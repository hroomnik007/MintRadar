// cashu.info per-mint detail (GET /api/v1/mints/{id}), fetched by a cron and stored. DISPLAY ONLY:
// nothing here feeds the Reliability Score. Visitors never trigger an outbound request; the
// endpoint reads audit_cz_detail only.
//
// Only a validated subset is kept (see StoredAuditCzDetail). Never stored: score, scoreParts,
// reviews, daily, changes, incidents7d, Frankfurt data, any spec detail except the onion boolean
// (the onion address itself is never stored), and any IP address (the source sends none).
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
const MAX_SATS = 1e12
const MAX_MS = 10 * 60_000
const MAX_ASN = 4_294_967_296
const MIN_TS = Date.UTC(2020, 0, 1)
const MAX_TS = Date.UTC(2100, 0, 1)
const MAX_AS_NAME = 80
const MAX_TLS_ISSUER = 60

export interface DetailDirection { total?: number; success?: number; failed?: number; avgMs?: number }
export interface StoredAuditCzDetail {
  swaps7d?: {
    all?: DetailDirection
    asSource?: DetailDirection
    asDest?: DetailDirection
    errorsBlamed?: number
    dleq?: { valid?: number; invalid?: number; missing?: number }
    quoteMs?: number
    meltMs?: number
    mintMs?: number
  }
  integrity?: {
    swap_test?: { ok?: boolean; recentOk?: number; recentFail?: number; ms?: number; timestamp?: number }
    proof_state?: { ok?: boolean; recentOk?: number; recentFail?: number; ms?: number; timestamp?: number; checked?: number; spent?: number; spentSat?: number; pending?: number }
  }
  network?: { ipv4?: boolean; ipv6?: boolean; asn?: number; asName?: string; country?: string; tlsIssuer?: string; tlsExpiresAt?: string }
  onion?: boolean
  latency?: { prague?: { p50?: number; p95?: number } }
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
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const timestamp = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= MIN_TS && v < MAX_TS ? v : undefined

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

function isoDate(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 40) return undefined
  const t = Date.parse(v)
  return Number.isFinite(t) && t >= Date.UTC(2000, 0, 1) && t < MAX_TS ? new Date(t).toISOString() : undefined
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
    quoteMs: ms(s['quoteMs']),
    meltMs: ms(s['meltMs']),
    mintMs: ms(s['mintMs']),
  }) : undefined

  const i = isObj(raw['integrity']) ? raw['integrity'] : null
  const st = i && isObj(i['swap_test']) ? i['swap_test'] : null
  const ps = i && isObj(i['proof_state']) ? i['proof_state'] : null
  const psDetail = ps && isObj(ps['detail']) ? ps['detail'] : null
  const integrity = i ? pack({
    swap_test: st ? pack({ ok: bool(st['ok']), recentOk: count(st['recentOk']), recentFail: count(st['recentFail']), ms: ms(st['ms']), timestamp: timestamp(st['timestamp']) }) : undefined,
    proof_state: ps ? pack({
      ok: bool(ps['ok']), recentOk: count(ps['recentOk']), recentFail: count(ps['recentFail']), ms: ms(ps['ms']), timestamp: timestamp(ps['timestamp']),
      checked: psDetail ? count(psDetail['checked']) : undefined,
      spent: psDetail ? count(psDetail['spent']) : undefined,
      spentSat: psDetail ? count(psDetail['spentSat'], MAX_SATS) : undefined,
      pending: psDetail ? count(psDetail['pending']) : undefined,
    }) : undefined,
  }) : undefined

  const n = isObj(raw['network']) ? raw['network'] : null
  const country = n ? cleanDetailText(n['country'], 2) : undefined
  const network = n ? pack({
    ipv4: bool(n['ipv4']),
    ipv6: bool(n['ipv6']),
    asn: count(n['asn'], MAX_ASN),
    asName: cleanDetailText(n['asName'], MAX_AS_NAME),
    country: country !== undefined && /^[A-Z]{2}$/.test(country) ? country : undefined,
    tlsIssuer: cleanDetailText(n['tlsIssuer'], MAX_TLS_ISSUER),
    tlsExpiresAt: isoDate(n['tlsExpiresAt']),
  }) : undefined

  // The onion address is reduced to "is there one"; the string itself is never kept.
  const spec = isObj(raw['spec']) ? raw['spec'] : null
  const onion = spec && 'onionUrl' in spec
    ? typeof spec['onionUrl'] === 'string' ? spec['onionUrl'].trim().length > 0 : spec['onionUrl'] === null ? false : undefined
    : undefined

  const l = isObj(raw['latency7d']) ? raw['latency7d'] : null
  const pr = l && isObj(l['prague']) ? l['prague'] : null
  const prague = pr ? pack({ p50: ms(pr['p50']), p95: ms(pr['p95']) }) : undefined
  const latency = prague ? { prague } : undefined

  const out = pack({ swaps7d, integrity, network, onion, latency })
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
