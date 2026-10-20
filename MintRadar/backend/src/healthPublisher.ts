// Publisher of the signed mint health assertions (healthAssertions.ts has the pure part). DORMANT: startAttestations()
// registers no timer, opens no connection and writes nothing to the database unless ATTESTATION_SERVICE_NSEC is set
// and belongs to ATTESTATION_PUBKEY_HEX. Design, constants and the activation steps: docs/claude/nostr-health-assertions.md.
//
// One timer tick (every 15 minutes with jitter, single-flight) reads the stored values (the shared known-mints snapshot,
// which is ONE database read cached for 60 s, plus the small attestation_state table), decides with shouldPublish() and
// publishes at most ATTESTATION_MAX_EVENTS_PER_RUN events to the four ATTESTATION_RELAYS. It never probes a mint.

import { finalizeEvent } from 'nostr-tools'
import type { Event as NostrEvent, EventTemplate } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import { pool as db } from './db.js'
// nostrService.ts installs the DNS-pinned WebSocket for every nostr-tools relay connection of the backend (importing it
// is what makes the pool below use it) and owns the existing publish helper used for the profile.
import { publishToRelays, META_RELAYS } from './nostrService.js'
import { toWalletMint, type KnownMintLike, type Snapshot, type WalletExtra, type WalletMint } from './walletApi.js'
import { METHODOLOGY_VERSION } from './shared/methodology.js'
import {
  ATTESTATION_MAX_EVENTS_PER_RUN, ATTESTATION_RELAYS, ATTESTATION_STATE_CHANGE_MAX_PER_HOUR, buildHealthEvent,
  buildProfileTemplate, healthIdentifier, publishReason, resolveAttestationKey,
  type HealthInput, type KeyLog, type PublishCandidate, type PublishedState, type PublishReason,
} from './healthAssertions.js'

export const ATTESTATION_RELAY_PAUSE_MS = 200
export const ATTESTATION_RELAY_TIMEOUT_MS = 5_000
export const ATTESTATION_RELAY_MAX_FAILURES = 3
export const ATTESTATION_TICK_MS = 15 * 60 * 1000
export const ATTESTATION_TICK_JITTER_MAX_MS = 60 * 1000
export const ATTESTATION_START_OFFSET_MS = 90 * 1000
export const ATTESTATION_PROFILE_REFRESH_MS = 24 * 60 * 60 * 1000
/** The own relay is added to the profile relays of the service profile (nostrService.ts META_RELAYS). */
export const ATTESTATION_PROFILE_RELAYS: readonly string[] = [...new Set<string>(['wss://nostr.mintradar.org', ...META_RELAYS])]

// ── Planning (pure) ──────────────────────────────────────────────────────────

export interface DueItem {
  /** The mint's `d` tag (normalised URL): the key of attestation_state. */
  d: string
  event: NostrEvent
  candidate: PublishCandidate
  /** Why it is published; only 'state-change' counts against the hourly cap. Absent in tests that build items by hand. */
  reason?: PublishReason
}

export function inputFromWalletMint(w: WalletMint, now: number): HealthInput {
  return {
    url: w.url,
    status: w.status,
    score: w.score,
    uptime24hPct: w.uptime24hPct,
    uptime7dPct: w.uptime7dPct,
    software: w.software,
    outdated: w.outdated,
    isTest: w.isTest,
    scoreCappedNew: w.scoreCappedNew,
    audit: w.audit,
    lastCheckedAt: w.lastCheckedAt,
    probes24h: w.sample.probes24h,
    downSince: w.downSince,
    keysets: w.keysets,
    keysetsCheckedAt: w.keysetsCheckedAt,
    lastChangeAt: w.changes[0]?.observedAt ?? null,
    now,
  }
}

export interface Plan {
  /** Mints that get an event at all (stored score, not archived). */
  eligible: number
  /** Due events: state changes first, then never-published first and the oldest; at most `limit`. */
  due: Array<{ d: string; template: EventTemplate; candidate: PublishCandidate; reason: PublishReason }>
  /** Due events that did not fit into this run (they stay due for the next one). */
  deferred: number
  /** Of `due`, the state-change events (what the hourly cap counts). */
  stateChanges: number
}

