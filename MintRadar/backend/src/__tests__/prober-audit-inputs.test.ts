import { describe, it, expect, vi, beforeEach } from 'vitest'

// The prober reads the audit inputs of the Reliability Score (mints.audit_cz_total / audit_cz_blamed /
// audit_cz_fetched_at) in the SAME single SELECT as before, and computes the age from audit_cz_fetched_at
// at probe time. Same mocked boundaries as prober-transitions.test.ts.

vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('../ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssrf.js')>()
  return { ...actual, safeFetch: vi.fn(), readJsonLimited: (res: { json: () => Promise<unknown> }) => res.json() }
})
vi.mock('../nostrService.js', () => ({
  notifySubscribers: vi.fn().mockResolvedValue(undefined),
  isNotificationServiceEnabled: vi.fn().mockReturnValue(false),
}))

const MINT = 'https://mint.example.com'
let query: ReturnType<typeof vi.fn>
let probeMintToDb: typeof import('../prober.js')['probeMintToDb']
let scoreRow: Record<string, unknown>
let selects: string[]

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  const dns = await import('dns/promises')
  ;(dns.lookup as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ address: '1.2.3.4', family: 4 }])
  const ssrf = await import('../ssrf.js')
  ;(ssrf.safeFetch as unknown as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(null) // offline probe: score still computed
  ;({ probeMintToDb } = await import('../prober.js'))
  selects = []
  query.mockImplementation(async (sql: string) => {
    if (/SELECT online FROM mint_history WHERE url = \$1/.test(sql)) return { rows: [] }
    if (/INSERT INTO mint_history/.test(sql)) return { rows: [{ id: 1 }] }
    if (/FROM mints m\s*\n\s*LEFT JOIN mint_history h/.test(sql)) { selects.push(sql); return { rows: [scoreRow] } }
    return { rows: [], rowCount: 1 }
  })
})

// uptime 50% (20) + 1 NUT (1) + unrecognised version (4) + no contact (0) + audit component
const baseRow = { nut_count: 1, version: '1.0.0', contact_count: 0, total: '4', online_count: '2', discovered_at: null }
const storedScore = () => query.mock.calls.find(c => /UPDATE mints SET last_reliability_score/.test(String(c[0])))?.[1]?.[0]
const storedHistoryScore = () => query.mock.calls.find(c => /UPDATE mint_history SET reliability_score/.test(String(c[0])))?.[1]?.[0]

describe('probeMintToDb — audit inputs from mints.audit_cz_*', () => {
  it('reads the three columns in the one score SELECT and not the audit.8333.space columns', async () => {
    scoreRow = { ...baseRow, audit_cz_total: 100, audit_cz_blamed: 0, audit_cz_fetched_at: new Date() }
    await probeMintToDb(MINT)
    expect(selects).toHaveLength(1)
    expect(selects[0]).toContain('m.audit_cz_total, m.audit_cz_blamed, m.audit_cz_fetched_at')
    expect(selects[0]).not.toContain('audit_recent')
    expect(selects[0]).not.toContain('audit_cz_detail')
  })

  it('scores 25 for 0 blamed of 100 swaps fetched just now', async () => {
    scoreRow = { ...baseRow, audit_cz_total: 100, audit_cz_blamed: 0, audit_cz_fetched_at: new Date() }
    await probeMintToDb(MINT)
    expect(storedScore()).toBe(50)
    expect(storedHistoryScore()).toBe(50)
  })

  it('scores 5 for 20 blamed of 100', async () => {
    scoreRow = { ...baseRow, audit_cz_total: 100, audit_cz_blamed: 20, audit_cz_fetched_at: new Date() }
    await probeMintToDb(MINT)
    expect(storedScore()).toBe(30)
  })

  it('neutral for 3 blamed of 8 (fewer than 10 swaps)', async () => {
    scoreRow = { ...baseRow, audit_cz_total: 8, audit_cz_blamed: 3, audit_cz_fetched_at: new Date() }
    await probeMintToDb(MINT)
    expect(storedScore()).toBe(38) // 37.5 rounded once
  })

  it('neutral without a detail (all three NULL)', async () => {
    scoreRow = { ...baseRow, audit_cz_total: null, audit_cz_blamed: null, audit_cz_fetched_at: null }
    await probeMintToDb(MINT)
    expect(storedScore()).toBe(38)
  })

  it('neutral once the stored detail is older than 168 hours', async () => {
    scoreRow = { ...baseRow, audit_cz_total: 100, audit_cz_blamed: 0, audit_cz_fetched_at: new Date(Date.now() - 169 * 3_600_000) }
    await probeMintToDb(MINT)
    expect(storedScore()).toBe(38)
  })

  it('still scored at 167 hours', async () => {
    scoreRow = { ...baseRow, audit_cz_total: 100, audit_cz_blamed: 0, audit_cz_fetched_at: new Date(Date.now() - 167 * 3_600_000) }
    await probeMintToDb(MINT)
    expect(storedScore()).toBe(50)
  })
})

