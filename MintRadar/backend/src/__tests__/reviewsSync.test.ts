import { describe, it, expect, vi, beforeEach } from 'vitest'

const { connectMock, clientQueryMock, clientReleaseMock, poolQueryMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  poolQueryMock: vi.fn(),
}))

vi.mock('../db.js', () => ({
  pool: { connect: connectMock, query: poolQueryMock },
  initDb: vi.fn(),
}))
vi.mock('../prober.js', () => ({ getKnownMints: vi.fn() }))

import {
  dedupeAndParseReviewEvents,
  computeAvgRating,
  persistMintReviews,
  recomputeReviewCountRollups,
  type SyncedReview,
} from '../reviewsSync.js'

beforeEach(() => {
  connectMock.mockReset()
  clientQueryMock.mockReset()
  clientReleaseMock.mockReset()
  poolQueryMock.mockReset()
  clientQueryMock.mockResolvedValue({ rows: [] })
  connectMock.mockResolvedValue({ query: clientQueryMock, release: clientReleaseMock })
})

function evt(o: Partial<{ id: string; pubkey: string; content: string; tags: string[][]; created_at: number }> = {}) {
  return { id: 'i', pubkey: 'p', content: '', tags: [] as string[][], created_at: 1, ...o }
}

describe('dedupeAndParseReviewEvents', () => {
  it('keeps only the newest event per pubkey', () => {
    const out = dedupeAndParseReviewEvents([
      evt({ pubkey: 'alice', content: '[1/5] old', created_at: 100 }),
      evt({ pubkey: 'alice', content: '[5/5] new', created_at: 200 }),
      evt({ pubkey: 'bob', content: '[3/5] ok', created_at: 150 }),
    ])
    expect(out).toHaveLength(2)
    const alice = out.find(r => r.pubkey === 'alice')!
    expect(alice.rating).toBe(5)
    expect(alice.comment).toBe('new')
  })

  it('sorts newest-first', () => {
    const out = dedupeAndParseReviewEvents([
      evt({ pubkey: 'a', created_at: 10 }),
      evt({ pubkey: 'b', created_at: 30 }),
      evt({ pubkey: 'c', created_at: 20 }),
    ])
    expect(out.map(r => r.createdAt)).toEqual([30, 20, 10])
  })

  it('keeps rating-less endorsement events (rating null)', () => {
    const out = dedupeAndParseReviewEvents([evt({ pubkey: 'a', content: 'just an endorsement' })])
    expect(out).toHaveLength(1)
    expect(out[0]!.rating).toBeNull()
  })
})

describe('computeAvgRating', () => {
  const r = (rating: number | null): SyncedReview => ({ eventId: 'e', pubkey: 'p', rating, comment: '', createdAt: 1 })

  it('returns null when no review carries a rating', () => {
    expect(computeAvgRating([r(null), r(null)])).toBeNull()
    expect(computeAvgRating([])).toBeNull()
  })

  it('averages only the rated reviews, rounded to 1 decimal', () => {
    expect(computeAvgRating([r(5), r(4), r(null)])).toBe(4.5)
    expect(computeAvgRating([r(5), r(4), r(4)])).toBe(4.3)
  })
})

