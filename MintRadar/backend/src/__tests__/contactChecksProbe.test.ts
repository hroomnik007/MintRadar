import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Where the contact checks hook into the probe: the body of the successful /v1/info the probe already fetched, no extra
// request to the mint, DNS work in the background. The probe result, the stored score and breakdown, the status and the
// notifications are the same with the checks, without them, and when DNS or the store throws.

vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))
const dnsMock = vi.hoisted(() => ({ resolveMx: vi.fn(), resolve4: vi.fn(), resolve6: vi.fn(), lookup: vi.fn() }))
vi.mock('dns/promises', () => ({
  lookup: dnsMock.lookup,
  Resolver: class { resolveMx = dnsMock.resolveMx; resolve4 = dnsMock.resolve4; resolve6 = dnsMock.resolve6 },
}))
vi.mock('../ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssrf.js')>()
  return { ...actual, safeFetch: vi.fn(), readJsonLimited: (res: { json: () => Promise<unknown> }) => res.json() }
})
const notify = vi.hoisted(() => ({
  notifySubscribers: vi.fn().mockResolvedValue(undefined),
  notifyAlert: vi.fn().mockResolvedValue(undefined),
  notifyMintChanges: vi.fn().mockResolvedValue(undefined),
  recordAlertClear: vi.fn().mockResolvedValue(undefined),
  isNotificationServiceEnabled: vi.fn().mockReturnValue(true),
}))
vi.mock('../nostrService.js', () => notify)
vi.mock('../versionCatalog.js', () => ({ getLatestVersionsMap: vi.fn().mockResolvedValue({ nutshell: { major: 0, minor: 17 } }) }))
vi.mock('../mintChanges.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mintChanges.js')>()
  return { ...actual, recordInfoObservation: vi.fn().mockResolvedValue(undefined), recordKeysetsObservation: vi.fn().mockResolvedValue(undefined) }
})

const { CONTACT_RULES_VERSION } = await import('../contactChecks.js')
const MINT = 'https://mint.example.com'
const CONTACT = [
  { method: 'email', info: 'ops@canary-mail-7f3a9c.com' },
  { method: 'nostr', info: 'ab'.repeat(32) },
  { method: 'twitter', info: '@canaryhandle7f3a9c' },
]
const INFO = { name: 'Test Mint', version: 'Nutshell/0.17.0', pubkey: '02' + 'ab'.repeat(32), nuts: { '4': {}, '5': {}, '7': {} }, contact: CONTACT }
const NOW = new Date(Date.UTC(2026, 9, 20, 12, 0, 0))

type Mode = 'on' | 'off' | 'dns-rejects' | 'dns-throws' | 'store-rejects'
let calls: Array<[string, unknown[]]>
let safeFetch: ReturnType<typeof vi.fn>

