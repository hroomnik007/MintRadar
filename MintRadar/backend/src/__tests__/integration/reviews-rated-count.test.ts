import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// reviews.ratedCount of the wallet API (docs/API.md): the number of counted reviews that carry a rating. The
// mints.review_rated_count column is written together with review_count by the reviews sync and by the startup
// recount; while it is NULL (before the first recount) the wallet API counts the stored reviews at read time instead of
// answering 0. A mint with 3 reviews, 2 of them rated and 1 comment only, says 2 before and after a simulated
// restart and after a new rated review arrives (3). The pool is a small stateful fake of the tables involved.

const URL_M = 'https://rated.example.com'

interface StoredReview { url: string; pubkey: string; rating: number | null; comment: string | null; created_at: number }
const db = {
  mint: { review_count: null as number | null, review_avg_rating: null as number | null, review_operator_count: null as number | null, review_rated_count: null as number | null },
  reviews: [] as StoredReview[],
  updates: [] as string[],
}

function fakeQuery(sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount?: number }> {
  const text = sql.replace(/\s+/g, ' ').trim()
  // the /api/mints/known snapshot
  if (text.includes('FROM mints m') && text.includes('LEFT JOIN LATERAL')) {
    const stored = db.mint.review_rated_count === null && db.reviews.length > 0
      ? db.reviews.map(r => ({ pubkey: r.pubkey, rating: r.rating, comment: r.comment }))
      : null
    return Promise.resolve({ rows: [{
      url: URL_M, name: 'Rated Mint', icon_url: null, version: 'Nutshell/0.21.0', nut_count: 12, tos_url: null, description_long: null,
      nuts_limits: { '4': {}, '5': {} }, units: ['sat'], mint_methods: null, melt_methods: null, pubkey: null,
      audit_cz_total: null, audit_cz_blamed: null, audit_cz_fetched_at: null,
      discovered_at: new Date(Date.now() - 200 * 86_400_000).toISOString(), last_reliability_score: 90,
      last_error: null, server_location: null, ip_address: null, net_asn: null, net_org: null, net_country: null, has_onion: null,
      review_count: db.mint.review_count, review_avg_rating: db.mint.review_avg_rating,
      review_operator_count: db.mint.review_operator_count, review_rated_count: db.mint.review_rated_count,
      contact_nostr: null, nostr_announce_pubkey: null, stored_reviews: stored,
      total: 288, online_count: 288, total_7d: 2016, online_count_7d: 2016,
      latest_online: true, latest_latency_ms: 100, latest_checked_at: new Date().toISOString(), last_online_at: new Date().toISOString(),
    }] })
  }
  // recomputeReviewCountRollups (startup recount)
  if (text.startsWith('SELECT url, contact_nostr, nostr_announce_pubkey FROM mints')) return Promise.resolve({ rows: [{ url: URL_M }] })
  if (text.startsWith('SELECT url, pubkey, rating, comment FROM mint_reviews')) return Promise.resolve({ rows: db.reviews.map(r => ({ ...r })) })
  if (text.startsWith('UPDATE mints m SET review_count = v.cnt')) {
    const [urls, counts, avgs, ops, rated] = params as [string[], number[], Array<number | null>, number[], number[]]
    const i = urls.indexOf(URL_M)
    if (i >= 0) Object.assign(db.mint, { review_count: counts[i], review_avg_rating: avgs[i], review_operator_count: ops[i], review_rated_count: rated[i] })
    db.updates.push('recount')
    return Promise.resolve({ rows: [], rowCount: i >= 0 ? 1 : 0 })
  }
  // persistMintReviews (a new review arrives)
  if (text.startsWith('INSERT INTO mint_reviews')) {
    for (let i = 0; i < params.length; i += 6) {
      const [url, pubkey, , rating, comment, created] = params.slice(i, i + 6) as [string, string, string, number | null, string, number]
      const at = db.reviews.findIndex(r => r.url === url && r.pubkey === pubkey)
      const row = { url, pubkey, rating, comment, created_at: created }
      if (at >= 0) db.reviews[at] = row; else db.reviews.push(row)
    }
    return Promise.resolve({ rows: [] })
  }
  if (text.startsWith('SELECT contact_nostr, nostr_announce_pubkey FROM mints WHERE url')) return Promise.resolve({ rows: [{ contact_nostr: null, nostr_announce_pubkey: null }] })
  if (text.startsWith('SELECT pubkey, rating, comment FROM mint_reviews WHERE url')) return Promise.resolve({ rows: db.reviews.map(r => ({ pubkey: r.pubkey, rating: r.rating, comment: r.comment })) })
  if (text.startsWith('UPDATE mints SET review_count')) {
    const [count, avg, op, rated] = params as [number, number | null, number, number]
    Object.assign(db.mint, { review_count: count, review_avg_rating: avg, review_operator_count: op, review_rated_count: rated })
    db.updates.push('sync')
    return Promise.resolve({ rows: [] })
  }
  if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return Promise.resolve({ rows: [] })
  return Promise.resolve({ rows: [] })
}

