// Hourly uptime of every mint for the last 24 hours (the 24 bars on the website's home mint cards, owner 2026-11-22).
// Website only: /api/mints/known `uptimeHourly24`; the wallet API does not carry it. Same pattern as dailyUptime.ts:
// one grouped read of mint_history (the 5-minute probes) every HOURLY_UPTIME_TTL_MS, started with the server; the
// known-mints snapshot only reads the last result (getHourlyUptime), so its refresh stays one database read. A failed
// read keeps the previous buckets (or none).
import { pool } from './db.js'

export const HOURLY_UPTIME_HOURS = 24
export const HOURLY_UPTIME_TTL_MS = 5 * 60_000

const HOUR_MS = 3_600_000

export interface HourCountRow { url: string; hour: string | Date; total: number | string; up: number | string }

/**
 * The 24 buckets per mint, oldest first, the last one is the current (started) UTC hour. A bucket is the share of
 * successful probes in that hour in percent, one decimal, rounded down (so 99.99 % never shows as 100); null for an
 * hour without any probe.
 */
export function buildHourlyBuckets(rows: readonly HourCountRow[], now: Date): Map<string, Array<number | null>> {
  const current = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS
  const first = current - (HOURLY_UPTIME_HOURS - 1) * HOUR_MS
  const out = new Map<string, Array<number | null>>()
  for (const r of rows) {
    const t = typeof r.hour === 'string' ? Date.parse(r.hour) : r.hour.getTime()
    if (!Number.isFinite(t)) continue
    const i = Math.round((Math.floor(t / HOUR_MS) * HOUR_MS - first) / HOUR_MS)
    if (i < 0 || i >= HOURLY_UPTIME_HOURS) continue
    const total = Number(r.total), up = Number(r.up)
    if (!(total > 0)) continue
    let buckets = out.get(r.url)
    if (!buckets) { buckets = Array<number | null>(HOURLY_UPTIME_HOURS).fill(null); out.set(r.url, buckets) }
    buckets[i] = Math.floor(Math.min(up, total) / total * 1000) / 10
  }
  return out
}

let cached: Map<string, Array<number | null>> | null = null
let inFlight: Promise<void> | null = null

/** The buckets read by the last refresh (empty before the first one). */
export function getHourlyUptime(): ReadonlyMap<string, Array<number | null>> {
  return cached ?? EMPTY
}
const EMPTY: ReadonlyMap<string, Array<number | null>> = new Map()

/** One grouped read of the last 24 UTC hours; a failed read keeps the previous buckets. Concurrent calls share one read. */
export function refreshHourlyUptime(now: () => number = Date.now): Promise<void> {
  if (inFlight) return inFlight
  inFlight = Promise.resolve()
    .then(() => pool.query<HourCountRow>(
      `SELECT url,
              to_char(date_trunc('hour', checked_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS hour,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE online) AS up
         FROM mint_history
        WHERE checked_at >= (date_trunc('hour', NOW() AT TIME ZONE 'UTC') - INTERVAL '${HOURLY_UPTIME_HOURS - 1} hours') AT TIME ZONE 'UTC'
        GROUP BY url, hour`,
    ))
    .then(res => { cached = buildHourlyBuckets(res.rows, new Date(now())) })
    .catch(err => { console.error('[hourlyUptime] refresh failed:', err instanceof Error ? err.message : err) })
    .finally(() => { inFlight = null })
  return inFlight
}

/** Server start-up (index.ts): one refresh now, then every HOURLY_UPTIME_TTL_MS (timer unref'ed). */
export function startHourlyUptimeRefresh(): void {
  void refreshHourlyUptime()
  setInterval(() => { void refreshHourlyUptime() }, HOURLY_UPTIME_TTL_MS).unref()
}

/** Tests only. */
export function resetHourlyUptimeCache(): void { cached = null; inFlight = null }
