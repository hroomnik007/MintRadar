import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { PAGE_META, OG_PAGE_SLUGS } from '../../shared/pageMeta.js'

// GET /api/og/page — bot HTML of /methodology and /for-wallets (nginx sends social crawlers here with a fixed slug,
// deploy/nginx.conf). Same mocking approach as og-mint.test.ts. The route never touches the database and never
// copies a query value into the response.

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

const NOT_FOUND = { error: 'Not found' }

describe('GET /api/og/page', () => {
  it.each(Object.entries(OG_PAGE_SLUGS))('p=%s returns the bot HTML built from PAGE_META', async (slug, path) => {
    const meta = PAGE_META[path]
    const url = `https://mintradar.org${meta.canonicalPath}`
    const res = await request(app).get('/api/og/page').query({ p: slug })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.headers['cache-control']).toBe('public, max-age=300')
    expect(res.text).toContain(`<title>${meta.title}</title>`)
    expect(res.text).toContain(`<meta property="og:title" content="${meta.title}" />`)
    expect(res.text).toContain(`<meta property="og:description" content="${meta.description}" />`)
    expect(res.text).toContain(`<meta name="twitter:title" content="${meta.title}" />`)
    expect(res.text).toContain(`<link rel="canonical" href="${url}" />`)
    expect(res.text).toContain(`<meta property="og:url" content="${url}" />`)
    expect(res.text).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(res.text).toContain('<meta property="og:image" content="https://mintradar.org/og-image-reliability.png" />')
    expect(res.text).toContain(`<a href="${url}">`)
    expect(query).not.toHaveBeenCalled()
  })

  it('returns the exact texts agreed for the two pages', async () => {
    const m = await request(app).get('/api/og/page').query({ p: 'methodology' })
    expect(m.text).toContain('<title>How the Reliability Score is computed | MintRadar</title>')
    const w = await request(app).get('/api/og/page').query({ p: 'for-wallets' })
    expect(w.text).toContain('<title>MintRadar for wallets | Cashu mint health API</title>')
  })

  it('answers 404 JSON for an unknown slug, a missing parameter and an empty one', async () => {
    for (const q of ['p=unknown', 'p=', 'p=Methodology', 'p=%2Fmethodology', 'p=__proto__', 'p=constructor', '']) {
      const res = await request(app).get(`/api/og/page?${q}`)
      expect(res.status, q).toBe(404)
      expect(res.headers['content-type'], q).toMatch(/application\/json/)
      expect(res.body, q).toEqual(NOT_FOUND)
    }
  })

  it('answers 404 when p is repeated or an array/object (nothing is picked from it)', async () => {
    for (const q of ['p=methodology&p=for-wallets', 'p[]=methodology', 'p[x]=methodology', 'p=methodology&p=<script>']) {
      const res = await request(app).get(`/api/og/page?${q}`)
      expect(res.status, q).toBe(404)
      expect(res.body, q).toEqual(NOT_FOUND)
    }
  })

  it('reflects no query value: a hostile p, and extra parameters next to a valid one, never reach the body', async () => {
    const hostile = '<script>alert(1)</script>'
    const bad = await request(app).get('/api/og/page').query({ p: hostile })
    expect(bad.status).toBe(404)
    expect(bad.text).not.toContain('script')
    expect(bad.text).not.toContain('alert')
    expect(bad.body).toEqual(NOT_FOUND)

    const ok = await request(app).get('/api/og/page').query({ p: 'methodology', title: hostile, url: 'https://evil.example', x: '"><b>' })
    expect(ok.status).toBe(200)
    expect(ok.text).not.toContain('evil.example')
    expect(ok.text).not.toContain('<script>')
    expect(ok.text).not.toContain('<b>')
    expect(ok.text).not.toContain('alert')
    const clean = await request(app).get('/api/og/page').query({ p: 'methodology' })
    expect(ok.text).toBe(clean.text)
  })

  it('serves only GET', async () => {
    const res = await request(app).post('/api/og/page').query({ p: 'methodology' })
    expect(res.status).not.toBe(200)
  })
})
