import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// Error responses must never leak internal details — stack traces, DB
// connection strings, credentials or filesystem paths. We force every
// 500-capable endpoint to fail with a DB error whose message is deliberately
// stuffed with sensitive-looking content, then assert none of it reaches the
// client and the body is the generic { error: 'Internal server error' }.

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('../../ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ssrf.js')>()
  return { ...actual, safeFetch: vi.fn() }
})
vi.mock('../../prober.js', () => ({
  upsertMint: vi.fn(),
  probeMintToDb: vi.fn(),
  getKnownMints: vi.fn(),
  pruneOldHistory: vi.fn(),
  backfillServerLocations: vi.fn(),
}))

// A DB error whose message embeds every kind of secret we must NOT echo back.
const LEAKY_DB_ERROR = new Error(
  "password authentication failed for user 'mintradar' " +
    'postgres://mintradar:s3cr3t-p4ss@10.0.0.5:5432/mintradar_prod ' +
    'at Connection.parseE (/home/deploy/mintradar-repo/backend/node_modules/pg/lib/connection.js:1:1)'
)
const SENSITIVE_FRAGMENTS = [
  's3cr3t-p4ss',
  'postgres://',
  '10.0.0.5',
  'mintradar_prod',
  '/home/deploy',
  'node_modules/pg',
  'Connection.parseE',
  'password authentication',
]

let app: Express
let query: ReturnType<typeof vi.fn>
let lookup: ReturnType<typeof vi.fn>
let safeFetch: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const db = await import('../../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  const dns = await import('dns/promises')
  lookup = dns.lookup as unknown as ReturnType<typeof vi.fn>
  lookup.mockReset()
  lookup.mockResolvedValue([{ address: '1.2.3.4', family: 4 }] as never) // public → isSafeUrl passes
  const ssrf = await import('../../ssrf.js')
  safeFetch = ssrf.safeFetch as unknown as ReturnType<typeof vi.fn>
  safeFetch.mockReset()
  ;({ app } = await import('../../index.js'))
})

function assertNoLeak(body: unknown, text: string): void {
  const haystack = JSON.stringify(body) + '\n' + text
  for (const fragment of SENSITIVE_FRAGMENTS) {
    expect(haystack).not.toContain(fragment)
  }
  // No raw stack frames either.
  expect(haystack).not.toMatch(/\bat \w+\.\w+ \(/)
}

const GET_ENDPOINTS: { name: string; req: () => request.Test }[] = [
  { name: 'GET /api/mints/known', req: () => request(app).get('/api/mints/known') },
  { name: 'GET /api/stats', req: () => request(app).get('/api/stats') },
  { name: 'GET /api/nuts', req: () => request(app).get('/api/nuts') },
  { name: 'GET /api/stats/trust-trend', req: () => request(app).get('/api/stats/trust-trend') },
  {
    name: 'GET /api/mints/history',
    req: () => request(app).get('/api/mints/history').query({ url: 'https://mint.example.com', period: '24h' }),
  },
  {
    name: 'GET /api/mints/version-history',
    req: () => request(app).get('/api/mints/version-history').query({ url: 'https://mint.example.com' }),
  },
  {
    name: 'GET /api/mints/daily-uptime',
    req: () => request(app).get('/api/mints/daily-uptime').query({ url: 'https://mint.example.com' }),
  },
]

describe('5xx error responses do not leak internal details', () => {
  it.each(GET_ENDPOINTS)('$name returns a generic 500 with no sensitive data', async ({ req }) => {
    query.mockRejectedValue(LEAKY_DB_ERROR)

    const res = await req()

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    assertNoLeak(res.body, res.text)
  })

  it('POST /api/mint/submit returns a generic 500 with no sensitive data', async () => {
    safeFetch.mockImplementation(async (u: string) => {
      if (u.endsWith('/v1/info')) return { ok: true, json: async () => ({ name: 'x', nuts: {} }) }
      if (u.endsWith('/v1/keysets')) return { ok: true, json: async () => ({ keysets: [] }) }
      return null
    })
    query.mockRejectedValue(LEAKY_DB_ERROR) // INSERT fails

    const res = await request(app)
      .post('/api/mint/submit')
      .set('X-Forwarded-For', '203.0.113.20')
      .send({ url: 'https://mint.example.com' })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
    assertNoLeak(res.body, res.text)
  })
})

describe('4xx validation responses do not leak internal details', () => {
  it('submit missing-url 400 returns only a safe field message', async () => {
    const res = await request(app)
      .post('/api/mint/submit')
      .set('X-Forwarded-For', '203.0.113.21')
      .send({})

    expect(res.status).toBe(400)
    expect(Object.keys(res.body)).toEqual(['error'])
    assertNoLeak(res.body, res.text)
  })

  it('history invalid-url 400 does not echo internal SSRF reasoning', async () => {
    // A raw private IP is blocked by the real isSafeUrl → generic "Invalid url".
    const res = await request(app)
      .get('/api/mints/history')
      .query({ url: 'https://10.0.0.5', period: '24h' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid url' })
  })

  it('a 404 for an unknown route does not expose internal paths', async () => {
    const res = await request(app).get('/api/internal/secret-admin-panel')

    expect(res.status).toBe(404)
    assertNoLeak(res.body, res.text)
  })
})