export interface PlanOptions {
  limit?: number
  /** How many state-change events this run may still publish (the hourly cap minus those of the last hour). */
  stateChangeBudget?: number
  /** probes24h, downSince and keysets by mint URL (Snapshot.walletExtra). */
  extras?: ReadonlyMap<string, WalletExtra>
}

/**
 * Which mints publish now. Pure: the snapshot rows, the stored states and the clock go in. A state change beyond
 * `stateChangeBudget` is not planned and counts as deferred: nothing is stored for it, so it is still a state change
 * (and due) at the next run.
 */
export function planCycle(
  rows: KnownMintLike[],
  states: ReadonlyMap<string, PublishedState>,
  nowMs: number,
  opts: PlanOptions = {},
): Plan {
  const limit = opts.limit ?? ATTESTATION_MAX_EVENTS_PER_RUN
  const budget = Math.max(0, opts.stateChangeBudget ?? ATTESTATION_STATE_CHANGE_MAX_PER_HOUR)
  const seen = new Set<string>()
  const changes: Plan['due'] = []
  const others: Plan['due'] = []
  let eligible = 0
  for (const row of rows) {
    const template = buildHealthEvent(inputFromWalletMint(toWalletMint(row, nowMs, undefined, opts.extras?.get(row.url)), nowMs))
    if (template === null) continue
    const d = healthIdentifier(row.url)
    if (d === null || seen.has(d)) continue
    seen.add(d)
    eligible++
    const rankTag = template.tags.find(t => t[0] === 'rank')?.[1]
    const statusTag = template.tags.find(t => t[0] === 'mint_status')?.[1]
    const candidate: PublishCandidate = { rank: Number(rankTag), status: statusTag ?? '', methodology: METHODOLOGY_VERSION }
    const reason = publishReason(states.get(d), candidate, nowMs)
    if (reason === null) continue
    ;(reason === 'state-change' ? changes : others).push({ d, template, candidate, reason })
  }
  const oldestFirst = (a: Plan['due'][number], b: Plan['due'][number]): number => {
    const pa = states.get(a.d)?.lastCreatedAt ?? -1
    const pb = states.get(b.d)?.lastCreatedAt ?? -1
    return pa - pb || (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)
  }
  changes.sort(oldestFirst)
  others.sort(oldestFirst)
  const allowedChanges = changes.slice(0, budget)
  const all = [...allowedChanges, ...others]
  const due = all.slice(0, limit)
  return {
    eligible, due,
    deferred: (changes.length - allowedChanges.length) + Math.max(0, all.length - limit),
    stateChanges: due.filter(p => p.reason === 'state-change').length,
  }
}

// ── State table ──────────────────────────────────────────────────────────────

export async function loadAttestationStates(): Promise<Map<string, PublishedState>> {
  const res = await db.query(
    'SELECT mint_url, last_created_at, last_rank, last_status, last_methodology FROM attestation_state',
  )
  const map = new Map<string, PublishedState>()
  for (const r of res.rows as Array<Record<string, unknown>>) {
    const lastCreatedAt = Number(r['last_created_at'])
    const lastRank = Number(r['last_rank'])
    const lastMethodology = Number(r['last_methodology'])
    // A row with a missing value counts as never published.
    if (typeof r['mint_url'] !== 'string' || typeof r['last_status'] !== 'string') continue
    if (r['last_created_at'] == null || r['last_rank'] == null || r['last_methodology'] == null) continue
    if (![lastCreatedAt, lastRank, lastMethodology].every(Number.isFinite)) continue
    map.set(r['mint_url'], { lastCreatedAt, lastRank, lastStatus: r['last_status'], lastMethodology })
  }
  return map
}

