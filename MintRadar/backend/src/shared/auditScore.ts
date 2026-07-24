// Audit reliability score (the 5%-weight "audit" component of Trust Score).
//
// This is the shared source of truth for both the server-side Trust Score computation
// (prober.ts's computeServerTrustScore, run on every probe cycle) and the frontend's
// client-side Trust Score Breakdown display (MintDetail.tsx) — the two must always agree
// on the same mint's audit component. The frontend cannot import this file directly
// (separate npm package, no workspace set up between backend/ and the frontend), so
// src/utils/auditScore.ts is a manually-synced copy — if you change the logic here, mirror
// the change there too.
export function auditReliabilityScore(
  nMints: number | null,
  nMelts: number | null,
  nErrors: number | null
): number {
  if (nMints === null) return 2.5
  const total = nMints + (nMelts ?? 0) + (nErrors ?? 0)
  if (total === 0) return 5
  const errorRate = (nErrors ?? 0) / total
  if (errorRate === 0) return 5
  if (errorRate < 0.01) return 4
  if (errorRate < 0.05) return 3
  if (errorRate < 0.15) return 2
  return 1
}
