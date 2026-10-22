import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { readFileSync } from 'node:fs'

// Readiness gate (readiness.ts): until initDb() and the seed have finished, database routes answer 503 with
// Retry-After: 2; /health keeps its 200 and reports ready:false; the gate opens once and never closes again.
// db.js is mocked, so no database is dialed. The real app is imported; NODE_ENV=test opens the gate by default, so
// every other test file is unaffected, and this file closes it explicitly with setReadyForTests(false).

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  initDb: vi.fn(),
}))

vi.mock('../../cron.js', () => ({
  seedKnownMints: vi.fn(),
  startCron: vi.fn(),
  getLastProbeCompletedAt: vi.fn(() => null),
}))

let app: Express
let readiness: typeof import('../../readiness.js')

beforeEach(async () => {
  vi.resetModules()
  readiness = await import('../../readiness.js')
  ;({ app } = await import('../../index.js'))
})

describe('app factory default', () => {
  it('starts open under NODE_ENV=test, so existing tests do not change', () => {
    expect(readiness.isReady()).toBe(true)
  })
})

describe('before ready', () => {
  beforeEach(() => { readiness.setReadyForTests(false) })

  it.each(['/api/mints/known', '/api/wallets/mints', '/api/v1/wallets/mints', '/api/stats', '/sitemap.xml'])(
    '%s answers 503 starting with Retry-After: 2',
    async (path) => {
      const res = await request(app).get(path)
      expect(res.status).toBe(503)
      expect(res.headers['retry-after']).toBe('2')
      expect(res.body).toEqual({ error: 'starting' })
    },
  )

  it('gates writes too', async () => {
    const res = await request(app).post('/api/mint/submit').send({ url: 'https://mint.example.com' })
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: 'starting' })
  })

  it('/health keeps its 200 and reports ready:false (also under /api/v1/health)', async () => {
    for (const path of ['/health', '/api/v1/health']) {
      const res = await request(app).get(path)
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('ok')
      expect(res.body.ready).toBe(false)
    }
  })

  it('does not gate the routes that never touch the database', async () => {
    expect((await request(app).get('/api/og/page?p=methodology')).status).toBe(200)
    expect((await request(app).get('/api')).status).toBe(200)
  })
})

describe('after ready', () => {
  it('the same routes pass through and /health reports ready:true', async () => {
    readiness.setReadyForTests(false)
    expect((await request(app).get('/api/wallets/mints')).status).toBe(503)
    readiness.setReadyForTests(true)
    const wallet = await request(app).get('/api/wallets/mints')
    expect(wallet.status).not.toBe(503)
    const known = await request(app).get('/api/mints/known')
    expect(known.status).not.toBe(503)
    expect((await request(app).get('/health')).body.ready).toBe(true)
  })
})

describe('openGateAfter', () => {
  it('opens the gate only after the start-up work has resolved', async () => {
    readiness.setReadyForTests(false)
    let finish!: () => void
    const pending = readiness.openGateAfter(() => new Promise<void>((resolve) => { finish = resolve }))
    await Promise.resolve()
    expect(readiness.isReady()).toBe(false)
    expect((await request(app).get('/api/mints/known')).status).toBe(503)
    finish()
    await pending
    expect(readiness.isReady()).toBe(true)
    expect((await request(app).get('/api/mints/known')).status).not.toBe(503)
  })

  it('does not open the gate when the start-up work fails, and passes the error on', async () => {
    readiness.setReadyForTests(false)
    const boom = new Error('initDb failed')
    await expect(readiness.openGateAfter(() => Promise.reject(boom))).rejects.toBe(boom)
    expect(readiness.isReady()).toBe(false)
    expect((await request(app).get('/api/mints/known')).status).toBe(503)
    expect((await request(app).get('/health')).body.ready).toBe(false)
  })

  it('is never closed again once open: a later failing run leaves it open', async () => {
    readiness.setReadyForTests(false)
    await readiness.openGateAfter(() => Promise.resolve())
    await expect(readiness.openGateAfter(() => Promise.reject(new Error('later')))).rejects.toThrow('later')
    expect(readiness.isReady()).toBe(true)
  })

  it('runs initDb then the seed, in that order, before opening', async () => {
    readiness.setReadyForTests(false)
    const order: string[] = []
    const seen: boolean[] = []
    const initDb = async (): Promise<void> => { order.push('initDb'); seen.push(readiness.isReady()) }
    const seed = async (): Promise<void> => { order.push('seed'); seen.push(readiness.isReady()) }
    await readiness.openGateAfter(() => initDb().then(() => seed()))
    expect(order).toEqual(['initDb', 'seed'])
    expect(seen).toEqual([false, false])
    expect(readiness.isReady()).toBe(true)
  })
})

describe('start-up wiring in index.ts', () => {
  it('opens the gate after initDb and the seed, and before cron and the warm-ups', () => {
    const src = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8')
    const listen = src.slice(src.indexOf('app.listen(PORT'))
    const gate = listen.indexOf('openGateAfter(() => initDb().then(() => seedKnownMints(upsertMint)))')
    expect(gate).toBeGreaterThan(-1)
    expect(listen.indexOf('startCron()')).toBeGreaterThan(gate)
    expect(src.indexOf('app.use(readinessGate)')).toBeLessThan(src.indexOf('app.use(express.json())'))
  })
})

describe('/health makes no database call before ready (E4b)', () => {
  it.each(['/health', '/api/v1/health'])('%s: zero pool calls, usual 200 and fields, ready:false', async (path) => {
    const { pool } = await import('../../db.js')
    const query = pool.query as unknown as ReturnType<typeof vi.fn>
    readiness.setReadyForTests(false)
    query.mockClear()
    const res = await request(app).get(path)
    expect(query).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(res.body.ready).toBe(false)
    expect(res.body.lastAuditSyncAt).toBeNull()
    expect(res.body.lastReviewsSyncAt).toBeNull()
    for (const k of ['status', 'timestamp', 'lastProbeAt', 'lastVantageOutageAt', 'auditUpstream', 'auditUpstreamCheckedAt', 'auditCz', 'sources']) {
      expect(res.body).toHaveProperty(k)
    }
  })

  it.each(['/health', '/api/v1/health'])('%s: queries the database as before once ready', async (path) => {
    const { pool } = await import('../../db.js')
    const query = pool.query as unknown as ReturnType<typeof vi.fn>
    readiness.setReadyForTests(true)
    query.mockClear()
    query.mockResolvedValue({ rows: [{ last_sync: '2026-10-22T06:00:00.000Z', last_reviews_sync: null }] })
    const res = await request(app).get(path)
    expect(query).toHaveBeenCalled()
    expect(res.body.ready).toBe(true)
    expect(res.body.lastAuditSyncAt).toBe('2026-10-22T06:00:00.000Z')
  })
})
