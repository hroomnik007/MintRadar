import { describe, it, expect } from 'vitest'
import { bayesianRating, ratingSortKey, RATING_PRIOR, RATING_PRIOR_WEIGHT } from '@/utils/bayesianRating'
import { compareReliabilityThenRating, listRating } from '@/utils/reliabilitySort'
import type { KnownMint } from '@/hooks/useKnownMints'

describe('bayesianRating', () => {
  it('defaults: prior 3.5, weight 5', () => {
    expect(RATING_PRIOR).toBe(3.5)
    expect(RATING_PRIOR_WEIGHT).toBe(5)
  })
  it('the reference values: one 5.0 review is 3.75, 83 reviews at 4.8 about 4.73, 30 at 4.0 about 3.93', () => {
    expect(bayesianRating(5.0, 1)).toBeCloseTo(3.75, 10)
    expect(bayesianRating(4.8, 83)).toBeCloseTo(4.7264, 3)
    expect(bayesianRating(4.0, 30)).toBeCloseTo(3.9286, 3)
  })
  it('one 5.0 review ranks below 83 reviews at 4.8', () => {
    expect(bayesianRating(5.0, 1)).toBeLessThan(bayesianRating(4.8, 83))
  })
  it('n = 0 gives the prior; a negative n is treated as 0; a large n approaches the average', () => {
    expect(bayesianRating(5, 0)).toBe(3.5)
    expect(bayesianRating(5, -4)).toBe(3.5)
    expect(bayesianRating(4.2, 100000)).toBeCloseTo(4.2, 3)
  })
  it('custom prior and weight', () => {
    expect(bayesianRating(5, 5, { prior: 3, weight: 5 })).toBe(4)
    expect(bayesianRating(5, 5, { weight: 15 })).toBeCloseTo((25 + 52.5) / 20, 10)
  })
})

describe('Rating sort order on a fixture list', () => {
  const mint = (name: string, over: Partial<KnownMint>): KnownMint => ({ url: `https://${name}.example`, name, online: true, reliabilityScore: 80, ...over }) as KnownMint
  const one = mint('one', { reviewAvgRating: 5.0, reviewCount: 1, reviewRatedCount: 1 })
  const many = mint('many', { reviewAvgRating: 4.8, reviewCount: 83, reviewRatedCount: 83 })
  const none = mint('none', {})
  const three = mint('three', { reviewAvgRating: 5.0, reviewCount: 3, reviewRatedCount: 3 })
  const order = (l: KnownMint[]) => [...l].sort((a, b) => ratingSortKey(b) - ratingSortKey(a)).map(m => m.name)

  it('83 x 4.8, then 3 x 5.0, then 1 x 5.0, the unrated mint last', () => {
    expect(order([none, one, three, many])).toEqual(['many', 'three', 'one', 'none'])
    expect(order([many, three, one, none])).toEqual(['many', 'three', 'one', 'none'])
  })
  it('uses the number of RATED reviews, not all counted reviews (comment-only ones add no weight)', () => {
    const commentHeavy = mint('c', { reviewAvgRating: 5.0, reviewCount: 40, reviewRatedCount: 1 })
    expect(ratingSortKey(commentHeavy)).toBeCloseTo(3.75, 10)
  })
  it('falls back to reviewCount while reviewRatedCount is null; an average of null is unrated', () => {
    expect(ratingSortKey(mint('f', { reviewAvgRating: 4.0, reviewCount: 30, reviewRatedCount: null }))).toBeCloseTo(3.9286, 3)
    expect(ratingSortKey(mint('g', { reviewAvgRating: null, reviewCount: 5, reviewRatedCount: 0 }))).toBe(-1)
  })
  it('ignores the backend IMDB-style reviewWeightedRating', () => {
    expect(ratingSortKey(mint('w', { reviewAvgRating: 5.0, reviewCount: 1, reviewRatedCount: 1, reviewWeightedRating: 4.99 }))).toBeCloseTo(3.75, 10)
  })
  it('the Reliability sort uses the same key as its rating tie-break', () => {
    expect(listRating(many)).toBe(ratingSortKey(many))
    expect(compareReliabilityThenRating(many, one)).toBeLessThan(0)
    expect(compareReliabilityThenRating(one, many)).toBeGreaterThan(0)
    expect(compareReliabilityThenRating(three, none)).toBeLessThan(0)
  })
})
