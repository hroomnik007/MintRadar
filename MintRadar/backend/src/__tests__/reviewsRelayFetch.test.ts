import { describe, it, expect, vi } from 'vitest'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { Event as NostrEvent } from 'nostr-tools'
import {
  REVIEW_FULL_SWEEP_INTERVAL_S,
  REVIEW_FULL_SWEEP_SLACK_S,
  REVIEW_SINCE_OVERLAP_S,
  chunk,
  connectRelayWs,
  fetchRelayReviews,
  groupEventsByMint,
  planRelayQuery,
  type ConnectRelay,
  type RelayConnection,
  type RelayQueryResult,
  type RelayRunOptions,
  type ReviewFilter,
} from '../reviewsRelayFetch.js'

const NOW = 1_800_000_000

function ev(id: string, urls: string[], created_at = NOW - 100, kind = 38000): NostrEvent {
  return { id, pubkey: 'p'.repeat(64), sig: 's', kind, content: '', created_at, tags: [['k', '38172'], ...urls.map(u => ['u', u, 'cashu'])] }
}

describe('planRelayQuery', () => {
  it('first run on a relay: full sweep, no since', () => {
    expect(planRelayQuery(undefined, NOW)).toEqual({ since: undefined, full: true })
  })
  it('state without a full-sweep time counts as first run', () => {
    expect(planRelayQuery({ lastOkStartedAt: NOW - 3600, lastFullAt: null }, NOW)).toEqual({ since: undefined, full: true })
  })
  it('hourly run: since = last clean start minus the overlap', () => {
    const plan = planRelayQuery({ lastOkStartedAt: NOW - 3600, lastFullAt: NOW - 7200 }, NOW)
    expect(plan).toEqual({ since: NOW - 3600 - REVIEW_SINCE_OVERLAP_S, full: false })
  })
  it('after a failure the state did not move, so since reaches further back', () => {
    // Clean runs stopped 5 hours ago; every run since failed and left the state untouched.
    const plan = planRelayQuery({ lastOkStartedAt: NOW - 5 * 3600, lastFullAt: NOW - 6 * 3600 }, NOW)
    expect(plan.since).toBe(NOW - 5 * 3600 - REVIEW_SINCE_OVERLAP_S)
    expect(plan.full).toBe(false)
  })
  it('after a full sweep the next hourly run is incremental from the sweep start', () => {
    const sweepStart = NOW - 3600
    expect(planRelayQuery({ lastOkStartedAt: sweepStart, lastFullAt: sweepStart }, NOW))
      .toEqual({ since: sweepStart - REVIEW_SINCE_OVERLAP_S, full: false })
  })
  it('a full sweep is due again about a day later (with slack for offset and jitter)', () => {
    const lastFull = NOW - (REVIEW_FULL_SWEEP_INTERVAL_S - REVIEW_FULL_SWEEP_SLACK_S)
    expect(planRelayQuery({ lastOkStartedAt: NOW - 3600, lastFullAt: lastFull }, NOW).full).toBe(true)
    expect(planRelayQuery({ lastOkStartedAt: NOW - 3600, lastFullAt: lastFull + 1 }, NOW).full).toBe(false)
  })
  it('since never goes negative', () => {
    expect(planRelayQuery({ lastOkStartedAt: 100, lastFullAt: 50 }, 200).since).toBe(0)
  })
})

