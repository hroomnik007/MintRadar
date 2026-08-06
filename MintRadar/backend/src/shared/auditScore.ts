// Audit reliability score (the 5%-weight "audit" component of Trust Score).
//
// This is the shared source of truth for both the server-side Trust Score computation
// (prober.ts's computeServerTrustScore, run on every probe cycle) and the frontend's
// client-side Trust Score Breakdown display (MintDetail.tsx) — the two must always agree
// on the same mint's audit component. The frontend cannot import this file directly
// (separate npm package, no workspace set up between backend/ and the frontend), so
// src/utils/auditScore.ts is a manually-synced copy — if you change the logic here, mirror
// the change there too.
//
// Error rate is computed over a rolling window of the mint's last ~100 swaps (see
// discoverMintsFromApi in discovery.ts, which fetches GET /swaps/mint/{id} from
// audit.8333.space), not audit.8333.space's cumulative lifetime counters — a mint that had
// problems long ago but has since been fixed is not penalized forever.
export const AUDIT_MIN_SAMPLES = 3

export function auditReliabilityScore(
  recentTotal: number | null,
  recentErrors: number | null
): number {
  // No data yet, or too few recent swaps to say anything meaningful — same neutral
  // default as "no data at all" (the pre-existing null → 2.5 behavior).
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
