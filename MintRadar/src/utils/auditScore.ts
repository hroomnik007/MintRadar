// Audit reliability score (the 5%-weight "audit" component of Trust Score).
//
// SOURCE OF TRUTH is backend/src/shared/auditScore.ts — this frontend package can't import
// it directly (separate npm package, no workspace set up between backend/ and the frontend),
// so this is a manually-synced copy. Do not change the logic here without also updating the
// backend copy (and vice versa) — both must always agree on the same mint's audit component,
// since this feeds both the server-side Trust Score (prober.ts) and this app's client-side
// Trust Score Breakdown (MintDetail.tsx).
//
// Error rate is computed over a rolling window of the mint's last ~100 swaps, not
// audit.8333.space's cumulative lifetime counters — a mint that had problems long ago but
// has since been fixed is not penalized forever.
export const AUDIT_MIN_SAMPLES = 3

export function auditReliabilityScore(
  recentTotal: number | null,
  recentErrors: number | null
): number {
  if (recentTotal === null || recentTotal < AUDIT_MIN_SAMPLES) return 2.5
  const errorRate = (recentErrors ?? 0) / recentTotal
  if (errorRate === 0) return 5
  if (errorRate < 0.01) return 4
  if (errorRate < 0.05) return 3
  if (errorRate < 0.15) return 2
  return 1
}

// True when there's some audit history but not enough of it (< AUDIT_MIN_SAMPLES) to score
// reliably — distinct from "no audit data at all" (recentTotal === null).
export function isAuditUnknown(recentTotal: number | null): boolean {
  return recentTotal !== null && recentTotal < AUDIT_MIN_SAMPLES
}
