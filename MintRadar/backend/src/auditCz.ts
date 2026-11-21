// cashu.info (Cashu Mints Auditor, formerly audit.cashu.cz) — second, public audit source. This file (the mint
// list and the swap feed) is display only; the audit part of the Reliability Score reads two numbers of the per-mint
// detail via mints.audit_cz_* (auditCzDetail.ts, shared/auditScore.ts), never the audit_cz_* tables themselves at
// probe time. Two server-side GETs every 10 minutes
// (cron.ts); the visitor's browser never contacts cashu.info.
//
// Failure policy: any failure (timeout, HTTP error, oversize, bad JSON, bad
// top-level shape) writes and deletes nothing — the previous rows stay as they
// were. Single malformed items are skipped. Writes are upserts, one transaction
// per response.
import { pool } from './db.js'
import { normalizeUrl } from './discovery.js'
import { publicMintName } from './mintNames.js'
import { safeFetch, readJsonLimited, RESPONSE_CAPS } from './ssrf.js'
import { sumLongWindow, utcDay, LONG_STEP_DAYS, LONG_MAX_ROWS, type StoredAuditCzDetail, type AuditCzDetailResponse, type DailyRow } from './auditCzDetail.js'

// Historical identifier (the service was audit.cashu.cz): stays as the stored `source` column value.
export const AUDIT_CZ_SOURCE = 'audit.cashu.cz'
/** The `source` /api/mints/audit-cz answers since 2026-10-25: the service's current name (the stored column keeps AUDIT_CZ_SOURCE). */
export const AUDIT_CZ_API_SOURCE = 'cashu.info'
/** The one place that names the source host; every URL below is built from it. */
export const AUDIT_CZ_BASE_URL = 'https://cashu.info'
const AUDIT_CZ_MINTS_URL = `${AUDIT_CZ_BASE_URL}/api/v1/mints`
// 500 is the API's maximum (~21 h of the global feed); 100 covered only ~4 h and missed quieter mints.
const AUDIT_CZ_SWAPS_URL = `${AUDIT_CZ_BASE_URL}/api/v1/swaps?limit=500`
/** A mint id of the source: the only part of a page URL we ever trust. */
export const AUDIT_CZ_ID_RE = /^[A-Za-z0-9]{8,64}$/
/** The page of a mint, always BUILT from a validated id, never copied from the feed. */
export function auditCzPageUrl(id: string): string | null {
  return AUDIT_CZ_ID_RE.test(id) ? `${AUDIT_CZ_BASE_URL}/mint/${id}` : null
}
const FETCH_TIMEOUT_MS = 15_000
const MAX_URL_LEN = 500
const MAX_ERROR_LEN = 300
const MAX_NAME_LEN = 100
const MAX_ALIASES = 20
const SWAP_RETENTION_DAYS = 14
const SWAP_MAX_ROWS = 20_000

const STATS_WINDOW_DAYS = 7

export const AUDIT_CZ_MINT_STATES = ['ok', 'warn', 'error'] as const
// `stage` and `status` are open-ended on their side (the live feed also sends e.g. stage
// "limits"), so any short lowercase token is accepted; anything else skips the item. The
// frontend styles success/failed/pending and shows any other status as a neutral badge.
const TOKEN_RE = /^[a-z][a-z_-]{0,29}$/

/** Matching key: the shared normalizeUrl plus a stripped trailing slash on both sides of any comparison. */
export function auditCzKey(raw: string): string {
  return normalizeUrl(raw).replace(/\/+$/, '')
}

export interface AuditCzMint {
  url: string
  aliases: string[]
  state: string
  uptime24h: number | null
  uptime7d: number | null
  uptime30d: number | null
  attributedFailures: number | null
  minted: number | null
  melted: number | null
  lastCheck: string | null
  page: string | null
}

