import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// GET /api/mints/nostr-reviews serves the `mint_reviews` rows that the 6h
// background sync (reviewsSync.ts) populates from Nostr relays — it no longer
// does its own live relay query per request. These tests mock the pg pool and
// assert the route's validation, row→JSON mapping, ordering pass-through, and
// error fallback.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('../../db.js', () => ({
  pool: { query: queryMock },
  initDb: vi.fn(),
}))

let app: Express

beforeEach(async () => {
  vi.resetModules()
  queryMock.mockReset()
  ;({ app } = await import('../../index.js'))
})

let n = 0
function row(overrides: Partial<{ event_id: string; pubkey: string; rating: number | null; comment: string; created_at: number }> = {}) {
  n++
  return {
    event_id: `evt-${n}`,
    pubkey: `pubkey-${n}`,
    rating: 5,
    comment: 'Solid mint',
    created_at: 1_700_000_000 + n,
    ...overrides,
  }
}

describe('GET /api/mints/nostr-reviews', () => {
  it('maps DB rows to the review JSON shape', async () => {
    queryMock.mockResolvedValue({
      rows: [
        row({ pubkey: 'bob', rating: 2, comment: 'Meh', created_at: 200 }),
        row({ pubkey: 'alice', rating: 4, comment: 'Good', created_at: 100 }),
      ],
    })

    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0]).toMatchObject({ pubkey: 'bob', rating: 2, content: 'Meh', createdAt: 200, source: 'nostr' })
    expect(res.body[0].id).toBe(res.body[0].id) // event_id surfaced as `id`
    expect(res.body[1]).toMatchObject({ pubkey: 'alice', rating: 4, content: 'Good' })
  })

  it('queries the given url, ordered newest-first', async () => {
    queryMock.mockResolvedValue({ rows: [] })

    await request(app).get('/api/mints/nostr-reviews').query({ url: 'https://mint.example.com' })

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [sql, params] = queryMock.mock.calls[0]!
    expect(sql).toMatch(/FROM mint_reviews WHERE url = \$1/)
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual(['https://mint.example.com'])
  })

  it('returns an empty array when the mint has no cached reviews', async () => {
    queryMock.mockResolvedValue({ rows: [] })

    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('passes a null rating through unchanged (rating-less endorsement event)', async () => {
    queryMock.mockResolvedValue({ rows: [row({ rating: null, comment: '' })] })

    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: 'https://mint.example.com' })

    expect(res.body[0]).toMatchObject({ rating: null, content: '' })
  })

  it('returns an empty array (not 500) when the DB query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    queryMock.mockRejectedValue(new Error('db down'))

    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns 400 when the url query param is missing', async () => {
    const res = await request(app).get('/api/mints/nostr-reviews')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Missing required query parameter: url' })
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-https url', async () => {
    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: 'http://x.example.com' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'url must start with https://' })
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('returns 400 for a url exceeding the max length', async () => {
    const res = await request(app)
      .get('/api/mints/nostr-reviews')
      .query({ url: 'https://example.com/' + 'a'.repeat(600) })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/maximum length/)
  })

  it('returns an XSS payload in a review comment verbatim (no dangerous server-side transform)', async () => {
    const xss = '<script>alert(document.cookie)</script>'
    queryMock.mockResolvedValue({ rows: [row({ pubkey: 'mallory', comment: xss })] })

    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    // Backend passes the comment through as inert JSON data — no execution, no
    // mutation. Escaping is the frontend's job.
    expect(res.body[0].content).toBe(xss)
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })

  it('sets a short Cache-Control so the CDN/browser can reuse it briefly', async () => {
    queryMock.mockResolvedValue({ rows: [] })

    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: 'https://mint.example.com' })

    expect(res.headers['cache-control']).toMatch(/max-age=\d+/)
  })
})
