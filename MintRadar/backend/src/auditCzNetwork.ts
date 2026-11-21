// cashu.info swap graph (GET /api/v1/network?range=30d), fetched by a cron and stored per mint for the Audit tab's
// 30-day view. Display only: the Reliability Score still reads only the 7-day (and long-window) totals and blamed
// counts from the per-mint detail. Visitors never trigger an outbound request.
//
// Direction mapping, checked against cashu.info's 7-day per-mint detail (swaps7d.asDest / asSource) for several
// mints: an edge's dest is deposits (mint / asDest), its source is withdrawals (melt / asSource). paid is success,
// failed is all failures (blamed and not). The 30-day blamed count is not on the graph; we read it from the mint
// list feed we already store (audit_cz_mints.attributed_failures).
import { pool } from './db.js'
import { safeFetch, readJsonLimited, RESPONSE_CAPS } from './ssrf.js'
import { AUDIT_CZ_BASE_URL, AUDIT_CZ_ID_RE, auditCzIdFromPage } from './auditCz.js'

export const AUDIT_CZ_NETWORK_URL = `${AUDIT_CZ_BASE_URL}/api/v1/network?range=30d`
const FETCH_TIMEOUT_MS = 15_000
const MAX_COUNT = 10_000_000
const MAX_AMOUNT = 1_000_000_000_000
const MAX_MS = 10 * 60_000
const MAX_EDGES = 20_000

export interface AuditCzNetworkEdge {
  source: string
  dest: string
  paid: number
  failed: number
  pending: number
  amount: number
  avgMs: number | null
}

/** One mint's 30-day totals from the graph: paid = success, dest = deposits, source = withdrawals. */
export interface AuditCzNetwork30d {
  paid: number
  failed: number
  amount: number
  avgMs: number | null
  destPaid: number
  destFailed: number
  destAmount: number
  sourcePaid: number
  sourceFailed: number
  sourceAmount: number
}

const empty30d = (): AuditCzNetwork30d => ({
  paid: 0, failed: 0, amount: 0, avgMs: null,
  destPaid: 0, destFailed: 0, destAmount: 0,
  sourcePaid: 0, sourceFailed: 0, sourceAmount: 0,
})

const finiteInt = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v < max ? v : null

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Pure: one graph edge, or null when the top-level shape or an id is unusable. A bad number is dropped (0 / null). */
export function parseAuditCzNetworkEdge(raw: unknown): AuditCzNetworkEdge | null {
  if (!isObj(raw)) return null
  const source = typeof raw['source'] === 'string' && AUDIT_CZ_ID_RE.test(raw['source']) ? raw['source'] : null
  const dest = typeof raw['dest'] === 'string' && AUDIT_CZ_ID_RE.test(raw['dest']) ? raw['dest'] : null
  if (!source || !dest) return null
  return {
    source,
    dest,
    paid: finiteInt(raw['paid'], MAX_COUNT) ?? 0,
    failed: finiteInt(raw['failed'], MAX_COUNT) ?? 0,
    pending: finiteInt(raw['pending'], MAX_COUNT) ?? 0,
    amount: finiteInt(raw['amount'], MAX_AMOUNT) ?? 0,
    avgMs: finiteInt(raw['avgMs'], MAX_MS),
  }
}

/** Pure: the official 30-day graph body. A bad wrapper or a non-array `edges` is rejected; bad items are skipped. */
export function parseAuditCzNetwork(raw: unknown): AuditCzNetworkEdge[] | null {
  if (!isObj(raw)) return null
  if (raw['range'] !== undefined && raw['range'] !== '30d') return null
  const edges = raw['edges']
  if (!Array.isArray(edges) || edges.length > MAX_EDGES) return null
  const out: AuditCzNetworkEdge[] = []
  for (const e of edges) {
    const parsed = parseAuditCzNetworkEdge(e)
    if (parsed) out.push(parsed)
  }
  return out
}

/**
 * Pure: add the edges of one mint (by cashu.info id). dest = deposits (asDest), source = withdrawals (asSource).
 * avgMs is the paid-weighted mean of edge averages; edges with no avgMs or no paid swaps are left out of the mean.
 */
