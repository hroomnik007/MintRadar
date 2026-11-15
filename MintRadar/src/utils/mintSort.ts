import type { KnownMint } from '@/hooks/useKnownMints'
import { ratingSortKey } from '@/utils/bayesianRating'
import { compareReliabilityThenRating } from '@/utils/reliabilitySort'

export type MintSortKey = 'name' | 'latency' | 'rating' | 'reliability' | 'reviewCount'
export type SortDir = 'asc' | 'desc'

export const DEFAULT_SORT_DIRS: Record<MintSortKey, SortDir> = { rating: 'desc', latency: 'asc', reliability: 'desc', name: 'asc', reviewCount: 'desc' }

/** The sort value of a mint for the keys that can be missing; null = no value (unrated, no reviews, no latency). */
function optionalKey(m: KnownMint, sortBy: 'rating' | 'latency' | 'reviewCount'): number | null {
  if (sortBy === 'rating') {
    const k = ratingSortKey(m)
    return k < 0 ? null : k
  }
  if (sortBy === 'latency') return m.online === true && m.latencyMs != null ? m.latencyMs : null
  return m.reviewCount && m.reviewCount > 0 ? m.reviewCount : null
}

/**
 * One comparator for the Dashboard grid and list. The direction flips only real values: a mint without a rating,
 * reviews or a latency stays after every mint that has one, ascending or descending (2026-11-15 audit: ascending
 * Rating put the unrated mints first). Equal values keep the incoming order (stable sort).
 */
export function compareMintsForSort(a: KnownMint, b: KnownMint, sortBy: MintSortKey, sortDir: SortDir, nameOf: (m: KnownMint) => string): number {
  const flip = sortDir === DEFAULT_SORT_DIRS[sortBy] ? 1 : -1
  if (sortBy === 'rating' || sortBy === 'latency' || sortBy === 'reviewCount') {
    const ka = optionalKey(a, sortBy)
    const kb = optionalKey(b, sortBy)
    if (ka === null || kb === null) {
      if (ka === null && kb === null) return 0
      return ka === null ? 1 : -1
    }
    // Default directions: rating and reviews high first, latency low first.
    const result = sortBy === 'latency' ? ka - kb : kb - ka
    return flip * result
  }
  if (sortBy === 'reliability') return flip * compareReliabilityThenRating(a, b)
  return flip * nameOf(a).localeCompare(nameOf(b))
}
