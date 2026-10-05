// Background sync of NIP-87 (kind:38000) mint reviews into Postgres.
//
// Why this exists: Mint Detail used to fetch reviews live on every page open —
// a client-side `sharedPool.querySync` against ~19 relays (4.4s EOSE ceiling)
// AND a server-side `GET /api/mints/nostr-reviews` doing the same query (~3s).
// That was the single largest contributor to the "several seconds until the
// page has data" problem. Now a cron pass (piggy-backing on the 6h discovery
// cycle — see cron.ts) fetches reviews for every known mint once and writes
// them to `mint_reviews` + rolls up `mints.review_count` / `review_avg_rating`.
// `GET /api/mints/nostr-reviews` and `/api/mints/known` then serve those
// cached values instantly from the DB. The frontend's own live querySync stays
// as a non-blocking background refresh (so a user sees their just-published
// review immediately) but no longer gates the first render.

import { SimplePool, verifyEvent } from 'nostr-tools'
import WebSocket from 'ws'
import { pool } from './db.js'
import { getKnownMints } from './prober.js'
import { parseReviewRatingAndComment } from './reviews.js'
import { operatorPubkeys } from './shared/operatorPubkeys.js'

export const REVIEW_SYNC_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.cashumints.space',
  'wss://relay.azzamo.net',
  'wss://nostr.oxtr.dev',
  'wss://offchain.pub',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.cypherpunk.today',
  'wss://nostr-pub.wellorder.net',
  'wss://nostr.mintradar.org',
  'wss://relay.nostr.net',
  'wss://relay.minibits.cash',
  'wss://nostr.mom',
  'wss://eden.nostr.land',
  'wss://nostr21.com',
]

const REVIEW_FETCH_TIMEOUT_MS = 8_000
const REVIEW_REQ_LIMIT = 500
const REVIEW_SYNC_CONCURRENCY = 3
const REVIEW_INSERT_BATCH = 1000

export interface SyncedReview {
  eventId: string
  pubkey: string
  rating: number | null
  comment: string
  createdAt: number
}

export function dedupeAndParseReviewEvents(
  events: { id: string; pubkey: string; content?: string; tags: string[][]; created_at: number }[],
): SyncedReview[] {
  const byPubkey = new Map<string, (typeof events)[number]>()
  for (const e of events) {
    const existing = byPubkey.get(e.pubkey)
    if (!existing || e.created_at > existing.created_at) byPubkey.set(e.pubkey, e)
  }
  const out: SyncedReview[] = []
  for (const e of byPubkey.values()) {
    const { rating, comment } = parseReviewRatingAndComment(e.tags, e.content ?? '')
    out.push({
      eventId: e.id,
      pubkey: e.pubkey,
      rating,
      comment: comment.length > 2000 ? comment.slice(0, 2000) : comment,
      createdAt: e.created_at,
    })
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

// Average over rated reviews only. review_count excludes empty events
// (no rating and no comment).
export function computeAvgRating(reviews: SyncedReview[]): number | null {
  const rated = reviews.filter(r => r.rating !== null)
  if (rated.length === 0) return null
  const sum = rated.reduce((s, r) => s + (r.rating as number), 0)
  return Math.round((sum / rated.length) * 10) / 10
}

async function fetchReviewsForMint(nostrPool: SimplePool, url: string): Promise<SyncedReview[] | null> {
  try {
    const events = await Promise.race([
      nostrPool.querySync(REVIEW_SYNC_RELAYS, { kinds: [38000], '#u': [url], limit: REVIEW_REQ_LIMIT }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), REVIEW_FETCH_TIMEOUT_MS)
      ),
    ])
    const valid = events.filter(e => verifyEvent(e))
    return dedupeAndParseReviewEvents(valid)
  } catch (err) {
    console.error(`[reviews-sync] relay fetch failed for ${url}:`, err instanceof Error ? err.message : err)
    return null
  }
}

interface StoredReviewRow {
  pubkey: string
  rating: number | null
  comment: string | null
}

export interface ReviewAggregate {
  /** Counted reviews (operator reviews excluded; empty events - no rating and no comment - excluded). */
  count: number
  /** Mean of the counted rated reviews, one decimal, or null when none is rated. */
  avg: number | null
  /** Reviews that would have counted but were written by the mint's operator. */
  operatorCount: number
}

/** Operator keys of a mints row ({ contact_nostr, nostr_announce_pubkey }), see shared/operatorPubkeys.ts. */
export function operatorKeysOf(row: { contact_nostr?: unknown; nostr_announce_pubkey?: unknown } | undefined): Set<string> {
  if (!row) return new Set()
  const contact = Array.isArray(row.contact_nostr)
    ? (row.contact_nostr as unknown[]).map(info => ({ method: 'nostr', info }))
    : []
  const announcePubkey = typeof row.nostr_announce_pubkey === 'string' ? row.nostr_announce_pubkey : null
  return operatorPubkeys({ contact, announcePubkey })
}

/** The one counting rule behind mints.review_count / review_avg_rating / review_operator_count. */
export function aggregateReviews(rows: readonly StoredReviewRow[], operators: ReadonlySet<string>): ReviewAggregate {
  let count = 0
  let operatorCount = 0
  let ratedSum = 0
  let rated = 0
  for (const r of rows) {
    if (r.rating === null && (r.comment ?? '').trim() === '') continue
    if (operators.has(r.pubkey.toLowerCase())) { operatorCount++; continue }
    count++
    if (r.rating !== null) { ratedSum += Number(r.rating); rated++ }
  }
  return { count, avg: rated === 0 ? null : Math.round((ratedSum / rated) * 10) / 10, operatorCount }
}

