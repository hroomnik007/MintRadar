// cashu.info per-mint detail (GET /api/v1/mints/{id}), fetched by a cron and stored. DISPLAY ONLY:
// nothing here feeds the Reliability Score. Visitors never trigger an outbound request; the
// endpoint reads audit_cz_detail only.
//
// Only the subset the UI actually shows is kept (see StoredAuditCzDetail). Never stored: score, scoreParts,
// reviews, daily, changes, incidents7d, latency, TLS, step timings, the auditor's swap test, Frankfurt data,
// any spec detail except the onion boolean (the onion address itself is never stored), and any IP address
// (the source sends none; the mint host's IPv4 is resolved by us in mintAddress.ts).
// Every field is optional: a malformed field is dropped, not the record; a malformed top level
// (not an object, id mismatch, nothing usable) skips the mint. A failed fetch writes and deletes
// nothing.
import { pool } from './db.js'
import { safeFetch, readJsonLimited, RESPONSE_CAPS } from './ssrf.js'
import { AUDIT_CZ_BASE_URL, AUDIT_CZ_ID_RE, auditCzIdFromPage } from './auditCz.js'

const FETCH_TIMEOUT_MS = 15_000
export const DETAIL_PAUSE_MS = 2_000
export const DETAIL_RUN_BUDGET_MS = 25 * 60_000

const MAX_COUNT = 10_000_000
const MAX_MS = 10 * 60_000
const MAX_ASN = 4_294_967_296
const MAX_AS_NAME = 80

export interface DetailDirection { total?: number; success?: number; failed?: number; avgMs?: number }
export interface StoredAuditCzDetail {
  swaps7d?: {
    all?: DetailDirection
    asSource?: DetailDirection
    asDest?: DetailDirection
    errorsBlamed?: number
    dleq?: { valid?: number; invalid?: number; missing?: number }
  }
  integrity?: {
    proof_state?: { checked?: number; spent?: number; pending?: number }
  }
  network?: { asn?: number; asName?: string; country?: string }
  onion?: boolean
}
export type AuditCzDetailResponse = StoredAuditCzDetail & { fetchedAt: string | null }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const INVISIBLE = new RegExp('[\\p{Cc}\\u200B-\\u200D\\u2060\\uFEFF\\u180E\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]', 'gu')

/** NFC, control / zero-width / bidi characters removed, whitespace collapsed, capped; '' → undefined. */
export function cleanDetailText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.normalize('NFC').replace(/\s+/gu, ' ').replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim().slice(0, max).trim()
  return t === '' ? undefined : t
}

