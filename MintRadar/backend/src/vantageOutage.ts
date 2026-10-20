// Suspected vantage outage: when OUR probe server loses its network, every mint fails at once. The second
// vantage point is cashu.info (its own probe every 5 minutes, stored by us in audit_cz_mints). Pure decision
// logic (no I/O, no clock): the cycle runner in probeCycle.ts feeds it and acts on the result.
//
// A cycle is classified ONLY when every rule below holds; anything missing or thin means "not classified"
// (fail open: everything is recorded exactly as without this module).
import type { ProbeErrorKind } from './probeErrorKind.js'

/** (b) Only these failure kinds are OUR network failing; an HTTP status or a "not cashu" answer is the mint's. */
export const VANTAGE_NETWORK_KINDS: readonly ProbeErrorKind[] = ['dns', 'timeout', 'unreachable', 'tls']
/** (a) At least this share (percent) of the mints that were online after the previous cycle failed now... */
export const VANTAGE_MIN_FAILED_PERCENT = 50
/** (a) ...and at least this many of them. */
export const VANTAGE_MIN_FAILED_COUNT = 20
/** (c) cashu.info's last check of a mint must not be older than this to count as evidence. */
export const VANTAGE_MAX_CHECK_AGE_MS = 15 * 60_000
/** A last check this far in the future is a clock difference we tolerate; further is bogus data, not evidence. */
export const VANTAGE_MAX_CHECK_FUTURE_MS = 60_000
/** (c) At least this share (percent) of the covered failed mints must be seen up (state is not "error")... */
export const VANTAGE_MIN_SEEN_UP_PERCENT = 70
/** (d) ...and at least this many failed mints must be covered with a fresh check, else the evidence is too thin. */
export const VANTAGE_MIN_COVERED = 10

export interface VantageCashuInfo {
  /** audit_cz_mints.state: ok | warn | error */
  state: string
  /** Age of cashu.info's last check of the mint in ms (now - last_check). */
  checkAgeMs: number
}

export interface VantageMintResult {
  /** The mint's last history row before this cycle (null: never probed). */
  previousOnline: boolean | null
  /** Set when this cycle's probe of the mint ended in a failure we hold back; null otherwise. */
  failureKind: ProbeErrorKind | null
}

export interface VantageDecision {
  classified: boolean
  /** Previously online mints in this cycle (N). */
  previousOnline: number
  /** Of those, failed with a network error (F). */
  failed: number
  /** Of F, covered by cashu.info with a fresh check (C). */
  covered: number
  /** Of C, seen up by cashu.info (R). */
  seenUp: number
}

function isFresh(ageMs: number): boolean {
  return Number.isFinite(ageMs) && ageMs >= -VANTAGE_MAX_CHECK_FUTURE_MS && ageMs <= VANTAGE_MAX_CHECK_AGE_MS
}

/** Integer comparison of `part / whole >= percent / 100`, no floating point at the boundary. */
function atLeastPercent(part: number, whole: number, percent: number): boolean {
  return whole > 0 && part * 100 >= whole * percent
}

export function evaluateVantageOutage(
  results: ReadonlyMap<string, VantageMintResult>,
  cashuInfo: ReadonlyMap<string, VantageCashuInfo>,
): VantageDecision {
  let previousOnline = 0
  const failedUrls: string[] = []
  for (const [url, r] of results) {
    if (r.previousOnline !== true) continue
    previousOnline++
    if (r.failureKind !== null && VANTAGE_NETWORK_KINDS.includes(r.failureKind)) failedUrls.push(url)
  }
  let covered = 0
  let seenUp = 0
  for (const url of failedUrls) {
    const c = cashuInfo.get(url)
    if (!c || !isFresh(c.checkAgeMs)) continue
    covered++
    if (c.state !== 'error') seenUp++
  }
  const failed = failedUrls.length
  const classified =
    failed >= VANTAGE_MIN_FAILED_COUNT && atLeastPercent(failed, previousOnline, VANTAGE_MIN_FAILED_PERCENT) &&
    covered >= VANTAGE_MIN_COVERED && atLeastPercent(seenUp, covered, VANTAGE_MIN_SEEN_UP_PERCENT)
  return { classified, previousOnline, failed, covered, seenUp }
}
