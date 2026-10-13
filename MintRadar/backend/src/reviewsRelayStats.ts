// Per-relay delivery accounting for the hourly reviews sync (reviewsSync.ts).
// Counters only: no event ids, pubkeys, review text or mint URLs leave this module or reach the database.
import { pool } from './db.js'

/** Upper bound of distinct event ids held in memory for one run's accounting. */
export const RELAY_ACCOUNTING_MAX_IDS = 50_000

export interface RelayDelivery {
  relay: string
  /** Ids of the events this relay delivered that passed the sync's validation (duplicates allowed). */
  eventIds: readonly string[]
  /** Only relays that finished cleanly are credited; the ids of the others still count as "delivered by someone". */
  ok: boolean
}

export interface RelayDeliveryCounts {
  relay: string
  /** Distinct event ids delivered by this relay in this run (0 for a relay that was not ok). */
  delivered: number
  /** Of those, ids no other relay delivered in this run. */
  exclusive: number
  /** Of those, ids that were not in mint_reviews before this run's inserts. */
  newEvents: number
}

export interface RelayAccounting {
  counts: RelayDeliveryCounts[]
  /** More than `maxIds` distinct ids were delivered: the surplus was left out of the accounting. */
  truncated: boolean
}

/**
 * Pure accounting of one run. `existingIds` = ids already stored in mint_reviews before the run's inserts.
 * Memory is bounded: once `maxIds` distinct ids are tracked no new id is added (ids already tracked still
 * learn about further relays) and `truncated` is set.
 */
export function accountRelayDeliveries(
  deliveries: readonly RelayDelivery[],
  existingIds: ReadonlySet<string>,
  maxIds: number = RELAY_ACCOUNTING_MAX_IDS,
): RelayAccounting {
  const MANY = -1
  // eventId -> index of the single relay that delivered it, or MANY once a second relay delivered it too.
  const owner = new Map<string, number>()
  const perRelay: Array<Set<string>> = deliveries.map(() => new Set<string>())
  let truncated = false
  deliveries.forEach((d, idx) => {
    for (const id of d.eventIds) {
      if (perRelay[idx]!.has(id)) continue
      const prev = owner.get(id)
      if (prev === undefined) {
        if (owner.size >= maxIds) { truncated = true; continue }
        owner.set(id, idx)
      } else if (prev !== idx) {
        owner.set(id, MANY)
      }
      perRelay[idx]!.add(id)
    }
  })
  const counts = deliveries.map((d, idx) => {
    if (!d.ok) return { relay: d.relay, delivered: 0, exclusive: 0, newEvents: 0 }
    let exclusive = 0
    let newEvents = 0
    for (const id of perRelay[idx]!) {
      if (owner.get(id) === idx) exclusive++
      if (!existingIds.has(id)) newEvents++
    }
    return { relay: d.relay, delivered: perRelay[idx]!.size, exclusive, newEvents }
  })
  return { counts, truncated }
}

/** The ids the accounting of `deliveries` will look at, in the same order and under the same cap (for the one existing-ids query). */
export function accountedIds(deliveries: readonly RelayDelivery[], maxIds: number = RELAY_ACCOUNTING_MAX_IDS): string[] {
  const seen = new Set<string>()
  for (const d of deliveries) {
    for (const id of d.eventIds) {
      if (seen.size >= maxIds && !seen.has(id)) continue
      seen.add(id)
    }
  }
  return [...seen]
}

/** Which of `ids` are already stored in mint_reviews: one query per run. */
export async function loadExistingEventIds(ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { rows } = await pool.query(
    'SELECT DISTINCT event_id FROM mint_reviews WHERE event_id = ANY($1::text[])',
    [ids],
  )
  return new Set((rows as Array<{ event_id: string }>).map(r => r.event_id))
}

export type RelayRunKind = 'ok' | 'failed' | 'skipped'

export interface RelayRunCounters {
  relay: string
  kind: RelayRunKind
  ms: number
  delivered: number
  exclusive: number
  newEvents: number
}

const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

/**
 * Adds one run's numbers to reviews_sync_relay_state: ONE statement for all relays (atomic, so an aborted run
 * writes nothing and a finished one is written exactly once). Only adds non-negative amounts. A relay that
 * never finished a clean run gets a row with last_ok_started_at NULL ("never ok"); loadRelayState ignores such rows.
 */
export async function saveRelayCounters(rows: readonly RelayRunCounters[]): Promise<void> {
  if (rows.length === 0) return
  const col = <T,>(f: (r: RelayRunCounters) => T): T[] => rows.map(f)
  await pool.query(
    `INSERT INTO reviews_sync_relay_state
       (relay, runs, ok_runs, failed_runs, skipped_runs, events_delivered, events_exclusive, events_new, total_ms, last_run_exclusive)
     SELECT v.relay, 1, v.ok_n, v.failed_n, v.skipped_n, v.delivered_n, v.exclusive_n, v.new_n, v.ms_n, v.exclusive_n
       FROM unnest($1::text[], $2::int[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[], $8::bigint[])
            AS v(relay, ok_n, failed_n, skipped_n, delivered_n, exclusive_n, new_n, ms_n)
     ON CONFLICT (relay) DO UPDATE SET
       runs = reviews_sync_relay_state.runs + 1,
       ok_runs = reviews_sync_relay_state.ok_runs + EXCLUDED.ok_runs,
       failed_runs = reviews_sync_relay_state.failed_runs + EXCLUDED.failed_runs,
       skipped_runs = reviews_sync_relay_state.skipped_runs + EXCLUDED.skipped_runs,
       events_delivered = reviews_sync_relay_state.events_delivered + EXCLUDED.events_delivered,
       events_exclusive = reviews_sync_relay_state.events_exclusive + EXCLUDED.events_exclusive,
       events_new = reviews_sync_relay_state.events_new + EXCLUDED.events_new,
       total_ms = reviews_sync_relay_state.total_ms + EXCLUDED.total_ms,
       last_run_exclusive = CASE WHEN EXCLUDED.ok_runs = 1 THEN EXCLUDED.last_run_exclusive ELSE reviews_sync_relay_state.last_run_exclusive END`,
    [
      col(r => r.relay),
      col(r => (r.kind === 'ok' ? 1 : 0)),
      col(r => (r.kind === 'failed' ? 1 : 0)),
      col(r => (r.kind === 'skipped' ? 1 : 0)),
      col(r => nonNeg(r.delivered)),
      col(r => nonNeg(r.exclusive)),
      col(r => nonNeg(r.newEvents)),
      col(r => nonNeg(r.ms)),
    ],
  )
}
