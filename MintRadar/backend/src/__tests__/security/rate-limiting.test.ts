import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// Rate limiting in index.ts has two layers:
//   - a general 60/min limiter (applies to non-exempt paths; sets X-RateLimit-*) and a separate 150/min
//     read-only bucket for the website's own GETs (READ_RATE_LIMIT_PATHS in index.ts)
//   - per-route windowed limiters for the outbound-fetch endpoints
//     (/api/mint/submit 20/hr; /api/mints/discover splits into two
//     INDEPENDENT budgets keyed by the request body's `source` field —
//     'auto' 3/hr for the background NIP-87 scan, 'bulk' 10/hr for an
//     explicit user submission, see index.ts) keyed by client IP.
// `app.set('trust proxy', 1)` means req.ip is derived from X-Forwarded-For, so
// each test can simulate distinct clients. Empty/invalid bodies keep requests
// cheap: the limiter runs before any DNS/DB work.

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))

let app: Express

beforeEach(async () => {
  vi.resetModules()
  ;({ app } = await import('../../index.js'))
})

afterEach(() => {
  vi.restoreAllMocks()
})

function discover(body: unknown, ip: string) {
  return request(app).post('/api/mints/discover').set('X-Forwarded-For', ip).send(body)
}
function submit(body: unknown, ip: string) {
  return request(app).post('/api/mint/submit').set('X-Forwarded-For', ip).send(body)
}

describe('rate limiting is per-IP, not global', () => {
  it('does not let one IP exhausting the discover bulk limit affect a different IP', async () => {
    const ipA = '198.51.100.1'
    const ipB = '198.51.100.2'

    // Exhaust IP-A's bulk budget (10/hr).
    for (let i = 0; i < 10; i++) {
      expect((await discover({ urls: [], source: 'bulk' }, ipA)).status).toBe(200)
    }
    expect((await discover({ urls: [], source: 'bulk' }, ipA)).status).toBe(429)

    // IP-B has an independent budget and is still allowed.
    expect((await discover({ urls: [], source: 'bulk' }, ipB)).status).toBe(200)
  })

  it('keeps submit limits independent across IPs', async () => {
    const ipA = '198.51.100.10'
    const ipB = '198.51.100.11'

    // Exhaust IP-A (20/hr) using missing-url 400s (still consume a slot).
    for (let i = 0; i < 20; i++) {
      expect((await submit({}, ipA)).status).toBe(400)
    }
    expect((await submit({}, ipA)).status).toBe(429)

    // IP-B unaffected.
    expect((await submit({}, ipB)).status).toBe(400)
  })
})

// ── The actual conflict this split fixes ───────────────────────
describe('discover: auto and bulk budgets are independent (not a shared bucket)', () => {
  it('exhausting the automatic NIP-87 discovery budget does not block a user Bulk submit', async () => {
    const ip = '198.51.100.20'

    // Simulate the background scan firing repeatedly (e.g. a few page
    // reloads/logins within the hour) until its 3/hr budget is spent.
    for (let i = 0; i < 3; i++) {
      expect((await discover({ urls: [], source: 'auto' }, ip)).status).toBe(200)
    }
    expect((await discover({ urls: [], source: 'auto' }, ip)).status).toBe(429)

    // The user's own explicit Bulk submit, from the SAME IP, still works —
    // it draws from the separate 'bulk' budget untouched by the above.
    expect((await discover({ urls: [], source: 'bulk' }, ip)).status).toBe(200)
  })

  it('exhausting the bulk budget does not throttle the automatic discovery budget', async () => {
    const ip = '198.51.100.21'

    for (let i = 0; i < 10; i++) {
      expect((await discover({ urls: [], source: 'bulk' }, ip)).status).toBe(200)
    }
    expect((await discover({ urls: [], source: 'bulk' }, ip)).status).toBe(429)

    // Auto's own budget is untouched.
    expect((await discover({ urls: [], source: 'auto' }, ip)).status).toBe(200)
  })

  it('a missing/unrecognized source defaults to the smaller auto budget, not the larger bulk one', async () => {
    const ip = '198.51.100.22'

    // No `source` field at all.
    for (let i = 0; i < 3; i++) {
      expect((await discover({ urls: [] }, ip)).status).toBe(200)
    }
    expect((await discover({ urls: [] }, ip)).status).toBe(429)

    // An unrecognized value behaves the same way (still 'auto').
    expect((await discover({ urls: [], source: 'nonsense' }, '198.51.100.23')).status).toBe(200)
  })

  it('sets a Retry-After header (seconds until the window resets) on a 429', async () => {
    const ip = '198.51.100.24'
    for (let i = 0; i < 3; i++) {
      expect((await discover({ urls: [], source: 'auto' }, ip)).status).toBe(200)
    }
    const limited = await discover({ urls: [], source: 'auto' }, ip)
    expect(limited.status).toBe(429)
    const retryAfter = Number(limited.headers['retry-after'])
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60 * 60)
  })
})

