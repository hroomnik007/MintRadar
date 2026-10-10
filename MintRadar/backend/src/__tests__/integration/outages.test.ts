// MintRadar/backend/src/__tests__/integration/outages.test.ts
// Add this file to cover the new endpoint.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))

let app: Express
let query: ReturnType<typeof vi.fn>
let lookup: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  const dns = await import('dns/promises')
  lookup = dns.lookup as unknown as ReturnType<typeof vi.fn>
  lookup.mockReset()
  lookup.mockResolvedValue([{ address: '1.2.3.4', family: 4 }] as never)
  ;({ app } = await import('../../index.js'))
})

describe('GET /api/mints/outages', () => {
  it('returns 400 without url', async () => {
    const res = await request(app).get('/api/mints/outages')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/url/)
  })

  it('returns empty outages when no offline blocks', async () => {
    query.mockResolvedValue({
      rows: [
        { online: true, checked_at: new Date('2026-10-10T10:00:00Z') },
        { online: true, checked_at: new Date('2026-10-10T10:05:00Z') },
      ],
    })
    const res = await request(app).get('/api/mints/outages').query({ url: 'https://mint.example.com' })
    expect(res.status).toBe(200)
    expect(res.body.outageCount).toBe(0)
    expect(res.body.outages).toEqual([])
    expect(res.body.sinceLastOutageMs).toBeNull()
  })

  it('detects a consecutive offline block of 2+', async () => {
    const t0 = new Date('2026-10-05T20:40:00Z')
    const t1 = new Date('2026-10-05T20:45:00Z')
    const t2 = new Date('2026-10-05T20:50:00Z')
    query.mockResolvedValue({
      rows: [
        { online: false, checked_at: t0 },
        { online: false, checked_at: t1 },
        { online: true, checked_at: t2 },
      ],
    })
    const res = await request(app).get('/api/mints/outages').query({ url: 'https://mint.example.com' })
    expect(res.status).toBe(200)
    expect(res.body.outageCount).toBe(1)
    expect(res.body.outages).toHaveLength(1)
    expect(res.body.outages[0].error).toBe('offline')
    expect(res.body.outages[0].durationMs).toBe(t2.getTime() - t0.getTime())
  })
})