export interface AuditCzSwap {
  id: string
  at: string
  status: string
  stage: string | null
  error: string | null
  amount: number | null
  fee: number | null
  durationMs: number | null
  fromUrl: string | null
  toUrl: string | null
  fromName: string | null
  toName: string | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

// undefined/null → null; finite number → number; anything else → INVALID.
const INVALID = Symbol('invalid')
function numOrNull(v: unknown): number | null | typeof INVALID {
  if (v === undefined || v === null) return null
  return typeof v === 'number' && Number.isFinite(v) ? v : INVALID
}

function httpsUrlKey(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t.startsWith('https://') || t.length > MAX_URL_LEN) return null
  try { new URL(t) } catch { return null }
  return auditCzKey(t)
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function pageFromFeedId(v: unknown): string | null {
  return typeof v === 'string' ? auditCzPageUrl(v) : null
}

export function parseAuditCzMint(raw: unknown): AuditCzMint | null {
  if (!isObj(raw)) return null
  const url = httpsUrlKey(raw['url'])
  if (!url) return null
  const state = raw['state']
  if (typeof state !== 'string' || !(AUDIT_CZ_MINT_STATES as readonly string[]).includes(state)) return null
  const u24 = numOrNull(raw['uptime24h'])
  const u7 = numOrNull(raw['uptime7d'])
  const u30 = numOrNull(raw['uptime30d'])
  if (u24 === INVALID || u7 === INVALID || u30 === INVALID) return null
  let attributed: number | null = null
  let minted: number | null = null
  let melted: number | null = null
  const swaps = raw['swaps']
  if (isObj(swaps)) {
    const a = numOrNull(swaps['attributedFailures'])
    const mi = numOrNull(swaps['minted'])
    const me = numOrNull(swaps['melted'])
    if (a === INVALID || mi === INVALID || me === INVALID) return null
    attributed = a === null ? null : Math.round(a)
    minted = mi === null ? null : Math.round(mi)
    melted = me === null ? null : Math.round(me)
  }
  const aliases: string[] = []
  if (Array.isArray(raw['aliases'])) {
    for (const a of raw['aliases'].slice(0, MAX_ALIASES)) {
      const k = httpsUrlKey(a)
      if (k && k !== url && !aliases.includes(k)) aliases.push(k)
    }
  }
  return {
    url, aliases, state,
    uptime24h: u24, uptime7d: u7, uptime30d: u30,
    attributedFailures: attributed,
    minted,
    melted,
    lastCheck: isoOrNull(raw['lastCheck']),
    page: pageFromFeedId(raw['id']),
  }
}

function endpoint(v: unknown): { url: string | null; name: string | null } {
  if (!isObj(v)) return { url: null, name: null }
  const name = typeof v['name'] === 'string' ? v['name'].slice(0, MAX_NAME_LEN) : null
  return { url: httpsUrlKey(v['url']), name }
}

export function parseAuditCzSwap(raw: unknown): AuditCzSwap | null {
  if (!isObj(raw)) return null
  const rawId = raw['id']
  const id = typeof rawId === 'string' ? rawId : typeof rawId === 'number' && Number.isFinite(rawId) ? String(rawId) : null
  if (!id || id.length > 100) return null
  const at = isoOrNull(raw['at'])
  if (!at) return null
  const status = raw['status']
  if (typeof status !== 'string' || !TOKEN_RE.test(status)) return null
  const stageRaw = raw['stage']
  if (stageRaw !== null && stageRaw !== undefined && !(typeof stageRaw === 'string' && TOKEN_RE.test(stageRaw))) return null
  const amount = numOrNull(raw['amount'])
  const fee = numOrNull(raw['fee'])
  const dur = numOrNull(raw['durationMs'])
  if (amount === INVALID || fee === INVALID || dur === INVALID) return null
  const from = endpoint(raw['from'])
  const to = endpoint(raw['to'])
  return {
    id, at, status,
    stage: typeof stageRaw === 'string' ? stageRaw : null,
    error: typeof raw['error'] === 'string' ? raw['error'].slice(0, MAX_ERROR_LEN) : null,
    amount, fee, durationMs: dur,
    fromUrl: from.url, toUrl: to.url, fromName: from.name, toName: to.name,
  }
}

export interface ParsedFeed<T> { items: T[]; fetched: number; skipped: number }

/** null = the whole response is unusable (nothing may be written). `skipped` counts malformed/unknown items. */
export function parseAuditCzMintsResponse(data: unknown): ParsedFeed<AuditCzMint> | null {
  if (!isObj(data) || !Array.isArray(data['mints'])) return null
  const items: AuditCzMint[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const item of data['mints']) {
    const m = parseAuditCzMint(item)
    if (!m) { skipped++; continue }
    if (!seen.has(m.url)) { seen.add(m.url); items.push(m) }
  }
  return { items, fetched: data['mints'].length, skipped }
}

export function parseAuditCzSwapsResponse(data: unknown): ParsedFeed<AuditCzSwap> | null {
  if (!isObj(data) || !Array.isArray(data['swaps'])) return null
  const items: AuditCzSwap[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const item of data['swaps']) {
    const sw = parseAuditCzSwap(item)
    if (!sw) { skipped++; continue }
    if (!seen.has(sw.id)) { seen.add(sw.id); items.push(sw) }
  }
  return { items, fetched: data['swaps'].length, skipped }
}

export interface AuditCzSyncStatus {
  lastSyncAt: string | null
  mintsStored: number | null
  swapsStored: number | null
  skipped: { mints: number; swaps: number } | null
}
let lastCycle: AuditCzSyncStatus = { lastSyncAt: null, mintsStored: null, swapsStored: null, skipped: null }

/** Counts of the last sync cycle (in memory; null until the first cycle after a restart). */
export function getAuditCzSyncStatus(): AuditCzSyncStatus {
  return { ...lastCycle, skipped: lastCycle.skipped ? { ...lastCycle.skipped } : null }
}

export type AuditCzSourceStatus = 'ok' | 'partial' | 'down' | 'unknown'

/**
 * One word for the last sync cycle, for /health `sources.cashuInfo.status`: `unknown` before the first cycle after a
 * restart, `ok` when both responses were stored, `partial` when only one was, `down` when neither was.
 */
export function auditCzSourceStatus(s: AuditCzSyncStatus): AuditCzSourceStatus {
  if (s.lastSyncAt === null) return 'unknown'
  if (s.mintsStored !== null && s.swapsStored !== null) return 'ok'
  return s.mintsStored === null && s.swapsStored === null ? 'down' : 'partial'
}

async function fetchJson(url: string, cap: number): Promise<unknown | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: FETCH_TIMEOUT_MS, headers: { Accept: 'application/json' } })
    if (!res || !res.ok) return null
    return await readJsonLimited(res, cap)
  } catch {
    return null // oversize, invalid JSON, network error
  }
}