export function sumNetworkEdgesForMint(edges: AuditCzNetworkEdge[], id: string): AuditCzNetwork30d {
  const acc = empty30d()
  let avgNum = 0
  let avgDen = 0
  for (const e of edges) {
    const asDest = e.dest === id
    const asSource = e.source === id
    if (!asDest && !asSource) continue
    acc.paid += e.paid
    acc.failed += e.failed
    acc.amount += e.amount
    if (e.avgMs !== null && e.paid > 0) { avgNum += e.avgMs * e.paid; avgDen += e.paid }
    if (asDest) { acc.destPaid += e.paid; acc.destFailed += e.failed; acc.destAmount += e.amount }
    if (asSource) { acc.sourcePaid += e.paid; acc.sourceFailed += e.failed; acc.sourceAmount += e.amount }
  }
  acc.avgMs = avgDen > 0 ? Math.round(avgNum / avgDen) : null
  return acc
}

/** Pure: one snapshot per cashu.info mint id that appears on at least one edge. */
export function sumNetwork30dByMint(edges: AuditCzNetworkEdge[]): Map<string, AuditCzNetwork30d> {
  const ids = new Set<string>()
  for (const e of edges) { ids.add(e.source); ids.add(e.dest) }
  const out = new Map<string, AuditCzNetwork30d>()
  for (const id of ids) out.set(id, sumNetworkEdgesForMint(edges, id))
  return out
}

export interface NetworkSyncStats { fetched: boolean; stored: number; skipped: number; failed: boolean; durationMs: number }

let running = false

/**
 * One run: a single GET of the 30-day graph, then one UPDATE per known cashu.info mint (zeros when it has no
 * edges). A failed fetch, an oversize or unusable body, or a database error writes and deletes nothing.
 */
export async function syncAuditCzNetwork(): Promise<NetworkSyncStats> {
  const stats: NetworkSyncStats = { fetched: false, stored: 0, skipped: 0, failed: false, durationMs: 0 }
  if (running) return stats
  running = true
  const started = Date.now()
  try {
    const res = await safeFetch(AUDIT_CZ_NETWORK_URL, { timeoutMs: FETCH_TIMEOUT_MS, headers: { Accept: 'application/json' } })
    if (!res || !res.ok) { stats.failed = true; return stats }
    const cap = RESPONSE_CAPS.auditCzNetwork ?? 1024 * 1024
    let raw: unknown
    try {
      raw = await readJsonLimited(res, cap)
    } catch {
      stats.failed = true
      return stats
    }
    stats.fetched = true
    const edges = parseAuditCzNetwork(raw)
    if (!edges) { stats.skipped++; return stats }
    const byId = sumNetwork30dByMint(edges)
    const known = await pool.query(`SELECT url, page FROM audit_cz_mints`)
    const rows = known.rows as Array<{ url: string; page: string | null }>
    if (rows.length === 0) return stats
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const row of rows) {
        const id = auditCzIdFromPage(row.page)
        if (!id) { stats.skipped++; continue }
        const snap = byId.get(id) ?? empty30d()
        await client.query(
          `UPDATE audit_cz_mints SET
             network30_paid = $2, network30_failed = $3, network30_amount = $4, network30_avg_ms = $5,
             network30_dest_paid = $6, network30_dest_failed = $7, network30_dest_amount = $8,
             network30_source_paid = $9, network30_source_failed = $10, network30_source_amount = $11,
             network30_fetched_at = NOW()
           WHERE url = $1`,
          [
            row.url, snap.paid, snap.failed, snap.amount, snap.avgMs,
            snap.destPaid, snap.destFailed, snap.destAmount,
            snap.sourcePaid, snap.sourceFailed, snap.sourceAmount,
          ],
        )
        stats.stored++
      }
      await client.query('COMMIT')
    } catch (err) {
      try { await client.query('ROLLBACK') } catch { /* keep the original error */ }
      throw err
    } finally {
      client.release()
    }
  } catch {
    stats.failed = true
  } finally {
    running = false
    stats.durationMs = Date.now() - started
    console.log(`[audit-cz-network] fetched=${stats.fetched} stored=${stats.stored} skipped=${stats.skipped} failed=${stats.failed} durationMs=${stats.durationMs}`)
  }
  return stats
}