async function setup(mode: Mode, stored: unknown = null) {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  dnsMock.lookup.mockReset().mockResolvedValue([{ address: '1.2.3.4', family: 4 }])
  dnsMock.resolveMx.mockReset().mockResolvedValue([{ exchange: 'mx.mail.example', priority: 10 }])
  dnsMock.resolve4.mockReset().mockRejectedValue(Object.assign(new Error('x'), { code: 'ENODATA' }))
  dnsMock.resolve6.mockReset().mockRejectedValue(Object.assign(new Error('x'), { code: 'ENODATA' }))
  if (mode === 'dns-rejects') dnsMock.resolveMx.mockRejectedValue(new Error('SERVFAIL canary-mail-7f3a9c.com'))
  if (mode === 'dns-throws') dnsMock.resolveMx.mockImplementation(() => { throw new Error('sync boom canary-mail-7f3a9c.com') })
  if (mode === 'off') vi.doMock('../contactChecks.js', async (orig) => ({ ...(await orig<typeof import('../contactChecks.js')>()), queueContactChecks: vi.fn() }))
  else vi.doUnmock('../contactChecks.js')
  const query = (await import('../db.js')).pool.query as unknown as ReturnType<typeof vi.fn>
  calls = []
  query.mockReset().mockImplementation(async (sql: string, params: unknown[] = []) => {
    calls.push([sql, params])
    if (/SELECT version, pubkey, nuts_limits, contact_checks/.test(sql)) return { rows: [{ version: 'Nutshell/0.17.0', pubkey: null, nuts_limits: null, contact_checks: stored }] }
    if (/SELECT server_location/.test(sql)) return { rows: [{ server_location: 'Somewhere' }] }
    if (/SELECT online FROM mint_history/.test(sql)) return { rows: [{ online: false }] }
    if (/INSERT INTO mint_history/.test(sql)) return { rows: [{ id: 7 }] }
    if (/FROM mints m\s+LEFT JOIN mint_history/.test(sql)) {
      return { rows: [{ nut_count: 3, version: 'Nutshell/0.17.0', contact_count: 2, audit_cz_total: null, audit_cz_blamed: null, audit_cz_fetched_at: null, discovered_at: '2026-01-01T00:00:00Z', total: '288', online_count: '288' }] }
    }
    if (mode === 'store-rejects' && /UPDATE mints SET contact_checks/.test(sql)) throw new Error('db down canary-mail-7f3a9c.com')
    return { rows: [], rowCount: 1 }
  })
  safeFetch = (await import('../ssrf.js')).safeFetch as unknown as ReturnType<typeof vi.fn>
  safeFetch.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => INFO })
  const { probeMintToDb } = await import('../prober.js')
  return probeMintToDb
}

/** Runs the probe and lets the background work finish. Returns what the probe itself returned. */
async function runProbe(probeMintToDb: (u: string) => Promise<void>): Promise<unknown> {
  const p = probeMintToDb(MINT)
  let done = false
  const result = p.then(v => { done = true; return v })
  while (!done) await vi.advanceTimersByTimeAsync(1000)
  const out = await result
  await vi.advanceTimersByTimeAsync(20_000)
  return out
}

const isCheckWrite = (sql: string): boolean => /UPDATE mints SET contact_checks/.test(sql)
const withoutChecks = (): Array<[string, unknown[]]> => calls.filter(([sql]) => !isCheckWrite(sql))

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); vi.spyOn(console, 'log').mockImplementation(() => undefined) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.doUnmock('../contactChecks.js') })

