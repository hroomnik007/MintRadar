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

// Broad relay set for the BACKGROUND sync — this runs on a cron with a generous
// time budget, so it favours coverage over latency (the opposite trade-off from
// the frontend's curated REVIEW_READ_RELAYS fast-path list). No longer a straight
// mirror of the frontend's old REVIEW_RELAYS — as of the 2026-09-19 relay audit
// (live NIP-11 + WS REQ measurement, 3 cycles) this is DISCOVERY_RELAYS (see the
// export above) + relay.minibits.cash + 3 relays that measured strong kind:38000
// yield but were kept OUT of general discovery for other reasons: nostr.mom
// (5/5 events, unrestricted), eden.nostr.land and nostr21.com (paid relays —
// 5/5 and 5/5 kind:38000 events respectively; fine here since this is a
// read-only cron with no write/discovery cost, unlike DISCOVERY_RELAYS or
// REVIEW_PUBLISH_RELAYS which do exclude them). Dropped vs. the pre-audit list:
// purplepag.es (0/5 both kinds — directory relay, not NIP-87/38000), relay.snort.social
// (only 1/5 kind:38172, 0/5 kind:38000 across 3 cycles), nostr.wine (403 on anon REQ,
// all 3 cycles), relay.8333.space (still EHOSTUNREACH). relay.nostr.net was
// dropped here on 2026-09-19 for NIP-11 HTTP 500 and re-added 2026-09-27 — see
// the entry below. `backend/src/__tests__/nostrReviewsRelays.test.ts` pins
// this exact array as a drift tripwire, and now also cross-checks DISCOVERY_RELAYS
// against the frontend's own array.
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
  // Re-added 2026-09-27. The 2026-09-19 audit dropped it because NIP-11 returned
  // HTTP 500. Rechecked live: NIP-11 is up (strfry) and a kind:38000 #u REQ for
  // https://mint.minibits.cash/Bitcoin returned EOSE with 44 events, 15 of which
  // no other relay in this list had. Stays off REVIEW_READ_RELAYS (fast path).
  'wss://relay.nostr.net',
  'wss://relay.minibits.cash',
  'wss://nostr.mom',
  'wss://eden.nostr.land',
  'wss://nostr21.com',
]

// A cycle that sees fewer reviews than we already stored must not delete them.
// Nostr does not forget an event just because this pass's relays didn't return
// it. Rows are upserted (newest event per pubkey wins) and the rollup is
// counted from the table afterwards, never from this cycle's array length.
// review_count_pending_low / _streak remain in the schema but are no longer
// read or written — the drop-floor that used them confirmed a thin fetch as
// a real deletion.

const REVIEW_FETCH_TIMEOUT_MS = 8_000
const REVIEW_REQ_LIMIT = 500
// How many mints to fetch reviews for concurrently. Kept at 3 so that, even if
// all workers hit persistMintReviews() at the same instant, at most 3 of the
// pg pool's 5 connections are taken by the sync — the API always keeps 2.
const REVIEW_SYNC_CONCURRENCY = 3
// Max rows per multi-VALUES INSERT (keeps the parameter count well under
// Postgres' 65535 bind-parameter ceiling: 6 cols * 1000 = 6000).
const REVIEW_INSERT_BATCH = 1000

export interface SyncedReview {
  eventId: string
  pubkey: string
  rating: number | null
  comment: string
  createdAt: number
}

// One review per pubkey (newest wins), signature-verified, rating/comment parsed.
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
    // Cap stored comment length — a relay could serve arbitrarily large event
    // content and this goes straight into a TEXT column. 2000 chars is well
    // above any real review; the frontend already truncates visually.
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

// Average over rated reviews only — rating-less endorsement events are counted
// in review_count but never dilute the star average (mirrors MintDetail.tsx's
// `ratedReviews` filter).
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

// Upsert this cycle's reviews, then set the rollup from the rows actually
// stored. Nothing already in mint_reviews is deleted just because this pass
// didn't see it. A newer event for the same pubkey replaces the older row;
// an older event does not. Readers under READ COMMITTED see the upserts and
// the rollup update commit together. A concurrent pass for the same url can't
// overlap (single-flight — see isReviewSyncRunning).
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

    const { rows } = await client.query<{ review_count: number; review_avg_rating: number | null }>(
      `SELECT COUNT(*)::int AS review_count,
              AVG(rating) FILTER (WHERE rating IS NOT NULL) AS review_avg_rating
         FROM mint_reviews
        WHERE url = $1`,
      [url],
    )
    const stored = rows[0]
    const avg = stored?.review_avg_rating == null
      ? null
      : Math.round(Number(stored.review_avg_rating) * 10) / 10
    await client.query(
      `UPDATE mints
         SET review_count = $1,
             review_avg_rating = $2,
             reviews_checked_at = NOW()
       WHERE url = $3`,
      [stored?.review_count ?? 0, avg, url],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

let reviewSyncRunning = false
export function isReviewSyncRunning(): boolean {
  return reviewSyncRunning
}

// Fetches reviews for every known mint and persists them. Single-flight: a
// second call while one is in progress is a no-op (returns -1).
export async function refreshAllMintReviews(): Promise<number> {
  if (reviewSyncRunning) {
    console.warn('[reviews-sync] already running — skipping overlapping run')
    return -1
  }
  reviewSyncRunning = true

  // Always install 'ws' as globalThis.WebSocket — see nostrService.ts for why
  // this must not be guarded by `if (!globalThis.WebSocket)`: Node 22's native
  // WebSocket crashes the process on a failed relay connection.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).WebSocket = WebSocket

  // Root nostr-tools SimplePool — connects via the plain `globalThis.WebSocket`
  // above, NOT the connect-time DNS-pinned `DnsPinnedWebSocket` that
  // nostrService.ts uses for the notification path. Safe ONLY because
  // REVIEW_SYNC_RELAYS is a hardcoded constant with no attacker-controlled host.
  // If a dynamic/user-supplied relay list is ever added here, move to the pinned
  // pool ('nostr-tools/pool' SimplePool + useWebSocketImplementation) or this
  // becomes an SSRF vector. See the matching note in discovery.ts.
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