async function inTransaction(fn: (q: (sql: string, params?: unknown[]) => Promise<unknown>) => Promise<void>): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await fn((sql, params) => client.query(sql, params))
    await client.query('COMMIT')
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* connection already gone */ }
    throw err
  } finally {
    client.release()
  }
}

async function writeMints(mints: AuditCzMint[]): Promise<void> {
  await inTransaction(async q => {
    for (const m of mints) {
      await q(
        `INSERT INTO audit_cz_mints (url, state, uptime24h, uptime7d, uptime30d, attributed_failures, minted, melted, last_check, page, fetched_at, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)
         ON CONFLICT (url) DO UPDATE SET state=EXCLUDED.state, uptime24h=EXCLUDED.uptime24h, uptime7d=EXCLUDED.uptime7d,
           uptime30d=EXCLUDED.uptime30d, attributed_failures=EXCLUDED.attributed_failures, minted=EXCLUDED.minted, melted=EXCLUDED.melted,
           last_check=EXCLUDED.last_check, page=EXCLUDED.page, fetched_at=NOW(), source=EXCLUDED.source`,
        [m.url, m.state, m.uptime24h, m.uptime7d, m.uptime30d, m.attributedFailures, m.minted, m.melted, m.lastCheck, m.page, AUDIT_CZ_SOURCE],
      )
      for (const a of m.aliases) {
        await q(
          `INSERT INTO audit_cz_aliases (alias_url, mint_url, fetched_at) VALUES ($1,$2,NOW())
           ON CONFLICT (alias_url) DO UPDATE SET mint_url=EXCLUDED.mint_url, fetched_at=NOW()`,
          [a, m.url],
        )
      }
    }
  })
}

async function writeSwaps(swaps: AuditCzSwap[]): Promise<void> {
  await inTransaction(async q => {
    for (const s of swaps) {
      await q(
        `INSERT INTO audit_cz_swaps (id, at, status, stage, error, amount, fee, duration_ms, from_url, to_url, from_name, to_name, fetched_at, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),$13)
         ON CONFLICT (id) DO UPDATE SET at=EXCLUDED.at, status=EXCLUDED.status, stage=EXCLUDED.stage, error=EXCLUDED.error,
           amount=EXCLUDED.amount, fee=EXCLUDED.fee, duration_ms=EXCLUDED.duration_ms, from_url=EXCLUDED.from_url,
           to_url=EXCLUDED.to_url, from_name=EXCLUDED.from_name, to_name=EXCLUDED.to_name, fetched_at=NOW()`,
        [s.id, s.at, s.status, s.stage, s.error, s.amount, s.fee, s.durationMs, s.fromUrl, s.toUrl, s.fromName, s.toName, AUDIT_CZ_SOURCE],
      )
    }
  })
}

// Only called after a successful swaps fetch + write.
async function pruneSwaps(): Promise<void> {
  await pool.query(`DELETE FROM audit_cz_swaps WHERE at < NOW() - make_interval(days => $1)`, [SWAP_RETENTION_DAYS])
  await pool.query(`DELETE FROM audit_cz_swaps WHERE id IN (SELECT id FROM audit_cz_swaps ORDER BY at DESC OFFSET $1)`, [SWAP_MAX_ROWS])
}

let running = false

