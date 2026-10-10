import type { KnownMint } from '@/hooks/useKnownMints'
import { bayesianRating, RATING_PRIOR } from '@/utils/bayesianRating'

// Scoring behind the Tools page "Best mint for me" wizard. Pure; Tools.tsx supplies the inputs.

export type WizardCheck = 'fast' | 'reliable' | 'ln' | 'seed' | 'p2pk' | 'ws'
export type SizeOption = 'small' | 'medium' | 'large'

export type Weights = { latency: number; reliability: number; nuts: number; reviews: number }

type CoreWeights = Omit<Weights, 'reviews'>

const FAST_WEIGHTS: CoreWeights = { latency: 0.6, reliability: 0.3, nuts: 0.1 }
const RELIABLE_WEIGHTS: CoreWeights = { latency: 0.2, reliability: 0.7, nuts: 0.1 }

// Share of the final score that comes from community reviews. Deliberately small: the reviews are
// self-published on Nostr, so they nudge the order of otherwise close mints and never decide it.
// The other three weights are scaled by (1 - REVIEWS_WEIGHT), so all four still sum to 1.
export const REVIEWS_WEIGHT = 0.1

// A mint needs at least this many rated reviews before its rating counts at all.
export const MIN_REVIEWS_FOR_SCORE = 3

// Fast+Reliable both checked → average the two vectors (each already sums to
// 1, so the average does too — no separate re-normalization step needed).
// Neither checked (only filter-type checks selected) → falls back to the
// Reliable weights, per spec.
function baseWeightsFor(checks: Set<WizardCheck>): CoreWeights {
  const fast = checks.has('fast')
  const reliable = checks.has('reliable')
  if (fast && reliable) {
    return {
      latency: (FAST_WEIGHTS.latency + RELIABLE_WEIGHTS.latency) / 2,
      reliability: (FAST_WEIGHTS.reliability + RELIABLE_WEIGHTS.reliability) / 2,
      nuts: (FAST_WEIGHTS.nuts + RELIABLE_WEIGHTS.nuts) / 2,
    }
  }
  if (fast) return FAST_WEIGHTS
  return RELIABLE_WEIGHTS
}

// Larger stored balances carry more risk if the mint turns out unreliable, so
// shift weight toward reliability — proportionally reducing latency/nuts so the
// three weights still sum to 1.
const LARGE_RELIABILITY_BOOST = 0.15

export function weightsFor(checks: Set<WizardCheck>, size: SizeOption): Weights {
  const base = baseWeightsFor(checks)
  let core = base
  if (size === 'large') {
    const scale = (1 - base.reliability - LARGE_RELIABILITY_BOOST) / (1 - base.reliability)
    core = { latency: base.latency * scale, reliability: base.reliability + LARGE_RELIABILITY_BOOST, nuts: base.nuts * scale }
  }
  const keep = 1 - REVIEWS_WEIGHT
  return {
    latency: core.latency * keep,
    reliability: core.reliability * keep,
    nuts: core.nuts * keep,
    reviews: REVIEWS_WEIGHT,
  }
}

/**
 * Review component, 0..1. The Bayesian-adjusted average (same prior as the Rating sort, so one 5★ review
 * can't beat many good ones) mapped from the 1–5 scale. A mint with no usable rating gets the neutral
 * value (the prior itself), so having no reviews neither helps nor hurts. Unusable means: no average,
 * fewer than MIN_REVIEWS_FOR_SCORE rated reviews, or a flagged review surge (possible manipulation).
 * Operator reviews are already excluded from reviewAvgRating/reviewRatedCount by the backend.
 */
export function reviewsScore(
  mint: Pick<KnownMint, 'reviewAvgRating' | 'reviewRatedCount' | 'reviewCount' | 'reviewSurge'>,
): number {
  const n = mint.reviewRatedCount ?? mint.reviewCount ?? 0
  const usable = mint.reviewAvgRating != null && n >= MIN_REVIEWS_FOR_SCORE && !mint.reviewSurge
  const adjusted = usable ? bayesianRating(mint.reviewAvgRating as number, n) : RATING_PRIOR
  return (adjusted - 1) / 4
}
