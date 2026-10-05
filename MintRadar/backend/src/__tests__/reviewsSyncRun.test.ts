import { describe, it, expect, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, type Event as NostrEvent } from 'nostr-tools'

vi.mock('../db.js', () => ({ pool: { connect: vi.fn(), query: vi.fn() }, initDb: vi.fn() }))
vi.mock('../prober.js', () => ({ getKnownMints: vi.fn() }))

import { runReviewsSync, type ReviewsSyncDeps, type SyncedReview } from '../reviewsSync.js'
import type { ConnectRelay, RelayConnection, RelaySyncState, ReviewFilter, RelayQueryResult } from '../reviewsRelayFetch.js'

const START_MS = 1_800_000_000_000
const START_S = START_MS / 1000

const review = (url: string, text: string, sk = generateSecretKey(), created_at = START_S - 60, kind = 38000): NostrEvent =>
  finalizeEvent({ kind, created_at, content: text, tags: [['k', '38172'], ['u', url, 'cashu']] }, sk)

interface RelayStub { events?: NostrEvent[]; fail?: 'connect' | RelayQueryResult }

function harness(stubs: Record<string, RelayStub>, mints: string[], state: Record<string, RelaySyncState> = {}, over: Partial<ReviewsSyncDeps> = {}) {
  const filters: Record<string, ReviewFilter[]> = {}
  const persisted: Array<{ url: string; reviews: SyncedReview[] }> = []
  const saved: Array<{ relay: string; startedAtSec: number; full: boolean }> = []
  const logs: string[] = []
  const connect: ConnectRelay = async relay => {
    const stub = stubs[relay]!
    if (stub.fail === 'connect') throw new Error('connect')
    filters[relay] = []
    const conn: RelayConnection = {
      async query(f) {
        filters[relay]!.push(f)
        if (stub.fail) return stub.fail
        // relay semantics: #u match + since + newest first + limit
        const hits = (stub.events ?? [])
          .filter(e => e.tags.some(t => t[0] === 'u' && f['#u'].includes(t[1] as string)))
          .filter(e => f.since === undefined || e.created_at >= f.since)
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, f.limit)
        return { status: 'ok', events: hits }
      },
      close() {},
    }
    return conn
  }
  const deps: ReviewsSyncDeps = {
    relays: Object.keys(stubs),
    getMints: async () => mints,
    loadState: async () => new Map(Object.entries(state)),
    saveState: async (relay, startedAtSec, full) => { saved.push({ relay, startedAtSec, full }) },
    persist: async (url, reviews) => { persisted.push({ url, reviews }) },
    connect,
    now: () => START_MS,
    sleep: async () => {},
    random: () => 0,
    log: l => logs.push(l),
    ...over,
  }
  return { deps, filters, persisted, saved, logs }
}

const A = 'https://a.example'
const B = 'https://b.example'
const C = 'https://c.example'