vi.mock('../../db.js', () => ({
  pool: {
    query: vi.fn((sql: string, params?: unknown[]) => fakeQuery(sql, params)),
    connect: vi.fn(async () => ({ query: (sql: string, params?: unknown[]) => fakeQuery(sql, params), release: () => {} })),
  },
  initDb: vi.fn(),
}))
vi.mock('../../versionCatalog.js', () => ({
  getLatestVersionsMap: vi.fn().mockResolvedValue({ nutshell: { major: 0, minor: 21 } }),
}))

const pk = (c: string) => c.repeat(64)
const R = (rating: number | null, comment: string, who: string, at: number) =>
  ({ eventId: who.repeat(64), pubkey: pk(who), rating, comment, createdAt: at })

beforeEach(() => {
  db.mint = { review_count: null, review_avg_rating: null, review_operator_count: null, review_rated_count: null }
  db.reviews = [
    { url: URL_M, pubkey: pk('a'), rating: 5, comment: 'great', created_at: 100 },
    { url: URL_M, pubkey: pk('b'), rating: 3, comment: '', created_at: 101 },
    { url: URL_M, pubkey: pk('c'), rating: null, comment: 'comment only', created_at: 102 },
  ]
  db.updates = []
})

/** A fresh process: new module registry, so a new app and an empty snapshot cache. */
async function boot(): Promise<Express> {
  vi.resetModules()
  return (await import('../../index.js')).app
}
const walletMint = async (app: Express) => (await request(app).get(`/api/wallets/mints/${encodeURIComponent(URL_M)}`)).body.mint

describe('reviews.ratedCount of the wallet API', () => {
  it('is 2 for 3 reviews (2 rated, 1 comment only) before the rollup exists, after a restart recount, and after a new review', async () => {
    // 1. the column is still NULL (first deploy, or the recount has not run): counted from the stored reviews
    expect(db.mint.review_rated_count).toBeNull()
    let app = await boot()
    let m = await walletMint(app)
    expect(m.reviews).toEqual({ count: 3, ratedCount: 2, avg: 4, operatorCount: 0 })
    expect(Number.isInteger(m.reviews.ratedCount)).toBe(true)
    // /api/mints/known keeps saying null until the recount: the fallback is wallet-only
    const known = (await request(app).get('/api/mints/known')).body.find((x: { url: string }) => x.url === URL_M)
    expect(known.reviewRatedCount).toBeNull()
    expect(known).not.toHaveProperty('stored_reviews')
    expect(known).not.toHaveProperty('contact_nostr')

    // 2. a restart: the startup recount fills the column, the answer stays 2
    await boot()
    const { recomputeReviewCountRollups } = await import('../../reviewsSync.js')
    expect(await recomputeReviewCountRollups()).toBe(1)
    expect(db.mint).toMatchObject({ review_count: 3, review_rated_count: 2, review_avg_rating: 4, review_operator_count: 0 })
    app = await boot()
    m = await walletMint(app)
    expect(m.reviews).toEqual({ count: 3, ratedCount: 2, avg: 4, operatorCount: 0 })

    // 3. a new rated review arrives through the sync: the count follows, in the same statement as review_count
    const { persistMintReviews } = await import('../../reviewsSync.js')
    await persistMintReviews(URL_M, [R(4, 'ok', 'd', 200)])
    expect(db.updates).toEqual(['recount', 'sync'])
    expect(db.mint).toMatchObject({ review_count: 4, review_rated_count: 3 })
    app = await boot()
    m = await walletMint(app)
    expect(m.reviews).toEqual({ count: 4, ratedCount: 3, avg: 4, operatorCount: 0 })
  })

  it('a sync of a mint whose column was NULL writes review_rated_count together with review_count', async () => {
    const { persistMintReviews } = await import('../../reviewsSync.js')
    await persistMintReviews(URL_M, [R(2, '', 'e', 300)])
    expect(db.mint.review_count).toBe(4)
    expect(db.mint.review_rated_count).toBe(3)
  })

  it('is 0 only when there really is no rated review (comment-only reviews, or none)', async () => {
    db.reviews = [{ url: URL_M, pubkey: pk('a'), rating: null, comment: 'just words', created_at: 1 }]
    let m = await walletMint(await boot())
    expect(m.reviews).toEqual({ count: 1, ratedCount: 0, avg: null, operatorCount: 0 })
    db.reviews = []
    m = await walletMint(await boot())
    expect(m.reviews).toEqual({ count: 0, ratedCount: 0, avg: null, operatorCount: 0 })
  })

  it('uses the stored column as is once it is set', async () => {
    db.mint = { review_count: 7, review_avg_rating: 4.2, review_operator_count: 1, review_rated_count: 5 }
    const m = await walletMint(await boot())
    expect(m.reviews).toEqual({ count: 7, ratedCount: 5, avg: 4.2, operatorCount: 1 })
  })
})
