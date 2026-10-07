import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// getAuditCzForMint().stats7d — the grouped 7-day aggregation. The pool is an in-memory stand-in
// that evaluates the grouped statement with the same rules as its SQL (window `at >= $2`, url
// match `= ANY($1)`, melt wins when both sides match, status → paid/failed/pending); the real SQL
// is checked separately against PostgreSQL.
const { rowsRef, poolMock } = vi.hoisted(() => {
  const rowsRef: { swaps: Array<Record<string, unknown>> } = { swaps: [] }
  const M = 'https://m.example'
  const poolMock = {
    query: vi.fn(async (sql: string, p: unknown[] = []) => {
      if (sql.includes('FROM audit_cz_mints') && sql.includes('WHERE url = $1')) {
        const k = p[0] as string
        return k === M || k === 'https://alias.example'
          ? { rows: [{ url: M, state: 'ok', uptime24h: 100, uptime7d: 100, uptime30d: 100, attributed_failures: 3, last_check: new Date(), page: 'https://cashu.info/mint/mint0001', fetched_at: new Date() }] }
          : { rows: [] }
      }
      if (sql.includes('SELECT alias_url')) return { rows: [{ alias_url: 'https://alias.example' }] }
      if (sql.includes('GROUP BY 1, 2')) {
        const urls = p[0] as string[]
        const cutoff = p[1] as Date
        const g = new Map<string, Record<string, number | string>>()
        for (const s of rowsRef.swaps) {
          const at = s['at'] as Date
          const fromHit = urls.includes(s['from_url'] as string)
          const toHit = urls.includes(s['to_url'] as string)
          if (at < cutoff || !(fromHit || toHit)) continue
          const dir = fromHit ? 'melt' : 'mint'
          const outcome = s['status'] === 'success' ? 'paid' : s['status'] === 'failed' ? 'failed' : 'pending'
          const key = `${dir}/${outcome}`
          const r = g.get(key) ?? { dir, outcome, n: 0, amount_sum: 0, fee_sum: 0, dur_sum: 0, dur_n: 0 }
          r['n'] = (r['n'] as number) + 1
          r['amount_sum'] = (r['amount_sum'] as number) + ((s['amount'] as number | null) ?? 0)
          r['fee_sum'] = (r['fee_sum'] as number) + ((s['fee'] as number | null) ?? 0)
          if (s['duration_ms'] !== null) { r['dur_sum'] = (r['dur_sum'] as number) + (s['duration_ms'] as number); r['dur_n'] = (r['dur_n'] as number) + 1 }
          g.set(key, r)
        }
        return { rows: [...g.values()].map(r => ({ ...r, n: String(r['n']), dur_n: String(r['dur_n']) })) }
      }
      if (sql.includes('FROM audit_cz_swaps') && sql.includes('LIMIT $2')) return { rows: [] }
      return { rows: [] }
    }),
  }
  return { rowsRef, poolMock }
})

vi.mock('../db.js', () => ({ pool: poolMock }))
vi.mock('../prober.js', () => ({ probeMintToDb: vi.fn(), isValidCashuMint: vi.fn() }))
vi.mock('../ssrf.js', () => ({ safeFetch: vi.fn(), readJsonLimited: vi.fn(), RESPONSE_CAPS: {} }))

import { buildAuditCzStats7d, getAuditCzForMint, clampAuditCzLimit } from '../auditCz.js'

const M = 'https://m.example'
const ALIAS = 'https://alias.example'
const OTHER = 'https://other.example'
const NOW = new Date('2026-10-04T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const MIN = 60_000
const DAY = 86_400_000

const sw = (o: Record<string, unknown>) => ({ id: 'x', at: ago(MIN), status: 'success', amount: 10, fee: 0, duration_ms: 1000, from_url: M, to_url: OTHER, ...o })

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); rowsRef.swaps = [] })
afterEach(() => { vi.useRealTimers() })

