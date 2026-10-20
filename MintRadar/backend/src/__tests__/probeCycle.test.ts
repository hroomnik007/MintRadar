import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// runProbeCycle(): the cycle with the real prober, a recording pool and stubbed fetches. A cycle where the
// network failures of ours coincide with cashu.info seeing the mints up must leave no trace in the history.

vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('../ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssrf.js')>()
  return { ...actual, safeFetch: vi.fn(), readJsonLimited: (res: { json: () => Promise<unknown> }) => res.json() }
})
vi.mock('../nostrService.js', () => ({
  notifySubscribers: vi.fn().mockResolvedValue(undefined),
  notifyAlert: vi.fn(),
  recordAlertClear: vi.fn(),
  isNotificationServiceEnabled: vi.fn(),
}))

const MIN = 60_000
const urlOf = (i: number) => `https://mint${i}.example.com`

let query: ReturnType<typeof vi.fn>
let safeFetch: ReturnType<typeof vi.fn>
let notifySubscribers: ReturnType<typeof vi.fn>
let runProbeCycle: typeof import('../probeCycle.js')['runProbeCycle']
let getLastVantageOutageAt: typeof import('../probeCycle.js')['getLastVantageOutageAt']
let getVantageOutageCount: typeof import('../probeCycle.js')['getVantageOutageCount']
let log: ReturnType<typeof vi.spyOn>

/** What the stub database holds. */
let cashuRows: Array<{ url: string; state: string; age_ms: number }>
let cashuQueryFails = false

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  const db = await import('../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  const dns = await import('dns/promises')
  ;(dns.lookup as unknown as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([{ address: '1.2.3.4', family: 4 }])
  safeFetch = (await import('../ssrf.js')).safeFetch as unknown as ReturnType<typeof vi.fn>
  safeFetch.mockReset()
  const notify = await import('../nostrService.js')
  notifySubscribers = notify.notifySubscribers as unknown as ReturnType<typeof vi.fn>
  notifySubscribers.mockReset().mockResolvedValue(undefined)
  ;(notify.isNotificationServiceEnabled as unknown as ReturnType<typeof vi.fn>).mockReset().mockReturnValue(true)
  ;({ runProbeCycle, getLastVantageOutageAt, getVantageOutageCount } = await import('../probeCycle.js'))
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

  cashuRows = []
  cashuQueryFails = false
  query.mockImplementation(async (sql: string) => {
    if (/DISTINCT ON \(url\)/.test(sql)) return { rows: Array.from({ length: 50 }, (_, i) => ({ url: urlOf(i), online: true })) }
    if (/JOIN audit_cz_mints/.test(sql)) {
      if (cashuQueryFails) throw new Error('connection terminated')
      return { rows: cashuRows }
    }
    if (/SELECT online FROM mint_history WHERE url = \$1/.test(sql)) return { rows: [{ online: true }] }
    if (/INSERT INTO mint_history/.test(sql)) return { rows: [{ id: 1 }] }
    if (/SELECT version, pubkey FROM mints WHERE url = \$1/.test(sql)) return { rows: [{ version: '1.0.0', pubkey: null }] }
    if (/SELECT server_location FROM mints/.test(sql)) return { rows: [{ server_location: 'X, Y' }] }
    if (/FROM mints m\s*\n\s*LEFT JOIN mint_history h/.test(sql)) {
      return { rows: [{ nut_count: 1, version: '1.0.0', audit_cz_total: null, audit_cz_blamed: null, audit_cz_fetched_at: null, total: '4', online_count: '2' }] }
    }
    return { rows: [], rowCount: 0 }
  })
})

afterEach(() => {
  vi.useRealTimers()
  log.mockRestore()
})

const dnsError = () => Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })

/** Mints 0..failing-1 fail with `failure`, the rest answer as a Cashu mint. */
function stubFetches(failing: number, failure: 'dns' | 'http500' = 'dns'): void {
  safeFetch.mockImplementation(async (url: string, opts?: { onError?: (e: unknown) => void }) => {
    const i = Number(/mint(\d+)\./.exec(url)?.[1])
    if (i >= failing) return { ok: true, status: 200, json: async () => ({ name: `Mint ${i}`, version: '1.0.0', nuts: { '4': {} } }) }
    if (failure === 'http500') return { ok: false, status: 500 }
    opts?.onError?.(dnsError())
    return null
  })
}

function cashu(count: number, state: string, ageMs: number): void {
  cashuRows = Array.from({ length: count }, (_, i) => ({ url: urlOf(i), state, age_ms: ageMs }))
}

async function runCycle(count = 50): Promise<void> {
  const urls = Array.from({ length: count }, (_, i) => urlOf(i))
  let done = false
  const p = runProbeCycle(urls).finally(() => { done = true })
  while (!done) await vi.advanceTimersByTimeAsync(1000)
  await p
}

