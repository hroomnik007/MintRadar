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
  aggregateReviews,
  operatorKeysOf,
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

const OPERATOR_HEX = 'a'.repeat(64)
const CRITIC_HEX = 'c'.repeat(64)

// Routes the three reads persistMintReviews does inside its transaction.
function routeClient(opts: { mintRow?: Record<string, unknown>; stored?: Array<{ pubkey: string; rating: number | null; comment: string | null }> } = {}) {
  clientQueryMock.mockImplementation((sql: string) => {
    const q = String(sql)
    if (q.includes('FROM mints WHERE url')) return Promise.resolve({ rows: opts.mintRow ? [opts.mintRow] : [] })
    if (q.includes('FROM mint_reviews WHERE url')) return Promise.resolve({ rows: opts.stored ?? [] })
    return Promise.resolve({ rows: [] })
  })
}

describe('aggregateReviews', () => {
  const five = (pubkey: string) => ({ pubkey, rating: 5, comment: 'x' })
  it('no operator: counts every non-empty review, average unchanged', () => {
    expect(aggregateReviews([five('a'), five('b'), { pubkey: 'c', rating: 3, comment: '' }], new Set()))
      .toEqual({ count: 3, avg: 4.3, operatorCount: 0, ratedCount: 3 })
  })
  it('3 five-star reviews, one by the operator: count 2, average of the other two', () => {
    const rows = [five(OPERATOR_HEX), { pubkey: 'b', rating: 5, comment: '' }, { pubkey: 'c', rating: 3, comment: 'ok' }]
    expect(aggregateReviews(rows, new Set([OPERATOR_HEX]))).toEqual({ count: 2, avg: 4, operatorCount: 1, ratedCount: 2 })
  })
  it('matches the operator key case-insensitively', () => {
    expect(aggregateReviews([five(OPERATOR_HEX.toUpperCase())], new Set([OPERATOR_HEX])))
      .toEqual({ count: 0, avg: null, operatorCount: 1, ratedCount: 0 })
  })
  it('empty events (no rating, no comment) count nowhere, not even as operator reviews', () => {
    expect(aggregateReviews([{ pubkey: OPERATOR_HEX, rating: null, comment: '  ' }], new Set([OPERATOR_HEX])))
      .toEqual({ count: 0, avg: null, operatorCount: 0, ratedCount: 0 })
  })
  it('null average when counted reviews carry no rating', () => {
    expect(aggregateReviews([{ pubkey: 'a', rating: null, comment: 'hi' }], new Set()))
      .toEqual({ count: 1, avg: null, operatorCount: 0, ratedCount: 0 })
  })
  it('comment-only reviews are in count but not in ratedCount (the n behind avg)', () => {
    expect(aggregateReviews([five('a'), { pubkey: 'b', rating: null, comment: 'hi' }, { pubkey: 'c', rating: 4, comment: '' }], new Set()))
      .toEqual({ count: 3, avg: 4.5, operatorCount: 0, ratedCount: 2 })
  })
})

describe('operatorKeysOf', () => {
  it('a key stored as a nostr contact that is also the announcement author is the operator', () => {
    const ops = operatorKeysOf({ contact_nostr: [OPERATOR_HEX, 'not a key'], nostr_announce_pubkey: OPERATOR_HEX })
    expect([...ops]).toEqual([OPERATOR_HEX])
  })
  it('a critic listed as contact but not the announcement author is not an operator', () => {
    expect(operatorKeysOf({ contact_nostr: [CRITIC_HEX], nostr_announce_pubkey: OPERATOR_HEX }).size).toBe(0)
    expect(operatorKeysOf({ contact_nostr: [CRITIC_HEX], nostr_announce_pubkey: null }).size).toBe(0)
    expect(operatorKeysOf({ contact_nostr: null, nostr_announce_pubkey: OPERATOR_HEX }).size).toBe(0)
  })
  it('is empty without data', () => {
    expect(operatorKeysOf(undefined).size).toBe(0)
    expect(operatorKeysOf({ contact_nostr: null, nostr_announce_pubkey: null }).size).toBe(0)
  })
})

