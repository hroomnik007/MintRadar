import { describe, it, expect, vi, beforeEach } from 'vitest'

// A mint answering 429 is skipped without a history row, but only for RATE_LIMITED_PROBES_BEFORE_FAILURE consecutive
// cycles: after that it is recorded as failed ('HTTP 429') so its stored status and score cannot stay frozen. A 429
// never starts the reap clock (invalid_since): the mint is up, it just throttles us.

vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('../ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssrf.js')>()
  return { ...actual, safeFetch: vi.fn(), readJsonLimited: (res: { json: () => Promise<unknown> }) => res.json() }
})
vi.mock('../nostrService.js', () => ({
  notifySubscribers: vi.fn().mockResolvedValue(undefined),
  notifyAlert: vi.fn().mockResolvedValue(undefined),
  recordAlertClear: vi.fn().mockResolvedValue(undefined),
  isNotificationServiceEnabled: vi.fn().mockReturnValue(false),
}))
vi.mock('../versionCatalog.js', () => ({ getLatestVersionsMap: vi.fn().mockResolvedValue({}) }))

const MINT = 'https://throttling.example.com'

let query: ReturnType<typeof vi.fn>
let safeFetch: ReturnType<typeof vi.fn>
let probeMintToDb: typeof import('../prober.js')['probeMintToDb']
let LIMIT: number

const historyInserts = () => query.mock.calls.filter(c => /INSERT INTO mint_history/.test(String(c[0]))).length
const reapClockStarts = () => query.mock.calls.filter(c => /SET invalid_since = COALESCE/.test(String(c[0]))).length

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset().mockImplementation(async (sql: string) => {
    if (/INSERT INTO mint_history/.test(sql)) return { rows: [{ id: 1 }] }
    return { rows: [], rowCount: 0 }
  })
  const lookup = (await import('dns/promises')).lookup as unknown as ReturnType<typeof vi.fn>
  lookup.mockReset().mockResolvedValue([{ address: '1.2.3.4', family: 4 }])
  safeFetch = (await import('../ssrf.js')).safeFetch as unknown as ReturnType<typeof vi.fn>
  safeFetch.mockReset().mockResolvedValue({ ok: false, status: 429 })
  ;({ probeMintToDb, RATE_LIMITED_PROBES_BEFORE_FAILURE: LIMIT } = await import('../prober.js'))
})

describe('probe of a mint that answers 429', () => {
  it('writes no history row while under the limit', async () => {
    for (let i = 0; i < LIMIT - 1; i++) await probeMintToDb(MINT)
    expect(historyInserts()).toBe(0)
  })

  it('records a failed probe on the Nth consecutive 429, without starting the reap clock', async () => {
    for (let i = 0; i < LIMIT; i++) await probeMintToDb(MINT)
    expect(historyInserts()).toBe(1)
    expect(reapClockStarts()).toBe(0)
  })

  it('starts counting again after a probe that is not a 429', async () => {
    for (let i = 0; i < LIMIT - 1; i++) await probeMintToDb(MINT)
    safeFetch.mockResolvedValue({ ok: false, status: 404 })
    await probeMintToDb(MINT) // not a 429: resets the counter (and records its own failure)
    const before = historyInserts()
    safeFetch.mockResolvedValue({ ok: false, status: 429 })
    for (let i = 0; i < LIMIT - 1; i++) await probeMintToDb(MINT)
    expect(historyInserts()).toBe(before)
  })
})