describe('chunk', () => {
  it('splits into batches of at most the size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })
})

describe('groupEventsByMint', () => {
  // A fake relay with the real semantics of `#u`: an event matches when any of its u tags is in the filter.
  const relayMatches = (events: NostrEvent[], urls: string[]) =>
    events.filter(e => e.kind === 38000 && e.tags.some(t => t[0] === 'u' && urls.includes(t[1] as string)))
  const mints = ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example']
  const fixture = [
    ev('e1', ['https://a.example']),
    ev('e2', ['https://b.example']),
    ev('e3', ['https://a.example', 'https://c.example']), // names two tracked mints
    ev('e4', ['https://a.example/']),                      // trailing slash: not the stored URL, matches nobody
    ev('e5', ['https://untracked.example']),
    ev('e6', ['https://d.example'], NOW, 1),               // wrong kind
    ev('e7', ['https://d.example']),
  ]

  it('a batch result maps to the same mints as the per-mint queries', () => {
    const perMint = new Map<string, string[]>()
    for (const url of mints) {
      const ids = relayMatches(fixture, [url]).map(e => e.id)
      if (ids.length) perMint.set(url, ids)
    }
    const batchResult = relayMatches(fixture, mints)
    const grouped = groupEventsByMint(batchResult, new Set(mints))
    const viaBatch = new Map([...grouped].map(([url, list]) => [url, list.map(e => e.id)]))
    expect(viaBatch).toEqual(perMint)
    expect(viaBatch.get('https://a.example')).toEqual(['e1', 'e3'])
    expect(viaBatch.get('https://c.example')).toEqual(['e3'])
    expect(viaBatch.has('https://untracked.example')).toBe(false)
  })

  it('two batches covering the mints give the same grouping as one', () => {
    const one = groupEventsByMint(relayMatches(fixture, mints), new Set(mints))
    const halves = chunk(mints, 2)
    const merged = new Map<string, string[]>()
    for (const half of halves) {
      for (const [url, list] of groupEventsByMint(relayMatches(fixture, half), new Set(half))) {
        merged.set(url, [...(merged.get(url) ?? []), ...list.map(e => e.id)])
      }
    }
    expect(merged).toEqual(new Map([...one].map(([url, list]) => [url, list.map(e => e.id)])))
  })

  it('does not add an event twice for repeated u tags of the same mint', () => {
    const grouped = groupEventsByMint([ev('x', ['https://a.example', 'https://a.example'])], new Set(mints))
    expect(grouped.get('https://a.example')).toHaveLength(1)
  })
})

function makeOpts(over: Partial<RelayRunOptions> = {}): RelayRunOptions & { sleeps: number[] } {
  const sleeps: number[] = []
  let clock = 0
  return {
    batchSize: 20,
    limit: 500,
    connectTimeoutMs: 10_000,
    queryTimeoutMs: 15_000,
    pacingMinMs: 1_000,
    pacingMaxMs: 2_000,
    maxConsecutiveFailures: 3,
    deadlineMs: 600_000,
    now: () => clock,
    sleep: async ms => { sleeps.push(ms); clock += ms },
    random: () => 0.5,
    sleeps,
    ...over,
  }
}

function fakeConn(answer: (f: ReviewFilter, n: number) => RelayQueryResult) {
  const filters: ReviewFilter[] = []
  const conn: RelayConnection = {
    query: vi.fn(async (f: ReviewFilter) => { filters.push(f); return answer(f, filters.length) }),
    close: vi.fn(),
  }
  const connect: ConnectRelay = vi.fn(async () => conn)
  return { conn, connect, filters }
}

const urls76 = Array.from({ length: 76 }, (_, i) => `https://mint${i}.example`)
const OK: RelayQueryResult = { status: 'ok', events: [] }

describe('fetchRelayReviews', () => {
  it('sends one REQ per batch of at most 20 mints with kinds, #u, limit and since', async () => {
    const { connect, filters, conn } = fakeConn(() => OK)
    const opts = makeOpts()
    const res = await fetchRelayReviews('wss://r', connect, urls76, 1234, opts)
    expect(filters.map(f => f['#u'].length)).toEqual([20, 20, 20, 16])
    for (const f of filters) {
      expect(f.kinds).toEqual([38000])
      expect(f.limit).toBe(500)
      expect(f.since).toBe(1234)
    }
    expect(filters.flatMap(f => f['#u'])).toEqual(urls76)
    expect(res).toMatchObject({ outcome: 'ok', reqs: 4 })
    expect(res.covered.size).toBe(76)
    expect(conn.close).toHaveBeenCalledOnce()
  })

  it('omits since on a full sweep', async () => {
    const { connect, filters } = fakeConn(() => OK)
    await fetchRelayReviews('wss://r', connect, urls76.slice(0, 5), undefined, makeOpts())
    expect('since' in filters[0]!).toBe(false)
  })

  it('pauses 1-2 s between batches to the same relay, not before the first', async () => {
    const { connect } = fakeConn(() => OK)
    const opts = makeOpts()
    await fetchRelayReviews('wss://r', connect, urls76, undefined, opts)
    expect(opts.sleeps).toEqual([1500, 1500, 1500])
    const lo = makeOpts({ random: () => 0 })
    await fetchRelayReviews('wss://r', connect, urls76, undefined, lo)
    expect(lo.sleeps.every(ms => ms === 1000)).toBe(true)
    const hi = makeOpts({ random: () => 0.999 })
    await fetchRelayReviews('wss://r', connect, urls76, undefined, hi)
    expect(hi.sleeps.every(ms => ms >= 1000 && ms <= 2000)).toBe(true)
  })

  it('never has two REQs in flight on one connection', async () => {
    let inFlight = 0
    let peak = 0
    const conn: RelayConnection = {
      query: async () => { inFlight++; peak = Math.max(peak, inFlight); await Promise.resolve(); inFlight--; return OK },
      close: vi.fn(),
    }
    await fetchRelayReviews('wss://r', async () => conn, urls76, undefined, makeOpts())
    expect(peak).toBe(1)
  })

  it('a CLOSED "rate-limited" skips the relay for the rest of the run', async () => {
    const { connect, filters, conn } = fakeConn((_, n) => n === 1 ? OK : { status: 'blocked', reason: 'closed-pushback' })
    const res = await fetchRelayReviews('wss://r', connect, urls76, undefined, makeOpts())
    expect(filters).toHaveLength(2) // second REQ was refused, third and fourth never sent
    expect(res.outcome).toBe('skipped')
    expect(res.reason).toBe('closed-pushback')
    expect(res.covered.size).toBe(20) // only the answered batch counts as covered
    expect(conn.close).toHaveBeenCalledOnce()
  })

  describe('consecutive failure counter', () => {
    it('3 failures in a row skip the relay', async () => {
      const { connect, filters } = fakeConn(() => ({ status: 'failed', reason: 'timeout' }))
      const res = await fetchRelayReviews('wss://r', connect, urls76, undefined, makeOpts())
      expect(filters).toHaveLength(3)
      expect(res).toMatchObject({ outcome: 'skipped', reason: '3-failures-in-a-row' })
    })
    it('a success in between resets the counter', async () => {
      const script: RelayQueryResult[] = [
        { status: 'failed', reason: 'timeout' }, { status: 'failed', reason: 'timeout' }, OK,
        { status: 'failed', reason: 'timeout' },
      ]
      const { connect, filters } = fakeConn((_, n) => script[n - 1] ?? OK)
      const res = await fetchRelayReviews('wss://r', connect, urls76, undefined, makeOpts())
      expect(filters).toHaveLength(4) // all four batches were tried
      expect(res.outcome).toBe('failed') // finished, but not cleanly
      expect(res.covered.size).toBe(20)
    })
    it('the threshold is a named option', async () => {
      const { connect, filters } = fakeConn(() => ({ status: 'failed', reason: 'timeout' }))
      await fetchRelayReviews('wss://r', connect, urls76, undefined, makeOpts({ maxConsecutiveFailures: 2 }))
      expect(filters).toHaveLength(2)
    })
  })

  it('a relay that cannot be reached fails without any REQ', async () => {
    const connect: ConnectRelay = async () => { throw new Error('connect') }
    const res = await fetchRelayReviews('wss://dead', connect, urls76, undefined, makeOpts())
    expect(res).toMatchObject({ outcome: 'failed', reason: 'connect', reqs: 0 })
  })

  it('a full batch (limit reached) is asked again in halves until the answers are no longer full', async () => {
    const full = (n: number): RelayQueryResult => ({ status: 'ok', events: Array.from({ length: n }, (_, i) => ev(`x${i}`, [])) })
    const { connect, filters } = fakeConn(f => f['#u'].length > 5 ? full(3) : OK)
    const res = await fetchRelayReviews('wss://r', connect, urls76.slice(0, 20), undefined, makeOpts({ limit: 3 }))
    expect(filters.map(f => f['#u'].length)).toEqual([20, 10, 5, 5, 10, 5, 5])
    expect(res.covered.size).toBe(20)
    expect(res.outcome).toBe('ok')
  })

  it('stops cleanly when the run deadline passes', async () => {
    const { connect, filters, conn } = fakeConn(() => OK)
    // 1.5 s pause per batch, deadline after ~2 s: the first batch goes out, the second is cut off.
    const res = await fetchRelayReviews('wss://r', connect, urls76, undefined, makeOpts({ deadlineMs: 2_000 }))
    expect(filters.length).toBeLessThan(4)
    expect(res.outcome).toBe('deadline')
    expect(conn.close).toHaveBeenCalledOnce()
  })

  it('does nothing for an empty mint list', async () => {
    const connect = vi.fn()
    const res = await fetchRelayReviews('wss://r', connect as unknown as ConnectRelay, [], undefined, makeOpts())
    expect(connect).not.toHaveBeenCalled()
    expect(res.reqs).toBe(0)
  })
})

describe('connectRelayWs against a local stub relay', () => {
  async function stub(onReq: (ws: WsSocket, subId: string, msg: unknown[]) => void, onConnect?: (ws: WsSocket) => void) {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    await new Promise<void>(r => wss.on('listening', () => r()))
    wss.on('connection', ws => {
      onConnect?.(ws)
      ws.on('message', raw => {
        const msg = JSON.parse(raw.toString()) as unknown[]
        if (msg[0] === 'REQ') onReq(ws, msg[1] as string, msg)
      })
    })
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`
    return { url, close: () => new Promise<void>(r => { for (const c of wss.clients) c.terminate(); wss.close(() => r()) }) }
  }
  const filter: ReviewFilter = { kinds: [38000], '#u': ['https://a.example'], limit: 500 }

  it('collects EVENTs until EOSE and drops malformed ones', async () => {
    const good = ev('good', ['https://a.example'])
    const s = await stub((ws, sub) => {
      ws.send(JSON.stringify(['EVENT', sub, good]))
      ws.send(JSON.stringify(['EVENT', sub, { id: 1 }]))
      ws.send(JSON.stringify(['EVENT', 'other-sub', ev('ignored', [])]))
      ws.send(JSON.stringify(['EOSE', sub]))
    })
    const conn = await connectRelayWs(s.url, 2000)
    const res = await conn.query(filter, 2000)
    conn.close()
    await s.close()
    expect(res.status).toBe('ok')
    if (res.status === 'ok') expect(res.events.map(e => e.id)).toEqual(['good'])
  })

  it('sends the filter it was given', async () => {
    let seen: unknown
    const s = await stub((ws, sub, msg) => { seen = msg[2]; ws.send(JSON.stringify(['EOSE', sub])) })
    const conn = await connectRelayWs(s.url, 2000)
    await conn.query({ ...filter, since: 42 }, 2000)
    conn.close()
    await s.close()
    expect(seen).toEqual({ ...filter, since: 42 })
  })

  it.each(['rate-limited: slow down', 'error: too many concurrent REQs', 'blocked: not allowed'])('CLOSED "%s" is a pushback', async reason => {
    const s = await stub((ws, sub) => ws.send(JSON.stringify(['CLOSED', sub, reason])))
    const conn = await connectRelayWs(s.url, 2000)
    const res = await conn.query(filter, 2000)
    conn.close()
    await s.close()
    expect(res).toEqual({ status: 'blocked', reason: 'closed-pushback' })
  })

  it('another CLOSED reason is an ordinary failure', async () => {
    const s = await stub((ws, sub) => ws.send(JSON.stringify(['CLOSED', sub, 'auth-required: sign in'])))
    const conn = await connectRelayWs(s.url, 2000)
    const res = await conn.query(filter, 2000)
    conn.close()
    await s.close()
    expect(res).toEqual({ status: 'failed', reason: 'closed-other' })
  })

  it('a pushback NOTICE ends the query and blocks later ones', async () => {
    const s = await stub(ws => ws.send(JSON.stringify(['NOTICE', 'ERROR: rate-limited'])))
    const conn = await connectRelayWs(s.url, 2000)
    expect(await conn.query(filter, 2000)).toEqual({ status: 'blocked', reason: 'notice-pushback' })
    expect(await conn.query(filter, 2000)).toEqual({ status: 'blocked', reason: 'notice-pushback' })
    conn.close()
    await s.close()
  })

  it('an unrelated NOTICE is ignored', async () => {
    const s = await stub((ws, sub) => { ws.send(JSON.stringify(['NOTICE', 'welcome'])); ws.send(JSON.stringify(['EOSE', sub])) })
    const conn = await connectRelayWs(s.url, 2000)
    const res = await conn.query(filter, 2000)
    conn.close()
    await s.close()
    expect(res.status).toBe('ok')
  })

  it('a connection closed after the REQ is a pushback', async () => {
    const s = await stub(ws => ws.close())
    const conn = await connectRelayWs(s.url, 2000)
    const res = await conn.query(filter, 2000)
    await s.close()
    expect(res).toEqual({ status: 'blocked', reason: 'closed-after-req' })
    conn.close()
  })

  it('no answer within the timeout is a failure', async () => {
    const s = await stub(() => { /* never answers */ })
    const conn = await connectRelayWs(s.url, 2000)
    const res = await conn.query(filter, 100)
    conn.close()
    await s.close()
    expect(res).toEqual({ status: 'failed', reason: 'timeout' })
  })

  it('rejects when nothing listens', async () => {
    await expect(connectRelayWs('ws://127.0.0.1:1', 1000)).rejects.toThrow()
  })
})
