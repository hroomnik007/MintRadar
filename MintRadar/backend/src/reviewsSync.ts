// Background sync of NIP-87 (kind:38000) mint reviews into Postgres.
//
// Why this exists: Mint Detail used to fetch reviews live on every page open —
// a client-side `sharedPool.querySync` against ~19 relays (4.4s EOSE ceiling)
// AND a server-side `GET /api/mints/nostr-reviews` doing the same query (~3s).
// That was the single largest contributor to the "several seconds until the
// page has data" problem. Now a background pass fetches reviews for every known
// mint and writes them to `mint_reviews` + rolls up `mints.review_count` /
// `review_avg_rating`. `GET /api/mints/nostr-reviews` and `/api/mints/known` then
// serve those cached values instantly from the DB. The frontend's own live
// querySync stays as a non-blocking background refresh (so a user sees their
// just-published review immediately) but no longer gates the first render.
//
// Schedule: its own hourly timer (reviewsSchedule.ts), independent of the 6h discovery
// cycle. To keep the load on each relay at a handful of requests per hour a run opens one
// connection per relay and sends one REQ per batch of mints (reviewsRelayFetch.ts), only for
// events newer than the last clean run on that relay (minus an overlap), with a full sweep per
// relay about once a day. Progress per relay lives in `reviews_sync_relay_state`.

import { verifyEvent, type Event as NostrEvent } from 'nostr-tools'
import { pool } from './db.js'
import { getKnownMints } from './prober.js'
import { parseReviewRatingAndComment } from './reviews.js'
import { operatorPubkeys } from './shared/operatorPubkeys.js'
import {
  REVIEW_BATCH_SIZE,
  REVIEW_CONNECT_TIMEOUT_MS,
  REVIEW_MAX_CONSECUTIVE_FAILURES,
  REVIEW_MAX_RUN_MS,
  REVIEW_PACING_MAX_MS,
  REVIEW_PACING_MIN_MS,
  REVIEW_QUERY_TIMEOUT_MS,
  REVIEW_REQ_LIMIT,
  connectRelayWs,
  fetchRelayReviews,
  groupEventsByMint,
  planRelayQuery,
  type ConnectRelay,
  type RelayPlan,
  type RelayRunOptions,
  type RelayRunResult,
  type RelaySyncState,
} from './reviewsRelayFetch.js'

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


// ── The run ───────────────────────────────────────────────────────────────────────────────

async function loadRelayState(): Promise<Map<string, RelaySyncState>> {
  const { rows } = await pool.query(
    'SELECT relay, last_ok_started_at, last_full_at FROM reviews_sync_relay_state',
  )
  const out = new Map<string, RelaySyncState>()
  for (const r of rows as Array<{ relay: string; last_ok_started_at: string | number; last_full_at: string | number | null }>) {
    out.set(r.relay, {
      lastOkStartedAt: Number(r.last_ok_started_at),
      lastFullAt: r.last_full_at === null ? null : Number(r.last_full_at),
    })
  }
  return out
}

