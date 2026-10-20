import pLimit from 'p-limit'
import { pool } from './db.js'
import { logCronError } from './cronLog.js'
import { probeMintToDb, type DeferredProbeFailure } from './prober.js'
import {
  evaluateVantageOutage, VANTAGE_MIN_FAILED_COUNT,
  type VantageCashuInfo, type VantageMintResult,
} from './vantageOutage.js'

const PROBE_CONCURRENCY = 10

// In-memory only, like the other /health sync fields: reset by a restart.
let lastVantageOutageAt: string | null = null
let vantageOutageCount = 0

/** When the last probe cycle was classified as a suspected vantage outage of ours (ISO 8601 UTC), or null. */
export function getLastVantageOutageAt(): string | null {
  return lastVantageOutageAt
}

/** Number of cycles classified as a suspected vantage outage since this process started. */
export function getVantageOutageCount(): number {
  return vantageOutageCount
}

export function noteVantageOutage(at: Date = new Date()): void {
  lastVantageOutageAt = at.toISOString()
  vantageOutageCount++
}

/** Last stored status of every mint probed in the past hour, i.e. the status at the end of the previous cycle. */
async function loadPreviousStatus(): Promise<Map<string, boolean>> {
  const res = await pool.query(
    `SELECT DISTINCT ON (url) url, online
       FROM mint_history
      WHERE checked_at > NOW() - INTERVAL '1 hour'
      ORDER BY url, checked_at DESC`,
  )
  return new Map((res.rows as Array<{ url: string; online: boolean }>).map(r => [r.url, r.online]))
}

/** cashu.info's stored state and the age of its last check for the given mints (exact URL or alias match). */
async function loadCashuInfo(urls: string[]): Promise<Map<string, VantageCashuInfo>> {
  const res = await pool.query(
    `SELECT m.url, a.state, EXTRACT(EPOCH FROM (NOW() - a.last_check)) * 1000 AS age_ms
       FROM mints m
       JOIN audit_cz_mints a
         ON a.url = rtrim(m.url, '/')
         OR a.url IN (SELECT al.mint_url FROM audit_cz_aliases al WHERE al.alias_url = rtrim(m.url, '/'))
      WHERE m.url = ANY($1) AND a.last_check IS NOT NULL`,
    [urls],
  )
  const out = new Map<string, VantageCashuInfo>()
  for (const r of res.rows as Array<{ url: string; state: string; age_ms: string | number }>) {
    const checkAgeMs = Number(r.age_ms)
    const prev = out.get(r.url)
    if (!prev || checkAgeMs < prev.checkAgeMs) out.set(r.url, { state: r.state, checkAgeMs })
  }
  return out
}

/**
 * One 5-minute probe cycle. Mints that answer are recorded at once, as always. A failure caused by our own
 * network is held back until every mint was probed; if the cycle then looks like a vantage outage of ours
 * (vantageOutage.ts) those held failures are dropped, otherwise they are recorded exactly as before.
 */
export async function runProbeCycle(urls: string[]): Promise<void> {
  let previous = new Map<string, boolean>()
  try {
    previous = await loadPreviousStatus()
  } catch (err) {
    logCronError('probe previous status', err)
  }

  const deferred: DeferredProbeFailure[] = []
  const limit = pLimit(PROBE_CONCURRENCY)
  await Promise.allSettled(urls.map(url => limit(() => probeMintToDb(url, f => { deferred.push(f) }))))

  if (deferred.length >= VANTAGE_MIN_FAILED_COUNT) {
    try {
      const failureKinds = new Map(deferred.map(f => [f.url, f.kind]))
      const results = new Map<string, VantageMintResult>(urls.map(url => [url, {
        previousOnline: previous.get(url) ?? null,
        failureKind: failureKinds.get(url) ?? null,
      }]))
      const decision = evaluateVantageOutage(results, await loadCashuInfo(deferred.map(f => f.url)))
      if (decision.classified) {
        noteVantageOutage()
        console.log(
          `[probe] suspected vantage outage: ${decision.failed} of ${decision.previousOnline} previously online mints failed (network errors), ` +
          `${decision.seenUp} of ${decision.covered} covered failures seen up by cashu.info: this cycle's failures are not recorded`,
        )
        return
      }
    } catch (err) {
      // Fail open: no evidence, no classification.
      logCronError('vantage outage check', err)
    }
  }

  await Promise.allSettled(deferred.map(f => limit(() => f.commit())))
}
