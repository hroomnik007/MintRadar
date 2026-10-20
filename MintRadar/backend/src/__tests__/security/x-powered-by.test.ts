import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// Express announces itself with X-Powered-By unless app.disable('x-powered-by') is called (index.ts, right after
// the app is created). The header must be absent on a success, a 404 and a 400 answer.

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
  query.mockResolvedValue({ rows: [] })
  ;({ app } = await import('../../index.js'))
})

describe('X-Powered-By', () => {
  it('is not sent on GET /api/v1/health', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('is not sent on a 404 for an unknown /api route', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist')
    expect(res.status).toBe(404)
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('is not sent on a 400 answer', async () => {
    const res = await request(app).get('/api/mint/probe')
    expect(res.status).toBe(400)
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})
