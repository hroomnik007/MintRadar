import { describe, it, expect, vi, beforeEach } from 'vitest'

// Methodology 4: the NUT component counts a tracked NUT only when the mint lists it and does not mark it
// "supported": false (shared/nutSupport.ts). The probe stores nut_count and the score is computed from the stored count,
// so this test feeds the stored count of the UPDATE back into the score SELECT, as the database does.

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
let safeFetch: ReturnType<typeof vi.fn>
let probeMintToDb: typeof import('../prober.js')['probeMintToDb']
let storedNutCount: number | null

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  const dns = await import('dns/promises')
  ;(dns.lookup as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ address: '1.2.3.4', family: 4 }])
  const ssrf = await import('../ssrf.js')
  safeFetch = ssrf.safeFetch as unknown as ReturnType<typeof vi.fn>
  safeFetch.mockReset()
  ;({ probeMintToDb } = await import('../prober.js'))
  storedNutCount = null
  query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/SELECT online FROM mint_history WHERE url = \$1/.test(sql)) return { rows: [] }
    if (/INSERT INTO mint_history/.test(sql)) return { rows: [{ id: 1 }] }
    if (/UPDATE mints SET\n\s*name/.test(sql)) { storedNutCount = (params as unknown[])[3] as number; return { rowCount: 1 } }
    if (/FROM mints m\s*\n\s*LEFT JOIN mint_history h/.test(sql)) {
      return { rows: [{ nut_count: storedNutCount, version: '1.0.0', contact_count: 0, audit_cz_total: null, audit_cz_blamed: null, audit_cz_fetched_at: null, total: '4', online_count: '4', discovered_at: null }] }
    }
    return { rows: [], rowCount: 1 }
  })
})

function serve(nuts: Record<string, unknown>): void {
  safeFetch.mockImplementation(async (u: string) => u.endsWith('/v1/info')
    ? { ok: true, status: 200, json: async () => ({ name: 'M', version: 'Nutshell/1.0.0', nuts }) }
    : null)
}
const storedScore = () => query.mock.calls.filter(c => /UPDATE mints SET last_reliability_score/.test(String(c[0]))).at(-1)?.[1]?.[0] as number

describe('probe: nut_count and the score with "supported": false', () => {
  it('counts a tracked NUT with supported:false as not supported; presence-only and supported:true still count', async () => {
    serve({ '4': {}, '5': { supported: true }, '7': { supported: false }, '8': { methods: [] }, '11': { supported: false }, '12': null, '21': {} })
    await probeMintToDb(MINT)
    expect(storedNutCount).toBe(3) // 4, 5, 8 (7 and 11 marked false, 12 null, 21 is not tracked)
  })

  it('the score is lower by exactly the NUT component share, and equal when nothing is marked false', async () => {
    const all = { '4': {}, '5': {}, '7': {}, '8': {}, '9': {}, '10': {}, '11': {}, '12': {}, '14': {}, '15': {}, '17': {}, '19': {}, '20': {}, '29': {} }
    serve(all)
    await probeMintToDb(MINT)
    const full = storedScore()
    expect(storedNutCount).toBe(14)

    serve({ ...all, '8': {} })
    await probeMintToDb(MINT)
    expect(storedScore()).toBe(full) // identical score for data without supported:false

    const { nutComponent } = await import('../shared/reliabilityScore.js')
    serve({ ...all, '8': { supported: false }, '9': { supported: false }, '10': { supported: false }, '11': { supported: false } })
    await probeMintToDb(MINT)
    expect(storedNutCount).toBe(10)
    expect(full - storedScore()).toBe(nutComponent(14) - nutComponent(10)) // 15 - 11 = 4 points
  })
})

describe('probe: nut_count and the score with a switched-off NUT-04/05 (methodology 5)', () => {
  const all = { '4': {}, '5': {}, '7': {}, '8': {}, '9': {}, '10': {}, '11': {}, '12': {}, '14': {}, '15': {}, '17': {}, '19': {}, '20': {}, '29': {} }

  it('a NUT-04/05 with disabled: true does not count; disabled: false and a missing flag still count', async () => {
    serve({ '4': { methods: [], disabled: true }, '5': { methods: [], disabled: false }, '7': {} })
    await probeMintToDb(MINT)
    expect(storedNutCount).toBe(2) // 5 and 7
  })

  it('the score drops by exactly the NUT component share (Lek: 4 and 5 switched off)', async () => {
    serve(all)
    await probeMintToDb(MINT)
    const full = storedScore()
    const { nutComponent } = await import('../shared/reliabilityScore.js')
    serve({ ...all, '4': { methods: [], disabled: true }, '5': { methods: [], disabled: true } })
    await probeMintToDb(MINT)
    expect(storedNutCount).toBe(12)
    expect(full - storedScore()).toBe(nutComponent(14) - nutComponent(12)) // 15 - 13 = 2 points
  })

  it('disabled: true on a NUT that is also supported: false counts once as not supported (no double effect)', async () => {
    serve({ ...all, '4': { supported: false, disabled: true } })
    await probeMintToDb(MINT)
    expect(storedNutCount).toBe(13)
  })
})