describe('runReviewsSync', () => {
  it('merges relays, keeps the newest review per author and mint, and stores each mint once', async () => {
    const alice = generateSecretKey()
    const old = review(A, '[1/5] old', alice, START_S - 500)
    const fresh = review(A, '[5/5] new', alice, START_S - 100)
    const h = harness({ 'wss://one': { events: [old, review(B, '[4/5] b')] }, 'wss://two': { events: [fresh, old] } }, [A, B, C])
    const s = await runReviewsSync(h.deps)
    const byUrl = new Map(h.persisted.map(p => [p.url, p.reviews]))
    expect(byUrl.get(A)).toHaveLength(1)
    expect(byUrl.get(A)![0]).toMatchObject({ eventId: fresh.id, rating: 5, comment: 'new' })
    expect(byUrl.get(B)).toHaveLength(1)
    expect(byUrl.get(C)).toEqual([]) // covered, nothing found: still stamped by persist
    expect(s).toMatchObject({ mints: 3, relaysUsed: 2, relaysFailed: 0, updated: 3, persistFailed: 0 })
  })

  it('drops events with a bad signature or another kind, keeps the rest', async () => {
    const good = JSON.parse(JSON.stringify(review(A, '[5/5] fine'))) as NostrEvent
    // Round-tripped through JSON like a relay message: drops nostr-tools' in-memory "already verified" marker.
    const forged = JSON.parse(JSON.stringify({ ...review(A, '[5/5] forged'), content: '[1/5] tampered after signing' })) as NostrEvent
    const wrongKind = review(A, '[5/5] note', generateSecretKey(), START_S - 10, 1)
    const h = harness({ 'wss://one': { events: [good, forged, wrongKind] } }, [A])
    await runReviewsSync(h.deps)
    expect(h.persisted[0]!.reviews.map(r => r.eventId)).toEqual([good.id])
  })

  it('does not touch a mint that no relay answered for', async () => {
    const h = harness({ 'wss://down': { fail: 'connect' }, 'wss://ok': { events: [] } }, [A, B], {}, {
      config: { batchSize: 1 },
      connect: async relay => {
        if (relay === 'wss://down') throw new Error('connect')
        let n = 0
        return { query: async () => (++n === 1 ? { status: 'ok', events: [] } : { status: 'blocked', reason: 'closed-pushback' }), close() {} } as RelayConnection
      },
    })
    const s = await runReviewsSync(h.deps)
    expect(h.persisted.map(p => p.url)).toEqual([A]) // B's batch was refused
    expect(s.relaysFailed).toBe(2)
  })

  it('every relay down: nothing is stored, no state moves', async () => {
    const h = harness({ 'wss://a': { fail: 'connect' }, 'wss://b': { fail: 'connect' } }, [A, B])
    const s = await runReviewsSync(h.deps)
    expect(h.persisted).toEqual([])
    expect(h.saved).toEqual([])
    expect(s).toMatchObject({ relaysUsed: 0, relaysFailed: 2, updated: 0 })
  })

  it('first run is a full sweep (no since); clean relays are marked, with the full flag', async () => {
    const h = harness({ 'wss://a': { events: [] }, 'wss://b': { events: [] } }, [A])
    await runReviewsSync(h.deps)
    for (const f of Object.values(h.filters).flat()) expect('since' in f).toBe(false)
    expect(h.saved).toEqual([
      { relay: 'wss://a', startedAtSec: START_S, full: true },
      { relay: 'wss://b', startedAtSec: START_S, full: true },
    ])
  })

  it('later runs are incremental per relay: since = that relay\'s last clean start minus 2 h', async () => {
    const state = {
      'wss://a': { lastOkStartedAt: START_S - 3600, lastFullAt: START_S - 3600 },
      'wss://b': { lastOkStartedAt: START_S - 5 * 3600, lastFullAt: START_S - 6 * 3600 }, // failed since, falls further back
    }
    const h = harness({ 'wss://a': { events: [] }, 'wss://b': { events: [] } }, [A], state)
    await runReviewsSync(h.deps)
    expect(h.filters['wss://a']![0]!.since).toBe(START_S - 3600 - 2 * 3600)
    expect(h.filters['wss://b']![0]!.since).toBe(START_S - 5 * 3600 - 2 * 3600)
    expect(h.saved.every(s => s.full === false)).toBe(true)
  })

  it('a full sweep is due once the last one is a day old', async () => {
    const h = harness({ 'wss://a': { events: [] } }, [A], { 'wss://a': { lastOkStartedAt: START_S - 3600, lastFullAt: START_S - 24 * 3600 } })
    await runReviewsSync(h.deps)
    expect('since' in h.filters['wss://a']![0]!).toBe(false)
    expect(h.saved).toEqual([{ relay: 'wss://a', startedAtSec: START_S, full: true }])
  })

  it('a relay that failed or was skipped does not move its state', async () => {
    const h = harness({
      'wss://ok': { events: [] },
      'wss://limited': { fail: { status: 'blocked', reason: 'closed-pushback' } },
      'wss://flaky': { fail: { status: 'failed', reason: 'timeout' } },
    }, [A])
    await runReviewsSync(h.deps)
    expect(h.saved.map(s => s.relay)).toEqual(['wss://ok'])
  })

  it('a failed database write keeps all relay state where it was', async () => {
    const h = harness({ 'wss://a': { events: [review(A, '[5/5] x')] } }, [A], {}, {
      persist: async () => { throw new Error('db down') },
    })
    const s = await runReviewsSync(h.deps)
    expect(s.persistFailed).toBe(1)
    expect(h.saved).toEqual([])
  })

  it('an unreadable state table means a full sweep, not a failed run', async () => {
    const h = harness({ 'wss://a': { events: [] } }, [A], {}, { loadState: async () => { throw new Error('no table') } })
    const s = await runReviewsSync(h.deps)
    expect('since' in h.filters['wss://a']![0]!).toBe(false)
    expect(s.updated).toBe(1)
  })

  it('stores nothing for a mint that is not tracked, whatever the relay sends', async () => {
    const h = harness({ 'wss://a': { events: [review('https://other.example', '[5/5] x')] } }, [A])
    await runReviewsSync(h.deps)
    expect(h.persisted).toEqual([{ url: A, reviews: [] }])
  })

  it('batches the mints: 76 mints, one relay, 4 REQs of at most 20', async () => {
    const mints = Array.from({ length: 76 }, (_, i) => `https://m${i}.example`)
    const h = harness({ 'wss://a': { events: [] } }, mints)
    const s = await runReviewsSync(h.deps)
    expect(h.filters['wss://a']!.map(f => f['#u'].length)).toEqual([20, 20, 20, 16])
    expect(s.reqs).toBe(4)
  })

  it('writes one summary line with counts only (no keys, no content)', async () => {
    const ev = review(A, '[5/5] secret text')
    const h = harness({ 'wss://a': { events: [ev] }, 'wss://b': { fail: 'connect' } }, [A])
    await runReviewsSync(h.deps)
    const done = h.logs.filter(l => l.includes('done:'))
    expect(done).toHaveLength(1)
    expect(done[0]).toMatch(/mints=1 relays_used=1 relays_failed_or_skipped=1 reqs=1 events=1 reviews_stored=1 mints_updated=1/)
    expect(done[0]).toMatch(/duration=/)
    for (const l of h.logs) {
      expect(l).not.toContain(ev.pubkey)
      expect(l).not.toContain('secret text')
    }
  })

  it('stops cleanly at the maximum run duration and logs it', async () => {
    let t = START_MS
    const h = harness({ 'wss://a': { events: [] } }, Array.from({ length: 76 }, (_, i) => `https://m${i}.example`), {}, {
      now: () => t,
      sleep: async ms => { t += ms },
      config: { maxRunMs: 2_000, pacingMinMs: 1_500, pacingMaxMs: 1_500 },
    })
    const s = await runReviewsSync(h.deps)
    expect(s.deadlineHit).toBe(true)
    expect(s.reqs).toBeLessThan(4)
    expect(h.logs.some(l => l.includes('max run duration'))).toBe(true)
    expect(h.saved).toEqual([]) // an incomplete relay is not marked clean
  })
})