const historyInserts = () => query.mock.calls.filter(c => /INSERT INTO mint_history/.test(c[0] as string))
const lastErrorUpdates = () => query.mock.calls.filter(c => /UPDATE mints SET last_reliability_score/.test(c[0] as string))
const vantageLines = () => log.mock.calls.filter(c => String(c[0]).includes('vantage outage'))

describe('runProbeCycle — suspected vantage outage', () => {
  it('all fetches fail with dns errors and cashu.info sees them up: failures are not recorded', async () => {
    stubFetches(50)
    cashu(50, 'ok', 2 * MIN)
    await runCycle()

    expect(historyInserts()).toHaveLength(0)
    expect(lastErrorUpdates()).toHaveLength(0)
    expect(query.mock.calls.filter(c => /UPDATE mints/.test(c[0] as string))).toHaveLength(0)
    expect(notifySubscribers).not.toHaveBeenCalled()
    expect(vantageLines()).toHaveLength(1)
    expect(getLastVantageOutageAt()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    expect(getVantageOutageCount()).toBe(1)
  })

  it('the log line has the numbers and no mint name or URL', async () => {
    stubFetches(50)
    cashu(50, 'ok', 2 * MIN)
    await runCycle()

    expect(vantageLines()[0]).toEqual([
      "[probe] suspected vantage outage: 50 of 50 previously online mints failed (network errors), 50 of 50 covered failures seen up by cashu.info: this cycle's failures are not recorded",
    ])
    const all = JSON.stringify(log.mock.calls)
    expect(all).not.toMatch(/example\.com|mint\d|https?:/)
  })

  it('cashu.info says "error" for the mints: normal writes and normal notifications', async () => {
    stubFetches(50)
    cashu(50, 'error', 2 * MIN)
    await runCycle()

    expect(historyInserts()).toHaveLength(50)
    expect(historyInserts().every(c => (c[1] as unknown[])[1] === false)).toBe(true)
    expect(notifySubscribers).toHaveBeenCalledTimes(50)
    expect(notifySubscribers).toHaveBeenCalledWith(urlOf(0), 'down', expect.any(Date))
    expect(vantageLines()).toHaveLength(0)
    expect(getLastVantageOutageAt()).toBeNull()
  })

  it('cashu.info checks are stale: normal writes', async () => {
    stubFetches(50)
    cashu(50, 'ok', 16 * MIN)
    await runCycle()

    expect(historyInserts()).toHaveLength(50)
    expect(notifySubscribers).toHaveBeenCalledTimes(50)
    expect(getLastVantageOutageAt()).toBeNull()
  })

  it('cashu.info has no rows for the mints: normal writes', async () => {
    stubFetches(50)
    await runCycle()
    expect(historyInserts()).toHaveLength(50)
    expect(getLastVantageOutageAt()).toBeNull()
  })

  it('the cashu.info lookup throws: fails open, normal writes', async () => {
    stubFetches(50)
    cashu(50, 'ok', 2 * MIN)
    cashuQueryFails = true
    await runCycle()
    expect(historyInserts()).toHaveLength(50)
    expect(notifySubscribers).toHaveBeenCalledTimes(50)
    expect(getLastVantageOutageAt()).toBeNull()
  })

  it('only 10 of 50 mints fail: normal writes for all 50', async () => {
    stubFetches(10)
    cashu(50, 'ok', 2 * MIN)
    await runCycle()

    expect(historyInserts()).toHaveLength(50)
    expect(historyInserts().filter(c => (c[1] as unknown[])[1] === false)).toHaveLength(10)
    expect(notifySubscribers).toHaveBeenCalledTimes(10)
    expect(getLastVantageOutageAt()).toBeNull()
  })

  it('30 of 50 fail: the failures are dropped, the 20 mints that answered are recorded as normal', async () => {
    stubFetches(30)
    cashu(50, 'ok', 2 * MIN)
    await runCycle()

    const inserts = historyInserts()
    expect(inserts).toHaveLength(20)
    expect(inserts.every(c => (c[1] as unknown[])[1] === true)).toBe(true)
    expect(inserts.map(c => (c[1] as unknown[])[0]).sort()).toEqual(Array.from({ length: 20 }, (_, i) => urlOf(i + 30)).sort())
    expect(notifySubscribers).not.toHaveBeenCalled()
    expect(getLastVantageOutageAt()).not.toBeNull()
  })

  it('HTTP errors of the mints are not our network: recorded even when cashu.info sees them up', async () => {
    stubFetches(50, 'http500')
    cashu(50, 'ok', 2 * MIN)
    await runCycle()

    expect(historyInserts()).toHaveLength(50)
    expect(notifySubscribers).toHaveBeenCalledTimes(50)
    expect(getLastVantageOutageAt()).toBeNull()
  })

  it('a quiet cycle runs no cashu.info query', async () => {
    stubFetches(0)
    await runCycle()
    expect(query.mock.calls.filter(c => /audit_cz_mints/.test(c[0] as string))).toHaveLength(0)
    expect(historyInserts()).toHaveLength(50)
  })
})
