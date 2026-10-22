// Timing line for the big snapshot computations (/api/mints/known, /api/stats): the evidence that the pool-level
// `jit = off` (db.ts) keeps them well below a second. The first FIRST_LOGGED computations after the process start are
// always logged, afterwards only a slow one (above SLOW_MS), at most one such line per SLOW_LOG_INTERVAL. The line holds
// the label and the milliseconds, nothing else.

const FIRST_LOGGED = 3
const SLOW_MS = 1500
const SLOW_LOG_INTERVAL = 5 * 60_000

export function timedSnapshot<T>(
  label: string,
  compute: () => Promise<T>,
  log: (line: string) => void = console.log,
): () => Promise<T> {
  let completed = 0
  let lastSlowLog = -Infinity
  return async () => {
    const started = Date.now()
    const value = await compute()
    const ms = Date.now() - started
    completed++
    if (completed <= FIRST_LOGGED) {
      log(`[${label}] snapshot computed in ${ms} ms`)
    } else if (ms > SLOW_MS && Date.now() - lastSlowLog >= SLOW_LOG_INTERVAL) {
      lastSlowLog = Date.now()
      log(`[${label}] snapshot computed in ${ms} ms`)
    }
    return value
  }
}
