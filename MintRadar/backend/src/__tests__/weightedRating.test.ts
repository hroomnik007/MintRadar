import { describe, it, expect } from 'vitest'
import { RATING_SORT_M, globalMeanRating, weightedRating } from '../weightedRating.js'

describe('globalMeanRating', () => {
  it('averages reviewAvgRating over mints with >= 1 review and a non-null average', () => {
    const c = globalMeanRating([
      { reviewCount: 10, reviewAvgRating: 4.0 },
      { reviewCount: 2, reviewAvgRating: 5.0 },
      { reviewCount: 0, reviewAvgRating: null }, // no reviews — ignored
      { reviewCount: 3, reviewAvgRating: null }, // only rating-less events — ignored
    ])
    expect(c).toBeCloseTo(4.5, 10)
  })

  it('returns null when no mint qualifies', () => {
    expect(globalMeanRating([{ reviewCount: 0, reviewAvgRating: null }])).toBeNull()
    expect(globalMeanRating([])).toBeNull()
  })
})

describe('weightedRating', () => {
  it('exports the documented m = 8', () => {
    expect(RATING_SORT_M).toBe(8)
  })

  it('returns null without a usable average or global mean', () => {
    expect(weightedRating(5, null, 4.5)).toBeNull()
    expect(weightedRating(5, 4.2, null)).toBeNull()
  })

  it('equals the raw average when it already equals the global mean', () => {
    expect(weightedRating(1, 4.5, 4.5)).toBeCloseTo(4.5, 10)
  })

  // The tie-break the feature exists for: a single 5.0 review must NOT outrank a
  // heavily-reviewed 4.7 mint. Numbers picked to match the spec example.
  it('ranks a 1-review 5.0 mint BELOW a 99-review 4.7 mint', () => {
    const C = 4.52 // ≈ production global mean (2026-09-03)
    const lonely = weightedRating(1, 5.0, C)!
    const established = weightedRating(99, 4.7, C)!

    // WR_lonely = (1/9)*5.0 + (8/9)*4.52 = 4.5733…
    expect(lonely).toBeCloseTo(4.5733, 3)
    // WR_established = (99/107)*4.7 + (8/107)*4.52 = 4.6865…
    expect(established).toBeCloseTo(4.6865, 3)

    expect(established).toBeGreaterThan(lonely)
    // …even though the lonely mint's raw displayed average (5.0) is higher.
    expect(5.0).toBeGreaterThan(4.7)
  })

  it('lets a genuinely high-volume mint pull ahead of the global mean', () => {
    const C = 4.0
    expect(weightedRating(100, 4.8, C)!).toBeGreaterThan(weightedRating(3, 4.8, C)!)
    expect(weightedRating(3, 4.8, C)!).toBeGreaterThan(C)
  })
})
