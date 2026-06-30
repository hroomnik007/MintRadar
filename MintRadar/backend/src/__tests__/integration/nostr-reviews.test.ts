import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// GET /api/mints/nostr-reviews fetches NIP-87 kind:38000 events from Nostr
// relays, verifies their signatures, dedupes by author, and parses the rating
// + comment. We mock the nostr-tools boundary (SimplePool.querySync +
// verifyEvent) so the route, validation, dedupe and real parseReviewRatingAndComment
// logic run without hitting any relay. db.js is mocked to avoid a real pool.

const { querySyncMock, verifyEventMock } = vi.hoisted(() => ({
  querySyncMock: vi.fn(),
  verifyEventMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))
vi.mock('nostr-tools', () => ({
  // Must be a `function` (not an arrow) so the handler's `new SimplePool()` works.
  SimplePool: vi.fn(function () {
    return { querySync: querySyncMock, destroy: vi.fn() }
  }),
  verifyEvent: verifyEventMock,
}))

let app: Express

beforeEach(async () => {
  vi.resetModules()
  querySyncMock.mockReset()
  verifyEventMock.mockReset()
  verifyEventMock.mockReturnValue(true) // signatures valid unless a test says otherwise
  ;({ app } = await import('../../index.js'))
})

let pubkeyCounter = 0
function review(overrides: Partial<{ id: string; pubkey: string; content: string; tags: string[][]; created_at: number }> = {}) {
  pubkeyCounter++
  return {
    id: `id-${pubkeyCounter}`,
    pubkey: `pubkey-${pubkeyCounter}`,
    content: '[5/5] Solid mint',
    tags: [] as string[][],
    created_at: 1_700_000_000 + pubkeyCounter,
    ...overrides,
  }
}

// Each test uses a distinct mint URL so the per-URL response cache never bleeds
// across tests (and the resetModules in beforeEach starts from a clean cache).
let urlCounter = 0
function freshUrl() {
  urlCounter++
  return `https://mint${urlCounter}.example.com`
}

describe('GET /api/mints/nostr-reviews', () => {
  it('returns parsed reviews for a valid mint URL', async () => {
    querySyncMock.mockResolvedValue([
      review({ pubkey: 'alice', content: '[4/5] Good', created_at: 100 }),
      review({ pubkey: 'bob', content: '[2/5] Meh', created_at: 200 }),
    ])

    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: freshUrl() })

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body).toHaveLength(2)
    // Sorted newest-first.
    expect(res.body[0].pubkey).toBe('bob')
    expect(res.body[0]).toMatchObject({ rating: 2, content: 'Meh', source: 'nostr' })
    expect(res.body[1]).toMatchObject({ pubkey: 'alice', rating: 4, content: 'Good' })
  })

  it('returns an empty array (not an error) when no reviews exist', async () => {
    querySyncMock.mockResolvedValue([])

    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: freshUrl() })

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('keeps only the most recent review per author (dedupe by pubkey)', async () => {
    querySyncMock.mockResolvedValue([
      review({ pubkey: 'alice', content: '[1/5] old', created_at: 100 }),
      review({ pubkey: 'alice', content: '[5/5] new', created_at: 999 }),
    ])

    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: freshUrl() })

    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({ rating: 5, content: 'new' })
  })

  it('drops events whose signature fails verification', async () => {
    verifyEventMock.mockReturnValue(false)
    querySyncMock.mockResolvedValue([review({ content: '[5/5] forged' })])

    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: freshUrl() })

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns an empty array (not 500) when the relay query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    querySyncMock.mockRejectedValue(new Error('relay timeout'))

    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: freshUrl() })

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns 400 when the url query param is missing', async () => {
    const res = await request(app).get('/api/mints/nostr-reviews')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Missing required query parameter: url' })
    expect(querySyncMock).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-https url', async () => {
    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: 'http://x.example.com' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'url must start with https://' })
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
    querySyncMock.mockResolvedValue([review({ pubkey: 'mallory', content: xss })])

    const res = await request(app).get('/api/mints/nostr-reviews').query({ url: freshUrl() })

    expect(res.status).toBe(200)
    // Backend passes the comment through as inert JSON data — no execution, no
    // mutation. Escaping is the frontend's job.
    expect(res.body[0].content).toBe(xss)
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })

  it('serves the cached payload on a second request for the same url (one relay round-trip)', async () => {
    querySyncMock.mockResolvedValue([review({ pubkey: 'alice', content: '[3/5] ok' })])
    const url = freshUrl()

    await request(app).get('/api/mints/nostr-reviews').query({ url })
    await request(app).get('/api/mints/nostr-reviews').query({ url })

    expect(querySyncMock).toHaveBeenCalledTimes(1)
  })
})