describe('probe -> contact checks', () => {
  it('a successful /v1/info starts the checks from the body it already fetched: one request to the mint, one write of four fields per entry', async () => {
    const probe = await setup('on')
    await runProbe(probe)
    expect(safeFetch).toHaveBeenCalledTimes(1)
    expect(String(safeFetch.mock.calls[0]![0])).toBe(`${MINT}/v1/info`)
    const writes = calls.filter(([sql]) => isCheckWrite(sql))
    expect(writes).toHaveLength(1)
    const stored = JSON.parse(writes[0]![1][0] as string) as Array<Record<string, unknown>>
    expect(stored.map(e => e['kind'])).toEqual(['email', 'nostr', 'twitter'])
    expect(stored[0]).toMatchObject({ formatValid: true, domainResolves: true })
    expect(dnsMock.resolveMx).toHaveBeenCalledTimes(1)
    expect(dnsMock.resolveMx.mock.calls[0]![0]).toBe('canary-mail-7f3a9c.com')
  })

  it('checks stored less than 24 h ago for the same kinds are not repeated (no DNS, no write)', async () => {
    const fresh = CONTACT.map(c => ({ kind: c.method, formatValid: true, domainResolves: null, checkedAt: new Date(NOW.getTime() - 3_600_000).toISOString(), rules: CONTACT_RULES_VERSION }))
    const probe = await setup('on', fresh)
    await runProbe(probe)
    expect(calls.filter(([sql]) => isCheckWrite(sql))).toHaveLength(0)
    expect(dnsMock.resolveMx).not.toHaveBeenCalled()
  })

  it('a result stored under older rules is rechecked at the next probe, once', async () => {
    const at = new Date(NOW.getTime() - 3_600_000).toISOString()
    const old = CONTACT.map(c => ({ kind: c.method, formatValid: false, domainResolves: null, checkedAt: at, rules: CONTACT_RULES_VERSION - 1 }))
    const probe = await setup('on', old)
    await runProbe(probe)
    const writes = calls.filter(([sql]) => isCheckWrite(sql))
    expect(writes).toHaveLength(1)
    const written = JSON.parse(writes[0]![1][0] as string) as Array<Record<string, unknown>>
    expect(written.every(e => e['rules'] === CONTACT_RULES_VERSION)).toBe(true)

    // The next probe sees what was written: current rules, fresh, same kinds: nothing to do.
    const next = await setup('on', written)
    await runProbe(next)
    expect(calls.filter(([sql]) => isCheckWrite(sql))).toHaveLength(0)
  })

  it.each([
    ['a network failure', () => safeFetch.mockResolvedValue(null)],
    ['a non-2xx answer', () => safeFetch.mockResolvedValue({ ok: false, status: 404 })],
    ['a 200 that is not a mint', () => safeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ name: 'x', contact: CONTACT }) })],
  ])('%s starts no check', async (_n, arrange) => {
    const probe = await setup('on')
    arrange()
    await runProbe(probe)
    expect(calls.filter(([sql]) => isCheckWrite(sql))).toHaveLength(0)
    expect(dnsMock.resolveMx).not.toHaveBeenCalled()
  })

  it('the probe does not wait for the checks: a lookup that never answers leaves the probe finished', async () => {
    const probe = await setup('on')
    dnsMock.resolveMx.mockReturnValue(new Promise(() => undefined))
    const p = probe(MINT)
    let done = false
    void p.then(() => { done = true })
    for (let i = 0; i < 10 && !done; i++) await vi.advanceTimersByTimeAsync(500)
    expect(done).toBe(true)
  })
})

describe('probe result, score and notifications do not depend on the checks', () => {
  async function observe(mode: Mode) {
    notify.notifySubscribers.mockClear()
    const probe = await setup(mode)
    let outcome: unknown
    let thrown: unknown = null
    try { outcome = await runProbe(probe) } catch (e) { thrown = e }
    return { outcome, thrown, calls: withoutChecks(), notified: notify.notifySubscribers.mock.calls.map(c => [c[0], c[1]]) }
  }

  it.each(['on', 'dns-rejects', 'dns-throws', 'store-rejects'] as const)('%s: the same probe outcome, stored rows, score and breakdown as with the checks switched off', async mode => {
    const baseline = await observe('off')
    const actual = await observe(mode)
    expect(baseline.thrown).toBeNull()
    expect(actual.thrown).toBeNull()
    expect(actual.outcome).toEqual(baseline.outcome)
    expect(actual.calls).toEqual(baseline.calls)
    expect(actual.notified).toEqual(baseline.notified)
    // The score and its breakdown were really written, and no error text was recorded for the mint.
    const scoreWrite = actual.calls.find(([sql]) => /SET last_reliability_score/.test(sql))
    expect(scoreWrite).toBeDefined()
    expect(scoreWrite![1][1]).toBeNull()
    expect(actual.notified).toEqual([[MINT, 'up']])
  })

  it('a DNS or store failure leaves no value or domain in any log line', async () => {
    for (const mode of ['dns-rejects', 'dns-throws', 'store-rejects'] as const) {
      const probe = await setup(mode)
      const spies = (['log', 'warn', 'error', 'info'] as const).map(k => vi.spyOn(console, k).mockImplementation(() => undefined))
      await runProbe(probe)
      const logs = JSON.stringify(spies.map(s => s.mock.calls)).toLowerCase()
      expect(logs, mode).not.toContain('canary')
      expect(logs, mode).not.toContain('ab'.repeat(32))
    }
  })
})
