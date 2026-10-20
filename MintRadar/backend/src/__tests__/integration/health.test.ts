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
  it('reports lastVantageOutageAt: null until a cycle was classified, then its ISO time', async () => {
    getLastProbeCompletedAt.mockReturnValue(null)
    const before = await request(app).get('/health')
    expect(before.body).toHaveProperty('lastVantageOutageAt', null)

    const { noteVantageOutage } = await import('../../probeCycle.js')
    noteVantageOutage(new Date('2026-10-20T11:05:00.000Z'))
    const after = await request(app).get('/health')
    expect(after.body.lastVantageOutageAt).toBe('2026-10-20T11:05:00.000Z')
    const aliased = await request(app).get('/api/v1/health')
    expect(aliased.body.lastVantageOutageAt).toBe('2026-10-20T11:05:00.000Z')
  })

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

  it('sources: one entry per input, additive next to the existing fields', async () => {
    getLastProbeCompletedAt.mockReturnValue('2026-10-20T09:58:12.000Z')
    for (const path of ['/health', '/api/v1/health']) {
      const res = await request(app).get(path)
      expect(res.status, path).toBe(200)
      // every existing field is still there
      for (const k of ['status', 'timestamp', 'lastProbeAt', 'lastVantageOutageAt', 'lastAuditSyncAt', 'lastReviewsSyncAt', 'auditUpstream', 'auditUpstreamCheckedAt', 'auditCz']) {
        expect(res.body, `${path} ${k}`).toHaveProperty(k)
      }
      const s = res.body.sources
      expect(Object.keys(s).sort(), path).toEqual(['audit8333', 'cashuInfo', 'ownProbe', 'reviews'])
      expect(s.ownProbe).toEqual({ usedForScore: true, lastProbeAt: '2026-10-20T09:58:12.000Z' })
      expect(Object.keys(s.cashuInfo).sort()).toEqual(['lastSyncAt', 'status', 'usedForScore'])
      expect(s.cashuInfo.usedForScore).toBe(true)
      expect(s.cashuInfo.status).toBe('unknown') // no cycle since the (test) start
      expect(s.cashuInfo.lastSyncAt).toBeNull()
      expect(s.reviews).toEqual({ usedForScore: false, lastSyncAt: res.body.lastReviewsSyncAt })
      expect(Object.keys(s.audit8333).sort()).toEqual(['lastSyncAt', 'status', 'usedForScore'])
      expect(s.audit8333.usedForScore).toBe(false)
      expect(s.audit8333.lastSyncAt).toBe(res.body.lastAuditSyncAt)
      expect(s.audit8333.status).toBe(res.body.auditUpstream)
    }
  })

  it('sources carries only timestamps, booleans and status words: no URL, host name or relay', async () => {
    getLastProbeCompletedAt.mockReturnValue(null)
    const res = await request(app).get('/health')
    const text = JSON.stringify(res.body.sources)
    expect(text).not.toMatch(/https?:|wss?:|\.org|\.space|\.info|\.cz|relay/i)
    const walk = (v: unknown): void => {
      if (v !== null && typeof v === 'object') Object.values(v).forEach(walk)
      else expect(['string', 'boolean']).toContain(v === null ? 'string' : typeof v)
    }
    walk(res.body.sources)
  })
})

describe('auditCzSourceStatus', () => {
  it('unknown before a cycle, ok when both responses were stored, partial for one, down for none', async () => {
    const { auditCzSourceStatus } = await import('../../auditCz.js')
    const base = { skipped: null }
    expect(auditCzSourceStatus({ ...base, lastSyncAt: null, mintsStored: null, swapsStored: null })).toBe('unknown')
    expect(auditCzSourceStatus({ ...base, lastSyncAt: 't', mintsStored: 62, swapsStored: 98 })).toBe('ok')
    expect(auditCzSourceStatus({ ...base, lastSyncAt: 't', mintsStored: 0, swapsStored: 0 })).toBe('ok')
    expect(auditCzSourceStatus({ ...base, lastSyncAt: 't', mintsStored: 62, swapsStored: null })).toBe('partial')
    expect(auditCzSourceStatus({ ...base, lastSyncAt: 't', mintsStored: null, swapsStored: 98 })).toBe('partial')
    expect(auditCzSourceStatus({ ...base, lastSyncAt: 't', mintsStored: null, swapsStored: null })).toBe('down')
  })
})
