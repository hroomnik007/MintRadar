// audit.cashu.cz — second, public audit source. DISPLAY ONLY: nothing here feeds
// the Reliability Score, `last_reliability_score` or any scoring module, and no
// scoring code reads the audit_cz_* tables. Two server-side GETs every 10 minutes
// (cron.ts); the visitor's browser never contacts audit.cashu.cz.
//
// Failure policy: any failure (timeout, HTTP error, oversize, bad JSON, bad
// top-level shape) writes and deletes nothing — the previous rows stay as they
// were. Single malformed items are skipped. Writes are upserts, one transaction
// per response.
import { pool } from './db.js'
import { normalizeUrl } from './discovery.js'
import { safeFetch, readJsonLimited, RESPONSE_CAPS } from './ssrf.js'

export const AUDIT_CZ_SOURCE = 'audit.cashu.cz'
const AUDIT_CZ_MINTS_URL = 'https://audit.cashu.cz/api/v1/mints'
// 500 is the API's maximum (~21 h of the global feed); 100 covered only ~4 h and missed quieter mints.
const AUDIT_CZ_SWAPS_URL = 'https://audit.cashu.cz/api/v1/swaps?limit=500'
const AUDIT_CZ_PAGE_PREFIX = 'https://audit.cashu.cz/'
const FETCH_TIMEOUT_MS = 15_000
const MAX_URL_LEN = 500
const MAX_ERROR_LEN = 300
const MAX_NAME_LEN = 100
const MAX_ALIASES = 20
const SWAP_RETENTION_DAYS = 14
const SWAP_MAX_ROWS = 20_000

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

function pageOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || !v.startsWith(AUDIT_CZ_PAGE_PREFIX) || v.length > MAX_URL_LEN) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && u.hostname === 'audit.cashu.cz' ? u.toString() : null
  } catch { return null }
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
    page: pageOrNull(raw['page']),
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
    const line = `audit.cashu.cz sync: ${part('mints', mints?.fetched, result.mints, skippedMints)}; ${part('swaps', swaps?.fetched, result.swaps, skippedSwaps)}`
    if (skippedMints + skippedSwaps > 0) console.warn(`[audit-cz] ${line}`)
    else console.log(`[audit-cz] ${line}`)
  } finally {
    running = false
  }
  return result
}

// ── Per-mint detail (swaps7d) ────────────────────────────────────────────────
// GET /api/v1/mints/{id} carries the source's own 7-day swap counts, including
// `errorsBlamed` (failures the auditor attributes to this mint). Fetched on demand, only when
// somebody opens that mint's Audit tab, and cached per mint: at most one request per mint per
// DETAIL_TTL_MS, whatever the traffic (worst case 65 mints x 6/h). A failure keeps the previous
// value; with nothing cached the caller falls back to the swaps MintRadar stored. Display only.
const AUDIT_CZ_DETAIL_URL = 'https://audit.cashu.cz/api/v1/mints/'
const DETAIL_TTL_MS = 10 * 60_000
const DETAIL_TIMEOUT_MS = 5_000
const DETAIL_ID_RE = /^[A-Za-z0-9]{8,64}$/

/** The source's `swaps7d.all` counts plus `errorsBlamed`. */
export interface AuditCzDetail7d {
  total: number
  success: number
  failed: number
  errorsBlamed: number
}

