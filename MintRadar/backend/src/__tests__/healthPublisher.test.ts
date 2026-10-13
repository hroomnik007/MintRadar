import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateSecretKey, getPublicKey, nip19, verifyEvent } from 'nostr-tools'
import type { Event as NostrEvent } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'

// healthPublisher.ts with every external boundary mocked: no database (db.js pool), no relay connection (SimplePool,
// counted by poolCtor), a fake RelayPublisher. Real relay sockets are covered in healthRelays.test.ts.

const { poolCtor } = vi.hoisted(() => ({ poolCtor: vi.fn() }))
vi.mock('nostr-tools/pool', async importOriginal => {
  const actual = await importOriginal<typeof import('nostr-tools/pool')>()
  return {
    ...actual,
    SimplePool: vi.fn().mockImplementation(function SimplePoolMock() {
      poolCtor()
      return { publish: vi.fn(), destroy: vi.fn() }
    }),
  }
})
vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))

import { pool as db } from '../db.js'
import { METHODOLOGY_VERSION } from '../shared/methodology.js'
import { ATTESTATION_MAX_EVENTS_PER_RUN, ATTESTATION_PUBKEY_HEX, ATTESTATION_RELAYS, type PublishedState } from '../healthAssertions.js'
import {
  ATTESTATION_PROFILE_REFRESH_MS, ATTESTATION_RELAY_PAUSE_MS, ATTESTATION_START_OFFSET_MS, ATTESTATION_TICK_MS,
  loadAttestationStates, planCycle, publishBatch, runAttestationCycle, saveAttestationState, startAttestations,
  type DueItem, type RelayPublisher,
} from '../healthPublisher.js'
import type { KnownMintLike, Snapshot } from '../walletApi.js'

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0)

function row(n: number, over: Partial<KnownMintLike> = {}): KnownMintLike {
  return {
    url: `https://mint${n}.example.com`, name: `Mint ${n}`, archived: false, degraded: false, online: true, version: 'Nutshell/0.17.5',
    softwareLatest: { major: 0, minor: 17 }, nutsLimits: null, units: ['sat'],
    auditCzTotal: 100, auditCzBlamed: 0, auditCzFetchedAt: new Date(NOW - 3_600_000).toISOString(),
    discoveredAt: new Date(NOW - 90 * 86_400_000).toISOString(), reliabilityScore: 80,
    uptimePct24h: 100, uptimePct7d: 99, lastCheckedAt: new Date(NOW - 60_000).toISOString(),
    reviewCount: 3, reviewRatedCount: 3, reviewAvgRating: 4.5, operatorReviewCount: 0, latencyMs: 120,
    ...over,
  }
}
const snapshotOf = (rows: KnownMintLike[]): Snapshot => ({ data: rows, computedAt: NOW })
const manyRows = (n: number): KnownMintLike[] => Array.from({ length: n }, (_, i) => row(i + 1))

/** An in-memory attestation_state plus a recording relay publisher. */
function harness(opts: { reject?: (relay: string) => boolean } = {}) {
  const store = new Map<string, PublishedState>()
  const sent: Array<{ relay: string; event: NostrEvent }> = []
  const publisher: RelayPublisher = {
    publish: async (relay, event) => {
      sent.push({ relay, event })
      if (opts.reject?.(relay)) throw new Error('rejected')
    },
    close: vi.fn(),
  }
  const saveState = vi.fn(async (d: string, event: NostrEvent, c: { rank: number; status: string; methodology: number }) => {
    store.set(d, { lastCreatedAt: event.created_at, lastRank: c.rank, lastStatus: c.status, lastMethodology: c.methodology })
  })
  return { store, sent, publisher, saveState, loadStates: async () => new Map(store) }
}

beforeEach(() => { poolCtor.mockClear(); vi.mocked(db.query).mockReset() })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

// ── Inert mode ───────────────────────────────────────────────────────────────

