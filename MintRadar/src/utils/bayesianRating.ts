import type { KnownMint } from '@/hooks/useKnownMints'

// Confidence-adjusted average for ORDERING mints in the "Rating" sort (and the rating tie-break of the
// Reliability Score sort). Never displayed: the card keeps showing the real average and review count.
//
//   (n * avg + weight * prior) / (n + weight)
//
// A mint with few rated reviews is pulled towards `prior` (3.5, a neutral mid-scale rating), so one 5.0
// review (-> 3.75) ranks below 83 reviews at 4.8 (-> 4.73); the pull fades as n grows (4.0 with 30 reviews
// -> 3.93). Pure; runs on the already loaded known-mints list.
export const RATING_PRIOR = 3.5
export const RATING_PRIOR_WEIGHT = 5

export function bayesianRating(
  avg: number,
  n: number,
  { prior = RATING_PRIOR, weight = RATING_PRIOR_WEIGHT }: { prior?: number; weight?: number } = {},
): number {
  const count = Math.max(0, n)
  return (count * avg + weight * prior) / (count + weight)
}

/**
 * Sort key of a mint: bayesianRating over exactly the numbers the card shows — the average over the RATED
 * reviews (operator reviews excluded by the backend) and the number of rated reviews. -1 for a mint without
 * a rated review, so it sorts after every rated mint. `reviewRatedCount` is null until the backend's startup
 * recount has filled it; reviewCount (which also counts comment-only reviews) stands in until then.
 */
export function ratingSortKey(mint: Pick<KnownMint, 'reviewAvgRating' | 'reviewRatedCount' | 'reviewCount'>): number {
  if (mint.reviewAvgRating == null) return -1
  return bayesianRating(mint.reviewAvgRating, mint.reviewRatedCount ?? mint.reviewCount ?? 0)
}
