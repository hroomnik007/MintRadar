import { createSwrCache, makeRefreshErrorLogger, type SwrCache } from './knownMintsCache.js'

// Stale-while-revalidate holder for /api/stats (index.ts: computeStats), the same holder as the known-mints snapshot with
// its own limits: the two queries are cheap once warm, but the first request after idle time or a restart paid for them.

export const STATS_CACHE_TTL = 60_000 // younger than this: served as is (also the response's max-age)
export const STATS_STALE_LIMIT = 5 * 60_000 // older than the TTL but younger than this: served, refreshed in the background
export const STATS_REFRESH_INTERVAL = 45_000 // timer refresh, below the TTL so a running server never serves an expired snapshot

export type StatsCache = SwrCache<object>

export function createStatsCache(compute: () => Promise<object>, log: (line: string) => void = console.error): StatsCache {
  const cache = createSwrCache<object>({
    compute,
    ttlMs: STATS_CACHE_TTL,
    staleLimitMs: STATS_STALE_LIMIT,
    onRefreshError: makeRefreshErrorLogger(log, 'stats'),
  })
  return { ...cache, start: (intervalMs = STATS_REFRESH_INTERVAL) => cache.start(intervalMs) }
}
