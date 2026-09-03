// Weighted / Bayesian rating for the "Rating" sort only.
//
// Problem: sorting mints by the raw `review_avg_rating` (an arithmetic mean over
// rated NIP-87 reviews) lets a mint with a single 5.0 review outrank a mint with
// 99 reviews averaging 4.7 — the small sample is noise, not signal.
//
// Fix: the standard IMDB-style weighted rating
//
//   WR = (v / (v + m)) * R + (m / (v + m)) * C
//
//   R = the mint's own `reviewAvgRating`
//   v = the mint's `reviewCount`
//   m = review count at which a mint's own average gets ~half the weight
//   C = mean `reviewAvgRating` across all mints with >= 1 review
//
// This value is used ONLY for ordering the Rating sort. The Community Rating
// badge on the card keeps showing the real `reviewAvgRating` / `reviewCount`.
//
// Why `m = 8`: measured against production data (2026-09-03, 51 mints with >= 1
// review) the review-count distribution is heavily right-skewed — median 3,
// mean 8.73, p75 8, max 102, and 20 of 51 mints have exactly one review. m = 8
// (≈ the 75th percentile / the mean) means a mint has to reach the top quartile
// of review engagement before its own average outweighs the global mean:
//   v=1  -> 11% own /  89% global
//   v=3  -> 27% own /  73% global   (the median mint)
//   v=8  -> 50% / 50%
//   v=25 -> 76% own /  24% global
// A pure-median m (=3) barely damped the 1-review outliers; m>10 over-punished
// genuinely well-reviewed mid-size mints. 8 is the balance the data supports.
export const RATING_SORT_M = 8

type RatingRow = { reviewCount?: number | null; reviewAvgRating?: number | null }

// C — mean of `reviewAvgRating` over every mint that has at least one review AND
// a non-null average (a mint whose only reviews are rating-less endorsement
// events has reviewCount >= 1 but reviewAvgRating === null — see
// reviewsSync.computeAvgRating — and must not count toward C).
// Returns null when no mint qualifies (nothing to sort by weighting yet).
export function globalMeanRating(mints: RatingRow[]): number | null {
  const rated = mints.filter(
    m => (m.reviewCount ?? 0) >= 1 && m.reviewAvgRating != null,
  )
  if (rated.length === 0) return null
  const sum = rated.reduce((s, m) => s + (m.reviewAvgRating as number), 0)
  return sum / rated.length
}

// WR for one mint. Null when the mint has no usable average (R) or when there is
// no global mean (C) — the caller then falls back to ordering those mints last,
// exactly as it already does for a null `reviewAvgRating`.
export function weightedRating(
  reviewCount: number | null | undefined,
  reviewAvgRating: number | null | undefined,
  globalMean: number | null,
  m: number = RATING_SORT_M,
): number | null {
  if (reviewAvgRating == null || globalMean == null) return null
  const v = Math.max(0, reviewCount ?? 0)
  const R = reviewAvgRating
  const C = globalMean
  return (v / (v + m)) * R + (m / (v + m)) * C
}