const finite = (v: unknown, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < max ? v : undefined
const count = (v: unknown, max = MAX_COUNT): number | undefined => {
  const n = finite(v, max)
  return n !== undefined && Number.isInteger(n) ? n : undefined
}
const ms = (v: unknown): number | undefined => {
  const n = finite(v, MAX_MS)
  return n === undefined ? undefined : Math.round(n)
}
/** Drops undefined entries; an object with no entry left becomes undefined. */
function pack<T extends Obj>(o: T): T | undefined {
  const out: Obj = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v
  return Object.keys(out).length > 0 ? (out as T) : undefined
}

function direction(v: unknown): DetailDirection | undefined {
  if (!isObj(v)) return undefined
  return pack({ total: count(v['total']), success: count(v['success']), failed: count(v['failed']), avgMs: ms(v['avgMs']) })
}

/** The validated subset of one detail response, or null when the top level is unusable. `expectedId` guards a mismatching body. */
export function parseAuditCzDetailFull(raw: unknown, expectedId?: string): StoredAuditCzDetail | null {
  if (!isObj(raw)) return null
  if (expectedId !== undefined && raw['id'] !== undefined && raw['id'] !== expectedId) return null

  const s = isObj(raw['swaps7d']) ? raw['swaps7d'] : null
  const swaps7d = s ? pack({
    all: direction(s['all']),
    asSource: direction(s['asSource']),
    asDest: direction(s['asDest']),
    errorsBlamed: count(s['errorsBlamed']),
    dleq: isObj(s['dleq']) ? pack({ valid: count(s['dleq']['valid']), invalid: count(s['dleq']['invalid']), missing: count(s['dleq']['missing']) }) : undefined,
  }) : undefined

  const i = isObj(raw['integrity']) ? raw['integrity'] : null
  const ps = i && isObj(i['proof_state']) ? i['proof_state'] : null
  const psDetail = ps && isObj(ps['detail']) ? ps['detail'] : null
  const proofState = psDetail ? pack({ checked: count(psDetail['checked']), spent: count(psDetail['spent']), pending: count(psDetail['pending']) }) : undefined
  const integrity = i ? pack({ proof_state: proofState }) : undefined

  const n = isObj(raw['network']) ? raw['network'] : null
  const country = n ? cleanDetailText(n['country'], 2) : undefined
  const network = n ? pack({
    asn: count(n['asn'], MAX_ASN),
    asName: cleanDetailText(n['asName'], MAX_AS_NAME),
    country: country !== undefined && /^[A-Z]{2}$/.test(country) ? country : undefined,
  }) : undefined

  // The onion address is reduced to "is there one"; the string itself is never kept.
  const spec = isObj(raw['spec']) ? raw['spec'] : null
  const onion = spec && 'onionUrl' in spec
    ? typeof spec['onionUrl'] === 'string' ? spec['onionUrl'].trim().length > 0 : spec['onionUrl'] === null ? false : undefined
    : undefined

  const out = pack({ swaps7d, integrity, network, onion })
  return out ?? null
}

// ── The cron job ────────────────────────────────────────────────────────────

export interface DetailRunStats { fetched: number; stored: number; skipped: number; failed: number; deferred: number; durationMs: number }
export interface DetailRunOptions {
  pauseMs?: number
  budgetMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const defaultSleep = (n: number) => new Promise<void>(r => setTimeout(r, n))

async function fetchDetail(id: string): Promise<unknown | null> {
  try {
    const res = await safeFetch(`${AUDIT_CZ_BASE_URL}/api/v1/mints/${id}`, { timeoutMs: FETCH_TIMEOUT_MS, headers: { Accept: 'application/json' } })
    if (!res || !res.ok) return null
    return await readJsonLimited(res, RESPONSE_CAPS.auditCzMintDetail)
  } catch {
    return null // oversize, invalid JSON, network error
  }
}

let running = false

/**
 * One run: every covered tracked mint, one at a time, `pauseMs` between requests, at most
 * `budgetMs` in total (the rest waits for the next run: oldest stored detail first).
 */
export async function syncAuditCzDetails(opts: DetailRunOptions = {}): Promise<DetailRunStats> {
  const pauseMs = opts.pauseMs ?? DETAIL_PAUSE_MS
  const budgetMs = opts.budgetMs ?? DETAIL_RUN_BUDGET_MS
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? Date.now
  const stats: DetailRunStats = { fetched: 0, stored: 0, skipped: 0, failed: 0, deferred: 0, durationMs: 0 }
  if (running) return stats
  running = true
  const started = now()
  try {
    const targets = await pool.query(
      `SELECT m.url, m.page
         FROM audit_cz_mints m
         LEFT JOIN audit_cz_detail d ON d.url = m.url
        WHERE m.page IS NOT NULL
          AND (m.url IN (SELECT rtrim(url, '/') FROM mints)
               OR m.url IN (SELECT a.mint_url FROM audit_cz_aliases a WHERE a.alias_url IN (SELECT rtrim(url, '/') FROM mints)))
        ORDER BY d.fetched_at ASC NULLS FIRST, m.url ASC`,
    )
    const rows = targets.rows as Array<{ url: string; page: string | null }>
    for (let idx = 0; idx < rows.length; idx++) {
      if (now() - started >= budgetMs) { stats.deferred = rows.length - idx; break }
      const row = rows[idx] as { url: string; page: string | null }
      const id = auditCzIdFromPage(row.page)
      if (!id || !AUDIT_CZ_ID_RE.test(id)) { stats.skipped++; continue }
      if (stats.fetched + stats.failed > 0) await sleep(pauseMs)
      const raw = await fetchDetail(id)
      if (raw === null) { stats.failed++; continue }
      stats.fetched++
      const detail = parseAuditCzDetailFull(raw, id)
      if (!detail) { stats.skipped++; continue }
      try {
        await pool.query(
          `INSERT INTO audit_cz_detail (url, detail, fetched_at) VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (url) DO UPDATE SET detail = EXCLUDED.detail, fetched_at = NOW()`,
          [row.url, JSON.stringify(detail)],
        )
        stats.stored++
      } catch {
        stats.failed++ // old row stays
      }
    }
  } finally {
    stats.durationMs = now() - started
    running = false
  }
  const line = `cashu.info detail run: ${stats.fetched} fetched, ${stats.stored} stored, ${stats.skipped} skipped, ${stats.failed} failed${stats.deferred ? `, ${stats.deferred} deferred` : ''}, ${Math.round(stats.durationMs / 1000)} s`
  if (stats.skipped + stats.failed > 0) console.warn(`[audit-cz] ${line}`)
  else console.log(`[audit-cz] ${line}`)
  return stats
}