/** Mint id from a stored `page` URL (https://audit.cashu.cz/mint/{id}); null when it does not look like one. */
export function auditCzIdFromPage(page: string | null | undefined): string | null {
  if (!page) return null
  const m = /^https:\/\/audit\.cashu\.cz\/mint\/([^/?#]+)\/?$/.exec(page)
  return m && DETAIL_ID_RE.test(m[1] as string) ? (m[1] as string) : null
}

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)

/** null = unusable (missing or non-count fields): the caller keeps what it had. */
export function parseAuditCzDetail(raw: unknown): AuditCzDetail7d | null {
  if (!isObj(raw) || !isObj(raw['swaps7d'])) return null
  const s7 = raw['swaps7d']
  const all = s7['all']
  if (!isObj(all)) return null
  const total = count(all['total'])
  const success = count(all['success'])
  const failed = count(all['failed'])
  const errorsBlamed = count(s7['errorsBlamed'])
  if (total === null || success === null || failed === null || errorsBlamed === null) return null
  return { total, success, failed, errorsBlamed }
}

interface DetailEntry { data: AuditCzDetail7d | null; nextTryAt: number }
const detailCache = new Map<string, DetailEntry>()
const detailInflight = new Map<string, Promise<AuditCzDetail7d | null>>()

async function refreshDetail(id: string): Promise<AuditCzDetail7d | null> {
  const raw = await (async () => {
    try {
      const res = await safeFetch(AUDIT_CZ_DETAIL_URL + id, { timeoutMs: DETAIL_TIMEOUT_MS, headers: { Accept: 'application/json' } })
      if (!res || !res.ok) return null
      return await readJsonLimited(res, RESPONSE_CAPS.auditCzMintDetail)
    } catch {
      return null
    }
  })()
  const parsed = raw === null ? null : parseAuditCzDetail(raw)
  const previous = detailCache.get(id)?.data ?? null
  // A failed refresh keeps the old value and waits a full TTL before the next attempt,
  // so an outage cannot turn page views into upstream requests.
  detailCache.set(id, { data: parsed ?? previous, nextTryAt: Date.now() + DETAIL_TTL_MS })
  return parsed ?? previous
}

/** Cached for 10 min per mint; concurrent callers share one request. null when nothing is known. */
export function getAuditCzDetail(id: string): Promise<AuditCzDetail7d | null> {
  const hit = detailCache.get(id)
  if (hit && Date.now() < hit.nextTryAt) return Promise.resolve(hit.data)
  const running = detailInflight.get(id)
  if (running) return running
  const p = refreshDetail(id).finally(() => { detailInflight.delete(id) })
  detailInflight.set(id, p)
  return p
}

/** Test helper. */
export function resetAuditCzDetailCache(): void {
  detailCache.clear()
  detailInflight.clear()
}

// ── Read side ────────────────────────────────────────────────────────────────

export interface AuditCzDirectionStats {
  paid: number
  failed: number
  pending: number
  amountPaid: number
  feesPaid: number
}

/** MintRadar's own count over the swaps it stored (never a figure published by audit.cashu.cz). */
export interface AuditCzStats7d {
  windowDays: 7
  /** Oldest swap (`at`) held in audit_cz_swaps: the window start the counts can claim. null when the table is empty. */
  collectedSince: string | null
  melts: AuditCzDirectionStats
  mints: AuditCzDirectionStats
  avgDurationMsPaid: number | null
  swapsCounted: number
}

export interface AuditCzResponse {
  source: typeof AUDIT_CZ_SOURCE
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
  /** audit.cashu.cz's own 7-day counts for this mint (cached up to 10 min); null when unavailable. */
  detail7d?: AuditCzDetail7d | null
}

const STATS_WINDOW_DAYS = 7

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
export function buildAuditCzStats7d(rows: AuditCzStatsRow[], collectedSince: string | null): AuditCzStats7d {
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
    collectedSince,
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
    return { source: AUDIT_CZ_SOURCE, sourceUrl: null, fetchedAt: iso((f.rows[0] as Record<string, unknown> | undefined)?.['fetched_at']), covered: false, mint: null, swaps: [], stats7d: null }
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
  const [st, since] = await Promise.all([
    pool.query(
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
    ),
    pool.query(`SELECT MIN(at) AS since FROM audit_cz_swaps`),
  ])
  const stats7d = buildAuditCzStats7d(
    st.rows as AuditCzStatsRow[],
    iso((since.rows[0] as Record<string, unknown> | undefined)?.['since']),
  )
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
      otherMintName: ((isFrom ? x['to_name'] : x['from_name']) as string | null) ?? null,
    }
  })
  return {
    source: AUDIT_CZ_SOURCE,
    sourceUrl: (row['page'] as string | null) ?? null,
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
  }
}
