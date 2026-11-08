// GET /api/stats, /api/stats/reliability-trend and /api/stats/reliability-movers, with their caches.
import { Router } from 'express'
import { type Request, type Response } from 'express'
import { pool } from '../db.js'
import { isNutOffered } from '../shared/nutSupport.js'
import { MINT_ADVERTISED_NUT_KEYS, isEligibleForRecommendation, hasFreshProbe } from '../shared/reliabilityScore.js'
import { computeReliabilityMovers, type MintScoreSnapshot } from '../reliabilityMovers.js'
import { isTestMint } from '../testMints.js'
import { publicMintName } from '../mintNames.js'
import { cachedBodyOf, sendCachedBody } from '../walletApi.js'
import { createStatsCache, STATS_CACHE_TTL } from '../statsCache.js'
import { timedSnapshot } from '../snapshotTiming.js'
import { IS_DEV } from '../serverConfig.js'

export const router = Router()

// /api/stats is in RATE_LIMIT_EXEMPT (see below) but, unlike the other exempt endpoints, ran two live pool.query() calls
// on every single request, which let ordinary traffic exhaust the shared `pool` (max: 5). It is now served from a
// stale-while-revalidate snapshot (statsCache.ts, same holder as knownMints above): fresh < 60 s, stale + ONE background
// refresh < 5 min, a 45 s timer and the start-up warm-up keep it from expiring under a running server.
export const stats = createStatsCache(timedSnapshot('stats', () => computeStats()))

// /api/stats/reliability-trend aggregates ~1.3M mint_history rows for 90d (sequential scan, ~1.3s; MIN(checked_at) another
// ~0.3s, EXPLAIN ANALYZE 2026-10-16) and the result only changes once a day, so each period is cached for 10 minutes,
// concurrent misses share one query, and the cache is warmed at startup and refreshed in the background (below).
export const reliabilityTrendCache = new Map<number, { data: object; expiresAt: number }>()
export const reliabilityTrendInFlight = new Map<number, Promise<object>>()
export const RELIABILITY_TREND_CACHE_TTL = 10 * 60_000 // 10 minutes
export const RELIABILITY_TREND_REFRESH_MS = 9 * 60_000 // refresh before the TTL ends, so a visitor never pays for the scan

export const reliabilityMoversCache = new Map<string, { data: object; expiresAt: number }>()
// Longer than KNOWN_MINTS_CACHE_TTL: the underlying snapshots only move once per
// probe cycle (5 min, refreshReliabilityMoversRollup on the probe cron), and a 7d/30d
// delta barely shifts between cycles — no reason to recompute per-minute.
export const RELIABILITY_MOVERS_CACHE_TTL = 10 * 60_000 // 10 minutes

