import type { KnownMint } from '@/hooks/useKnownMints'
import { displayName as mintDisplayName } from '@/utils/mintFormatting'

export function listReliabilityScore(mint: KnownMint): number {
  if (mint.online !== true) return 0
  return mint.reliabilityScore ?? 0
}

// Prefer the backend Bayesian average so a mint with two 5★ reviews does not
// beat one with fifty 4.6★. Unrated mints sink below any rated mint.
export function listRating(mint: KnownMint): number {
  return mint.reviewWeightedRating ?? mint.reviewAvgRating ?? -1
}

// Default order: Reliability Score desc, then community rating desc, then name asc.
// Latency is intentionally not used — it is measured from Frankfurt, not the user.
export function compareReliabilityThenRating(a: KnownMint, b: KnownMint): number {
  const reliability = listReliabilityScore(b) - listReliabilityScore(a)
  if (reliability !== 0) return reliability
  const rating = listRating(b) - listRating(a)
  if (rating !== 0) return rating
  return mintDisplayName(a).localeCompare(mintDisplayName(b))
}