describe('inert mode (no key, invalid key, wrong key)', () => {
  function captureConsole() {
    const out: string[] = []
    const record = (...args: unknown[]) => { out.push(args.map(a => (a instanceof Error ? a.message : String(a))).join(' ')) }
    const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(record))
    return { out, spies, log: spies[0]!, error: spies[1]! }
  }

  it.each([[undefined], [''], ['   ']])('no key (%j): ONE log line, no timer, no network, no database access, no snapshot read', env => {
    vi.useFakeTimers()
    const cap = captureConsole()
    const loadSnapshot = vi.fn()
    const publishProfile = vi.fn()
    const handle = startAttestations({ env: env === undefined ? {} : { ATTESTATION_SERVICE_NSEC: env }, loadSnapshot, publishProfile })
    expect(handle).toBeNull()
    expect(cap.out).toHaveLength(1)
    expect(cap.out[0]).toBe('[attestations] disabled: no signing key is configured')
    expect(cap.log).toHaveBeenCalledTimes(1)
    expect(cap.error).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(ATTESTATION_TICK_MS * 10)
    expect(db.query).not.toHaveBeenCalled()
    expect(poolCtor).not.toHaveBeenCalled()
    expect(loadSnapshot).not.toHaveBeenCalled()
    expect(publishProfile).not.toHaveBeenCalled()
  })

  it('invalid key: disabled, ONE error line, nothing else, no part of the key in any output', () => {
    vi.useFakeTimers()
    const cap = captureConsole()
    const sk = generateSecretKey()
    const broken = nip19.nsecEncode(sk).slice(0, -4) + 'qqqq'
    const publishProfile = vi.fn()
    expect(startAttestations({ env: { ATTESTATION_SERVICE_NSEC: broken }, loadSnapshot: vi.fn(), publishProfile })).toBeNull()
    expect(cap.out).toHaveLength(1)
    expect(cap.error).toHaveBeenCalledTimes(1)
    expect(cap.log).not.toHaveBeenCalled()
    const all = cap.out.join('\n')
    expect(all).not.toContain(broken)
    expect(all).not.toContain(broken.slice(5, 25))
    expect(vi.getTimerCount()).toBe(0)
    expect(db.query).not.toHaveBeenCalled()
    expect(poolCtor).not.toHaveBeenCalled()
    expect(publishProfile).not.toHaveBeenCalled()
  })

  it('wrong key (valid nsec, other identity — the production check against ATTESTATION_PUBKEY_HEX): disabled, ONE error line, no key material', () => {
    vi.useFakeTimers()
    const cap = captureConsole()
    const sk = generateSecretKey()
    const nsec = nip19.nsecEncode(sk)
    const publishProfile = vi.fn()
    // no expectedPubkey override: exactly what production does
    expect(startAttestations({ env: { ATTESTATION_SERVICE_NSEC: nsec }, loadSnapshot: vi.fn(), publishProfile })).toBeNull()
    expect(cap.out).toHaveLength(1)
    expect(cap.error).toHaveBeenCalledTimes(1)
    const all = cap.out.join('\n')
    for (const secret of [nsec, nsec.slice(5, 25), nsec.slice(-20), bytesToHex(sk), bytesToHex(sk).slice(0, 16), getPublicKey(sk)]) {
      expect(all).not.toContain(secret)
    }
    expect(vi.getTimerCount()).toBe(0)
    expect(db.query).not.toHaveBeenCalled()
    expect(poolCtor).not.toHaveBeenCalled()
    expect(publishProfile).not.toHaveBeenCalled()
    expect(ATTESTATION_PUBKEY_HEX).not.toBe(getPublicKey(sk))
  })

  it('allowlist mode with a valid key: disabled with one line, no timer', () => {
    vi.useFakeTimers()
    const cap = captureConsole()
    const sk = generateSecretKey()
    const handle = startAttestations({
      env: { ATTESTATION_SERVICE_NSEC: nip19.nsecEncode(sk) }, expectedPubkey: getPublicKey(sk), loadSnapshot: vi.fn(),
      isAllowlistMode: () => true, publishProfile: vi.fn(),
    })
    expect(handle).toBeNull()
    expect(cap.out).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

// ── Enabled mode (fake relays) ───────────────────────────────────────────────

describe('enabled mode', () => {
  it('publishes the profile at start, runs a tick after the start offset, never overlaps, refreshes the profile daily', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const sk = generateSecretKey()
    const h = harness()
    const profiles: NostrEvent[] = []
    const publishProfile = vi.fn(async (relays: string[], event: NostrEvent) => { profiles.push(event); return { succeeded: relays.length, failed: 0 } })
    let release: (() => void) | null = null
    const gate = new Promise<void>(r => { release = r })
    let calls = 0
    const loadSnapshot = vi.fn(async () => { calls++; if (calls === 1) await gate; return snapshotOf(manyRows(3)) })

    const handle = startAttestations({
      env: { ATTESTATION_SERVICE_NSEC: nip19.nsecEncode(sk) }, expectedPubkey: getPublicKey(sk), loadSnapshot,
      publishProfile: publishProfile as never, random: () => 0,
      cycle: { loadStates: h.loadStates, saveState: h.saveState, publisher: h.publisher, sleep: async () => {} },
    })
    expect(handle).not.toBeNull()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(publishProfile).toHaveBeenCalledTimes(1)
    const [relays, profile] = publishProfile.mock.calls[0] as unknown as [string[], NostrEvent]
    expect(relays).toContain('wss://nostr.mintradar.org')
    expect(profile.kind).toBe(0)
    expect(profile.pubkey).toBe(getPublicKey(sk))
    expect(verifyEvent(profile)).toBe(true)
    expect(JSON.parse(profile.content)).toMatchObject({ name: 'MintRadar Health', nip05: 'health@mintradar.org' })
    expect(JSON.parse(profile.content)).not.toHaveProperty('picture')

    // first tick starts at the start offset (random = 0) and blocks inside loadSnapshot
    await vi.advanceTimersByTimeAsync(ATTESTATION_START_OFFSET_MS)
    expect(loadSnapshot).toHaveBeenCalledTimes(1)
    // the next tick lands while the first still runs: skipped (single-flight)
    await vi.advanceTimersByTimeAsync(ATTESTATION_TICK_MS)
    expect(loadSnapshot).toHaveBeenCalledTimes(1)
    release!()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.store.size).toBe(3)
    // later ticks run again (nothing due: the 6 h minimum has not passed)
    await vi.advanceTimersByTimeAsync(ATTESTATION_TICK_MS)
    expect(loadSnapshot).toHaveBeenCalledTimes(2)
    // the daily profile refresh happens on a tick after 24 h
    await vi.advanceTimersByTimeAsync(ATTESTATION_PROFILE_REFRESH_MS)
    expect(publishProfile.mock.calls.length).toBeGreaterThanOrEqual(2)
    handle!.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})

// ── Planning ─────────────────────────────────────────────────────────────────

describe('planCycle', () => {
  it('skips null-score and archived mints, publishes offline and test mints', () => {
    const rows = [
      row(1), row(2, { reliabilityScore: null }), row(3, { archived: true }),
      row(4, { online: false }), row(5, { url: 'https://testnut.cashu.space' }),
    ]
    const plan = planCycle(rows, new Map(), NOW)
    expect(plan.eligible).toBe(3)
    const byD = new Map(plan.due.map(p => [p.d, p.template.tags] as const))
    expect([...byD.keys()].sort()).toEqual(['https://mint1.example.com', 'https://mint4.example.com', 'https://testnut.cashu.space'])
    expect(byD.get('https://mint4.example.com')).toContainEqual(['mint_status', 'offline'])
    expect(byD.get('https://testnut.cashu.space')).toContainEqual(['mint_test', '1'])
  })

  it('a mint that is ineligible gets no event even when it has an old state row', () => {
    const states = new Map([['https://mint2.example.com', { lastCreatedAt: Math.floor(NOW / 1000) - 40 * 3600, lastRank: 80, lastStatus: 'online', lastMethodology: METHODOLOGY_VERSION }]])
    expect(planCycle([row(2, { reliabilityScore: null })], states, NOW).due).toEqual([])
    expect(planCycle([row(2, { archived: true })], states, NOW).due).toEqual([])
  })

  it('caps the run at 200 events: never-published first, then the oldest', () => {
    const rows = manyRows(250)
    const states = new Map<string, PublishedState>()
    // mints 1..50 were published long ago (due for the daily refresh), 51..250 never published
    for (let i = 1; i <= 50; i++) states.set(`https://mint${i}.example.com`, { lastCreatedAt: Math.floor(NOW / 1000) - 30 * 3600 - i, lastRank: 80, lastStatus: 'online', lastMethodology: METHODOLOGY_VERSION })
    const plan = planCycle(rows, states, NOW)
    expect(plan.due).toHaveLength(ATTESTATION_MAX_EVENTS_PER_RUN)
    expect(plan.deferred).toBe(50)
    expect(plan.due.slice(0, 200).every(p => !states.has(p.d))).toBe(true) // the 200 never-published mints fill the run
    expect(plan.due.some(p => states.has(p.d))).toBe(false)
  })

  it('refreshes the oldest published mints first when everything is already published', () => {
    const rows = manyRows(3)
    const base = Math.floor(NOW / 1000) - 30 * 3600
    const states = new Map<string, PublishedState>([
      ['https://mint1.example.com', { lastCreatedAt: base + 20, lastRank: 80, lastStatus: 'online', lastMethodology: METHODOLOGY_VERSION }],
      ['https://mint2.example.com', { lastCreatedAt: base + 10, lastRank: 80, lastStatus: 'online', lastMethodology: METHODOLOGY_VERSION }],
      ['https://mint3.example.com', { lastCreatedAt: base + 30, lastRank: 80, lastStatus: 'online', lastMethodology: METHODOLOGY_VERSION }],
    ])
    expect(planCycle(rows, states, NOW).due.map(p => p.d)).toEqual(['https://mint2.example.com', 'https://mint1.example.com', 'https://mint3.example.com'])
  })

  it('publishes one event per d (two rows that normalise to the same URL)', () => {
    const plan = planCycle([row(1), row(1, { url: 'https://MINT1.example.com/' })], new Map(), NOW)
    expect(plan.due).toHaveLength(1)
  })
})

// ── Pacing and relay failures (fake publisher, fake timers) ─────────────────

describe('publishBatch', () => {
  function items(n: number): DueItem[] {
    return planCycle(manyRows(n), new Map(), NOW).due.map(p => ({
      d: p.d, candidate: p.candidate,
      event: { ...p.template, id: `id-${p.d}`, pubkey: 'p', sig: 's' } as NostrEvent,
    }))
  }

  it('pauses 200 ms between events on each relay (fake timers)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const times: Array<{ relay: string; at: number }> = []
    const publisher: RelayPublisher = { publish: async relay => { times.push({ relay, at: Date.now() - NOW }) }, close: () => {} }
    const run = publishBatch(items(4), { publisher, relays: ['wss://a.example', 'wss://b.example'], onAccepted: async () => {} })
    await vi.advanceTimersByTimeAsync(5000)
    await run
    expect(ATTESTATION_RELAY_PAUSE_MS).toBe(200)
    for (const relay of ['wss://a.example', 'wss://b.example']) {
      expect(times.filter(t => t.relay === relay).map(t => t.at)).toEqual([0, 200, 400, 600])
    }
  })

  it('skips a relay after 3 consecutive failures; the other relay keeps going; counts are reported', async () => {
    const calls: Record<string, number> = {}
    const publisher: RelayPublisher = {
      publish: async relay => { calls[relay] = (calls[relay] ?? 0) + 1; if (relay === 'wss://bad.example') throw new Error('blocked: nope') },
      close: () => {},
    }
    const accepted: string[] = []
    const stats = await publishBatch(items(10), {
      publisher, relays: ['wss://bad.example', 'wss://good.example'], sleep: async () => {}, onAccepted: async i => { accepted.push(i.d) },
    })
    expect(calls['wss://bad.example']).toBe(3)
    expect(calls['wss://good.example']).toBe(10)
    expect(stats.relays['wss://bad.example']).toEqual({ ok: 0, failed: 3, skipped: 7 })
    expect(stats.relays['wss://good.example']).toEqual({ ok: 10, failed: 0, skipped: 0 })
    expect(stats.accepted).toBe(10)
    expect(accepted).toHaveLength(10)
  })

  it('a success resets the failure streak (fail, fail, ok, fail, fail does not skip)', async () => {
    const pattern = [false, false, true, false, false, true]
    let i = 0
    const publisher: RelayPublisher = { publish: async () => { if (!pattern[i++]) throw new Error('x') }, close: () => {} }
    const stats = await publishBatch(items(6), { publisher, relays: ['wss://r.example'], sleep: async () => {}, onAccepted: async () => {} })
    expect(stats.relays['wss://r.example']).toEqual({ ok: 2, failed: 4, skipped: 0 })
  })

  it('calls onAccepted once per event even when several relays accept it', async () => {
    const publisher: RelayPublisher = { publish: async () => {}, close: () => {} }
    const onAccepted = vi.fn(async () => {})
    await publishBatch(items(5), { publisher, relays: ['wss://a.example', 'wss://b.example', 'wss://c.example'], sleep: async () => {}, onAccepted })
    expect(onAccepted).toHaveBeenCalledTimes(5)
  })

  it('a failing state write does not stop the run and the mint stays due', async () => {
    const publisher: RelayPublisher = { publish: async () => {}, close: () => {} }
    const stats = await publishBatch(items(3), { publisher, relays: ['wss://a.example'], sleep: async () => {}, onAccepted: async () => { throw new Error('db down') } })
    expect(stats.relays['wss://a.example']).toEqual({ ok: 3, failed: 0, skipped: 0 })
  })
})

// ── One run ──────────────────────────────────────────────────────────────────

describe('runAttestationCycle', () => {
  const quiet = () => {}

  it('only ever talks to the four relay constants, signs with the key, and records the state after acceptance', async () => {
    const sk = generateSecretKey()
    const h = harness()
    const res = await runAttestationCycle({
      secretKey: sk, loadSnapshot: async () => snapshotOf(manyRows(5)), loadStates: h.loadStates, saveState: h.saveState,
      publisher: h.publisher, now: () => NOW, sleep: async () => {}, log: quiet,
    })
    expect(res).toMatchObject({ eligible: 5, due: 5, accepted: 5 })
    expect([...new Set(h.sent.map(s => s.relay))].sort()).toEqual([...ATTESTATION_RELAYS].sort())
    expect(h.sent).toHaveLength(5 * 4)
    for (const { event } of h.sent) {
      expect(verifyEvent(event)).toBe(true)
      expect(event.pubkey).toBe(getPublicKey(sk))
      expect(event.kind).toBe(30385)
    }
    expect(h.store.size).toBe(5)
    expect(h.saveState).toHaveBeenCalledTimes(5)
    expect(h.publisher.close).toHaveBeenCalledTimes(1)
  })

  it('a restart does not republish: the stored state decides (new run, same store)', async () => {
    const sk = generateSecretKey()
    const h = harness()
    const base = { secretKey: sk, loadSnapshot: async () => snapshotOf(manyRows(4)), loadStates: h.loadStates, saveState: h.saveState, publisher: h.publisher, sleep: async () => {}, log: quiet }
    await runAttestationCycle({ ...base, now: () => NOW })
    const before = h.sent.length
    const again = await runAttestationCycle({ ...base, now: () => NOW + 15 * 60_000 })
    expect(again.due).toBe(0)
    expect(h.sent).toHaveLength(before)
    // after the 24 hour refresh point everything is due again
    const later = await runAttestationCycle({ ...base, now: () => NOW + 24 * 3_600_000 })
    expect(later.due).toBe(4)
  })

  it('an event rejected by every relay does not update the state; the next run retries it even inside the 6 hours', async () => {
    const sk = generateSecretKey()
    let reject = true
    const h = harness({ reject: () => reject })
    const base = { secretKey: sk, loadSnapshot: async () => snapshotOf(manyRows(2)), loadStates: h.loadStates, saveState: h.saveState, publisher: h.publisher, sleep: async () => {}, log: quiet }
    const first = await runAttestationCycle({ ...base, now: () => NOW })
    expect(first.accepted).toBe(0)
    expect(h.saveState).not.toHaveBeenCalled()
    expect(h.store.size).toBe(0)
    reject = false
    const second = await runAttestationCycle({ ...base, now: () => NOW + 15 * 60_000 })
    expect(second.accepted).toBe(2)
    expect(h.store.size).toBe(2)
  })

  it('the own relay rejecting (not yet on the allow-list) still records the state when another relay accepts', async () => {
    const sk = generateSecretKey()
    const h = harness({ reject: relay => relay === 'wss://nostr.mintradar.org' })
    const res = await runAttestationCycle({
      secretKey: sk, loadSnapshot: async () => snapshotOf(manyRows(6)), loadStates: h.loadStates, saveState: h.saveState,
      publisher: h.publisher, now: () => NOW, sleep: async () => {}, log: quiet,
    })
    expect(res.accepted).toBe(6)
    expect(res.relays['wss://nostr.mintradar.org']).toEqual({ ok: 0, failed: 3, skipped: 3 })
    expect(h.store.size).toBe(6)
  })

  it('publishes at most 200 events per run to at most 4 relays', async () => {
    const sk = generateSecretKey()
    const h = harness()
    const res = await runAttestationCycle({
      secretKey: sk, loadSnapshot: async () => snapshotOf(manyRows(260)), loadStates: h.loadStates, saveState: h.saveState,
      publisher: h.publisher, now: () => NOW, sleep: async () => {}, log: quiet,
    })
    expect(res.due).toBe(200)
    expect(res.deferred).toBe(60)
    expect(h.sent.length).toBeLessThanOrEqual(200 * 4)
    // the deferred mints go out in the next run
    const next = await runAttestationCycle({
      secretKey: sk, loadSnapshot: async () => snapshotOf(manyRows(260)), loadStates: h.loadStates, saveState: h.saveState,
      publisher: h.publisher, now: () => NOW + 15 * 60_000, sleep: async () => {}, log: quiet,
    })
    expect(next.due).toBe(60)
  })

  it('logs counts only (no event ids, no mint URLs)', async () => {
    const lines: string[] = []
    const h = harness()
    await runAttestationCycle({
      secretKey: generateSecretKey(), loadSnapshot: async () => snapshotOf(manyRows(2)), loadStates: h.loadStates, saveState: h.saveState,
      publisher: h.publisher, now: () => NOW, sleep: async () => {}, log: l => lines.push(l),
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/2 eligible, 2 due \(0 deferred\), 2 accepted/)
    expect(lines[0]).not.toContain('mint1.example.com')
    expect(lines[0]).not.toMatch(/[0-9a-f]{64}/)
  })

  it('reads the snapshot once and the state once per run', async () => {
    const h = harness()
    const loadSnapshot = vi.fn(async () => snapshotOf(manyRows(3)))
    const loadStates = vi.fn(h.loadStates)
    await runAttestationCycle({ secretKey: generateSecretKey(), loadSnapshot, loadStates, saveState: h.saveState, publisher: h.publisher, now: () => NOW, sleep: async () => {}, log: quiet })
    expect(loadSnapshot).toHaveBeenCalledTimes(1)
    expect(loadStates).toHaveBeenCalledTimes(1)
  })
})

// ── State table ──────────────────────────────────────────────────────────────

describe('attestation_state access', () => {
  it('maps BIGINT strings, skips rows with a missing value', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [
        { mint_url: 'https://a.example', last_created_at: '1791979200', last_rank: 80, last_status: 'online', last_methodology: 3 },
        { mint_url: 'https://b.example', last_created_at: null, last_rank: 80, last_status: 'online', last_methodology: 3 },
        { mint_url: 'https://c.example', last_created_at: '1791979200', last_rank: null, last_status: 'online', last_methodology: 3 },
      ],
      rowCount: 3,
    } as never)
    const map = await loadAttestationStates()
    expect([...map.keys()]).toEqual(['https://a.example'])
    expect(map.get('https://a.example')).toEqual({ lastCreatedAt: 1791979200, lastRank: 80, lastStatus: 'online', lastMethodology: 3 })
    expect(String(vi.mocked(db.query).mock.calls[0]![0])).toMatch(/FROM attestation_state/)
  })

  it('saves with an upsert that keeps one row per mint', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)
    await saveAttestationState('https://a.example', { id: 'e'.repeat(64), created_at: 1791979200 } as NostrEvent, { rank: 80, status: 'online', methodology: 3 })
    const [sql, params] = vi.mocked(db.query).mock.calls[0]!
    expect(String(sql)).toMatch(/INSERT INTO attestation_state/)
    expect(String(sql)).toMatch(/ON CONFLICT \(mint_url\) DO UPDATE/)
    expect(params).toEqual(['https://a.example', 'e'.repeat(64), 1791979200, 80, 'online', 3])
  })
})
