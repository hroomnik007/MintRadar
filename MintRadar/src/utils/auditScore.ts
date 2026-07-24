// Audit reliability score (the 5%-weight "audit" component of Trust Score).
//
// SOURCE OF TRUTH is backend/src/shared/auditScore.ts — this frontend package can't import
// it directly (separate npm package, no workspace set up between backend/ and the frontend),
// so this is a manually-synced copy. Do not change the logic here without also updating the
// backend copy (and vice versa) — both must always agree on the same mint's audit component,
// since this feeds both the server-side Trust Score (prober.ts) and this app's client-side
// Trust Score Breakdown (MintDetail.tsx).
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
