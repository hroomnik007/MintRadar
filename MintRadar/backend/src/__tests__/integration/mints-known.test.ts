import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// GET /api/mints/known is a read-only, rate-limit-exempt endpoint backed by a
// single SQL query and a 60s in-memory cache. We mock the `pg`-backed pool at
// the db.js boundary so the real route handler, middleware stack and the
// computeDegraded/shape-mapping logic run end-to-end without a database.
//
// `vi.resetModules()` in beforeEach gives every test a pristine index.js module
// instance — resetting the knownMintsCache and the rate-limit stores so tests
// are fully independent.

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

// A representative row as returned by the /api/mints/known SQL projection.
function sampleRow(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://mint.example.com',
    name: 'Example Mint',
    icon_url: 'https://mint.example.com/icon.png',
    version: 'Nutshell/0.16.0',
    nut_count: 12,
    tos_url: 'https://mint.example.com/tos',
    description_long: 'A test mint',
    nuts_limits: { '4': {}, '5': {} },
    audit_n_mints: 100,
    audit_n_melts: 50,
    audit_n_errors: 0,
    audit_checked_at: '2026-06-30T00:00:00.000Z',
    discovered_at: '2026-01-01T00:00:00.000Z',
    last_trust_score: 88,
    last_error: null,
    server_location: 'US',
    total: 12,
    online_count: 12,
    latest_online: true,
    latest_latency_ms: 142,
    latest_checked_at: '2026-06-30T11:55:00.000Z',
    ...overrides,
  }
}

describe('GET /api/mints/known', () => {
  it('returns 200 and an array of mints', async () => {
    query.mockResolvedValueOnce({ rows: [sampleRow()] })

    const res = await request(app).get('/api/mints/known')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body).toHaveLength(1)
  })

  it('maps the SQL projection to the expected response shape', async () => {
    query.mockResolvedValueOnce({ rows: [sampleRow()] })

    const res = await request(app).get('/api/mints/known')
    const mint = res.body[0]

    // Core fields the frontend Dashboard relies on.
    expect(mint).toMatchObject({
      url: 'https://mint.example.com',
      name: 'Example Mint',
      online: true,
      latencyMs: 142,
      version: 'Nutshell/0.16.0',
      nutCount: 12,
      trustScore: 88,
      degraded: false,
      uptimePct24h: 100,
      serverLocation: 'US',
    })
    // The contract advertised in CLAUDE.md: url, degraded, online, trustScore.
    expect(mint).toHaveProperty('url')
    expect(mint).toHaveProperty('degraded')
    expect(mint).toHaveProperty('trustScore')
    expect(mint).toHaveProperty('lastCheckedAt')
  })

  it('marks a long-offline mint as degraded', async () => {
    // last state offline, last probe >24h old → isStaleOffline → degraded
    query.mockResolvedValueOnce({
      rows: [
        sampleRow({
          latest_online: false,
          online_count: 0,
          latest_checked_at: '2026-06-01T00:00:00.000Z',
          latest_latency_ms: null,
        }),
      ],
    })

    const res = await request(app).get('/api/mints/known')

    expect(res.status).toBe(200)
    expect(res.body[0].degraded).toBe(true)
  })

  it('returns an empty array (not an error) when the DB has no mints', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app).get('/api/mints/known')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('sends a Cache-Control header for CDN/browser caching', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app).get('/api/mints/known')

    expect(res.headers['cache-control']).toBe('max-age=300')
  })

  it('returns 500 with a generic message when the DB query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    query.mockRejectedValueOnce(new Error('connection refused'))

    const res = await request(app).get('/api/mints/known')

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    // The internal error message must not leak to the client.
    expect(JSON.stringify(res.body)).not.toContain('connection refused')
  })

  it('serves the cached payload on a second request without re-querying the DB', async () => {
    query.mockResolvedValueOnce({ rows: [sampleRow()] })

    await request(app).get('/api/mints/known')
    await request(app).get('/api/mints/known')

    // 60s TTL cache → only one DB round-trip for two requests.
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('applies standard security headers', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app).get('/api/mints/known')

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
  })
})
