import { describe, it, expect } from 'vitest'
import { weightsFor, reviewsScore, REVIEWS_WEIGHT, type WizardCheck, type SizeOption } from '@/utils/wizardScoring'

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0)
const combos: Set<WizardCheck>[] = [new Set(['fast']), new Set(['reliable']), new Set(['fast', 'reliable']), new Set(['ln'])]
const sizes: SizeOption[] = ['small', 'medium', 'large']

describe('weightsFor', () => {
  it('always sums to 1 and gives reviews exactly REVIEWS_WEIGHT', () => {
    for (const c of combos) for (const s of sizes) {
      const w = weightsFor(c, s)
      expect(sum(w)).toBeCloseTo(1, 10)
      expect(w.reviews).toBe(REVIEWS_WEIGHT)
    }
  })
  it('keeps the Fast / Reliable / Large relationships', () => {
    expect(weightsFor(new Set(['fast']), 'small').latency).toBeCloseTo(0.54, 10)
    expect(weightsFor(new Set(['reliable']), 'small').reliability).toBeCloseTo(0.63, 10)
    expect(weightsFor(new Set(['reliable']), 'large').reliability).toBeGreaterThan(weightsFor(new Set(['reliable']), 'small').reliability)
  })
})

describe('reviewsScore', () => {
  const m = (o: object) => ({ reviewAvgRating: null, reviewRatedCount: null, reviewCount: null, reviewSurge: false, ...o })
  const neutral = reviewsScore(m({}))
  it('no reviews is neutral', () => expect(neutral).toBeCloseTo(0.625, 10))
  it('fewer than 3 rated reviews is neutral', () => {
    expect(reviewsScore(m({ reviewAvgRating: 5, reviewRatedCount: 2, reviewCount: 2 }))).toBe(neutral)
  })
  it('a review surge is neutral', () => {
    expect(reviewsScore(m({ reviewAvgRating: 5, reviewRatedCount: 40, reviewCount: 40, reviewSurge: true }))).toBe(neutral)
  })
  it('many good reviews beat few perfect ones, bad reviews fall below neutral', () => {
    const few = reviewsScore(m({ reviewAvgRating: 5, reviewRatedCount: 3, reviewCount: 3 }))
    const many = reviewsScore(m({ reviewAvgRating: 4.6, reviewRatedCount: 40, reviewCount: 40 }))
    expect(many).toBeGreaterThan(few)
    expect(few).toBeGreaterThan(neutral)
    expect(reviewsScore(m({ reviewAvgRating: 1.5, reviewRatedCount: 20, reviewCount: 20 }))).toBeLessThan(neutral)
  })
  it('stays within 0..1', () => {
    expect(reviewsScore(m({ reviewAvgRating: 5, reviewRatedCount: 1000, reviewCount: 1000 }))).toBeLessThanOrEqual(1)
    expect(reviewsScore(m({ reviewAvgRating: 1, reviewRatedCount: 1000, reviewCount: 1000 }))).toBeGreaterThanOrEqual(0)
  })
})
