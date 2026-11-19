// Daily uptime of every mint for the last 30 UTC days (the 30 bars on the website's mint cards and Mint Detail,
// 2026-11-19 redesign phase 3). Website only: /api/mints/known `uptimeDaily30`; the wallet API does not carry it.
//
// One grouped read of mint_history (the 5-minute probes) every DAILY_UPTIME_TTL_MS, started with the server
// (startDailyUptimeRefresh): the buckets of past days do not change and today's moves slowly. The known-mints snapshot
// (refreshed about every minute) only reads the last result (getDailyUptime), so its refresh stays one database read.
// A failed read keeps the previous buckets (or none).
import { pool } from './db.js'

export const DAILY_UPTIME_DAYS = 30
export const DAILY_UPTIME_TTL_MS = 10 * 60_000

const DAY_MS = 86_400_000

export interface DayCountRow { url: string; day: string | Date; total: number | string; up: number | string }

/** 'YYYY-MM-DD' of a UTC day. */
const dayKey = (d: Date): string => d.toISOString().slice(0, 10)

/**
 * The 30 buckets per mint, oldest first, the last one is today (UTC). A bucket is the share of successful probes that
 * day in percent, one decimal, rounded down (so 99.99 % never shows as 100); null for a day without any probe.
 */
export function buildDailyBuckets(rows: readonly DayCountRow[], now: Date): Map<string, Array<number | null>> {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const index = new Map<string, number>()
  for (let i = 0; i < DAILY_UPTIME_DAYS; i++) index.set(dayKey(new Date(today - (DAILY_UPTIME_DAYS - 1 - i) * DAY_MS)), i)
  const out = new Map<string, Array<number | null>>()
  for (const r of rows) {
    const key = typeof r.day === 'string' ? r.day.slice(0, 10) : dayKey(r.day)
    const i = index.get(key)
    if (i === undefined) continue
    const total = Number(r.total), up = Number(r.up)
    if (!(total > 0)) continue
    let buckets = out.get(r.url)
    if (!buckets) { buckets = Array<number | null>(DAILY_UPTIME_DAYS).fill(null); out.set(r.url, buckets) }
    buckets[i] = Math.floor(Math.min(up, total) / total * 1000) / 10
  }
  return out
}

let cached: Map<string, Array<number | null>> | null = null
let inFlight: Promise<void> | null = null

/** The buckets read by the last refresh (empty before the first one): the known-mints snapshot reads this, never the
 *  database, so a snapshot refresh stays ONE database read. */
export function getDailyUptime(): ReadonlyMap<string, Array<number | null>> {
  return cached ?? EMPTY
}
const EMPTY: ReadonlyMap<string, Array<number | null>> = new Map()

/** One grouped read of the last 30 UTC days; a failed read keeps the previous buckets. Concurrent calls share one read. */
export function refreshDailyUptime(now: () => number = Date.now): Promise<void> {
  if (inFlight) return inFlight
  inFlight = Promise.resolve()
    .then(() => pool.query<DayCountRow>(
      `SELECT url,
              to_char((checked_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE online) AS up
         FROM mint_history
        WHERE checked_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '${DAILY_UPTIME_DAYS - 1} days') AT TIME ZONE 'UTC'
        GROUP BY url, day`,
    ))
    .then(res => { cached = buildDailyBuckets(res.rows, new Date(now())) })
    .catch(err => { console.error('[dailyUptime] refresh failed:', err instanceof Error ? err.message : err) })
    .finally(() => { inFlight = null })
  return inFlight
}

/** Server start-up (index.ts): one refresh now, then every DAILY_UPTIME_TTL_MS (timer unref'ed). */
export function startDailyUptimeRefresh(): void {
  void refreshDailyUptime()
  setInterval(() => { void refreshDailyUptime() }, DAILY_UPTIME_TTL_MS).unref()
}

/** Tests only. */
export function resetDailyUptimeCache(): void { cached = null; inFlight = null }
