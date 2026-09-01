import { pool } from './db.js'

// Precomputes each mint's Trust Score "N days ago" snapshot into
// mints.trust_score_7d_ago / trust_score_30d_ago, so GET /api/stats/trust-movers
// is a plain indexed read of `mints` rather than two DISTINCT ON passes over the
// whole mint_history table (~2M rows, ~2.5s cold) on every cache miss. Same
// rollup idea as review_count / review_avg_rating (reviewsSync.ts).
//
// The "latest" score is NOT rolled up here — it already lives on
// mints.last_trust_score, written by every probe (prober.ts). Only the
// point-in-time historical snapshot needs mint_history.
//
// A mint with no scored history reaching past the cutoff gets NULL, which is
// exactly how the endpoint represents "insufficient history" (it filters those
// rows out) — matching the old query's INNER JOIN behaviour.

let rollupRunning = false

export function isTrustMoversRollupRunning(): boolean {
  return rollupRunning
}

// Single-flight: a second call while one is in progress is a no-op. Never throws
// — a failed rollup just leaves the previous snapshot values in place.
export async function refreshTrustMoversRollup(): Promise<void> {
  if (rollupRunning) {
    console.warn('[trust-movers-rollup] already running — skipping overlapping run')
    return
  }
  rollupRunning = true
  const started = Date.now()
  try {
    const result = await pool.query(`
      UPDATE mints m SET
        trust_score_7d_ago = sub.s7,
        trust_score_30d_ago = sub.s30,
        trust_movers_checked_at = NOW()
      FROM (
        SELECT
          m2.url,
          (SELECT h.trust_score FROM mint_history h
             WHERE h.url = m2.url AND h.trust_score IS NOT NULL
               AND h.checked_at <= NOW() - INTERVAL '7 days'
             ORDER BY h.checked_at DESC LIMIT 1) AS s7,
          (SELECT h.trust_score FROM mint_history h
             WHERE h.url = m2.url AND h.trust_score IS NOT NULL
               AND h.checked_at <= NOW() - INTERVAL '30 days'
             ORDER BY h.checked_at DESC LIMIT 1) AS s30
        FROM mints m2
      ) sub
      WHERE m.url = sub.url
    `)
    console.log(
      `[trust-movers-rollup] refreshed ${result.rowCount ?? 0} mint(s) in ${Date.now() - started}ms`,
    )
  } catch (err) {
    console.error(
      '[trust-movers-rollup] failed:',
      err instanceof Error ? err.message : err,
    )
  } finally {
    rollupRunning = false
  }
}
