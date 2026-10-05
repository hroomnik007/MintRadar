// Relay side of the hourly reviews sync (reviewsSync.ts): one connection per relay per run,
// one REQ in flight at a time, kind:38000 queries batched over many mints, back-off when a relay
// pushes back. Nothing here touches the database.
//
// Why not SimplePool (what the sync used before): it hides CLOSED reasons and NOTICE messages, which
// the back-off needs, and it sends one REQ per mint per relay. This talks to the relay with the `ws`
// package directly. The relay lists are hardcoded constants, so (like discovery.ts and the old sync)
// there is no DNS pinning here — a dynamic relay list must switch to a pinned socket first.

import WebSocket from 'ws'
import type { Event as NostrEvent } from 'nostr-tools'

export const REVIEW_REQ_LIMIT = 500
/** Mints per REQ (number of `#u` values in one filter). No NIP-11 limit is read anywhere, so this is the default. */
export const REVIEW_BATCH_SIZE = 20
export const REVIEW_CONNECT_TIMEOUT_MS = 10_000
export const REVIEW_QUERY_TIMEOUT_MS = 15_000
/** Pause between two batches to the same relay: random in [min, max]. */
export const REVIEW_PACING_MIN_MS = 1_000
export const REVIEW_PACING_MAX_MS = 2_000
/** A relay is skipped for the rest of the run after this many failed batches in a row. */
export const REVIEW_MAX_CONSECUTIVE_FAILURES = 3
/** The whole run stops cleanly after this long. */
export const REVIEW_MAX_RUN_MS = 10 * 60 * 1000

/** Largest single relay message accepted (an event is limited to far less by every relay). */
const MAX_MESSAGE_BYTES = 256 * 1024
/** A relay that sends more than this for one REQ is ignored past the cap (a compliant one stops at `limit`). */
const MAX_EVENTS_PER_QUERY = REVIEW_REQ_LIMIT * 2

/** CLOSED / NOTICE text that means "stop asking this relay for now". */
const PUSHBACK_PATTERN = /rate-?limit|too many|blocked/i

export interface ReviewFilter {
  kinds: number[]
  '#u': string[]
  limit: number
  since?: number
}

export type RelayQueryResult =
  | { status: 'ok'; events: NostrEvent[] }
  /** Rate limit, block, or the relay closed the connection: skip this relay for the rest of the run. */
  | { status: 'blocked'; reason: string }
  | { status: 'failed'; reason: string }

export interface RelayConnection {
  /** Never rejects. */
  query(filter: ReviewFilter, timeoutMs: number): Promise<RelayQueryResult>
  close(): void
}

/** Rejects when the relay cannot be reached within the timeout. */
export type ConnectRelay = (url: string, timeoutMs: number) => Promise<RelayConnection>

function isWellFormedEvent(e: unknown): e is NostrEvent {
  if (typeof e !== 'object' || e === null) return false
  const o = e as Record<string, unknown>
  return typeof o['id'] === 'string' && typeof o['pubkey'] === 'string' && typeof o['sig'] === 'string' &&
    typeof o['content'] === 'string' && typeof o['kind'] === 'number' && typeof o['created_at'] === 'number' &&
    Array.isArray(o['tags']) && (o['tags'] as unknown[]).every(t => Array.isArray(t) && t.every(x => typeof x === 'string'))
}

