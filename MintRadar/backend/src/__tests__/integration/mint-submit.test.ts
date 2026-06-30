import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// POST /api/mint/submit accepts a single mint URL, runs the REAL SSRF guard,
// probes the URL, and inserts it if it is a live Cashu mint. We mock the
// external boundaries only:
//   - db.js pool                → no database
//   - dns/promises lookup       → deterministic SSRF-guard resolution
//   - ssrf.js safeFetch         → no outbound network (probeMint)
//   - prober.js                 → no real post-insert probe / DB writes
// isSafeUrl()/checkUrlSafety() run for real (partial ssrf mock keeps them).

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

const FIXED_IP = '203.0.113.9'

let app: Express
let query: ReturnType<typeof vi.fn>
let lookup: ReturnType<typeof vi.fn>
let safeFetch: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  const dns = await import('dns/promises')
  lookup = dns.lookup as unknown as ReturnType<typeof vi.fn>
  lookup.mockReset()
  const ssrf = await import('../../ssrf.js')
  safeFetch = ssrf.safeFetch as unknown as ReturnType<typeof vi.fn>
  safeFetch.mockReset()
  ;({ app } = await import('../../index.js'))
})

function resolvesTo(...addrs: { address: string; family: number }[]): void {
  lookup.mockResolvedValue(addrs as never)
}

// Make the mint probe (two safeFetch calls inside probeMint) succeed.
function mintReachable(info: Record<string, unknown>): void {
  safeFetch.mockImplementation(async (u: string) => {
    if (u.endsWith('/v1/info')) return { ok: true, json: async () => info }
    if (u.endsWith('/v1/keysets')) return { ok: true, json: async () => ({ keysets: [] }) }
    return null
  })
}

function post(body: unknown, ip = FIXED_IP) {
  return request(app).post('/api/mint/submit').set('X-Forwarded-For', ip).send(body)
}

describe('POST /api/mint/submit', () => {
  it('accepts a reachable public mint and inserts it', async () => {
    resolvesTo({ address: '1.2.3.4', family: 4 })
    mintReachable({ name: 'Test Mint', nuts: { '4': {} } })
    query.mockResolvedValueOnce({ rowCount: 1 }) // INSERT

    const res = await post({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, isNew: true, name: 'Test Mint' })
  })

  it('reports isNew: false when the mint already exists', async () => {
    resolvesTo({ address: '1.2.3.4', family: 4 })
    mintReachable({ name: 'Test Mint', nuts: {} })
    query.mockResolvedValueOnce({ rowCount: 0 }) // ON CONFLICT DO NOTHING

    const res = await post({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, isNew: false })
  })

  it('rejects an unreachable / non-mint URL without inserting', async () => {
    resolvesTo({ address: '1.2.3.4', family: 4 })
    safeFetch.mockResolvedValue(null) // probe fails

    const res = await post({ url: 'https://not-a-mint.example.com' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'URL does not appear to be a valid Cashu mint' })
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a loopback URL (SSRF) before probing or inserting', async () => {
    const res = await post({ url: 'https://127.0.0.1' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid url' })
    expect(safeFetch).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a domain that resolves to an internal IP (DNS-rebinding SSRF)', async () => {
    resolvesTo({ address: '192.168.1.10', family: 4 })

    const res = await post({ url: 'https://rebind.attacker.example' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid url' })
    expect(safeFetch).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('returns 400 when url is missing', async () => {
    const res = await post({})

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Missing required field: url' })
  })

  it('returns 400 for a non-https url', async () => {
    const res = await post({ url: 'http://insecure.example.com' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'url must start with https://' })
  })

  it('returns 400 for a url exceeding the max length', async () => {
    const res = await post({ url: 'https://example.com/' + 'a'.repeat(600) })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/maximum length/)
  })

  it('rate-limits a single IP after 20 requests/hour (21st → 429)', async () => {
    // Missing-url body keeps each request cheap; the rate check runs first so a
    // 400 still consumes a slot.
    for (let i = 0; i < 20; i++) {
      const r = await post({})
      expect(r.status).toBe(400)
    }
    const limited = await post({})
    expect(limited.status).toBe(429)
    expect(limited.body).toEqual({ error: 'Too many requests. Try again later.' })
  })

  it('handles a SQL-injection payload in the url safely (parameterized INSERT, no crash)', async () => {
    resolvesTo({ address: '1.2.3.4', family: 4 })
    mintReachable({ name: 'Evil', nuts: {} })
    query.mockResolvedValueOnce({ rowCount: 1 })
    const evil = "https://evil.example.com/'; DROP TABLE mints; --"

    const res = await post({ url: evil })

    expect(res.status).toBe(200)
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('INSERT INTO mints')
    expect(sql).toContain('$1')
    expect(sql).not.toContain('DROP TABLE')
    expect(params).toHaveLength(1)
    expect(params[0]).toContain('evil.example.com')
  })

  it('returns an XSS payload in the mint name verbatim (no dangerous server-side transform)', async () => {
    resolvesTo({ address: '1.2.3.4', family: 4 })
    const xss = '<script>alert(1)</script>'
    mintReachable({ name: xss, nuts: {} })
    query.mockResolvedValueOnce({ rowCount: 1 })

    const res = await post({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    // Backend treats the name as inert JSON data: it neither executes nor
    // mutates it. Escaping is the frontend's responsibility (React).
    expect(res.body.name).toBe(xss)
    // It is delivered as a JSON string value, not interpolated into markup.
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })

  it('applies standard security headers', async () => {
    const res = await post({})

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
  })
})
