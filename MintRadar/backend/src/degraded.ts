// Pure degraded/offline classification used by GET /api/mints/known.
//
// A mint is "degraded" (hidden from the grid by default) when EITHER:
//   1. It has accumulated enough recent probes (>= 4 in the 24h window) and
//      none of them were online — i.e. it is consistently failing right now.
//   2. Its last known state is offline AND that last probe is older than 24h
//      (isStaleOffline) — i.e. it has been gone long enough to declutter.
//
// Extracted from index.ts so the boolean logic is unit-testable without
// starting the Express server. `now` is injectable for deterministic tests.
const STALE_OFFLINE_MS = 24 * 60 * 60 * 1000

export function computeDegraded(
  total: number,
  onlineCount: number,
  latestOnline: boolean | null,
  latestCheckedAt: string | null,
  now: number = Date.now()
): boolean {
  const isStaleOffline = latestOnline === false &&
    latestCheckedAt !== null &&
    now - new Date(latestCheckedAt).getTime() > STALE_OFFLINE_MS
  return (total >= 4 && onlineCount === 0) || isStaleOffline
}