export async function saveAttestationState(d: string, event: NostrEvent, c: PublishCandidate): Promise<void> {
  await db.query(
    `INSERT INTO attestation_state (mint_url, last_event_id, last_created_at, last_rank, last_status, last_methodology)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (mint_url) DO UPDATE SET
       last_event_id = EXCLUDED.last_event_id, last_created_at = EXCLUDED.last_created_at,
       last_rank = EXCLUDED.last_rank, last_status = EXCLUDED.last_status, last_methodology = EXCLUDED.last_methodology`,
    [d, event.id, event.created_at, c.rank, c.status, c.methodology],
  )
}

// ── Relay publishing ─────────────────────────────────────────────────────────

/** Publishes ONE event to ONE relay; rejects when the relay refuses, errors or does not answer in `timeoutMs`. */
export interface RelayPublisher {
  publish(relay: string, event: NostrEvent, timeoutMs: number): Promise<void>
  close(): void
}

/** The default publisher: one short-lived SimplePool per run (connections are reused within the run, then destroyed). */
export function createPoolPublisher(): RelayPublisher {
  const pool = new SimplePool()
  return {
    async publish(relay, event, timeoutMs) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs) })
      try {
        const [pub] = pool.publish([relay], event, { maxWait: timeoutMs })
        if (!pub) throw new Error('no publish')
        pub.catch(() => { /* a late rejection after the timeout won the race must not become unhandled */ })
        await Promise.race([pub, timeout])
      } finally {
        if (timer) clearTimeout(timer)
      }
    },
    close() { pool.destroy() },
  }
}

export interface RelayStats { ok: number; failed: number; skipped: number }
export interface BatchStats { accepted: number; relays: Record<string, RelayStats> }

export interface BatchDeps {
  publisher: RelayPublisher
  /** Called once per event, as soon as the first relay accepted it (the state row is written here). */
  onAccepted: (item: DueItem) => Promise<void>
  relays?: readonly string[]
  sleep?: (ms: number) => Promise<void>
  pauseMs?: number
  timeoutMs?: number
  maxFailures?: number
}

const realSleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })

/**
 * Every relay gets the events one after another with a pause between them (the relays work in parallel with each
 * other). After `maxFailures` failures in a row a relay is skipped for the rest of the run. An event counts as accepted
 * when at least one relay accepted it.
 */
export async function publishBatch(items: DueItem[], deps: BatchDeps): Promise<BatchStats> {
  const relays = deps.relays ?? ATTESTATION_RELAYS
  const sleep = deps.sleep ?? realSleep
  const pauseMs = deps.pauseMs ?? ATTESTATION_RELAY_PAUSE_MS
  const timeoutMs = deps.timeoutMs ?? ATTESTATION_RELAY_TIMEOUT_MS
  const maxFailures = deps.maxFailures ?? ATTESTATION_RELAY_MAX_FAILURES
  const accepted = new Set<string>()
  const stats: Record<string, RelayStats> = {}

  await Promise.all(relays.map(async relay => {
    const s: RelayStats = { ok: 0, failed: 0, skipped: 0 }
    stats[relay] = s
    let streak = 0
    for (let i = 0; i < items.length; i++) {
      if (streak >= maxFailures) { s.skipped = items.length - i; break }
      if (i > 0) await sleep(pauseMs)
      const item = items[i] as DueItem
      try {
        await deps.publisher.publish(relay, item.event, timeoutMs)
      } catch {
        s.failed++
        streak++
        continue
      }
      s.ok++
      streak = 0
      if (!accepted.has(item.event.id)) {
        accepted.add(item.event.id)
        try { await deps.onAccepted(item) } catch { /* the state row is retried by the next run: the mint is still due */ }
      }
    }
  }))
  return { accepted: accepted.size, relays: stats }
}

// ── One run ──────────────────────────────────────────────────────────────────

