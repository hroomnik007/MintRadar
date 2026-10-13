import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// Read routes that every caller may share send `Cache-Control: public, max-age=<their TTL>` and the same strong
// ETag as /api/mints/known and the wallet routes (sha256 of the body), on a miss and on a hit; If-None-Match gives
// 304. The TTLs are unchanged: stats 60, reliability-movers 600, swaps 300, audit-cz 60, nostr-reviews 120.
// Routes that must not be shared (submit, probe) are not touched. The pool is mocked at the db.js boundary.

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))

let app: Express
let query: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  const dns = await import('dns/promises')
  const lookup = dns.lookup as unknown as ReturnType<typeof vi.fn>
  lookup.mockReset()
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
  ;({ app } = await import('../../index.js'))
})

const STRONG_ETAG = /^"[0-9a-f]{32}"$/
const MINT = 'https://mint.example.com'

const mintRow = {
  url: MINT, name: 'Example', last_reliability_score: 80, nuts_limits: { '4': {} },
  discovered_at: new Date(Date.now() - 365 * 86_400_000).toISOString(), online: true, latency_ms: 100,
}
const swapRow = {
  swap_id: 1, to_url: 'https://other.example.com', amount: 56, fee: 2, created_at: new Date('2026-09-11T21:36:24Z'),
  time_taken_ms: 2574, state: 'OK', error: null,
}
const reviewRow = {
  event_id: 'e'.repeat(64), pubkey: 'f'.repeat(64), rating: 4, comment: 'fine', created_at: 1_760_000_000,
  found: false, name: null, display_name: null, nip05: null,
}

interface Route { name: string; path: string; maxAge: number; arrange: () => void }
const ROUTES: Route[] = [
  {
    name: '/api/stats', path: '/api/stats', maxAge: 60,
    arrange: () => { query.mockResolvedValueOnce({ rows: [mintRow] }).mockResolvedValueOnce({ rows: [{ avg_latency: 100 }] }) },
  },
  {
    name: '/api/stats/reliability-movers', path: '/api/stats/reliability-movers', maxAge: 600,
    arrange: () => { query.mockResolvedValueOnce({ rows: [{ url: MINT, name: 'Example', latest_score: 90, old_score: 80 }] }) },
  },
  {
    name: '/api/mints/swaps', path: `/api/mints/swaps?url=${encodeURIComponent(MINT)}`, maxAge: 300,
    arrange: () => { query.mockResolvedValue({ rows: [swapRow] }) },
  },
  {
    name: '/api/mints/audit-cz', path: `/api/mints/audit-cz?url=${encodeURIComponent(MINT)}`, maxAge: 60,
    arrange: () => { query.mockResolvedValue({ rows: [] }) },
  },
  {
    name: '/api/mints/nostr-reviews', path: `/api/mints/nostr-reviews?url=${encodeURIComponent(MINT)}`, maxAge: 120,
    arrange: () => { query.mockResolvedValue({ rows: [reviewRow] }) },
  },
]

describe.each(ROUTES)('$name cache headers', ({ path, maxAge, arrange }) => {
  it(`sends public, max-age=${maxAge} and a strong ETag on a miss and on a hit`, async () => {
    arrange()
    const miss = await request(app).get(path)
    expect(miss.status).toBe(200)
    expect(miss.headers['content-type']).toMatch(/^application\/json/)
    expect(miss.headers['cache-control']).toBe(`public, max-age=${maxAge}`)
    expect(miss.headers['etag']).toMatch(STRONG_ETAG)
    const again = await request(app).get(path)
    expect(again.status).toBe(200)
    expect(again.headers['cache-control']).toBe(`public, max-age=${maxAge}`)
    expect(again.headers['etag']).toBe(miss.headers['etag'])
    expect(again.body).toEqual(miss.body)
  })

  it('answers 304 to a matching If-None-Match (same headers, no body) and 200 to another one', async () => {
    arrange()
    const first = await request(app).get(path)
    const etag = first.headers['etag'] as string
    const nm = await request(app).get(path).set('If-None-Match', etag)
    expect(nm.status).toBe(304)
    expect(nm.headers['cache-control']).toBe(`public, max-age=${maxAge}`)
    expect(nm.headers['etag']).toBe(etag)
    expect(nm.text ?? '').toBe('')
    const other = await request(app).get(path).set('If-None-Match', '"0123456789abcdef0123456789abcdef"')
    expect(other.status).toBe(200)
    // the weak form of the same validator (what a compressing proxy sends back) matches too
    const weak = await request(app).get(path).set('If-None-Match', `W/${etag}`)
    expect(weak.status).toBe(304)
  })
})

describe('routes that must not be shared stay as they were', () => {
  it('POST /api/mint/submit and GET /api/mint/probe never send a public Cache-Control', async () => {
    const submit = await request(app).post('/api/mint/submit').send({})
    expect(submit.headers['cache-control'] ?? '').not.toMatch(/public/)
    const probe = await request(app).get('/api/mint/probe')
    expect(probe.headers['cache-control'] ?? '').not.toMatch(/public/)
  })

  it('an error response of a cached route carries no Cache-Control', async () => {
    const res = await request(app).get('/api/mints/audit-cz')
    expect(res.status).toBe(400)
    expect(res.headers['cache-control'] ?? '').not.toMatch(/public|max-age/)
  })
})
