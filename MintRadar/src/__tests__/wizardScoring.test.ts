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

describe('latencyScore (2026-11-13: stable order without "Fast from here")', () => {
  it('without Fast: every mint under LATENCY_SLOW_MS scores the same, so measurement noise cannot reorder the results', async () => {
    const { latencyScore } = await import('@/utils/wizardScoring')
    expect(latencyScore(64, 1380, false)).toBe(1)
    expect(latencyScore(458, 1380, false)).toBe(1)
    expect(latencyScore(1999, 1380, false)).toBe(1)
    expect(latencyScore(2000, 4000, false)).toBe(0.5)
    expect(latencyScore(5000, 5000, false)).toBe(0)
    expect(latencyScore(null, 1380, false)).toBe(0)
  })
  it('with Fast: relative to the slowest measured candidate, faster is higher', async () => {
    const { latencyScore } = await import('@/utils/wizardScoring')
    expect(latencyScore(100, 1000, true)).toBeCloseTo(0.9)
    expect(latencyScore(1000, 1000, true)).toBe(0)
    expect(latencyScore(null, 1000, true)).toBe(0)
    expect(latencyScore(64, 1000, true)).toBeGreaterThan(latencyScore(458, 1000, true))
  })
  it('"Reliable" alone: one Reliability point now decides between two mints of normal speed', async () => {
    const { latencyScore, weightsFor } = await import('@/utils/wizardScoring')
    const w = weightsFor(new Set(['reliable']), 'medium')
    const score = (rel: number, ms: number) => w.latency * latencyScore(ms, 1380, false) + w.reliability * (rel / 100)
    expect(score(98, 458)).toBeGreaterThan(score(97, 64))
  })
})