export async function computeStats(): Promise<object> {
  const [mintsResult, latencyResult] = await Promise.all([
    pool.query(`
      SELECT m.url, m.name, m.last_reliability_score, m.nuts_limits, m.discovered_at,
        latest.online AS online, latest.latency_ms, latest.checked_at
      FROM mints m
      LEFT JOIN LATERAL (
        SELECT online, latency_ms, checked_at FROM mint_history
        WHERE url = m.url ORDER BY checked_at DESC, id DESC LIMIT 1
      ) latest ON true
    `),
    pool.query(`
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)::int AS avg_latency
      FROM mint_history
      WHERE online = true
        AND checked_at > NOW() - INTERVAL '24 hours'
        AND latency_ms IS NOT NULL
        AND latency_ms > 0
        AND latency_ms < 10000
    `),
  ])
  type MintRow = { url: string; name: string | null; last_reliability_score: number | null; nuts_limits: Record<string, unknown> | null; discovered_at: string | Date | null; online: boolean | null; latency_ms: number | null; checked_at: string | Date | null }
  const rows = mintsResult.rows as MintRow[]
  const online = rows.filter(r => r.online === true)
  const offline = rows.filter(r => r.online === false)
  const onlineReliabilityScores = online.map(r => r.last_reliability_score ?? 0)
  const avgReliabilityScore = onlineReliabilityScores.length > 0
    ? Math.round(onlineReliabilityScores.reduce((a, b) => a + b) / onlineReliabilityScores.length)
    : null
  const avgLatency24h = latencyResult.rows[0]?.avg_latency as number | null ?? null
  const low = onlineReliabilityScores.filter(s => s < 40).length
  const moderate = onlineReliabilityScores.filter(s => s >= 40 && s < 70).length
  const high = onlineReliabilityScores.filter(s => s >= 70).length
  // MINT_ADVERTISED_NUT_KEYS, not TRACKED_NUT_KEYS — Stats.tsx's NUT
  // Coverage panel only ever iterates the frontend's TRACKED_NUTS (14) so
  // extra entries here are simply ignored there, but the Network Health
  // Index's "advanced adoption" component also reads this array directly
  // for a few auth/payment-method NUTs (21/22/25) outside the 14.
  // Offered, not only declared: a switched-off NUT-04/05 (`disabled: true`) is not counted as adoption.
  const onlineWithNuts = online.filter(r => r.nuts_limits != null)
  const totalForAdoption = onlineWithNuts.length
  const nutAdoption = MINT_ADVERTISED_NUT_KEYS.map(key => ({
    nut: `NUT-${key.padStart(2, '0')}`,
    count: onlineWithNuts.filter(r => r.nuts_limits && isNutOffered(r.nuts_limits[key])).length,
    percent: totalForAdoption > 0
      ? Math.round(onlineWithNuts.filter(r => r.nuts_limits && isNutOffered(r.nuts_limits[key])).length / totalForAdoption * 100)
      : 0,
  }))
  const top5 = [...rows]
    // Recommended only while online (the newest probe succeeded) AND that probe is recent (hasFreshProbe): the
    // stored score of an offline or long-unprobed mint would otherwise keep it in the "Most Reliable" list.
    .filter(r => r.online === true && hasFreshProbe(r.checked_at))
    .filter(r => r.last_reliability_score != null)
    // Known dev/test-only mints are excluded from this "best of" list —
    // still fully visible/probed elsewhere, just not proactively recommended.
    .filter(r => !isTestMint(r.url as string))
    // Minimum observation window before a mint can be recommended — see
    // isEligibleForRecommendation (2026-09-19 audit run-3 MEDIUM finding).
    // Additive to NEW_MINT_RELIABILITY_CAP (score-side discount); this is the
    // ranking-eligibility side.
    .filter(r => isEligibleForRecommendation(r.discovered_at))
    .sort((a, b) => (b.last_reliability_score as number) - (a.last_reliability_score as number))
    .slice(0, 5)
    .map(r => ({ url: r.url, name: publicMintName(r.name, r.url).name, reliabilityScore: r.last_reliability_score as number }))
  const data = { totalMints: rows.length, onlineMints: online.length, offlineMints: offline.length, avgReliabilityScore, avgLatency24h, reliabilityDistribution: { low, moderate, high }, nutAdoption, top5ByReliabilityScore: top5 }
  return data
}

