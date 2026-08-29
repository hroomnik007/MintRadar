import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// GET /api/stats/trust-movers — same mocking approach as mints-known.test.ts /
// og-mint.test.ts: mock the pg-backed pool at the db.js boundary so the real
// route handler + response-shaping run end-to-end without a database. The
// mocked rows represent what the SQL's "latest"/"old" CTEs + INNER JOINs have
// already resolved (a mint absent from these rows is exactly how the real
// query represents "insufficient history" — there is no separate exclusion
// flag to test at this layer).

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))

let app: Express
let query: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  ;({ app } = await import('../../index.js'))
})

function row(url: string, name: string | null, latestScore: number, oldScore: number) {
  return { url, name, latest_score: latestScore, old_score: oldScore }
}

describe('GET /api/stats/trust-movers', () => {
  it('returns risers and fallers computed from the resolved snapshot rows', async () => {
    query.mockResolvedValueOnce({
      rows: [
        row('https://riser.example.com', 'Riser Mint', 90, 80),
        row('https://faller.example.com', 'Faller Mint', 70, 80),
        row('https://stable.example.com', 'Stable Mint', 81, 80),
      ],
    })

    const res = await request(app).get('/api/stats/trust-movers')

    expect(res.status).toBe(200)
    expect(res.body.period).toBe('7d')
    expect(res.body.risers).toEqual([{ url: 'https://riser.example.com', name: 'Riser Mint', delta: 10 }])
    expect(res.body.fallers).toEqual([{ url: 'https://faller.example.com', name: 'Faller Mint', delta: -10 }])
  })

  it('defaults to period=7d and requests a 7-day cutoff', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await request(app).get('/api/stats/trust-movers')
    expect(query.mock.calls[0][1]).toEqual([7])
  })

  it('accepts period=30d and requests a 30-day cutoff', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const res = await request(app).get('/api/stats/trust-movers').query({ period: '30d' })
    expect(res.body.period).toBe('30d')
    expect(query.mock.calls[0][1]).toEqual([30])
  })

  it('falls back to 7d for an invalid period value instead of erroring', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const res = await request(app).get('/api/stats/trust-movers').query({ period: 'bogus' })
    expect(res.status).toBe(200)
    expect(res.body.period).toBe('7d')
  })

  it('a mint with insufficient history (absent from the resolved rows) never appears in the output', async () => {
    // Only "long-tracked" is in the mocked rows — "too-new" represents a mint
    // the SQL's INNER JOIN would have excluded for lacking an old-enough snapshot.
    query.mockResolvedValueOnce({ rows: [row('https://long-tracked.example.com', 'Long Tracked', 95, 80)] })
    const res = await request(app).get('/api/stats/trust-movers')
    expect(res.body.risers).toHaveLength(1)
    expect(res.body.risers[0].url).toBe('https://long-tracked.example.com')
  })

  it('returns empty risers/fallers (not an error) when no mint crosses the threshold', async () => {
    query.mockResolvedValueOnce({ rows: [row('https://stable.example.com', 'Stable Mint', 81, 80)] })
    const res = await request(app).get('/api/stats/trust-movers')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ period: '7d', risers: [], fallers: [] })
  })

  it('returns a 200 fallback-free error response when the DB query throws', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'))
    const res = await request(app).get('/api/stats/trust-movers')
    expect(res.status).toBe(500)
  })

  it('sets a Cache-Control max-age header', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const res = await request(app).get('/api/stats/trust-movers')
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/)
  })

  it('serves the second request for the same period from cache without querying again', async () => {
    query.mockResolvedValueOnce({ rows: [row('https://riser.example.com', 'Riser Mint', 90, 80)] })
    const first = await request(app).get('/api/stats/trust-movers')
    const second = await request(app).get('/api/stats/trust-movers')
    expect(query).toHaveBeenCalledTimes(1)
    expect(second.body).toEqual(first.body)
  })
})
