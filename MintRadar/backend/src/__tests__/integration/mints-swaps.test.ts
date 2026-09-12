import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// GET /api/mints/swaps?url= serves the audit.8333.space rolling-window swap
// detail (mint_audit_swaps) for one mint. Same pg-mock-at-the-db.js-boundary
// approach as integration/mints-known.test.ts.

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))
// isSafeUrl() does a real DNS lookup to reject SSRF targets — mock it to a
// public address so these tests don't depend on outbound DNS resolution
// actually working in the test environment. Same pattern as version-history.test.ts.
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
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never) // public → isSafeUrl passes
  ;({ app } = await import('../../index.js'))
})

function sampleSwapRow(overrides: Record<string, unknown> = {}) {
  return {
    swap_id: 65989,
    to_url: 'https://mint.chorus.community',
    amount: 56,
    fee: 2,
    created_at: new Date('2026-09-11T21:36:24Z'),
    time_taken_ms: 2574.3,
    state: 'OK',
    error: null,
    ...overrides,
  }
}

describe('GET /api/mints/swaps', () => {
  it('requires the url query parameter', async () => {
    const res = await request(app).get('/api/mints/swaps')
    expect(res.status).toBe(400)
  })

  it('rejects a non-https url', async () => {
    const res = await request(app).get('/api/mints/swaps').query({ url: 'http://mint.example.com' })
    expect(res.status).toBe(400)
  })

  it('returns swaps + avgTimeMs computed over OK swaps only', async () => {
    query.mockResolvedValueOnce({
      rows: [
        sampleSwapRow(),
        sampleSwapRow({ swap_id: 65961, to_url: 'https://mint.hanbitkorea.org', time_taken_ms: null, state: 'FAILED', error: 'timeout' }),
      ],
    })

    const res = await request(app).get('/api/mints/swaps').query({ url: 'https://mint.minibits.cash/Bitcoin' })

    expect(res.status).toBe(200)
    expect(res.body.url).toBe('https://mint.minibits.cash/Bitcoin')
    expect(res.body.avgTimeMs).toBe(2574.3)
    expect(res.body.swaps).toHaveLength(2)
    expect(res.body.swaps[0]).toMatchObject({
      swapId: 65989,
      toUrl: 'https://mint.chorus.community',
      amount: 56,
      fee: 2,
      state: 'OK',
      error: null,
    })
    expect(res.body.swaps[1]).toMatchObject({ state: 'FAILED', error: 'timeout', timeTakenMs: null })
  })

  it('returns avgTimeMs null when there are no OK swaps with a known time', async () => {
    query.mockResolvedValueOnce({ rows: [sampleSwapRow({ state: 'FAILED', time_taken_ms: null, error: 'x' })] })

    const res = await request(app).get('/api/mints/swaps').query({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    expect(res.body.avgTimeMs).toBeNull()
  })

  it('returns an empty list (not an error) for a mint with no synced swaps yet', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const res = await request(app).get('/api/mints/swaps').query({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    expect(res.body.swaps).toEqual([])
    expect(res.body.avgTimeMs).toBeNull()
  })

  it('returns 500 with a generic message when the DB query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    query.mockRejectedValueOnce(new Error('connection refused'))

    const res = await request(app).get('/api/mints/swaps').query({ url: 'https://mint.example.com' })

    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('connection refused')
  })
})
