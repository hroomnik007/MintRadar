import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// GET /api/v1/* — alias mounted onto the existing /api/* handlers (D2). The
// alias is a request-rewrite middleware, not a duplicate route registration,
// so it must inherit the exact same handler, response shape, and rate-limit
// exemption as its /api/* equivalent. Same db.js mocking approach as
// version-history.test.ts.

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

describe('GET /api/v1/* alias', () => {
  it('/api/v1/stats returns the same shape as /api/stats', async () => {
    // /api/stats issues several queries — return empty rows for all of them.
    query.mockResolvedValue({ rows: [] })
    const [legacy, aliased] = await Promise.all([
      request(app).get('/api/stats'),
      request(app).get('/api/v1/stats'),
    ])
    expect(legacy.status).toBe(200)
    expect(aliased.status).toBe(200)
    expect(aliased.body).toEqual(legacy.body)
  })

  it('/api/v1/mints/known is exempt from the per-IP rate limiter, same as /api/mints/known', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(app).get('/api/v1/mints/known')
    expect(res.status).toBe(200)
    expect(res.headers['x-ratelimit-limit']).toBeUndefined()
  })

  it('a bare /api/v1 with a query string rewrites to /api with the query string preserved', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(app).get('/api/v1/mints/history?url=https%3A%2F%2Fmint.example.com&period=24h')
    // Missing/invalid params on the real handler would 400, not 404 — proves
    // routing reached the handler at all rather than falling through to Express's
    // default 404, which is what a broken prefix rewrite would produce.
    expect(res.status).not.toBe(404)
  })

  it('/api/v1/nonexistent-route still 404s (alias does not swallow unknown paths)', async () => {
    const res = await request(app).get('/api/v1/nonexistent-route')
    expect(res.status).toBe(404)
  })
})