router.get('/api/stats', (_req: Request, res: Response): void => {
  stats.get()
    .then(data => sendCachedBody(res, cachedBodyOf(data), Math.floor(STATS_CACHE_TTL / 1000)))
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/stats]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

export async function computeReliabilityTrend(days: number): Promise<object> {
  const [result, earliestResult] = await Promise.all([
    pool.query(
      `SELECT
         (DATE_TRUNC('day', checked_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::date AS date,
         ROUND(AVG(reliability_score))::int AS avg_reliability
       FROM mint_history
       WHERE reliability_score IS NOT NULL
         AND online = true
         AND checked_at > NOW() - INTERVAL '1 day' * $1
       GROUP BY DATE_TRUNC('day', checked_at AT TIME ZONE 'UTC')
       ORDER BY 1 ASC`,
      [days]
    ),
    // Network-wide oldest probe, unbounded — used to tell the frontend when
    // the selected window (e.g. 90d) exceeds what's actually been collected.
    pool.query('SELECT MIN(checked_at) AS earliest FROM mint_history'),
  ])
  const earliestRaw = earliestResult.rows[0]?.earliest as Date | null
  const earliestCheckedAt = earliestRaw ? earliestRaw.toISOString() : null
  const daysOfDataAvailable = earliestRaw
    ? Math.min(days, Math.max(0, Math.floor((Date.now() - earliestRaw.getTime()) / 86_400_000)))
    : 0
  return {
    trend: result.rows.map(r => ({
      date: (r.date as Date).toISOString().slice(0, 10),
      avgReliability: r.avg_reliability as number,
    })),
    periodDays: days,
    earliestCheckedAt,
    daysOfDataAvailable,
  }
}

// One query pair per period at a time: concurrent callers (and the background refresh) share the same promise.
export function loadReliabilityTrend(days: number): Promise<object> {
  const running = reliabilityTrendInFlight.get(days)
  if (running) return running
  const started = computeReliabilityTrend(days)
    .then(data => {
      reliabilityTrendCache.set(days, { data, expiresAt: Date.now() + RELIABILITY_TREND_CACHE_TTL })
      return data
    })
    .finally(() => { reliabilityTrendInFlight.delete(days) })
  reliabilityTrendInFlight.set(days, started)
  return started
}

// Warms both periods; a failure is only logged (the route then computes on demand and answers 500 itself on an error).
export function refreshReliabilityTrendCache(): void {
  for (const days of [30, 90]) {
    loadReliabilityTrend(days).catch((err: unknown) => {
      if (IS_DEV) console.error('[reliability-trend warm-up]', err)
    })
  }
}

router.get('/api/stats/reliability-trend', (req: Request, res: Response): void => {
  const daysParam = parseInt(String(req.query['days'] ?? '30'), 10)
  const days = [30, 90].includes(daysParam) ? daysParam : 30

  const cached = reliabilityTrendCache.get(days)
  if (cached && Date.now() < cached.expiresAt) {
    sendCachedBody(res, cachedBodyOf(cached.data), Math.floor(RELIABILITY_TREND_CACHE_TTL / 1000))
    return
  }

  loadReliabilityTrend(days)
    .then(data => {
      sendCachedBody(res, cachedBodyOf(data), Math.floor(RELIABILITY_TREND_CACHE_TTL / 1000))
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/stats/reliability-trend]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

// Reliability Score risers/fallers over the last 7 or 30 days. Reads entirely from
// `mints`: last_reliability_score is the "latest" snapshot (written by every probe),
// and reliability_score_{7,30}d_ago are the point-in-time snapshots rolled up by
// refreshReliabilityMoversRollup() (reliabilityMoversRollup.ts) on the probe cron — this
// used to be two DISTINCT ON passes over all of mint_history (~2.5s measured) run
// on every cache miss. A mint with no old-enough scored history has a NULL
// snapshot and is filtered out here (same effect as the old INNER JOIN). The
// +/-3 threshold and top-3 ranking live in reliabilityMovers.ts (computeReliabilityMovers),
// unit-tested independently of this query.
router.get('/api/stats/reliability-movers', (req: Request, res: Response): void => {
  const period: '7d' | '30d' = req.query['period'] === '30d' ? '30d' : '7d'
  const days = period === '30d' ? 30 : 7

  const cached = reliabilityMoversCache.get(period)
  if (cached && Date.now() < cached.expiresAt) {
    sendCachedBody(res, cachedBodyOf(cached.data), Math.floor(RELIABILITY_MOVERS_CACHE_TTL / 1000))
    return
  }

  pool.query(
    `SELECT url, name,
       last_reliability_score AS latest_score,
       CASE WHEN $1 = 30 THEN reliability_score_30d_ago ELSE reliability_score_7d_ago END AS old_score
     FROM mints
     WHERE last_reliability_score IS NOT NULL
       AND CASE WHEN $1 = 30 THEN reliability_score_30d_ago ELSE reliability_score_7d_ago END IS NOT NULL`,
    [days]
  )
    .then(result => {
      const snapshots: MintScoreSnapshot[] = result.rows.map(r => ({
        url: r.url as string,
        name: publicMintName(r.name as string | null, r.url as string).name,
        latestScore: Number(r.latest_score),
        oldScore: Number(r.old_score),
      }))
      const data = { period, ...computeReliabilityMovers(snapshots) }
      reliabilityMoversCache.set(period, { data, expiresAt: Date.now() + RELIABILITY_MOVERS_CACHE_TTL })
      sendCachedBody(res, cachedBodyOf(data), Math.floor(RELIABILITY_MOVERS_CACHE_TTL / 1000))
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/stats/reliability-movers]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})
