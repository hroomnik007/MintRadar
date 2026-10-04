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
  const swaps = raw['swaps']
  if (isObj(swaps)) {
    const a = numOrNull(swaps['attributedFailures'])
    if (a === INVALID) return null
    attributed = a === null ? null : Math.round(a)
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
        `INSERT INTO audit_cz_mints (url, state, uptime24h, uptime7d, uptime30d, attributed_failures, last_check, page, fetched_at, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9)
         ON CONFLICT (url) DO UPDATE SET state=EXCLUDED.state, uptime24h=EXCLUDED.uptime24h, uptime7d=EXCLUDED.uptime7d,
           uptime30d=EXCLUDED.uptime30d, attributed_failures=EXCLUDED.attributed_failures, last_check=EXCLUDED.last_check,
           page=EXCLUDED.page, fetched_at=NOW(), source=EXCLUDED.source`,
        [m.url, m.state, m.uptime24h, m.uptime7d, m.uptime30d, m.attributedFailures, m.lastCheck, m.page, AUDIT_CZ_SOURCE],
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

// ── Read side ────────────────────────────────────────────────────────────────

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
}

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null)
const numOrNullRow = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export async function getAuditCzForMint(rawUrl: string): Promise<AuditCzResponse> {
  const key = auditCzKey(rawUrl)
  // Match on their url or any of their aliases (stored keyed the same way).
  const m = await pool.query(
    `SELECT url, state, uptime24h, uptime7d, uptime30d, attributed_failures, last_check, page, fetched_at
       FROM audit_cz_mints
      WHERE url = $1 OR url IN (SELECT mint_url FROM audit_cz_aliases WHERE alias_url = $1)
      LIMIT 1`,
    [key],
  )
  const row = m.rows[0] as Record<string, unknown> | undefined
  if (!row) {
    const f = await pool.query(`SELECT MAX(fetched_at) AS fetched_at FROM audit_cz_mints`)
    return { source: AUDIT_CZ_SOURCE, sourceUrl: null, fetchedAt: iso((f.rows[0] as Record<string, unknown> | undefined)?.['fetched_at']), covered: false, mint: null, swaps: [] }
  }
  const canonical = row['url'] as string
  const al = await pool.query(`SELECT alias_url FROM audit_cz_aliases WHERE mint_url = $1`, [canonical])
  const urls = Array.from(new Set([key, canonical, ...al.rows.map(r => (r as Record<string, unknown>)['alias_url'] as string)]))
  const sw = await pool.query(
    `SELECT id, at, status, stage, error, amount, fee, duration_ms, from_url, to_url, from_name, to_name
       FROM audit_cz_swaps
      WHERE from_url = ANY($1) OR to_url = ANY($1)
      ORDER BY at DESC
      LIMIT 20`,
    [urls],
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
      lastCheck: iso(row['last_check']),
    },
    swaps,
  }
}