/** Marks a clean run on one relay. A run without `since` also moves the full-sweep time. */
async function saveRelayState(relay: string, startedAtSec: number, full: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO reviews_sync_relay_state (relay, last_ok_started_at, last_full_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (relay) DO UPDATE SET
       last_ok_started_at = EXCLUDED.last_ok_started_at,
       last_full_at = COALESCE(EXCLUDED.last_full_at, reviews_sync_relay_state.last_full_at)`,
    [relay, startedAtSec, full ? startedAtSec : null],
  )
}

export interface ReviewsSyncDeps {
  relays: readonly string[]
  getMints: () => Promise<string[]>
  loadState: () => Promise<Map<string, RelaySyncState>>
  saveState: (relay: string, startedAtSec: number, full: boolean) => Promise<void>
  persist: (url: string, reviews: SyncedReview[]) => Promise<void>
  connect: ConnectRelay
  now: () => number
  sleep: (ms: number) => Promise<void>
  random: () => number
  log: (line: string) => void
  /** Overrides for tests and the stub-relay scratch run. */
  config?: Partial<Pick<RelayRunOptions, 'batchSize' | 'limit' | 'pacingMinMs' | 'pacingMaxMs' | 'queryTimeoutMs' | 'connectTimeoutMs' | 'maxConsecutiveFailures'>> & { maxRunMs?: number }
}

export interface ReviewsSyncSummary {
  mints: number
  relaysUsed: number
  relaysFailed: number
  reqs: number
  events: number
  stored: number
  updated: number
  persistFailed: number
  durationMs: number
  deadlineHit: boolean
  relays: Array<{ relay: string; plan: RelayPlan; result: RelayRunResult }>
}

export async function runReviewsSync(deps: ReviewsSyncDeps): Promise<ReviewsSyncSummary> {
  const startedMs = deps.now()
  const startedSec = Math.floor(startedMs / 1000)
  const cfg = deps.config ?? {}
  const opts: RelayRunOptions = {
    batchSize: cfg.batchSize ?? REVIEW_BATCH_SIZE,
    limit: cfg.limit ?? REVIEW_REQ_LIMIT,
    connectTimeoutMs: cfg.connectTimeoutMs ?? REVIEW_CONNECT_TIMEOUT_MS,
    queryTimeoutMs: cfg.queryTimeoutMs ?? REVIEW_QUERY_TIMEOUT_MS,
    pacingMinMs: cfg.pacingMinMs ?? REVIEW_PACING_MIN_MS,
    pacingMaxMs: cfg.pacingMaxMs ?? REVIEW_PACING_MAX_MS,
    maxConsecutiveFailures: cfg.maxConsecutiveFailures ?? REVIEW_MAX_CONSECUTIVE_FAILURES,
    deadlineMs: startedMs + (cfg.maxRunMs ?? REVIEW_MAX_RUN_MS),
    now: deps.now,
    sleep: deps.sleep,
    random: deps.random,
  }

  const urls = [...new Set(await deps.getMints())]
  let state = new Map<string, RelaySyncState>()
  try {
    state = await deps.loadState()
  } catch (err) {
    // Unknown progress means a full sweep everywhere, which is the safe direction.
    deps.log(`[reviews-sync] could not read relay state, running a full sweep: ${err instanceof Error ? err.message : err}`)
  }

  // Relays run in parallel, each one strictly one REQ at a time.
  const relays = await Promise.all(deps.relays.map(async relay => {
    const plan = planRelayQuery(state.get(relay), startedSec)
    const result = await fetchRelayReviews(relay, deps.connect, urls, plan.since, opts)
    if (result.outcome !== 'ok') deps.log(`[reviews-sync] relay ${relay} ${result.outcome}: ${result.reason ?? 'unknown'}`)
    return { relay, plan, result }
  }))

  // Signature and kind are checked once per distinct event, whichever relays delivered it.
  const verified = new Map<string, NostrEvent>()
  for (const { result } of relays) {
    for (const e of result.events) {
      if (verified.has(e.id)) continue
      let ok: boolean
      try { ok = e.kind === 38000 && verifyEvent(e) } catch { ok = false }
      if (ok) verified.set(e.id, e)
    }
  }
  const byMint = groupEventsByMint([...verified.values()], new Set(urls))
  const covered = new Set<string>()
  for (const { result } of relays) for (const url of result.covered) covered.add(url)

  // Mints no relay answered for are left alone (no stamp, no change).
  let updated = 0
  let stored = 0
  let persistFailed = 0
  for (const url of urls) {
    if (!covered.has(url)) continue
    const reviews = dedupeAndParseReviewEvents(byMint.get(url) ?? [])
    try {
      await deps.persist(url, reviews)
      updated++
      stored += reviews.length
    } catch (err) {
      persistFailed++
      deps.log(`[reviews-sync] persist failed for ${url}: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Progress only moves for relays that finished cleanly, and only if everything fetched was stored:
  // otherwise the next run reaches back far enough to fetch it again.
  if (persistFailed === 0) {
    for (const { relay, plan, result } of relays) {
      if (result.outcome !== 'ok') continue
      try {
        await deps.saveState(relay, startedSec, plan.full)
      } catch (err) {
        deps.log(`[reviews-sync] could not save relay state for ${relay}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  const used = relays.filter(r => r.result.reqs > 0).length
  const failed = relays.filter(r => r.result.outcome !== 'ok').length
  const reqs = relays.reduce((n, r) => n + r.result.reqs, 0)
  const events = relays.reduce((n, r) => n + r.result.eventsReceived, 0)
  const deadlineHit = relays.some(r => r.result.outcome === 'deadline')
  const durationMs = deps.now() - startedMs
  if (deadlineHit) deps.log(`[reviews-sync] max run duration of ${Math.round((cfg.maxRunMs ?? REVIEW_MAX_RUN_MS) / 1000)}s reached, stopped cleanly`)
  deps.log(
    `[reviews-sync] done: mints=${urls.length} relays_used=${used} relays_failed_or_skipped=${failed} ` +
    `reqs=${reqs} events=${events} reviews_stored=${stored} mints_updated=${updated} ` +
    `full_sweep_relays=${relays.filter(r => r.plan.full).length} duration=${(durationMs / 1000).toFixed(1)}s`,
  )
  return { mints: urls.length, relaysUsed: used, relaysFailed: failed, reqs, events, stored, updated, persistFailed, durationMs, deadlineHit, relays }
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
  try {
    const summary = await runReviewsSync({
      relays: REVIEW_SYNC_RELAYS,
      getMints: getKnownMints,
      loadState: loadRelayState,
      saveState: saveRelayState,
      persist: persistMintReviews,
      connect: connectRelayWs,
      now: Date.now,
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      random: Math.random,
      log: line => console.log(line),
    })
    return summary.updated
  } catch (err) {
    console.error('[reviews-sync] fatal error:', err instanceof Error ? err.message : err)
    return 0
  } finally {
    reviewSyncRunning = false
  }
}