describe('persistMintReviews', () => {
  it('upserts rows and sets the rollup from the stored table, inside one transaction', async () => {
    clientQueryMock.mockImplementation((sql: string) => {
      if (String(sql).includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ review_count: 2, review_avg_rating: 5 }] })
      }
      return Promise.resolve({ rows: [] })
    })
    const reviews: SyncedReview[] = [
      { eventId: 'e1', pubkey: 'a', rating: 5, comment: 'x', createdAt: 2 },
      { eventId: 'e2', pubkey: 'b', rating: null, comment: '', createdAt: 1 },
    ]
    await persistMintReviews('https://m.example', reviews)

    const sqls = clientQueryMock.mock.calls.map(c => String(c[0]))
    expect(sqls.some(s => s.includes('DELETE'))).toBe(false)
    expect(sqls[0]!.trim().startsWith('BEGIN')).toBe(true)
    expect(sqls.at(-1)!.trim()).toBe('COMMIT')
    expect(sqls.filter(s => s.includes('INSERT INTO mint_reviews'))).toHaveLength(1)

    const insertCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO mint_reviews'))!
    expect(String(insertCall[0])).toMatch(/mint_reviews\.created_at < EXCLUDED\.created_at/)
    expect(String(insertCall[0])).toMatch(/\$7/)
    expect(insertCall[1]).toHaveLength(12)

    const updateCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE mints'))!
    expect(updateCall[1]).toEqual([2, 5, 'https://m.example'])
    expect(String(updateCall[0])).not.toMatch(/pending_low/)
    expect(clientReleaseMock).toHaveBeenCalledOnce()
  })

  it('does not delete stored reviews when this cycle found fewer, and the count comes from the table', async () => {
    clientQueryMock.mockImplementation((sql: string) => {
      if (String(sql).includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ review_count: 96, review_avg_rating: 4.8 }] })
      }
      return Promise.resolve({ rows: [] })
    })
    const reviews: SyncedReview[] = Array.from({ length: 31 }, (_, i) => (
      { eventId: `e${i}`, pubkey: `p${i}`, rating: 5, comment: '', createdAt: i }
    ))
    await persistMintReviews('https://m.example', reviews)

    const sqls = clientQueryMock.mock.calls.map(c => String(c[0]))
    expect(sqls.some(s => s.includes('DELETE'))).toBe(false)
    const insertCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO mint_reviews'))!
    expect(insertCall[1]).toHaveLength(31 * 6)
    const updateCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE mints'))!
    expect(updateCall[1]).toEqual([96, 4.8, 'https://m.example'])
  })

  it('writes a null average when the stored rows have no ratings', async () => {
    clientQueryMock.mockImplementation((sql: string) => {
      if (String(sql).includes('COUNT(*)')) {
        return Promise.resolve({ rows: [{ review_count: 2, review_avg_rating: null }] })
      }
      return Promise.resolve({ rows: [] })
    })
    await persistMintReviews('https://m.example', [
      { eventId: 'e', pubkey: 'p', rating: null, comment: '', createdAt: 1 },
    ])
    const updateCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE mints'))!
    expect(updateCall[1]).toEqual([2, null, 'https://m.example'])
  })

  it('rolls back and rethrows if an insert fails, still releasing the client', async () => {
    clientQueryMock.mockImplementation((sql: string) => {
      if (String(sql).startsWith('INSERT')) return Promise.reject(new Error('boom'))
      return Promise.resolve({ rows: [] })
    })
    await expect(
      persistMintReviews('https://m.example', [{ eventId: 'e', pubkey: 'p', rating: 3, comment: '', createdAt: 1 }]),
    ).rejects.toThrow('boom')

    const sqls = clientQueryMock.mock.calls.map(c => String(c[0]).trim().split(/\s+/)[0])
    expect(sqls).toContain('ROLLBACK')
    expect(clientReleaseMock).toHaveBeenCalledOnce()
  })
})

describe('recomputeReviewCountRollups', () => {
  it('updates rollup from stored rows and excludes empty reviews', async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 12, rows: [] })
    await expect(recomputeReviewCountRollups()).resolves.toBe(12)
    expect(poolQueryMock).toHaveBeenCalledOnce()
    const sql = String(poolQueryMock.mock.calls[0]![0])
    expect(sql).toMatch(/UPDATE mints/)
    expect(sql).toMatch(/rating IS NOT NULL OR BTRIM/)
    expect(sql).toMatch(/FROM mint_reviews/)
  })

  it('returns 0 when the driver reports no rowCount', async () => {
    poolQueryMock.mockResolvedValue({ rows: [] })
    await expect(recomputeReviewCountRollups()).resolves.toBe(0)
  })
})