function rawToString(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

export const connectRelayWs: ConnectRelay = (url, timeoutMs) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url, {
    handshakeTimeout: timeoutMs,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
    followRedirects: false,
  })
  let opened = false
  let closed = false
  let pushback = false
  let seq = 0
  let active: { subId: string; events: NostrEvent[]; timer: NodeJS.Timeout; resolve: (r: RelayQueryResult) => void } | null = null

  const settle = (result: RelayQueryResult): void => {
    const a = active
    if (!a) return
    active = null
    clearTimeout(a.timer)
    if (!closed && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(['CLOSE', a.subId])) } catch { /* socket went away */ }
    }
    a.resolve(result)
  }

  ws.on('error', () => {
    if (!opened) reject(new Error('connect'))
    else settle({ status: 'failed', reason: 'socket-error' })
  })
  ws.on('close', () => {
    closed = true
    if (!opened) reject(new Error('connect'))
    else settle({ status: 'blocked', reason: 'closed-after-req' })
  })
  ws.on('message', (data: WebSocket.RawData) => {
    let msg: unknown
    try { msg = JSON.parse(rawToString(data)) } catch { return }
    if (!Array.isArray(msg)) return
    const [type, a1, a2] = msg as unknown[]
    if (type === 'NOTICE') {
      if (typeof a1 === 'string' && PUSHBACK_PATTERN.test(a1)) {
        pushback = true
        settle({ status: 'blocked', reason: 'notice-pushback' })
      }
      return
    }
    if (!active || a1 !== active.subId) return
    if (type === 'EVENT') {
      if (active.events.length < MAX_EVENTS_PER_QUERY && isWellFormedEvent(a2)) active.events.push(a2)
    } else if (type === 'EOSE') {
      settle({ status: 'ok', events: active.events })
    } else if (type === 'CLOSED') {
      settle(typeof a2 === 'string' && PUSHBACK_PATTERN.test(a2)
        ? { status: 'blocked', reason: 'closed-pushback' }
        : { status: 'failed', reason: 'closed-other' })
    }
  })
  ws.on('open', () => {
    opened = true
    resolve({
      query(filter, queryTimeoutMs) {
        if (closed) return Promise.resolve({ status: 'blocked', reason: 'closed-after-req' })
        if (pushback) return Promise.resolve({ status: 'blocked', reason: 'notice-pushback' })
        if (active) return Promise.resolve({ status: 'failed', reason: 'busy' })
        return new Promise<RelayQueryResult>(res => {
          const subId = `rs${++seq}`
          const timer = setTimeout(() => settle({ status: 'failed', reason: 'timeout' }), queryTimeoutMs)
          active = { subId, events: [], timer, resolve: res }
          try {
            ws.send(JSON.stringify(['REQ', subId, filter]))
          } catch {
            settle({ status: 'failed', reason: 'socket-error' })
          }
        })
      },
      close() {
        closed = true
        try { ws.close() } catch { /* already closing */ }
        setTimeout(() => { try { ws.terminate() } catch { /* gone */ } }, 2_000).unref()
      },
    })
  })
})

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ── Incremental plan ──────────────────────────────────────────────────────────────────────

/** Seconds. Hourly runs ask for events newer than (last clean run start − this): relays may store an event late. */
export const REVIEW_SINCE_OVERLAP_S = 2 * 60 * 60
/** A run without `since` (full sweep) per relay about once a day. */
export const REVIEW_FULL_SWEEP_INTERVAL_S = 24 * 60 * 60
/** The hourly tick drifts by the start offset and up to 5 min of jitter; without slack a "24 h" sweep would slip to ~25 h. */
export const REVIEW_FULL_SWEEP_SLACK_S = 10 * 60

export interface RelaySyncState {
  /** Start (unix s) of the last run that finished cleanly on this relay. */
  lastOkStartedAt: number
  /** Start (unix s) of the last clean run on this relay that had no `since`; null if none. */
  lastFullAt: number | null
}

export interface RelayPlan {
  /** Absent on a full sweep. */
  since: number | undefined
  full: boolean
}

/**
 * First run (no state) and a missing sweep time → full. A full sweep is due once the last one is ~24 h old.
 * Otherwise incremental from the last clean start minus the overlap. State only advances on a clean run, so
 * after a failure the next run simply reaches further back.
 */
export function planRelayQuery(state: RelaySyncState | undefined, nowSec: number): RelayPlan {
  if (!state || state.lastFullAt === null) return { since: undefined, full: true }
  if (nowSec - state.lastFullAt >= REVIEW_FULL_SWEEP_INTERVAL_S - REVIEW_FULL_SWEEP_SLACK_S) {
    return { since: undefined, full: true }
  }
  return { since: Math.max(0, Math.floor(state.lastOkStartedAt - REVIEW_SINCE_OVERLAP_S)), full: false }
}

// ── Grouping ──────────────────────────────────────────────────────────────────────────────

/**
 * Assigns kind:38000 events to the mints named by their `u` tags (exact string match, same as the relay's
 * `#u` filter and the old per-mint query). An event naming several tracked mints belongs to each of them.
 */