describe('persistMintReviews', () => {
  it('upserts rows and sets the rollup from the stored table, inside one transaction', async () => {
    routeClient({ stored: [{ pubkey: 'a', rating: 5, comment: 'x' }, { pubkey: 'b', rating: 5, comment: '' }] })
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
    expect(updateCall[1]).toEqual([2, 5, 0, 2, 'https://m.example'])
    expect(String(updateCall[0])).not.toMatch(/pending_low/)
    expect(clientReleaseMock).toHaveBeenCalledOnce()
  })

  it('does not delete stored reviews when this cycle found fewer, and the count comes from the table', async () => {
    routeClient({ stored: Array.from({ length: 96 }, (_, i) => ({ pubkey: `p${i}`, rating: i < 77 ? 5 : 4, comment: '' })) })
    const reviews: SyncedReview[] = Array.from({ length: 31 }, (_, i) => (
      { eventId: `e${i}`, pubkey: `p${i}`, rating: 5, comment: '', createdAt: i }
    ))
    await persistMintReviews('https://m.example', reviews)

    const sqls = clientQueryMock.mock.calls.map(c => String(c[0]))
    expect(sqls.some(s => s.includes('DELETE'))).toBe(false)
    const insertCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO mint_reviews'))!
    expect(insertCall[1]).toHaveLength(31 * 6)
    const updateCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE mints'))!
    expect(updateCall[1]).toEqual([96, 4.8, 0, 96, 'https://m.example'])
  })

  it('writes a null average when the stored rows have no ratings', async () => {
    routeClient({ stored: [{ pubkey: 'p', rating: null, comment: 'only a comment' }, { pubkey: 'q', rating: null, comment: 'another' }] })
    await persistMintReviews('https://m.example', [
      { eventId: 'e', pubkey: 'p', rating: null, comment: 'only a comment', createdAt: 1 },
    ])
    const updateCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE mints'))!
    expect(updateCall[1]).toEqual([2, null, 0, 0, 'https://m.example'])
  })

  it('leaves the operator\'s review out of count and average but stores it and counts it separately', async () => {
    routeClient({
      mintRow: { contact_nostr: [OPERATOR_HEX], nostr_announce_pubkey: OPERATOR_HEX },
      stored: [
        { pubkey: OPERATOR_HEX, rating: 5, comment: '' },
        { pubkey: 'b', rating: 5, comment: '' },
        { pubkey: 'c', rating: 3, comment: '' },
      ],
    })
    await persistMintReviews('https://m.example', [
      { eventId: 'e1', pubkey: OPERATOR_HEX, rating: 5, comment: '', createdAt: 3 },
      { eventId: 'e2', pubkey: 'b', rating: 5, comment: '', createdAt: 2 },
      { eventId: 'e3', pubkey: 'c', rating: 3, comment: '', createdAt: 1 },
    ])
    const insertCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO mint_reviews'))!
    expect(insertCall[1]).toHaveLength(18) // all three rows are still stored
    const updateCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE mints'))!
    expect(updateCall[1]).toEqual([2, 4, 1, 2, 'https://m.example'])
  })

  it('a critic listed as the mint\'s contact but not an announcer is neither excluded nor labelled: the 1-star review counts', async () => {
    routeClient({
      mintRow: { contact_nostr: [CRITIC_HEX], nostr_announce_pubkey: OPERATOR_HEX },
      stored: [
        { pubkey: CRITIC_HEX, rating: 1, comment: 'lost my sats' },
        { pubkey: 'b', rating: 5, comment: '' },
      ],
    })
    await persistMintReviews('https://m.example', [
      { eventId: 'e1', pubkey: CRITIC_HEX, rating: 1, comment: 'lost my sats', createdAt: 2 },
      { eventId: 'e2', pubkey: 'b', rating: 5, comment: '', createdAt: 1 },
    ])
    const updateCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE mints'))!
    expect(updateCall[1]).toEqual([2, 3, 0, 2, 'https://m.example']) // both counted, average of 1 and 5, no operator review
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
  function routePool(mints: unknown[], reviews: unknown[], updateRowCount = 1) {
    poolQueryMock.mockImplementation((sql: string) => {
      const q = String(sql)
      if (q.includes('FROM mints')) return Promise.resolve({ rows: mints })
      if (q.includes('FROM mint_reviews')) return Promise.resolve({ rows: reviews })
      return Promise.resolve({ rowCount: updateRowCount, rows: [] })
    })
  }

  it('updates the rollup from stored rows: empty reviews and the operator\'s reviews are not counted', async () => {
    routePool(
      [{ url: 'https://m.example', contact_nostr: [OPERATOR_HEX], nostr_announce_pubkey: OPERATOR_HEX }, { url: 'https://n.example', contact_nostr: null, nostr_announce_pubkey: null }],
      [
        { url: 'https://m.example', pubkey: OPERATOR_HEX, rating: 5, comment: '' },
        { url: 'https://m.example', pubkey: 'b', rating: 5, comment: '' },
        { url: 'https://m.example', pubkey: 'c', rating: 3, comment: '' },
        { url: 'https://n.example', pubkey: 'd', rating: null, comment: '   ' },
        { url: 'https://n.example', pubkey: 'e', rating: 2, comment: '' },
      ],
      2,
    )
    await expect(recomputeReviewCountRollups()).resolves.toBe(2)
    const upd = poolQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE mints'))!
    expect(String(upd[0])).toMatch(/review_operator_count = v\.opc/)
    expect(upd[1]).toEqual([['https://m.example', 'https://n.example'], [2, 1], [4, 2], [1, 0], [2, 1]])
    expect(String(upd[0])).toMatch(/review_rated_count = v\.rated/)
  })

  it('returns 0 and writes nothing when there are no stored reviews', async () => {
    routePool([], [])
    await expect(recomputeReviewCountRollups()).resolves.toBe(0)
    expect(poolQueryMock.mock.calls.some(c => String(c[0]).includes('UPDATE mints'))).toBe(false)
  })

  it('returns 0 when the driver reports no rowCount', async () => {
    poolQueryMock.mockImplementation((sql: string) => {
      const q = String(sql)
      if (q.includes('FROM mints')) return Promise.resolve({ rows: [] })
      if (q.includes('FROM mint_reviews')) return Promise.resolve({ rows: [{ url: 'u', pubkey: 'p', rating: 4, comment: '' }] })
      return Promise.resolve({ rows: [] })
    })
    await expect(recomputeReviewCountRollups()).resolves.toBe(0)
  })
})
