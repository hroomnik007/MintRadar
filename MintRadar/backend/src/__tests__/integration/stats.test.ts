import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// GET /api/stats aggregates network-wide metrics from two SQL queries
// (Promise.all: [mints + latest status], [median latency 24h]). We mock the
// db.js pool so the aggregation/derivation logic runs end-to-end without a DB.

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

function mintRow(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://mint.example.com',
    name: 'Example',
    last_trust_score: 80,
    nuts_limits: { '4': {}, '5': {} },
    online: true,
    latency_ms: 100,
    ...overrides,
  }
}

describe('GET /api/stats', () => {
  it('returns 200 and the full network-stats structure', async () => {
    query
      // Query 1: per-mint rows + latest online status
      .mockResolvedValueOnce({
        rows: [
          mintRow({ url: 'https://a.example', last_trust_score: 80, online: true }),
          mintRow({ url: 'https://b.example', last_trust_score: 50, online: true }),
          mintRow({ url: 'https://c.example', last_trust_score: null, online: false, nuts_limits: null }),
        ],
      })
      // Query 2: median latency over the last 24h
      .mockResolvedValueOnce({ rows: [{ avg_latency: 150 }] })

    const res = await request(app).get('/api/stats')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      totalMints: 3,
      onlineMints: 2,
      offlineMints: 1,
      avgTrustScore: 65, // round((80 + 50) / 2)
      avgLatency24h: 150,
      trustDistribution: { low: 0, moderate: 1, high: 1 },
    })
    expect(Array.isArray(res.body.nutAdoption)).toBe(true)
    expect(Array.isArray(res.body.top5ByTrustScore)).toBe(true)
    // top5 is sorted descending by trust score, nulls excluded.
    expect(res.body.top5ByTrustScore.map((m: { trustScore: number }) => m.trustScore)).toEqual([80, 50])
  })

  it('excludes known dev/test-only mints from top5ByTrustScore even with a top score', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          mintRow({ url: 'https://testnut.cashu.space', name: 'Testnut mint', last_trust_score: 99, online: true }),
          mintRow({ url: 'https://a.example', last_trust_score: 80, online: true }),
        ],
      })
      .mockResolvedValueOnce({ rows: [{ avg_latency: 150 }] })

    const res = await request(app).get('/api/stats')

    expect(res.status).toBe(200)
    expect(res.body.top5ByTrustScore.map((m: { url: string }) => m.url)).toEqual(['https://a.example'])
  })

  it('returns zeroed/empty stats for an empty database (no crash)', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ avg_latency: null }] })

    const res = await request(app).get('/api/stats')

    expect(res.status).toBe(200)
    expect(res.body.totalMints).toBe(0)
    expect(res.body.onlineMints).toBe(0)
    expect(res.body.offlineMints).toBe(0)
    expect(res.body.avgTrustScore).toBeNull()
    expect(res.body.trustDistribution).toEqual({ low: 0, moderate: 0, high: 0 })
    expect(res.body.top5ByTrustScore).toEqual([])
    // nutAdoption still enumerates every tracked NUT, all at count 0.
    expect(res.body.nutAdoption.every((n: { count: number }) => n.count === 0)).toBe(true)
  })

  it('treats mints with NULL latest online as non-offline (matches Dashboard)', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          mintRow({ url: 'https://a.example', online: true }),
          mintRow({ url: 'https://b.example', online: null }), // never probed
        ],
      })
      .mockResolvedValueOnce({ rows: [{ avg_latency: 100 }] })

    const res = await request(app).get('/api/stats')

    expect(res.status).toBe(200)
    expect(res.body.totalMints).toBe(2)
    expect(res.body.onlineMints).toBe(1)
    expect(res.body.offlineMints).toBe(0) // null online is NOT counted as offline
  })

  it('returns 500 with a generic message when the DB query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    query.mockRejectedValueOnce(new Error('pool exhausted'))

    const res = await request(app).get('/api/stats')

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(res.body)).not.toContain('pool exhausted')
  })
})
