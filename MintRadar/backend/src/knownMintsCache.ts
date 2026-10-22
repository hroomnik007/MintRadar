// Stale-while-revalidate holder for the /api/mints/known snapshot (index.ts: loadKnownMints). The computation is a
// 7-day aggregate over mint_history that takes seconds when the data is not in the database cache, so a visitor must
// not be the one who waits for it: a snapshot past its TTL is served at once while ONE background refresh runs.

export const KNOWN_MINTS_CACHE_TTL = 60_000 // younger than this: served as is
export const KNOWN_MINTS_STALE_LIMIT = 5 * 60_000 // older than the TTL but younger than this: served, refreshed in the background
export const KNOWN_MINTS_REFRESH_INTERVAL = 45_000 // timer refresh, below the TTL so a running server never serves an expired snapshot
const REFRESH_LOG_INTERVAL = 5 * 60_000 // at most one "refresh failed" line per this long

export interface SwrCacheOptions<T> {
  compute: () => Promise<T>
  ttlMs?: number
  staleLimitMs?: number
  onRefreshError?: (err: unknown) => void
}

export interface SwrCache<T> {
  get: () => Promise<T>
  invalidate: () => void
  /** Fire-and-forget refresh through the same path; a no-op while a refresh is already running. */
  refreshInBackground: () => void
  /** Warm-up plus the timer; returns the stop function. Never throws, never delays the caller. */
  start: (intervalMs?: number) => () => void
}

export function createSwrCache<T>(opts: SwrCacheOptions<T>): SwrCache<T> {
  const ttl = opts.ttlMs ?? KNOWN_MINTS_CACHE_TTL
  const staleLimit = opts.staleLimitMs ?? KNOWN_MINTS_STALE_LIMIT
  let snapshot: { value: T; at: number } | null = null
  let inflight: Promise<T> | null = null
  // Bumped by invalidate(): a computation that started before it must not become the current snapshot.
  let generation = 0

  function refresh(): Promise<T> {
    if (inflight) return inflight
    const started = generation
    const p: Promise<T> = opts.compute()
      .then(value => {
        if (started === generation) snapshot = { value, at: Date.now() }
        return value
      })
      .finally(() => { if (inflight === p) inflight = null })
    inflight = p
    return p
  }

  function refreshInBackground(): void {
    refresh().catch(err => opts.onRefreshError?.(err))
  }

  return {
    get() {
      if (snapshot) {
        const age = Date.now() - snapshot.at
        if (age < ttl) return Promise.resolve(snapshot.value)
        if (age < staleLimit) {
          refreshInBackground()
          return Promise.resolve(snapshot.value)
        }
      }
      return refresh()
    },
    invalidate() {
      generation++
      snapshot = null
      inflight = null
    },
    refreshInBackground,
    start(intervalMs = KNOWN_MINTS_REFRESH_INTERVAL) {
      refreshInBackground()
      const timer = setInterval(refreshInBackground, intervalMs)
      timer.unref()
      return () => clearInterval(timer)
    },
  }
}

/** One concise line per REFRESH_LOG_INTERVAL; only the error class and code, never the message (it can carry a connection string). */
export function makeRefreshErrorLogger(log: (line: string) => void = console.error, label = 'known-mints'): (err: unknown) => void {
  let last = -Infinity
  return err => {
    const now = Date.now()
    if (now - last < REFRESH_LOG_INTERVAL) return
    last = now
    const code = (err as { code?: unknown } | null)?.code
    const name = err instanceof Error ? err.name : typeof err
    log(`[${label}] background refresh failed: ${name}${typeof code === 'string' ? ` (${code})` : ''}`)
  }
}