export async function persistMintReviews(url: string, reviews: SyncedReview[]): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < reviews.length; i += REVIEW_INSERT_BATCH) {
      const batch = reviews.slice(i, i + REVIEW_INSERT_BATCH)
      const values: unknown[] = []
      const tuples = batch.map((r, j) => {
        const b = j * 6
        values.push(url, r.pubkey, r.eventId, r.rating, r.comment, r.createdAt)
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`
      })
      await client.query(
        `INSERT INTO mint_reviews (url, pubkey, event_id, rating, comment, created_at)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (url, pubkey) DO UPDATE SET
           event_id = EXCLUDED.event_id,
           rating = EXCLUDED.rating,
           comment = EXCLUDED.comment,
           created_at = EXCLUDED.created_at
         WHERE mint_reviews.created_at < EXCLUDED.created_at`,
        values,
      )
    }
    // Aggregates are computed here, from the stored rows, with the operator's own reviews left out
    // (stored rows are never changed or deleted; the operator is a key the mint lists as a nostr
    // contact AND that authored its NIP-87 announcement — shared/operatorPubkeys.ts).
    const { rows: mintRows } = await client.query(
      `SELECT contact_nostr, nostr_announce_pubkey FROM mints WHERE url = $1`,
      [url],
    )
    const operators = operatorKeysOf(mintRows[0])
    const { rows: stored } = await client.query(
      `SELECT pubkey, rating, comment FROM mint_reviews WHERE url = $1`,
      [url],
    )
    const agg = aggregateReviews(stored as StoredReviewRow[], operators)
    await client.query(
      `UPDATE mints SET review_count = $1, review_avg_rating = $2, review_operator_count = $3, reviews_checked_at = NOW() WHERE url = $4`,
      [agg.count, agg.avg, agg.operatorCount, url],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** Recount mints.review_count / review_avg_rating / review_operator_count from stored mint_reviews
 *  without hitting relays. Same rule as persistMintReviews (aggregateReviews): empty events (no
 *  rating and no comment) and the operator's own reviews are not counted. */
export async function recomputeReviewCountRollups(): Promise<number> {
  const [{ rows: mintRows }, { rows: reviewRows }] = await Promise.all([
    pool.query(`SELECT url, contact_nostr, nostr_announce_pubkey FROM mints`),
    pool.query(`SELECT url, pubkey, rating, comment FROM mint_reviews`),
  ])
  const operatorsByUrl = new Map<string, Set<string>>()
  for (const m of mintRows as Array<{ url: string; contact_nostr?: unknown; nostr_announce_pubkey?: unknown }>) {
    const ops = operatorKeysOf(m)
    if (ops.size > 0) operatorsByUrl.set(m.url, ops)
  }
  const byUrl = new Map<string, StoredReviewRow[]>()
  for (const r of reviewRows as Array<StoredReviewRow & { url: string }>) {
    const list = byUrl.get(r.url)
    if (list) list.push(r); else byUrl.set(r.url, [r])
  }
  const urls: string[] = []
  const counts: number[] = []
  const avgs: Array<number | null> = []
  const opCounts: number[] = []
  for (const [url, list] of byUrl) {
    const agg = aggregateReviews(list, operatorsByUrl.get(url) ?? new Set())
    urls.push(url); counts.push(agg.count); avgs.push(agg.avg); opCounts.push(agg.operatorCount)
  }
  if (urls.length === 0) {
    console.log('[reviews-sync] recomputed review_count rollup for 0 mint(s)')
    return 0
  }
  const { rowCount } = await pool.query(
    `UPDATE mints m
        SET review_count = v.cnt,
            review_avg_rating = v.avg,
            review_operator_count = v.opc
       FROM unnest($1::text[], $2::int[], $3::real[], $4::int[]) AS v(url, cnt, avg, opc)
      WHERE m.url = v.url`,
    [urls, counts, avgs, opCounts],
  )
  const n = rowCount ?? 0
  console.log(`[reviews-sync] recomputed review_count rollup for ${n} mint(s)`)
  return n
}

let reviewSyncRunning = false
export function isReviewSyncRunning(): boolean {
  return reviewSyncRunning
}

export async function refreshAllMintReviews(): Promise<number> {
  if (reviewSyncRunning) {
    console.warn('[reviews-sync] already running — skipping overlapping run')
    return -1
  }
  reviewSyncRunning = true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).WebSocket = WebSocket
  const nostrPool = new SimplePool()
  let updated = 0
  let failed = 0
  try {
    const urls = await getKnownMints()
    let cursor = 0
    async function worker(): Promise<void> {
      for (;;) {
        const i = cursor++
        if (i >= urls.length) return
        const url = urls[i]
        if (url === undefined) return
        const reviews = await fetchReviewsForMint(nostrPool, url)
        if (reviews === null) { failed++; continue }
        try {
          await persistMintReviews(url, reviews)
          updated++
        } catch (err) {
          failed++
          console.error(`[reviews-sync] persist failed for ${url}:`, err instanceof Error ? err.message : err)
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(REVIEW_SYNC_CONCURRENCY, urls.length) }, () => worker()),
    )
    console.log(`[reviews-sync] done: ${updated} mints updated, ${failed} failed (of ${urls.length})`)
  } catch (err) {
    console.error('[reviews-sync] fatal error:', err instanceof Error ? err.message : err)
  } finally {
    nostrPool.destroy()
    reviewSyncRunning = false
  }
  return updated
}