describe('stats7d aggregation', () => {
  it('counts directions, statuses, aliases, null fee and the same mint on both sides', async () => {
    rowsRef.swaps = [
      sw({ id: '1', amount: 100, fee: 2, duration_ms: 1000 }),                                   // melt paid
      sw({ id: '2', from_url: ALIAS, amount: 50, fee: null, duration_ms: 3000 }),                 // melt paid via alias, null fee
      sw({ id: '3', status: 'failed', duration_ms: null }),                                       // melt failed
      sw({ id: '4', status: 'pending', duration_ms: null }),                                      // melt pending
      sw({ id: '5', from_url: OTHER, to_url: M, amount: 30, fee: 1, duration_ms: 2000 }),         // mint paid
      sw({ id: '6', from_url: OTHER, to_url: ALIAS, status: 'failed', duration_ms: null }),       // mint failed (alias)
      sw({ id: '7', from_url: OTHER, to_url: M, status: 'skipped', duration_ms: null }),          // unknown → pending
      sw({ id: '8', from_url: M, to_url: ALIAS, amount: 10, fee: 0, duration_ms: 500 }),          // both sides → melt, once
      sw({ id: '9', from_url: OTHER, to_url: M, at: ago(7 * DAY + MIN) }),                        // just outside the window
      sw({ id: '10', from_url: OTHER, to_url: M, status: 'failed', at: ago(7 * DAY - MIN), duration_ms: null }), // just inside
      sw({ id: '11', from_url: OTHER, to_url: 'https://third.example' }),                         // unrelated
    ]
    const r = await getAuditCzForMint(ALIAS)
    expect(r.stats7d).toEqual({
      windowDays: 7,
      melts: { paid: 3, failed: 1, pending: 1, amountPaid: 160, feesPaid: 2 },
      mints: { paid: 1, failed: 2, pending: 1, amountPaid: 30, feesPaid: 1 },
      avgDurationMsPaid: 1625,
      swapsCounted: 9,
    })
    // paid + failed + pending adds up to swapsCounted
    const s = r.stats7d!
    expect(s.melts.paid + s.melts.failed + s.melts.pending + s.mints.paid + s.mints.failed + s.mints.pending).toBe(s.swapsCounted)
  })

  it('binds the url list (incl. aliases) and the cutoff as parameters', async () => {
    await getAuditCzForMint(M)
    const call = poolMock.query.mock.calls.find(c => String(c[0]).includes('GROUP BY 1, 2'))!
    expect(String(call[0])).not.toContain(M)
    const [urls, cutoff] = call[1] as [string[], Date]
    expect(urls).toEqual(expect.arrayContaining([M, ALIAS]))
    expect(cutoff.getTime()).toBe(NOW.getTime() - 7 * DAY)
  })

  it('returns zeros and a null average when nothing is in the window', async () => {
    rowsRef.swaps = [sw({ at: ago(8 * DAY) })]
    const r = await getAuditCzForMint(M)
    expect(r.stats7d).toMatchObject({ swapsCounted: 0, avgDurationMsPaid: null, melts: { paid: 0, failed: 0, pending: 0, amountPaid: 0, feesPaid: 0 } })
  })

  it('is null for a mint cashu.info does not cover', async () => {
    expect((await getAuditCzForMint('https://nobody.example')).stats7d).toBeNull()
  })
})

describe('buildAuditCzStats7d', () => {
  it('keeps pending and unknown out of paid/failed and averages only paid durations', () => {
    const r = buildAuditCzStats7d([
      { dir: 'melt', outcome: 'paid', n: '2', amount_sum: '30', fee_sum: '1', dur_sum: '3000', dur_n: '2' },
      { dir: 'mint', outcome: 'pending', n: '1', amount_sum: '5', fee_sum: '0', dur_sum: '0', dur_n: '0' },
    ])
    expect(r.melts).toEqual({ paid: 2, failed: 0, pending: 0, amountPaid: 30, feesPaid: 1 })
    expect(r.mints).toEqual({ paid: 0, failed: 0, pending: 1, amountPaid: 0, feesPaid: 0 })
    expect(r.avgDurationMsPaid).toBe(1500)
    expect(r.swapsCounted).toBe(3)
  })
})

describe('swaps limit parameter', () => {
  it('clamps to 1..100, defaults to 20 and is passed as a bound parameter', async () => {
    expect(clampAuditCzLimit(undefined)).toBe(20)
    expect(clampAuditCzLimit('abc')).toBe(20)
    expect(clampAuditCzLimit('')).toBe(20)
    expect(clampAuditCzLimit('0')).toBe(1)
    expect(clampAuditCzLimit('-5')).toBe(1)
    expect(clampAuditCzLimit('50')).toBe(50)
    expect(clampAuditCzLimit('500')).toBe(100)
    expect(clampAuditCzLimit('7.9')).toBe(7)
    await getAuditCzForMint(M, clampAuditCzLimit('500'))
    const call = poolMock.query.mock.calls.filter(c => String(c[0]).includes('LIMIT $2')).at(-1)!
    expect(String(call[0])).not.toContain('LIMIT 100')
    expect(call[1]).toEqual([expect.arrayContaining([M]), 100, 'both'])
  })
})
