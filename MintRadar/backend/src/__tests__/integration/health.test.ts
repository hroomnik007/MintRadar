import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// GET /health — lastProbeAt reflects the last completed 5-min probe cycle
// (cron.ts's getLastProbeCompletedAt()), not mere process-alive status.
// cron.js is mocked here (same db.js mocking approach as version-history.test.ts)
// so the route's wiring is tested in isolation from node-cron scheduling itself.

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))

const getLastProbeCompletedAt = vi.fn<() => string | null>()
vi.mock('../../cron.js', () => ({
  seedKnownMints: vi.fn(),
  startCron: vi.fn(),
  getLastProbeCompletedAt,
}))

let app: Express

beforeEach(async () => {
  vi.resetModules()
  getLastProbeCompletedAt.mockReset()
  ;({ app } = await import('../../index.js'))
})

describe('GET /health', () => {
  it('reports lastProbeAt: null before any probe cycle has completed', async () => {
    getLastProbeCompletedAt.mockReturnValue(null)
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(typeof res.body.timestamp).toBe('string')
    expect(res.body.lastProbeAt).toBeNull()
  })

  it('passes through the timestamp of the last completed probe cycle', async () => {
    getLastProbeCompletedAt.mockReturnValue('2026-06-25T09:58:12.000Z')
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.lastProbeAt).toBe('2026-06-25T09:58:12.000Z')
  })
})