export async function syncAuditCz(): Promise<{ mints: number | null; swaps: number | null }> {
  const result: { mints: number | null; swaps: number | null } = { mints: null, swaps: null }
  if (running) return result
  running = true
  try {
    const [mintsRaw, swapsRaw] = await Promise.all([
      fetchJson(AUDIT_CZ_MINTS_URL, RESPONSE_CAPS.auditCzMints),
      fetchJson(AUDIT_CZ_SWAPS_URL, RESPONSE_CAPS.auditCzSwaps),
    ])
    const mints = mintsRaw === null ? null : parseAuditCzMintsResponse(mintsRaw)
    const swaps = swapsRaw === null ? null : parseAuditCzSwapsResponse(swapsRaw)
    if (mints) {
      try { await writeMints(mints.items); result.mints = mints.items.length } catch { /* rolled back; old rows stay */ }
    }
    if (swaps) {
      try {
        await writeSwaps(swaps.items)
        result.swaps = swaps.items.length
        await pruneSwaps()
      } catch { /* rolled back or prune failed; old rows stay */ }
    }
    const skippedMints = mints?.skipped ?? 0
    const skippedSwaps = swaps?.skipped ?? 0
    lastCycle = {
      lastSyncAt: new Date().toISOString(),
      mintsStored: result.mints,
      swapsStored: result.swaps,
      skipped: { mints: skippedMints, swaps: skippedSwaps },
    }
    const part = (name: string, fetched: number | undefined, stored: number | null, skipped: number) =>
      fetched === undefined || stored === null ? `${name} failed` : `${name} ${fetched} fetched, ${stored} stored, ${skipped} skipped`
    const line = `cashu.info sync: ${part('mints', mints?.fetched, result.mints, skippedMints)}; ${part('swaps', swaps?.fetched, result.swaps, skippedSwaps)}`
    if (skippedMints + skippedSwaps > 0) console.warn(`[audit-cz] ${line}`)
    else console.log(`[audit-cz] ${line}`)
  } finally {
    running = false
  }
  return result
}

// ── Per-mint detail ──────────────────────────────────────────────────────────
// The detail is fetched by the 30-minute cron in auditCzDetail.ts and stored in audit_cz_detail;
// this module only reads it. No visitor ever triggers an outbound request.

