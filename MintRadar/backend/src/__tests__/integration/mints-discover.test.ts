import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// POST /api/mints/discover batch-inserts discovered mint URLs. It is the most
// security-sensitive read path: every URL is run through the REAL isSafeUrl()
// SSRF guard before any INSERT. We mock only the two true external boundaries:
//   - db.js pool  → no database
//   - dns/promises lookup → deterministic resolution for the SSRF guard
// so the rate limiter, validation, normalization and SSRF logic all execute
// for real.

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))

const FIXED_IP = '203.0.113.7'

let app: Express
let query: ReturnType<typeof vi.fn>
let lookup: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  const dns = await import('dns/promises')
  lookup = dns.lookup as unknown as ReturnType<typeof vi.fn>
  lookup.mockReset()
  ;({ app } = await import('../../index.js'))
})

// Make the SSRF guard's DNS resolution deterministic.
function resolvesTo(...addrs: { address: string; family: number }[]): void {
  lookup.mockResolvedValue(addrs as never)
}

function post(body: unknown, ip = FIXED_IP) {
  return request(app).post('/api/mints/discover').set('X-Forwarded-For', ip).send(body)
}

describe('POST /api/mints/discover', () => {
  it('inserts a valid public mint URL and reports it added', async () => {
    resolvesTo({ address: '1.2.3.4', family: 4 })
    query.mockResolvedValueOnce({ rowCount: 1 })

    const res = await post({ urls: ['https://mint.example.com'] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ added: 1, total: 1 })
  })

  it('reports added: 0 when the mint already exists (ON CONFLICT DO NOTHING)', async () => {
    resolvesTo({ address: '1.2.3.4', family: 4 })
    query.mockResolvedValueOnce({ rowCount: 0 })

    const res = await post({ urls: ['https://mint.example.com'] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ added: 0, total: 1 })
  })

  it('rate-limits a single IP after 10 requests/hour (11th → 429)', async () => {
    // Empty batch keeps each request cheap; the rate check runs before the body
    // is processed, so no DNS/DB work is needed to exercise the limiter.
    for (let i = 0; i < 10; i++) {
      const ok = await post({ urls: [] })
      expect(ok.status).toBe(200)
    }
    const limited = await post({ urls: [] })
    expect(limited.status).toBe(429)
    expect(limited.body).toEqual({ error: 'Too many requests. Try again later.' })
  })

  it('rejects a loopback URL (SSRF) without inserting it', async () => {
    const res = await post({ urls: ['https://127.0.0.1'] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ added: 0, total: 1 })
    // Raw private IP is blocked before any DNS lookup or INSERT.
    expect(lookup).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a private 10.0.0.0/8 URL (SSRF) without inserting it', async () => {
    const res = await post({ urls: ['https://10.0.0.5'] })

    expect(res.body).toEqual({ added: 0, total: 1 })
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a domain that resolves to an internal IP (DNS-rebinding SSRF)', async () => {
    resolvesTo({ address: '169.254.169.254', family: 4 }) // cloud metadata endpoint

    const res = await post({ urls: ['https://metadata.attacker.example'] })

    expect(res.body).toEqual({ added: 0, total: 1 })
    expect(query).not.toHaveBeenCalled()
  })

  it('silently skips malformed and non-https URLs', async () => {
    const res = await post({ urls: ['not a url', 'http://insecure.example', 'ftp://x.example'] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ added: 0, total: 3 })
    expect(query).not.toHaveBeenCalled()
  })

  it('skips URLs longer than the max length without inserting', async () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(600)

    const res = await post({ urls: [longUrl] })

    expect(res.body).toEqual({ added: 0, total: 1 })
    expect(query).not.toHaveBeenCalled()
  })

  it('handles a SQL-injection payload safely via parameterized queries (no crash, no interpolation)', async () => {
    resolvesTo({ address: '1.2.3.4', family: 4 })
    query.mockResolvedValueOnce({ rowCount: 1 })
    const evil = "https://evil.example.com/'; DROP TABLE mints; --"

    const res = await post({ urls: [evil] })

    // Request completes normally — the payload never reaches SQL as code.
    expect(res.status).toBe(200)
    // The INSERT uses a fixed parameterized statement; the URL is bound, not concatenated.
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('INSERT INTO mints')
    expect(sql).toContain('$1')
    expect(sql).not.toContain('DROP TABLE')
    // The payload is bound as a single parameter (URL-normalized), never
    // concatenated into the SQL string.
    expect(params).toHaveLength(1)
    expect(params[0]).toContain('evil.example.com')
  })

  it('returns 400 when urls is not an array', async () => {
    const res = await post({ urls: 'https://mint.example.com' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'urls must be array' })
  })

  it('returns 400 when the batch exceeds the maximum size', async () => {
    const urls = Array.from({ length: 101 }, (_, i) => `https://mint${i}.example.com`)

    const res = await post({ urls })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/maximum batch size/)
  })

  it('applies standard security headers', async () => {
    const res = await post({ urls: [] })

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
  })
})
