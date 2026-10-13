import { describe, it, expect, vi, beforeEach } from 'vitest'
import { finalizeEvent, generateSecretKey, type Event as NostrEvent } from 'nostr-tools'

const { queries } = vi.hoisted(() => ({ queries: [] as Array<{ sql: string; params?: unknown[] }> }))
vi.mock('pg', () => ({
  Pool: class {
    query = async (sql: string, params?: unknown[]) => { queries.push({ sql, params }); return { rows: [], rowCount: 0 } }
    connect = vi.fn()
  },
}))
vi.mock('../prober.js', () => ({ getKnownMints: vi.fn() }))

import { initDb } from '../db.js'
import { accountRelayDeliveries, accountedIds, saveRelayCounters } from '../reviewsRelayStats.js'
import { runReviewsSync, type ReviewsSyncDeps, type SyncedReview } from '../reviewsSync.js'
import type { ConnectRelay, RelayConnection, RelaySyncState } from '../reviewsRelayFetch.js'

beforeEach(() => { queries.length = 0 })

const d = (relay: string, eventIds: string[], ok = true) => ({ relay, eventIds, ok })
const none = new Set<string>()

describe('accountRelayDeliveries', () => {
  it('two relays delivering the same events: exclusive 0 each', () => {
    const r = accountRelayDeliveries([d('a', ['1', '2']), d('b', ['1', '2'])], none)
    expect(r.counts).toEqual([
      { relay: 'a', delivered: 2, exclusive: 0, newEvents: 2 },
      { relay: 'b', delivered: 2, exclusive: 0, newEvents: 2 },
    ])
    expect(r.truncated).toBe(false)
  })

  it('a relay with unique events gets them as exclusive', () => {
    const r = accountRelayDeliveries([d('a', ['1', '2', '3']), d('b', ['1'])], none)
    expect(r.counts[0]).toMatchObject({ delivered: 3, exclusive: 2 })
    expect(r.counts[1]).toMatchObject({ delivered: 1, exclusive: 0 })
  })

  it('an empty relay delivers 0', () => {
    const r = accountRelayDeliveries([d('a', ['1']), d('b', [])], none)
    expect(r.counts[1]).toEqual({ relay: 'b', delivered: 0, exclusive: 0, newEvents: 0 })
  })

  it('a failed relay is not credited, but its ids still make an event non-exclusive', () => {
    const r = accountRelayDeliveries([d('a', ['1', '2']), d('bad', ['1'], false)], none)
    expect(r.counts[1]).toEqual({ relay: 'bad', delivered: 0, exclusive: 0, newEvents: 0 })
    expect(r.counts[0]).toMatchObject({ delivered: 2, exclusive: 1 })
  })

  it('duplicates inside one relay (several batches) count once', () => {
    const r = accountRelayDeliveries([d('a', ['1', '1', '2', '1'])], none)
    expect(r.counts[0]).toMatchObject({ delivered: 2, exclusive: 2 })
  })

  it('"new" excludes ids already stored', () => {
    const r = accountRelayDeliveries([d('a', ['1', '2']), d('b', ['2', '3'])], new Set(['2']))
    expect(r.counts.map(c => c.newEvents)).toEqual([1, 1])
  })

  it('caps the tracked ids and flags truncation; accountedIds uses the same cap', () => {
    const deliveries = [d('a', ['1', '2', '3']), d('b', ['3', '4'])]
    const r = accountRelayDeliveries(deliveries, none, 3)
    expect(r.truncated).toBe(true)
    expect(r.counts[0]).toMatchObject({ delivered: 3, exclusive: 2 }) // '3' is also known to b
    expect(r.counts[1]).toMatchObject({ delivered: 1, exclusive: 0 }) // '4' was dropped by the cap
    expect(accountedIds(deliveries, 3).sort()).toEqual(['1', '2', '3'])
    expect(accountRelayDeliveries(deliveries, none, 4).truncated).toBe(false)
  })
})

describe('saveRelayCounters', () => {
  it('writes all relays in ONE statement, additive, with non-negative integers only', async () => {
    await saveRelayCounters([
      { relay: 'wss://a', kind: 'ok', ms: 120.7, delivered: 3, exclusive: 1, newEvents: 2 },
      { relay: 'wss://b', kind: 'failed', ms: -5, delivered: -1, exclusive: 0, newEvents: 0 },
      { relay: 'wss://c', kind: 'skipped', ms: 9, delivered: 0, exclusive: 0, newEvents: 0 },
    ])
    expect(queries).toHaveLength(1)
    const { sql, params } = queries[0]!
    expect(sql).toContain('ON CONFLICT (relay) DO UPDATE')
    for (const c of ['runs', 'ok_runs', 'failed_runs', 'skipped_runs', 'events_delivered', 'events_exclusive', 'events_new', 'total_ms']) {
      expect(sql).toContain(`${c} = reviews_sync_relay_state.${c} +`) // values only ever grow
    }
    expect(params).toEqual([
      ['wss://a', 'wss://b', 'wss://c'], [1, 0, 0], [0, 1, 0], [0, 0, 1], [3, 0, 0], [1, 0, 0], [2, 0, 0], [120, 0, 9],
    ])
  })

  it('writes nothing for an empty list', async () => {
    await saveRelayCounters([])
    expect(queries).toHaveLength(0)
  })
})

