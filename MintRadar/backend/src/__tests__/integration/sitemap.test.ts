import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// GET /sitemap.xml is generated dynamically from the mints table so every
// tracked mint's /mint/:url page is discoverable, unlike a static sitemap
// file which can't reflect mints as they're added/removed.

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

describe('GET /sitemap.xml', () => {
  it('includes the static routes and every mint url, XML-escaped and content-typed', async () => {
    query.mockResolvedValueOnce({
      rows: [{ url: 'https://a.example' }, { url: 'https://b.example' }],
    })

    const res = await request(app).get('/sitemap.xml')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/xml')
    expect(res.text).toContain('<loc>https://mintradar.org/</loc>')
    expect(res.text).toContain('<loc>https://mintradar.org/learn/how-to-choose-a-mint</loc>')
    expect(res.text).toContain(`<loc>https://mintradar.org/mint/${encodeURIComponent('https://a.example')}</loc>`)
    expect(res.text).toContain(`<loc>https://mintradar.org/mint/${encodeURIComponent('https://b.example')}</loc>`)
  })

  it('excludes known dev/test-only mints', async () => {
    query.mockResolvedValueOnce({
      rows: [{ url: 'https://testnut.cashu.space' }, { url: 'https://a.example' }],
    })

    const res = await request(app).get('/sitemap.xml')

    expect(res.status).toBe(200)
    expect(res.text).not.toContain('testnut.cashu.space')
    expect(res.text).toContain(encodeURIComponent('https://a.example'))
  })

  it('still returns the static routes for an empty mints table', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app).get('/sitemap.xml')

    expect(res.status).toBe(200)
    expect(res.text).toContain('<loc>https://mintradar.org/</loc>')
  })

  it('returns 500 with a generic message when the DB query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    query.mockRejectedValueOnce(new Error('pool exhausted'))

    const res = await request(app).get('/sitemap.xml')

    expect(res.status).toBe(500)
    expect(res.text).not.toContain('pool exhausted')
  })
})