export function groupEventsByMint(events: readonly NostrEvent[], mintUrls: ReadonlySet<string>): Map<string, NostrEvent[]> {
  const out = new Map<string, NostrEvent[]>()
  for (const e of events) {
    if (e.kind !== 38000) continue
    const owners = new Set<string>()
    for (const t of e.tags) {
      if (t[0] === 'u' && t[1] !== undefined && mintUrls.has(t[1])) owners.add(t[1])
    }
    for (const url of owners) {
      const list = out.get(url)
      if (list) list.push(e); else out.set(url, [e])
    }
  }
  return out
}

// ── One relay, one run ────────────────────────────────────────────────────────────────────

export interface RelayRunOptions {
  batchSize: number
  limit: number
  connectTimeoutMs: number
  queryTimeoutMs: number
  pacingMinMs: number
  pacingMaxMs: number
  maxConsecutiveFailures: number
  /** Absolute time (ms, same clock as `now`) when the run must stop. */
  deadlineMs: number
  now: () => number
  sleep: (ms: number) => Promise<void>
  random: () => number
}

export interface RelayRunResult {
  relay: string
  /** ok: every batch answered. skipped: back-off. failed: connect failure or a batch failed. deadline: run time ran out. */
  outcome: 'ok' | 'failed' | 'skipped' | 'deadline'
  reason: string | null
  reqs: number
  eventsReceived: number
  events: NostrEvent[]
  /** Mints whose batch this relay answered with EOSE. */
  covered: Set<string>
}

export async function fetchRelayReviews(
  relay: string,
  connect: ConnectRelay,
  mintUrls: readonly string[],
  since: number | undefined,
  opts: RelayRunOptions,
): Promise<RelayRunResult> {
  const result: RelayRunResult = { relay, outcome: 'ok', reason: null, reqs: 0, eventsReceived: 0, events: [], covered: new Set() }
  if (mintUrls.length === 0) return result
  if (opts.now() >= opts.deadlineMs) return { ...result, outcome: 'deadline', reason: 'deadline' }

  let conn: RelayConnection
  try {
    conn = await connect(relay, opts.connectTimeoutMs)
  } catch {
    return { ...result, outcome: 'failed', reason: 'connect' }
  }

  try {
    const queue = chunk(mintUrls, opts.batchSize)
    let consecutiveFailures = 0
    let anyBatchFailed = false
    let firstBatch = true
    while (queue.length > 0) {
      if (!firstBatch) {
        await opts.sleep(opts.pacingMinMs + opts.random() * (opts.pacingMaxMs - opts.pacingMinMs))
      }
      firstBatch = false
      const remaining = opts.deadlineMs - opts.now()
      if (remaining <= 0) {
        result.outcome = 'deadline'
        result.reason = 'deadline'
        return result
      }
      const batch = queue.shift() as string[]
      const filter: ReviewFilter = { kinds: [38000], '#u': batch, limit: opts.limit }
      if (since !== undefined) filter.since = since
      result.reqs++
      const res = await conn.query(filter, Math.min(opts.queryTimeoutMs, remaining))
      if (res.status === 'ok') {
        consecutiveFailures = 0
        result.eventsReceived += res.events.length
        result.events.push(...res.events)
        if (res.events.length >= opts.limit && batch.length > 1) {
          // The relay hit `limit`: the oldest events of the busiest mints may be cut off. Ask again in halves.
          const mid = Math.ceil(batch.length / 2)
          queue.unshift(batch.slice(0, mid), batch.slice(mid))
        } else {
          for (const url of batch) result.covered.add(url)
        }
      } else if (res.status === 'blocked') {
        result.outcome = 'skipped'
        result.reason = res.reason
        return result
      } else {
        anyBatchFailed = true
        consecutiveFailures++
        if (consecutiveFailures >= opts.maxConsecutiveFailures) {
          result.outcome = 'skipped'
          result.reason = `${consecutiveFailures}-failures-in-a-row`
          return result
        }
        result.reason = res.reason
      }
    }
    if (anyBatchFailed) result.outcome = 'failed'
    return result
  } finally {
    conn.close()
  }
}