export interface CycleDeps {
  secretKey: Uint8Array
  loadSnapshot: () => Promise<Snapshot>
  loadStates?: () => Promise<Map<string, PublishedState>>
  saveState?: (d: string, event: NostrEvent, c: PublishCandidate) => Promise<void>
  publisher?: RelayPublisher
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Test hook: the log of state-change publication times (ms) the hourly cap counts; default: one per process. */
  stateChangeLog?: number[]
  /** Test hooks only; production always uses ATTESTATION_RELAYS and the constants above. */
  relays?: readonly string[]
  timeoutMs?: number
  pauseMs?: number
  log?: (line: string) => void
}

export interface CycleResult { eligible: number; due: number; deferred: number; accepted: number; relays: Record<string, RelayStats> }

/** When this process planned its state-change events (ms). In memory on purpose: a restart can allow one more cap's worth
 *  at most, never a republish of everything (attestation_state is persistent). Pruned to the last hour on every run. */
const stateChangeLog: number[] = []
const HOUR_MS = 3_600_000

function stateChangeBudget(log: number[], nowMs: number): number {
  while (log.length > 0 && (log[0] as number) <= nowMs - HOUR_MS) log.shift()
  return Math.max(0, ATTESTATION_STATE_CHANGE_MAX_PER_HOUR - log.length)
}

export async function runAttestationCycle(deps: CycleDeps): Promise<CycleResult> {
  const log = deps.log ?? ((line: string) => console.log(line))
  const now = (deps.now ?? Date.now)()
  const snapshot = await deps.loadSnapshot()
  const states = await (deps.loadStates ?? loadAttestationStates)()
  const changeLog = deps.stateChangeLog ?? stateChangeLog
  const plan = planCycle(snapshot.data as KnownMintLike[], states, now, {
    stateChangeBudget: stateChangeBudget(changeLog, now),
    ...(snapshot.walletExtra ? { extras: snapshot.walletExtra } : {}),
  })
  if (plan.due.length === 0) {
    log(`[attestations] run: ${plan.eligible} eligible, nothing due${plan.deferred > 0 ? ` (${plan.deferred} deferred)` : ''}`)
    return { eligible: plan.eligible, due: 0, deferred: plan.deferred, accepted: 0, relays: {} }
  }
  const items: DueItem[] = plan.due.map(p => ({ d: p.d, candidate: p.candidate, reason: p.reason, event: finalizeEvent(p.template, deps.secretKey) }))
  // Counted when planned, not when accepted: a relay that refuses must not get the same events again without limit.
  for (let i = 0; i < plan.stateChanges; i++) changeLog.push(now)
  const saveState = deps.saveState ?? saveAttestationState
  const publisher = deps.publisher ?? createPoolPublisher()
  try {
    const batchDeps: BatchDeps = {
      publisher,
      onAccepted: item => saveState(item.d, item.event, item.candidate),
    }
    if (deps.sleep) batchDeps.sleep = deps.sleep
    if (deps.relays) batchDeps.relays = deps.relays
    if (deps.timeoutMs !== undefined) batchDeps.timeoutMs = deps.timeoutMs
    if (deps.pauseMs !== undefined) batchDeps.pauseMs = deps.pauseMs
    const stats = await publishBatch(items, batchDeps)
    const perRelay = Object.entries(stats.relays)
      .map(([url, s]) => `${url.replace(/^wss?:\/\//, '')} ok=${s.ok} failed=${s.failed} skipped=${s.skipped}`)
      .join('; ')
    log(`[attestations] run: ${plan.eligible} eligible, ${items.length} due (${plan.deferred} deferred), ${stats.accepted} accepted by at least one relay; ${perRelay}`)
    return { eligible: plan.eligible, due: items.length, deferred: plan.deferred, accepted: stats.accepted, relays: stats.relays }
  } finally {
    publisher.close()
  }
}