describe('rate limit window resets after it elapses', () => {
  it('allows requests again once the discover bulk window has passed', async () => {
    const ip = '198.51.100.50'
    let now = 1_000_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    // Exhaust the 10/hr bulk budget at a fixed instant.
    for (let i = 0; i < 10; i++) {
      expect((await discover({ urls: [], source: 'bulk' }, ip)).status).toBe(200)
    }
    expect((await discover({ urls: [], source: 'bulk' }, ip)).status).toBe(429)

    // Advance virtual time just past the 1-hour window.
    now += 60 * 60 * 1000 + 1

    // The window has rolled over → the same IP is allowed again.
    expect((await discover({ urls: [], source: 'bulk' }, ip)).status).toBe(200)
  })
})

describe('general limiter wiring', () => {
  it('counts /api/mints/known against the read-only limiter (it is no longer exempt)', async () => {
    const db = await import('../../db.js')
    const query = db.pool.query as unknown as ReturnType<typeof vi.fn>
    query.mockResolvedValue({ rows: [] })

    const res = await request(app).get('/api/mints/known')

    expect(res.headers['x-ratelimit-limit']).toBe('150')
  })

  it('applies the general limiter (X-RateLimit-* headers) to non-exempt endpoints', async () => {
    // Missing-url 400 returns before any handler work but after the limiter.
    const res = await request(app).get('/api/mint/probe')

    expect(res.status).toBe(400)
    expect(res.headers['x-ratelimit-limit']).toBe('60')
    expect(Number(res.headers['x-ratelimit-remaining'])).toBeLessThanOrEqual(59)
  })
})

// ── Read-only bucket for the website's own GETs (150/min/IP) ───
describe('read-only bucket', () => {
  const READ_PATHS = [
    '/api/mints/known', '/api/mints/history', '/api/mints/version-history', '/api/mints/outages', '/api/mints/changes',
    '/api/mints/nostr-reviews', '/api/mints/daily-uptime', '/api/mints/swaps', '/api/mints/audit-cz',
    '/api/stats/reliability-trend', '/api/stats/reliability-movers', '/api/nuts',
  ]
  // A bad request is rejected by the handler (or answered from the empty mock) after the limiter, which is all these tests need.
  const get = (path: string, ip: string) => request(app).get(path).set('X-Forwarded-For', ip)

  beforeEach(async () => {
    const db = await import('../../db.js')
    ;(db.pool.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] })
  })

  it('allows 150 requests per minute across the read routes, then a 429 with Retry-After and the old body', async () => {
    const ip = '203.0.113.1'
    for (let i = 0; i < 150; i++) {
      const res = await get(READ_PATHS[i % READ_PATHS.length]!, ip)
      expect(res.status, READ_PATHS[i % READ_PATHS.length]).not.toBe(429)
      expect(res.headers['x-ratelimit-limit']).toBe('150')
    }
    const blocked = await get('/api/mints/history', ip)
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many requests' })
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect(blocked.headers['x-ratelimit-remaining']).toBe('0')
  }, 60_000)

  it('is per-IP: one IP exhausting the bucket does not affect another', async () => {
    for (let i = 0; i < 150; i++) await get('/api/mints/changes', '203.0.113.2')
    expect((await get('/api/mints/changes', '203.0.113.2')).status).toBe(429)
    expect((await get('/api/mints/changes', '203.0.113.3')).status).not.toBe(429)
  }, 60_000)

  it('is a separate counter: exhausting it leaves the general 60/min routes (probe) untouched, and the reverse', async () => {
    const ip = '203.0.113.4'
    for (let i = 0; i < 150; i++) await get('/api/mints/history', ip)
    expect((await get('/api/mints/history', ip)).status).toBe(429)
    const probe = await get('/api/mint/probe', ip)
    expect(probe.status).toBe(400)
    expect(probe.headers['x-ratelimit-limit']).toBe('60')

    const ip2 = '203.0.113.5'
    for (let i = 0; i < 60; i++) await get('/api/mint/probe', ip2)
    expect((await get('/api/mint/probe', ip2)).status).toBe(429)
    expect((await get('/api/mints/history', ip2)).status).not.toBe(429)
  }, 60_000)

  it('the /api/v1 alias, a trailing slash and upper case share the same bucket', async () => {
    const ip = '203.0.113.6'
    const first = await get('/api/v1/mints/outages', ip)
    expect(first.headers['x-ratelimit-remaining']).toBe('149')
    expect((await get('/api/mints/outages/', ip)).headers['x-ratelimit-remaining']).toBe('148')
    expect((await get('/API/MINTS/OUTAGES', ip)).headers['x-ratelimit-remaining']).toBe('147')
  })

  it('keeps the old limits on probe, the other GETs and the write routes', async () => {
    for (const path of ['/api/mint/probe', '/api', '/api/nip05/verify', '/api/og/page']) {
      expect((await get(path, '203.0.113.7')).headers['x-ratelimit-limit'], path).toBe('60')
    }
    const ip = '203.0.113.8'
    for (let i = 0; i < 20; i++) expect((await submit({}, ip)).status).toBe(400)
    expect((await submit({}, ip)).status).toBe(429)
    for (let i = 0; i < 3; i++) expect((await discover({ urls: [], source: 'auto' }, ip)).status).toBe(200)
    expect((await discover({ urls: [], source: 'auto' }, ip)).status).toBe(429)
  })

  it('keeps the wallet budget (300/min) and its headers', async () => {
    const res = await get('/api/wallets/mints', '203.0.113.9')
    expect(res.headers['x-ratelimit-limit']).toBe('300')
  })
})