describe('initDb migration of reviews_sync_relay_state', () => {
  it('is additive and idempotent (every statement IF NOT EXISTS / DROP NOT NULL), counters default to 0', async () => {
    await initDb()
    const sql = queries.map(q => q.sql).join('\n')
    for (const c of ['runs', 'ok_runs', 'failed_runs', 'skipped_runs', 'events_delivered', 'events_exclusive', 'events_new', 'total_ms', 'last_run_exclusive']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE reviews_sync_relay_state ADD COLUMN IF NOT EXISTS ${c} (INTEGER|BIGINT) NOT NULL DEFAULT 0;`))
    }
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS counters_since TIMESTAMPTZ NOT NULL DEFAULT now()')
    expect(sql).not.toMatch(/reviews_sync_relay_state[^;]*(DROP COLUMN|RENAME)/i)
    await initDb()
    expect(queries.length).toBeGreaterThan(0)
  })
})

// ── Sync run with and without accounting ──────────────────────────────────────────────────

const START_MS = 1_800_000_000_000
const START_S = START_MS / 1000
const A = 'https://a.example'
const review = (text: string, sk = generateSecretKey()): NostrEvent =>
  finalizeEvent({ kind: 38000, created_at: START_S - 60, content: text, tags: [['k', '38172'], ['u', A, 'cashu']] }, sk)

function run(stubs: Record<string, NostrEvent[] | 'connect'>, over: Partial<ReviewsSyncDeps> = {}, state: Record<string, RelaySyncState> = {}) {
  const persisted: Array<{ url: string; reviews: SyncedReview[] }> = []
  const saved: Array<{ relay: string; full: boolean }> = []
  const logs: string[] = []
  const connect: ConnectRelay = async relay => {
    const s = stubs[relay]!
    if (s === 'connect') throw new Error('x')
    const conn: RelayConnection = { async query() { return { status: 'ok', events: s } }, close() {} }
    return conn
  }
  const deps: ReviewsSyncDeps = {
    relays: Object.keys(stubs), getMints: async () => [A],
    loadState: async () => new Map(Object.entries(state)),
    saveState: async (relay, _s, full) => { saved.push({ relay, full }) },
    persist: async (url, reviews) => { persisted.push({ url, reviews }) },
    connect, now: () => START_MS, sleep: async () => {}, random: () => 0, log: l => logs.push(l), ...over,
  }
  return { deps, persisted, saved, logs }
}

describe('runReviewsSync accounting', () => {
  const shared = review('[5/5] shared')
  const onlyA = review('[4/5] a only')
  const stubs = { 'wss://relay.one': [shared, onlyA], 'wss://relay.two': [shared], 'wss://relay.bad': 'connect' as const }

  it('logs one line per relay (counts only) and writes the counters once', async () => {
    const saveCounters = vi.fn(async () => {})
    const h = run(stubs, { loadExistingEventIds: async () => new Set([shared.id]), saveCounters })
    await runReviewsSync(h.deps)
    const lines = h.logs.filter(l => l.startsWith('[reviews-sync] relay'))
    expect(lines).toEqual([
      '[reviews-sync] relay=relay.one result=ok ms=0 delivered=2 exclusive=1 new=1',
      '[reviews-sync] relay=relay.two result=ok ms=0 delivered=1 exclusive=0 new=0',
      '[reviews-sync] relay wss://relay.bad failed: connect ms=0 delivered=0 exclusive=0 new=0',
    ])
    expect(saveCounters).toHaveBeenCalledTimes(1)
    const rows = (saveCounters.mock.calls[0] as unknown as [Array<{ relay: string; kind: string }>])[0]
    expect(rows.map(r => [r.relay, r.kind])).toEqual([['wss://relay.one', 'ok'], ['wss://relay.two', 'ok'], ['wss://relay.bad', 'failed']])
    for (const l of h.logs) { expect(l).not.toContain(shared.id); expect(l).not.toContain(shared.pubkey); expect(l).not.toContain('only') }
  })

  it('stored reviews and relay state are identical with and without the accounting', async () => {
    const without = run(stubs)
    await runReviewsSync(without.deps)
    const withAcc = run(stubs, { loadExistingEventIds: async () => new Set(), saveCounters: async () => {} })
    await runReviewsSync(withAcc.deps)
    expect(withAcc.persisted).toEqual(without.persisted)
    expect(withAcc.saved).toEqual(without.saved)
  })

  it('an accounting failure does not touch the sync result and writes no counters', async () => {
    const saveCounters = vi.fn(async () => {})
    const base = run(stubs)
    await runReviewsSync(base.deps)
    const h = run(stubs, { loadExistingEventIds: async () => { throw new Error('db down') }, saveCounters })
    const s = await runReviewsSync(h.deps)
    expect(saveCounters).not.toHaveBeenCalled()
    expect(h.persisted).toEqual(base.persisted)
    expect(s.persistFailed).toBe(0)
    expect(h.logs.some(l => l.includes('relay accounting skipped'))).toBe(true)
  })

  it('an aborted run (persist throws out of the run) writes no counters; a failed counters write is only logged', async () => {
    const saveCounters = vi.fn(async () => {})
    const h = run(stubs, { loadExistingEventIds: async () => new Set(), saveCounters, getMints: async () => { throw new Error('boom') } })
    await expect(runReviewsSync(h.deps)).rejects.toThrow('boom')
    expect(saveCounters).not.toHaveBeenCalled()
    const h2 = run(stubs, { loadExistingEventIds: async () => new Set(), saveCounters: async () => { throw new Error('write failed') } })
    await expect(runReviewsSync(h2.deps)).resolves.toBeTruthy()
    expect(h2.logs.some(l => l.includes('could not save relay counters'))).toBe(true)
  })
})