/** The kind 0 profile of the attestation key to the own relay and the service-profile relays. Counts only in the log. */
export async function publishAttestationProfile(
  secretKey: Uint8Array,
  nowMs: number = Date.now(),
  publish: typeof publishToRelays = publishToRelays,
  log: (line: string) => void = line => console.log(line),
): Promise<void> {
  try {
    const event = finalizeEvent(buildProfileTemplate(nowMs), secretKey)
    const { succeeded, failed } = await publish([...ATTESTATION_PROFILE_RELAYS], event)
    log(`[attestations] published kind:0 profile (${succeeded} succeeded, ${failed} failed)`)
  } catch (err) {
    console.error('[attestations] kind:0 profile publish error:', err instanceof Error ? err.message : 'unknown error')
  }
}

// ── Timer ────────────────────────────────────────────────────────────────────

export interface TimerDeps {
  tick: () => Promise<unknown>
  random?: () => number
  log?: (line: string) => void
}

/** Every ATTESTATION_TICK_MS plus its own random jitter; a tick that finds the previous one still running is skipped. */
export function startAttestationTimer(deps: TimerDeps): { stop: () => void } {
  const random = deps.random ?? Math.random
  const log = deps.log ?? ((line: string) => console.log(line))
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let running = false
  let lastJitter = 0
  const nextJitter = (): number => Math.floor(random() * ATTESTATION_TICK_JITTER_MAX_MS)

  const schedule = (delayMs: number): void => {
    timer = setTimeout(() => {
      if (stopped) return
      const jitter = nextJitter()
      schedule(ATTESTATION_TICK_MS - lastJitter + jitter)
      lastJitter = jitter
      if (running) { log('[attestations] previous run still going — skipping this tick'); return }
      running = true
      deps.tick()
        .catch(err => { console.error('[attestations] scheduled run error:', err instanceof Error ? err.message : 'unknown error') })
        .finally(() => { running = false })
    }, delayMs)
    timer.unref?.()
  }

  lastJitter = nextJitter()
  schedule(ATTESTATION_START_OFFSET_MS + lastJitter)
  return { stop() { stopped = true; if (timer) clearTimeout(timer) } }
}

// ── Start (the dormant switch) ───────────────────────────────────────────────

export interface StartDeps {
  loadSnapshot: () => Promise<Snapshot>
  isAllowlistMode?: () => boolean
  env?: Record<string, string | undefined>
  /** Tests only: the public key the configured key must belong to (production: ATTESTATION_PUBKEY_HEX). */
  expectedPubkey?: string
  log?: KeyLog
  /** Tests only. */
  cycle?: Omit<CycleDeps, 'secretKey' | 'loadSnapshot'>
  publishProfile?: typeof publishToRelays
  random?: () => number
}

/**
 * Reads ATTESTATION_SERVICE_NSEC once. Without a valid key of the right identity this returns null after ONE log line:
 * no timer, no network, no database access. With one it publishes the profile now, then runs the 15-minute timer
 * (profile again once a day).
 */
export function startAttestations(deps: StartDeps): { stop: () => void } | null {
  const env = deps.env ?? process.env
  const secretKey = resolveAttestationKey(env['ATTESTATION_SERVICE_NSEC'], deps.expectedPubkey, deps.log)
  if (!secretKey) return null
  const log = deps.log?.info ?? ((line: string) => console.log(line))
  if (deps.isAllowlistMode?.()) {
    secretKey.fill(0)
    log('[attestations] disabled: allowlist mode makes no relay traffic')
    return null
  }
  log('[attestations] enabled: signing key loaded, publishing health assertions')

  let lastProfileAt = Date.now()
  void publishAttestationProfile(secretKey, lastProfileAt, deps.publishProfile, log)

  const timerDeps: TimerDeps = {
    log,
    tick: async () => {
      const now = Date.now()
      if (now - lastProfileAt >= ATTESTATION_PROFILE_REFRESH_MS) {
        lastProfileAt = now
        await publishAttestationProfile(secretKey, now, deps.publishProfile, log)
      }
      await runAttestationCycle({ ...deps.cycle, secretKey, loadSnapshot: deps.loadSnapshot, log })
    },
  }
  if (deps.random) timerDeps.random = deps.random
  const timer = startAttestationTimer(timerDeps)
  return { stop() { timer.stop(); secretKey.fill(0) } }
}
