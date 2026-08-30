import { describe, it, expect, vi, beforeEach } from 'vitest'

const { connectMock, clientQueryMock, clientReleaseMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
}))

vi.mock('../db.js', () => ({
  pool: { connect: connectMock, query: vi.fn() },
  initDb: vi.fn(),
}))
vi.mock('../prober.js', () => ({ getKnownMints: vi.fn() }))

import {
  dedupeAndParseReviewEvents,
  computeAvgRating,
  persistMintReviews,
  type SyncedReview,
} from '../reviewsSync.js'

beforeEach(() => {
  connectMock.mockReset()
  clientQueryMock.mockReset()
  clientReleaseMock.mockReset()
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
  it('replaces rows and updates the rollup inside one transaction', async () => {
    const reviews: SyncedReview[] = [
      { eventId: 'e1', pubkey: 'a', rating: 5, comment: 'x', createdAt: 2 },
      { eventId: 'e2', pubkey: 'b', rating: null, comment: '', createdAt: 1 },
    ]
    await persistMintReviews('https://m.example', reviews)

    const sqls = clientQueryMock.mock.calls.map(c => String(c[0]).trim().split(/\s+/).slice(0, 2).join(' '))
    expect(sqls[0]).toBe('BEGIN')
    expect(sqls[1]).toBe('DELETE FROM')
    // Both reviews go in one batched multi-VALUES INSERT.
    expect(sqls.filter(s => s === 'INSERT INTO')).toHaveLength(1)
    expect(sqls.at(-2)).toBe('UPDATE mints')
    expect(sqls.at(-1)).toBe('COMMIT')

    const insertCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO mint_reviews'))!
    expect(String(insertCall[0])).toMatch(/\$7/) // second row's params present → really batched
    expect(insertCall[1]).toHaveLength(12) // 2 rows * 6 cols

    const updateCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE mints'))!
    expect(updateCall[1]).toEqual([2, 5, 'https://m.example']) // count=2, avg=5 (only e1 rated)
    expect(clientReleaseMock).toHaveBeenCalledOnce()
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
