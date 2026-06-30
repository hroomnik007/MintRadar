import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// Rate limiting in index.ts has two layers:
//   - a general 60/min limiter (applies to non-exempt paths; sets X-RateLimit-*)
//   - per-route windowed limiters for the outbound-fetch endpoints
//     (/api/mint/submit 20/hr, /api/mints/discover 10/hr) keyed by client IP.
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
  it('does not let one IP exhausting the discover limit affect a different IP', async () => {
    const ipA = '198.51.100.1'
    const ipB = '198.51.100.2'

    // Exhaust IP-A (10/hr).
    for (let i = 0; i < 10; i++) {
      expect((await discover({ urls: [] }, ipA)).status).toBe(200)
    }
    expect((await discover({ urls: [] }, ipA)).status).toBe(429)

    // IP-B has an independent budget and is still allowed.
    expect((await discover({ urls: [] }, ipB)).status).toBe(200)
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

describe('rate limit window resets after it elapses', () => {
  it('allows requests again once the discover window has passed', async () => {
    const ip = '198.51.100.50'
    let now = 1_000_000_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    // Exhaust the 10/hr budget at a fixed instant.
    for (let i = 0; i < 10; i++) {
      expect((await discover({ urls: [] }, ip)).status).toBe(200)
    }
    expect((await discover({ urls: [] }, ip)).status).toBe(429)

    // Advance virtual time just past the 1-hour window.
    now += 60 * 60 * 1000 + 1

    // The window has rolled over → the same IP is allowed again.
    expect((await discover({ urls: [] }, ip)).status).toBe(200)
  })
})

describe('general limiter wiring', () => {
  it('does not rate-limit the exempt /api/mints/known endpoint', async () => {
    const db = await import('../../db.js')
    const query = db.pool.query as unknown as ReturnType<typeof vi.fn>
    query.mockResolvedValue({ rows: [] })

    const res = await request(app).get('/api/mints/known')

    // Exempt endpoints carry no X-RateLimit accounting headers.
    expect(res.headers['x-ratelimit-limit']).toBeUndefined()
  })

  it('applies the general limiter (X-RateLimit-* headers) to non-exempt endpoints', async () => {
    // Missing-url 400 returns before any handler work but after the limiter.
    const res = await request(app).get('/api/mint/probe')

    expect(res.status).toBe(400)
    expect(res.headers['x-ratelimit-limit']).toBe('60')
    expect(Number(res.headers['x-ratelimit-remaining'])).toBeLessThanOrEqual(59)
  })
})
