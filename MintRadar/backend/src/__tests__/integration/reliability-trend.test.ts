import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// GET /api/stats/reliability-trend — the pool is mocked at the db.js boundary (same approach as
// reliability-movers.test.ts). The route aggregates ~1.3M mint_history rows for 90d (a ~1.3s sequential scan,
// EXPLAIN ANALYZE 2026-10-16), so each period is cached for 10 minutes and concurrent misses share one query pair.

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))

let app: Express
let query: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  vi.useRealTimers()
  const db = await import('../../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  ;({ app } = await import('../../index.js'))
})

const trendRows = [
  { date: new Date('2026-10-15T00:00:00Z'), avg_reliability: 80 },
  { date: new Date('2026-10-16T00:00:00Z'), avg_reliability: 82 },
]

/** The route runs two queries per computation: the daily aggregate, then MIN(checked_at). */
function arrangeOk(): void {
  query.mockImplementation((sql: string) =>
    Promise.resolve(sql.includes('MIN(checked_at)')
      ? { rows: [{ earliest: new Date(Date.now() - 200 * 86_400_000) }] }
      : { rows: trendRows }))
}

const callsFor = (days: number) => query.mock.calls.filter(c => Array.isArray(c[1]) && c[1][0] === days).length
const aggregateCalls = () => query.mock.calls.filter(c => String(c[0]).includes('GROUP BY')).length

describe('GET /api/stats/reliability-trend', () => {
  it('returns the daily series with the same shape as before', async () => {
    arrangeOk()
    const res = await request(app).get('/api/stats/reliability-trend').query({ days: 90 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      trend: [{ date: '2026-10-15', avgReliability: 80 }, { date: '2026-10-16', avgReliability: 82 }],
      periodDays: 90,
      earliestCheckedAt: expect.any(String),
      daysOfDataAvailable: 90,
    })
  })

  it('anything but 30 or 90 falls back to 30', async () => {
    arrangeOk()
    const res = await request(app).get('/api/stats/reliability-trend').query({ days: 7 })
    expect(res.body.periodDays).toBe(30)
    expect(callsFor(30)).toBe(1)
  })

  it('serves the second request from the cache: one query pair, not two', async () => {
    arrangeOk()
    await request(app).get('/api/stats/reliability-trend').query({ days: 90 })
    const second = await request(app).get('/api/stats/reliability-trend').query({ days: 90 })
    expect(second.status).toBe(200)
    expect(aggregateCalls()).toBe(1)
    expect(query).toHaveBeenCalledTimes(2) // aggregate + MIN, once
  })

  it('caches each period on its own', async () => {
    arrangeOk()
    await request(app).get('/api/stats/reliability-trend').query({ days: 30 })
    await request(app).get('/api/stats/reliability-trend').query({ days: 90 })
    await request(app).get('/api/stats/reliability-trend').query({ days: 30 })
    expect(callsFor(30)).toBe(1)
    expect(callsFor(90)).toBe(1)
  })

  it('concurrent misses share one query pair', async () => {
    arrangeOk()
    const results = await Promise.all([1, 2, 3].map(() => request(app).get('/api/stats/reliability-trend').query({ days: 90 })))
    for (const r of results) expect(r.status).toBe(200)
    expect(aggregateCalls()).toBe(1)
  })

  it('recomputes after the 10 minute TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    arrangeOk()
    await request(app).get('/api/stats/reliability-trend').query({ days: 90 })
    vi.setSystemTime(Date.now() + 9 * 60_000)
    await request(app).get('/api/stats/reliability-trend').query({ days: 90 })
    expect(aggregateCalls()).toBe(1)
    vi.setSystemTime(Date.now() + 2 * 60_000)
    await request(app).get('/api/stats/reliability-trend').query({ days: 90 })
    expect(aggregateCalls()).toBe(2)
  })

  it('an error answers 500 without detail and is not cached: the next request tries again', async () => {
    query.mockRejectedValue(new Error('connection refused: secret-host:5432'))
    const failed = await request(app).get('/api/stats/reliability-trend').query({ days: 90 })
    expect(failed.status).toBe(500)
    expect(JSON.stringify(failed.body)).not.toMatch(/secret-host/)
    expect(failed.headers['cache-control'] ?? '').not.toMatch(/public|max-age/)
    arrangeOk()
    const retry = await request(app).get('/api/stats/reliability-trend').query({ days: 90 })
    expect(retry.status).toBe(200)
  })
})
