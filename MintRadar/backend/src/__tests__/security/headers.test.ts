import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// HTTP security headers are set by an Express middleware in index.ts that runs
// before routing, so EVERY response (2xx/4xx/404) must carry them. CSP and HSTS
// are deliberately NOT set here — they live at the nginx layer (see CLAUDE.md
// "nginx CSP" / "add_header non-inheritance" notes), so this suite asserts only
// the headers Express owns.
//
// This file also covers the "auth" category: the backend exposes only public,
// unauthenticated endpoints (there are no admin/privileged routes), so the
// security property to verify is that public reads work with no credentials.

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

const EXPECTED_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-xss-protection': '0',
}

describe('HTTP security headers', () => {
  it('sets all security headers on a successful GET', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app).get('/api/mints/known')

    for (const [header, value] of Object.entries(EXPECTED_HEADERS)) {
      expect(res.headers[header]).toBe(value)
    }
  })

  it('sets all security headers on a 400 response', async () => {
    const res = await request(app).post('/api/mint/submit').send({}) // missing url → 400

    expect(res.status).toBe(400)
    for (const [header, value] of Object.entries(EXPECTED_HEADERS)) {
      expect(res.headers[header]).toBe(value)
    }
  })

  it('sets all security headers on a 404 (unknown route)', async () => {
    const res = await request(app).get('/this/route/does/not/exist')

    expect(res.status).toBe(404)
    for (const [header, value] of Object.entries(EXPECTED_HEADERS)) {
      expect(res.headers[header]).toBe(value)
    }
  })

  it('disables the legacy X-XSS-Protection auditor (set to 0, not 1)', async () => {
    // 0 is the modern, recommended value — the legacy auditor itself was a
    // source of vulnerabilities, so it must be explicitly disabled.
    query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app).get('/api/mints/known')

    expect(res.headers['x-xss-protection']).toBe('0')
  })

  it('does not emit a CSP header from Express (CSP is owned by nginx)', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app).get('/api/mints/known')

    // Documents the layering boundary: if this ever changes, the nginx-vs-app
    // CSP ownership has shifted and needs review.
    expect(res.headers['content-security-policy']).toBeUndefined()
  })
})

describe('public access (no authentication required)', () => {
  it('serves GET /api/mints/known without any credentials', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app).get('/api/mints/known')

    expect(res.status).toBe(200)
  })

  it('serves GET /api/stats without any credentials', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ avg_latency: null }] })

    const res = await request(app).get('/api/stats')

    expect(res.status).toBe(200)
  })

  it('does not gate public reads behind an Authorization header', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    // Presence/absence of an Authorization header must not change the outcome.
    const withAuth = await request(app)
      .get('/api/mints/known')
      .set('Authorization', 'Bearer some-token')

    expect(withAuth.status).toBe(200)
  })
})
