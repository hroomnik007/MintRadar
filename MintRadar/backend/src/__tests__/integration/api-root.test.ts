import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// GET /api and /api/ answer with a small JSON pointer to the docs instead of Express's
// "Cannot GET /api/". Same db.js mocking approach as api-v1-alias.test.ts.

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))

let app: Express

beforeEach(async () => {
  vi.resetModules()
  ;({ app } = await import('../../index.js'))
})

describe('GET /api', () => {
  it.each(['/api', '/api/', '/api/v1'])('%s returns the API pointer', async (path) => {
    const res = await request(app).get(path)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body).toEqual({
      name: 'MintRadar API',
      docs: 'https://github.com/hroomnik007/MintRadar/blob/main/MintRadar/docs/API.md',
      health: '/api/v1/health',
    })
  })

  it('is still counted by the per-IP rate limiter', async () => {
    const res = await request(app).get('/api')
    expect(res.headers['x-ratelimit-limit']).toBeDefined()
  })

  it('an unknown /api/* path stays a 404', async () => {
    const res = await request(app).get('/api/nope')
    expect(res.status).toBe(404)
  })
})
