// p50/p95 latency for /api/mints/history (Mint Detail, History summary "Median / p95"): percentile_cont over the
// successful probes (online, latency measured) of the selected period, the same window as the period's segments.

/** `days` comes from the fixed PERIOD_DAYS map (1, 7, 30, 90), never from the request; bounded again here. */
export function historyLatencyPercentilesSql(days: number): string {
  const d = Math.max(1, Math.min(90, Math.trunc(days)))
  return `
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
    FROM mint_history
    WHERE url = $1
      AND online
      AND latency_ms IS NOT NULL
      AND checked_at >= NOW() - INTERVAL '${d} days'
      AND checked_at < NOW()`
}

/** Whole milliseconds, null when the period has no successful probe with a latency. */
export function latencyPercentilesOf(row: { p50?: unknown; p95?: unknown } | undefined): { p50LatencyMs: number | null; p95LatencyMs: number | null } {
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined) return null
    const n = Number(v)
    return Number.isFinite(n) ? Math.round(n) : null
  }
  return { p50LatencyMs: num(row?.p50), p95LatencyMs: num(row?.p95) }
}
