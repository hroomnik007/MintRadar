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
  resolveReviewCountRollup,
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

describe('resolveReviewCountRollup — floor-guard against a single flaky sync cycle', () => {
  it('applies immediately when there is no prior count (first-ever sync)', () => {
    const r = resolveReviewCountRollup({ reviewCount: null, pendingLowStreak: 0 }, 31)
    expect(r).toEqual({ appliedCount: 31, pendingLow: null, pendingLowStreak: 0, outcome: 'applied' })
  })

  it('applies immediately on an increase', () => {
    const r = resolveReviewCountRollup({ reviewCount: 96, pendingLowStreak: 0 }, 120)
    expect(r).toEqual({ appliedCount: 120, pendingLow: null, pendingLowStreak: 0, outcome: 'applied' })
  })

  it('applies immediately on a decrease that is not sharp (within the floor ratio)', () => {
    // 80/96 ≈ 0.83, above the 0.75 floor — ordinary fluctuation, not "sharp".
    const r = resolveReviewCountRollup({ reviewCount: 96, pendingLowStreak: 0 }, 80)
    expect(r).toEqual({ appliedCount: 80, pendingLow: null, pendingLowStreak: 0, outcome: 'applied' })
  })

  it('dampens a sharp single-cycle drop instead of applying it', () => {
    const r = resolveReviewCountRollup({ reviewCount: 96, pendingLowStreak: 0 }, 31)
    expect(r).toEqual({ appliedCount: 96, pendingLow: 31, pendingLowStreak: 1, outcome: 'dampened' })
  })

  it('confirms and applies a sharp drop once it recurs on a 2nd consecutive cycle', () => {
    const r = resolveReviewCountRollup({ reviewCount: 96, pendingLowStreak: 1 }, 33)
    expect(r).toEqual({ appliedCount: 33, pendingLow: null, pendingLowStreak: 0, outcome: 'confirmed-after-dampening' })
  })

  it('resets the streak the moment a cycle is no longer a sharp drop', () => {
    // Was mid-streak (1), but this cycle recovered — treated as a normal
    // increase/non-sharp value and applied immediately, streak cleared.
    const r = resolveReviewCountRollup({ reviewCount: 96, pendingLowStreak: 1 }, 95)
    expect(r).toEqual({ appliedCount: 95, pendingLow: null, pendingLowStreak: 0, outcome: 'applied' })
  })
})

describe('persistMintReviews', () => {
  it('replaces rows and updates the rollup inside one transaction', async () => {
    clientQueryMock.mockImplementation((sql: string) => {
      if (String(sql).startsWith('SELECT')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [] })
    })
    const reviews: SyncedReview[] = [
      { eventId: 'e1', pubkey: 'a', rating: 5, comment: 'x', createdAt: 2 },
      { eventId: 'e2', pubkey: 'b', rating: null, comment: '', createdAt: 1 },
    ]
    await persistMintReviews('https://m.example', reviews)

    const sqls = clientQueryMock.mock.calls.map(c => String(c[0]).trim().split(/\s+/).slice(0, 2).join(' '))
    expect(sqls[0]).toBe('BEGIN')
    expect(sqls[1]).toBe('SELECT review_count,')
    expect(sqls[2]).toBe('DELETE FROM')
    // Both reviews go in one batched multi-VALUES INSERT.
    expect(sqls.filter(s => s === 'INSERT INTO')).toHaveLength(1)
    expect(sqls.at(-2)).toBe('UPDATE mints')
    expect(sqls.at(-1)).toBe('COMMIT')

    const insertCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO mint_reviews'))!
    expect(String(insertCall[0])).toMatch(/\$7/) // second row's params present → really batched
    expect(insertCall[1]).toHaveLength(12) // 2 rows * 6 cols

    const updateCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE mints'))!
    // count=2, avg=5 (only e1 rated) — no prior row, so applied immediately, no pending state.
    expect(updateCall[1]).toEqual([2, 5, null, 0, 'https://m.example'])
    expect(clientReleaseMock).toHaveBeenCalledOnce()
  })

  it('holds back a sharp single-cycle drop, keeping the previously-applied count', async () => {
    clientQueryMock.mockImplementation((sql: string) => {
      if (String(sql).startsWith('SELECT')) {
        return Promise.resolve({ rows: [{ review_count: 96, review_avg_rating: 4.8, review_count_pending_low_streak: 0 }] })
      }
      return Promise.resolve({ rows: [] })
    })
    // This cycle's live relay query only found 31 of the mint's 96 known reviews.
    const reviews: SyncedReview[] = Array.from({ length: 31 }, (_, i) => (
      { eventId: `e${i}`, pubkey: `p${i}`, rating: 5, comment: '', createdAt: i }
    ))
    await persistMintReviews('https://m.example', reviews)

    // The rows themselves are still fully replaced with this cycle's findings...
    const insertCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO mint_reviews'))!
    expect(insertCall[1]).toHaveLength(31 * 6)
    // ...but the rollup keeps serving the previous, higher count/avg, with the
    // held-back candidate + streak recorded for the next cycle to see.
    const updateCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE mints'))!
    expect(updateCall[1]).toEqual([96, 4.8, 31, 1, 'https://m.example'])
  })

  it('applies a sharp drop once it has recurred for 2 consecutive cycles', async () => {
    clientQueryMock.mockImplementation((sql: string) => {
      if (String(sql).startsWith('SELECT')) {
        return Promise.resolve({ rows: [{ review_count: 96, review_avg_rating: 4.8, review_count_pending_low_streak: 1 }] })
      }
      return Promise.resolve({ rows: [] })
    })
    const reviews: SyncedReview[] = Array.from({ length: 33 }, (_, i) => (
      { eventId: `e${i}`, pubkey: `p${i}`, rating: 5, comment: '', createdAt: i }
    ))
    await persistMintReviews('https://m.example', reviews)

    const updateCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE mints'))!
    // Now applied: count/avg reflect this cycle's (still low) findings, pending state cleared.
    expect(updateCall[1]).toEqual([33, 5, null, 0, 'https://m.example'])
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
