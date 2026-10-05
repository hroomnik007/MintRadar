// Timer for the reviews sync (reviewsSync.ts): its own hourly clock, independent of the 6h discovery
// cycle and of the node-cron jobs (the 5-minute probe, the :03/:13/... audit sync, the daily jobs).
//
// Ticks sit on a grid of REVIEWS_SYNC_PERIOD_MS starting REVIEWS_SYNC_START_OFFSET_MS after boot, and
// each tick is moved by its own random jitter of up to REVIEWS_SYNC_JITTER_MAX_MS, so the load never
// lines up with another cron. A tick that finds the previous run still going is skipped (one log line).

export const REVIEWS_SYNC_PERIOD_MS = 60 * 60 * 1000
export const REVIEWS_SYNC_START_OFFSET_MS = 3 * 60 * 1000
export const REVIEWS_SYNC_JITTER_MAX_MS = 5 * 60 * 1000

export interface ReviewsSyncTimerDeps {
  run: () => Promise<unknown>
  isRunning: () => boolean
  /** True when the tick must do nothing at all (allowlist mode: no relay traffic). */
  shouldSkip?: () => boolean
  random?: () => number
  log?: (line: string) => void
}

export function startReviewsSyncTimer(deps: ReviewsSyncTimerDeps): { stop: () => void } {
  const random = deps.random ?? Math.random
  const log = deps.log ?? ((line: string) => console.log(line))
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let lastJitter = 0

  const nextJitter = (): number => Math.floor(random() * REVIEWS_SYNC_JITTER_MAX_MS)

  const schedule = (delayMs: number): void => {
    timer = setTimeout(() => {
      if (stopped) return
      // The next tick is planned before the run starts, so a long run never shifts the grid.
      const jitter = nextJitter()
      schedule(REVIEWS_SYNC_PERIOD_MS - lastJitter + jitter)
      lastJitter = jitter
      if (deps.shouldSkip?.()) return
      if (deps.isRunning()) {
        log('[reviews-sync] previous run still going — skipping this tick')
        return
      }
      void deps.run().catch(err => {
        console.error('[reviews-sync] scheduled run error:', err instanceof Error ? err.message : err)
      })
    }, delayMs)
    timer.unref?.()
  }

  lastJitter = nextJitter()
  schedule(REVIEWS_SYNC_START_OFFSET_MS + lastJitter)

  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