/** Mint id from a stored `page` URL (https://cashu.info/mint/{id}; rows from before the move still carry https://audit.cashu.cz/mint/{id}); null when it does not look like one. */
export function auditCzIdFromPage(page: string | null | undefined): string | null {
  if (!page) return null
  const m = /^https:\/\/(?:cashu\.info|audit\.cashu\.cz)\/mint\/([^/?#]+)\/?$/.exec(page)
  return m && AUDIT_CZ_ID_RE.test(m[1] as string) ? (m[1] as string) : null
}

/** The stored detail of one mint (database only), or null when none was stored yet. */
export async function readAuditCzDetail(canonicalUrl: string): Promise<AuditCzDetailResponse | null> {
  const r = await pool.query(`SELECT detail, fetched_at FROM audit_cz_detail WHERE url = $1`, [canonicalUrl])
  const row = r.rows[0] as { detail?: unknown; fetched_at?: unknown } | undefined
  if (!row || !isObj(row.detail)) return null
  const f = row.fetched_at
  return { ...(row.detail as StoredAuditCzDetail), fetchedAt: f instanceof Date ? f.toISOString() : typeof f === 'string' ? f : null }
}

// ── Read side ────────────────────────────────────────────────────────────────

export interface AuditCzDirectionStats {
  paid: number
  failed: number
  pending: number
  amountPaid: number
  feesPaid: number
}

/** MintRadar's own count over the swaps it stored (never a figure published by cashu.info). */
export interface AuditCzStats7d {
  windowDays: 7
  melts: AuditCzDirectionStats
  mints: AuditCzDirectionStats
  avgDurationMsPaid: number | null
  swapsCounted: number
}

export interface AuditCzResponse {
  source: typeof AUDIT_CZ_API_SOURCE
  sourceUrl: string | null
  fetchedAt: string | null
  covered: boolean
  mint: {
    state: string
    uptime24h: number | null
    uptime7d: number | null
    uptime30d: number | null
    attributedFailures: number | null
    minted: number | null
    melted: number | null
    lastCheck: string | null
  } | null
  swaps: Array<{
    id: string
    at: string
    status: string
    stage: string | null
    error: string | null
    amount: number | null
    fee: number | null
    durationMs: number | null
    direction: 'from' | 'to'
    otherMintUrl: string | null
    otherMintName: string | null
  }>
  stats7d: AuditCzStats7d | null
  /** The validated subset of cashu.info's per-mint detail (stored by the 30-minute cron) plus `fetchedAt`; null when none is stored yet. Absent when the mint is not covered. */
  detail?: AuditCzDetailResponse | null
  /** MintRadar's own count of the stored swaps per UTC day, the last 7 days, oldest first (a day without swaps is all zeros). Absent when the mint is not covered. */
  daily7d?: AuditCzDay[]
  /** The long window of the score (audit_cz_daily, up to 28 days); null while only one 7-day total is stored. Absent when the mint is not covered. */
  long?: { windowDays: number; swaps: number; attributedFailures: number } | null
  /** Every stored 7-day total that does not overlap the others, added up; `day` is the first day the sum covers. Null when nothing is stored. */
  since?: { day: string; swaps: number; attributedFailures: number } | null
  /** Every stored non-overlapping 7-day snapshot (audit_cz_daily, the same stride as `since`), oldest first. Absent when the mint is not covered. */
  weeks?: AuditCzWeek[]
  /** Sums of `weeks` for the 7-day, 28-day and all-history views. Absent when the mint is not covered. */
  totals?: AuditCzTotals
}

/** One direction of a stored 7-day snapshot; null fields were not stored for that week. */
export interface AuditCzWeekDirection {
  total: number | null
  success: number | null
  failed: number | null
  avgMs: number | null
  amount: number | null
  fees: number | null
}

/**
 * One stored 7-day snapshot of cashu.info's per-mint detail. `start` is the first day it covers and `end` the day it
 * was stored (the 7 days before `end`). `swaps` and `attributedFailures` are always set; every other figure is null
 * when it was not stored for that week (snapshots from before 2026-11-21 carry only total, blamed and failed).
 */
export interface AuditCzWeek {
  start: string
  end: string
  swaps: number
  attributedFailures: number
  failed: number | null
  succeeded: number | null
  failedElsewhere: number | null
  avgMs: number | null
  amount: number | null
  fees: number | null
  deposits: AuditCzWeekDirection | null
  withdrawals: AuditCzWeekDirection | null
}

/** Succeeded / failed elsewhere summed over the newest weeks that all have them; `since` is the first day covered. */
export interface AuditCzOutcomeSplit { since: string; swaps: number; succeeded: number; failedElsewhere: number; attributedFailures: number }
/** Deposits / withdrawals summed over the newest weeks that all have them; `since` is the first day covered. */
export interface AuditCzDirectionSplit {
  since: string
  deposits: { total: number; success: number; failed: number }
  withdrawals: { total: number; success: number; failed: number }
}

/** One view of the history: the weeks it adds up and their sums. */
export interface AuditCzPeriodTotal {
  /** Days the sum covers (7 per week). */
  days: number
  start: string
  end: string
  weeks: number
  swaps: number
  attributedFailures: number
  /** Null when no week of the period has stored its failures. */
  outcomes: AuditCzOutcomeSplit | null
  /** Null when no week of the period has stored a direction split. */
  directions: AuditCzDirectionSplit | null
}

export interface AuditCzTotals {
  /** The snapshot stored today; null when today's has not been stored yet. */
  d7: AuditCzPeriodTotal | null
  /** Today's snapshot and the ones 7, 14 and 21 days older, stopping at the first missing one (the score's long window). */
  d28: AuditCzPeriodTotal | null
  /** Every stored week. */
  all: AuditCzPeriodTotal | null
}

export interface AuditCzDay { day: string; ok: number; failed: number; other: number }

/** Pure: grouped (day, outcome, n) rows → 7 entries ending at `today`, oldest first, zero-filled. */
export function buildAuditCzDaily(rows: Array<{ day: string; outcome: string; n: unknown }>, today: string): AuditCzDay[] {
  const t0 = Date.parse(`${today}T00:00:00Z`)
  const days: AuditCzDay[] = []
  for (let i = STATS_WINDOW_DAYS - 1; i >= 0; i--) days.push({ day: utcDay(t0 - i * 86_400_000), ok: 0, failed: 0, other: 0 })
  const byDay = new Map(days.map(d => [d.day, d]))
  for (const r of rows) {
    const d = byDay.get(r.day)
    if (!d) continue
    const n = Number(r.n) || 0
    if (r.outcome === 'paid') d.ok += n
    else if (r.outcome === 'failed') d.failed += n
    else d.other += n
  }
  return days
}

/** Pure: every stored row whose distance from `today` is a multiple of 7 days (they do not overlap), added up. */
export function sumSince(rows: DailyRow[], today: string): { day: string; swaps: number; attributedFailures: number } | null {
  const t0 = Date.parse(`${today}T00:00:00Z`)
  let swaps = 0
  let blamed = 0
  let first: number | null = null
  for (const r of rows) {
    const t = Date.parse(`${r.day}T00:00:00Z`)
    const diff = Math.round((t0 - t) / 86_400_000)
    if (!Number.isFinite(t) || diff < 0 || diff % LONG_STEP_DAYS !== 0) continue
    swaps += r.total
    blamed += Math.min(r.blamed, r.total)
    if (first === null || t < first) first = t
  }
  return first === null ? null : { day: utcDay(first - LONG_STEP_DAYS * 86_400_000), swaps, attributedFailures: blamed }
}

/** One audit_cz_daily row as read for the weeks; every column after blamed is nullable. */
export interface DailyWeekRow {
  day: string
  total: unknown
  blamed: unknown
  failed?: unknown
  success?: unknown
  avg_ms?: unknown
  amount?: unknown
  fees?: unknown
  dest_total?: unknown
  dest_success?: unknown
  dest_failed?: unknown
  dest_avg_ms?: unknown
  dest_amount?: unknown
  dest_fees?: unknown
  source_total?: unknown
  source_success?: unknown
  source_failed?: unknown
  source_avg_ms?: unknown
  source_amount?: unknown
  source_fees?: unknown
}

/** A non-negative finite number from a row cell (pg returns BIGINT as a string), else null. */
function cell(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function weekDirection(r: DailyWeekRow, side: 'dest' | 'source'): AuditCzWeekDirection | null {
  const t = cell(r[`${side}_total`]), s = cell(r[`${side}_success`]), f = cell(r[`${side}_failed`])
  const avgMs = cell(r[`${side}_avg_ms`]), amount = cell(r[`${side}_amount`]), fees = cell(r[`${side}_fees`])
  if (t === null && s === null && f === null && avgMs === null && amount === null && fees === null) return null
  return {
    total: t,
    success: t !== null && s !== null ? Math.min(s, t) : s,
    failed: t !== null && f !== null ? Math.min(f, t) : f,
    avgMs, amount, fees,
  }
}

/**
 * Pure: the stored 7-day snapshots that do not overlap (the rows a multiple of 7 days before `today`, as in
 * sumSince), oldest first. Succeeded and failed elsewhere are derived from total, failed and blamed when failed
 * was stored: succeeded = total - failed, failed elsewhere = failed - blamed (blamed and failed are clamped so the
 * three add up to total). Rows of the future or of the overlapping days in between are left out.
 */
export function buildAuditCzWeeks(rows: DailyWeekRow[], today: string): AuditCzWeek[] {
  const t0 = Date.parse(`${today}T00:00:00Z`)
  const out: AuditCzWeek[] = []
  for (const r of rows) {
    const t = Date.parse(`${r.day}T00:00:00Z`)
    const diff = Math.round((t0 - t) / 86_400_000)
    if (!Number.isFinite(t) || diff < 0 || diff % LONG_STEP_DAYS !== 0) continue
    const total = cell(r.total)
    const blamedRaw = cell(r.blamed)
    if (total === null || blamedRaw === null) continue
    const blamed = Math.min(blamedRaw, total)
    const failedRaw = cell(r.failed)
    const failed = failedRaw === null ? null : Math.min(Math.max(failedRaw, blamed), total)
    out.push({
      start: utcDay(t - LONG_STEP_DAYS * 86_400_000),
      end: r.day,
      swaps: total,
      attributedFailures: blamed,
      failed,
      succeeded: failed === null ? null : total - failed,
      failedElsewhere: failed === null ? null : failed - blamed,
      avgMs: cell(r.avg_ms),
      amount: cell(r.amount),
      fees: cell(r.fees),
      deposits: weekDirection(r, 'dest'),
      withdrawals: weekDirection(r, 'source'),
    })
  }
  return out.sort((a, b) => a.end.localeCompare(b.end))
}

const completeDir = (d: AuditCzWeekDirection | null): d is AuditCzWeekDirection & { total: number; success: number; failed: number } =>
  !!d && d.total !== null && d.success !== null && d.failed !== null

/**
 * Pure: the sums of the given weeks (oldest first). The outcome and direction splits add up only the NEWEST weeks
 * that all carry them, walking back from the newest and stopping at the first week without; `since` names the first
 * day of the oldest week they include, so the UI can say "split since …" for history that started before the split
 * was stored. Null for an empty list.
 */
export function buildAuditCzPeriodTotal(weeks: AuditCzWeek[]): AuditCzPeriodTotal | null {
  if (weeks.length === 0) return null
  const first = weeks[0] as AuditCzWeek
  const last = weeks[weeks.length - 1] as AuditCzWeek
  let swaps = 0
  let blamed = 0
  for (const w of weeks) { swaps += w.swaps; blamed += w.attributedFailures }

  let outcomes: AuditCzOutcomeSplit | null = null
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i] as AuditCzWeek
    if (w.succeeded === null || w.failedElsewhere === null) break
    outcomes = outcomes
      ? { since: w.start, swaps: outcomes.swaps + w.swaps, succeeded: outcomes.succeeded + w.succeeded, failedElsewhere: outcomes.failedElsewhere + w.failedElsewhere, attributedFailures: outcomes.attributedFailures + w.attributedFailures }
      : { since: w.start, swaps: w.swaps, succeeded: w.succeeded, failedElsewhere: w.failedElsewhere, attributedFailures: w.attributedFailures }
  }

  let dirSince: string | null = null
  let depSum = { total: 0, success: 0, failed: 0 }
  let witSum = { total: 0, success: 0, failed: 0 }
  for (let i = weeks.length - 1; i >= 0; i--) {
    const w = weeks[i] as AuditCzWeek
    if (!completeDir(w.deposits) || !completeDir(w.withdrawals)) break
    depSum = { total: depSum.total + w.deposits.total, success: depSum.success + w.deposits.success, failed: depSum.failed + w.deposits.failed }
    witSum = { total: witSum.total + w.withdrawals.total, success: witSum.success + w.withdrawals.success, failed: witSum.failed + w.withdrawals.failed }
    dirSince = w.start
  }
  const directions: AuditCzDirectionSplit | null = dirSince
    ? { since: dirSince, deposits: depSum, withdrawals: witSum }
    : null

  return {
    days: weeks.length * LONG_STEP_DAYS,
    start: first.start,
    end: last.end,
    weeks: weeks.length,
    swaps,
    attributedFailures: blamed,
    outcomes,
    directions,
  }
}

/**
 * Pure: the three views of the Audit tab. d7 = today's snapshot; d28 = today's and the ones 7, 14 and 21 days
 * older while each exists (the same weeks as the score's long window, sumLongWindow); all = every week. Needs
 * `weeks` from buildAuditCzWeeks with the same `today`.
 */
export function buildAuditCzTotals(weeks: AuditCzWeek[], today: string): AuditCzTotals {
  const byEnd = new Map(weeks.map(w => [w.end, w]))
  const t0 = Date.parse(`${today}T00:00:00Z`)
  const recent: AuditCzWeek[] = []
  for (let n = 0; n < LONG_MAX_ROWS; n++) {
    const w = byEnd.get(utcDay(t0 - n * LONG_STEP_DAYS * 86_400_000))
    if (!w) break
    recent.unshift(w)
  }
  return {
    d7: buildAuditCzPeriodTotal(recent.slice(-1)),
    d28: buildAuditCzPeriodTotal(recent),
    all: buildAuditCzPeriodTotal(weeks),
  }
}


/** One row per (direction, outcome) from the grouped query in getAuditCzForMint. */
export interface AuditCzStatsRow {
  dir: string
  outcome: string
  n: unknown
  amount_sum: unknown
  fee_sum: unknown
  dur_sum: unknown
  dur_n: unknown
}

const emptyDir = (): AuditCzDirectionStats => ({ paid: 0, failed: 0, pending: 0, amountPaid: 0, feesPaid: 0 })
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

/** Pure: grouped rows → stats7d. Melt = this mint is `from` (also when both sides match); mint = `to`. */
export function buildAuditCzStats7d(rows: AuditCzStatsRow[]): AuditCzStats7d {
  const melts = emptyDir()
  const mints = emptyDir()
  let durSum = 0
  let durN = 0
  let counted = 0
  for (const r of rows) {
    const d = r.dir === 'melt' ? melts : mints
    const n = num(r.n)
    counted += n
    if (r.outcome === 'paid') {
      d.paid += n
      d.amountPaid += num(r.amount_sum)
      d.feesPaid += num(r.fee_sum)
      durSum += num(r.dur_sum)
      durN += num(r.dur_n)
    } else if (r.outcome === 'failed') {
      d.failed += n
    } else {
      d.pending += n
    }
  }
  return {
    windowDays: STATS_WINDOW_DAYS,
    melts,
    mints,
    avgDurationMsPaid: durN > 0 ? durSum / durN : null,
    swapsCounted: counted,
  }
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null)
const numOrNullRow = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export const AUDIT_CZ_SWAPS_DEFAULT_LIMIT = 20
export const AUDIT_CZ_SWAPS_MAX_LIMIT = 100

/** Optional `limit` query value → integer in 1..100; anything missing or non-numeric keeps the default (20). */
export function clampAuditCzLimit(raw: unknown): number {
  if (typeof raw !== 'string' || !/^-?\d+(\.\d+)?$/.test(raw.trim())) return AUDIT_CZ_SWAPS_DEFAULT_LIMIT
  return Math.min(AUDIT_CZ_SWAPS_MAX_LIMIT, Math.max(1, Math.floor(Number(raw))))
}

export async function getAuditCzForMint(rawUrl: string, limit: number = AUDIT_CZ_SWAPS_DEFAULT_LIMIT, direction: 'from' | 'to' | 'both' = 'both'): Promise<AuditCzResponse> {
  const key = auditCzKey(rawUrl)
  // Match on their url or any of their aliases (stored keyed the same way).
  const m = await pool.query(
    `SELECT url, state, uptime24h, uptime7d, uptime30d, attributed_failures, minted, melted, last_check, page, fetched_at
       FROM audit_cz_mints
      WHERE url = $1 OR url IN (SELECT mint_url FROM audit_cz_aliases WHERE alias_url = $1)
      LIMIT 1`,
    [key],
  )
  const row = m.rows[0] as Record<string, unknown> | undefined
  if (!row) {
    const f = await pool.query(`SELECT MAX(fetched_at) AS fetched_at FROM audit_cz_mints`)
    return { source: AUDIT_CZ_API_SOURCE, sourceUrl: null, fetchedAt: iso((f.rows[0] as Record<string, unknown> | undefined)?.['fetched_at']), covered: false, mint: null, swaps: [], stats7d: null }
  }
  const canonical = row['url'] as string
  const al = await pool.query(`SELECT alias_url FROM audit_cz_aliases WHERE mint_url = $1`, [canonical])
  const urls = Array.from(new Set([key, canonical, ...al.rows.map(r => (r as Record<string, unknown>)['alias_url'] as string)]))
  const sw = await pool.query(
    `SELECT id, at, status, stage, error, amount, fee, duration_ms, from_url, to_url, from_name, to_name
       FROM audit_cz_swaps
      WHERE (
        ($3 = 'both' AND (from_url = ANY($1) OR to_url = ANY($1)))
        OR ($3 = 'from' AND from_url = ANY($1))
        OR ($3 = 'to' AND to_url = ANY($1))
      )
      ORDER BY at DESC
      LIMIT $2`,
    [urls, limit, direction],
  )
  // One grouped query over the window (indexes on from_url/to_url + at). A swap whose both sides
  // match this mint is counted once, as a melt. Status other than success/failed counts as pending.
  const cutoff = new Date(Date.now() - STATS_WINDOW_DAYS * 86_400_000)
  const st = await pool.query(
    `SELECT CASE WHEN from_url = ANY($1) THEN 'melt' ELSE 'mint' END AS dir,
            CASE WHEN status = 'success' THEN 'paid' WHEN status = 'failed' THEN 'failed' ELSE 'pending' END AS outcome,
            COUNT(*) AS n,
            COALESCE(SUM(amount), 0) AS amount_sum,
            COALESCE(SUM(COALESCE(fee, 0)), 0) AS fee_sum,
            COALESCE(SUM(duration_ms), 0) AS dur_sum,
            COUNT(duration_ms) AS dur_n
       FROM audit_cz_swaps
      WHERE at >= $2 AND (from_url = ANY($1) OR to_url = ANY($1))
      GROUP BY 1, 2`,
    [urls, cutoff],
  )
  const stats7d = buildAuditCzStats7d(st.rows as AuditCzStatsRow[])
  const swaps = sw.rows.map(r => {
    const x = r as Record<string, unknown>
    const isFrom = typeof x['from_url'] === 'string' && urls.includes(x['from_url'])
    return {
      id: String(x['id']),
      at: iso(x['at']) ?? '',
      status: String(x['status']),
      stage: (x['stage'] as string | null) ?? null,
      error: (x['error'] as string | null) ?? null,
      amount: numOrNullRow(x['amount']),
      fee: numOrNullRow(x['fee']),
      durationMs: numOrNullRow(x['duration_ms']),
      direction: isFrom ? 'from' as const : 'to' as const,
      otherMintUrl: ((isFrom ? x['to_url'] : x['from_url']) as string | null) ?? null,
      // The counterpart's name is third-party text (cashu.info): cleaned / hidden-list aware like every name we emit.
      otherMintName: publicMintName(
        ((isFrom ? x['to_name'] : x['from_name']) as string | null) ?? null,
        ((isFrom ? x['to_url'] : x['from_url']) as string | null) ?? '',
      ).name,
    }
  })
  const detail = await readAuditCzDetail(canonical)
  const today = utcDay(Date.now())
  // Per UTC day, the same 7 days and outcome rule as stats7d; a swap is counted once (both directions).
  const dq = await pool.query(
    `SELECT to_char((at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
            CASE WHEN status = 'success' THEN 'paid' WHEN status = 'failed' THEN 'failed' ELSE 'pending' END AS outcome,
            COUNT(*) AS n
       FROM audit_cz_swaps
      WHERE at >= $2::date - 6 AND (from_url = ANY($1) OR to_url = ANY($1))
      GROUP BY 1, 2`,
    [urls, today],
  )
  const daily7d = buildAuditCzDaily(dq.rows as Array<{ day: string; outcome: string; n: unknown }>, today)
  const dr = await pool.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, total, blamed, failed, success, avg_ms, amount, fees,
            dest_total, dest_success, dest_failed, dest_avg_ms, dest_amount, dest_fees,
            source_total, source_success, source_failed, source_avg_ms, source_amount, source_fees
       FROM audit_cz_daily WHERE url = $1 AND day <= $2::date ORDER BY day`,
    [canonical, today],
  )
  const weekRows = dr.rows as DailyWeekRow[]
  const dailyRows: DailyRow[] = weekRows.map(r => ({ day: r.day, total: Number(r.total), blamed: Number(r.blamed) }))
  const longSum = sumLongWindow(dailyRows, today)
  const long = longSum && longSum.days > LONG_STEP_DAYS ? { windowDays: longSum.days, swaps: longSum.total, attributedFailures: longSum.blamed } : null
  const since = sumSince(dailyRows, today)
  const weeks = buildAuditCzWeeks(weekRows, today)
  const totals = buildAuditCzTotals(weeks, today)
  return {
    source: AUDIT_CZ_API_SOURCE,
    // Rebuilt from the id, so a row stored under the old host is served with the new page URL.
    sourceUrl: (() => { const id = auditCzIdFromPage(row['page'] as string | null); return id ? auditCzPageUrl(id) : null })(),
    fetchedAt: iso(row['fetched_at']),
    covered: true,
    mint: {
      state: row['state'] as string,
      uptime24h: numOrNullRow(row['uptime24h']),
      uptime7d: numOrNullRow(row['uptime7d']),
      uptime30d: numOrNullRow(row['uptime30d']),
      attributedFailures: numOrNullRow(row['attributed_failures']),
      minted: numOrNullRow(row['minted']),
      melted: numOrNullRow(row['melted']),
      lastCheck: iso(row['last_check']),
    },
    swaps,
    stats7d,
    detail,
    daily7d,
    long,
    since,
    weeks,
    totals,
  }
}
