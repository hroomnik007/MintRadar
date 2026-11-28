import { describe, it, expect } from 'vitest'
import { weightsFor, reviewsScore, REVIEWS_WEIGHT, whyBestReasons, whyBestText, WHY_BEST_FALLBACK, type WizardCheck, type SizeOption, type WhyBestEntry } from '@/utils/wizardScoring'

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

describe('latencyPart (2026-11-14: without "Fast from here" latency only breaks ties)', () => {
  it('without Fast it is worth at most LATENCY_TIE_BREAK_POINTS Reliability points, also for a failed measurement', async () => {
    const { latencyPart, weightsFor, LATENCY_TIE_BREAK_POINTS } = await import('@/utils/wizardScoring')
    expect(LATENCY_TIE_BREAK_POINTS).toBe(2)
    for (const size of ['small', 'medium', 'large'] as const) {
      const w = weightsFor(new Set(['reliable']), size)
      const point = w.reliability / 100
      expect(latencyPart(w, 64, 1380, false)).toBeCloseTo(LATENCY_TIE_BREAK_POINTS * point, 12)
      expect(latencyPart(w, null, 1380, false)).toBe(0)
      expect(latencyPart(w, 64, 1380, false) - latencyPart(w, null, 1380, false)).toBeLessThanOrEqual(LATENCY_TIE_BREAK_POINTS * point + 1e-12)
    }
  })
  it('"Reliable": a mint 3 points better stays #1 even when its measurement failed or it is slow; 1 point can be swapped by speed', async () => {
    const { latencyPart, weightsFor } = await import('@/utils/wizardScoring')
    const w = weightsFor(new Set(['reliable']), 'medium')
    const score = (rel: number, ms: number | null) => latencyPart(w, ms, 1380, false) + w.reliability * (rel / 100)
    expect(score(98, null)).toBeGreaterThan(score(95, 64))
    expect(score(98, 4000)).toBeGreaterThan(score(95, 64))
    expect(score(98, 2100)).toBeGreaterThan(score(96, 64) - 1e-12)
    expect(score(97, 64)).toBeGreaterThan(score(98, null))
    // Two mints of normal speed: speed never matters, the score does.
    expect(score(98, 1900)).toBeGreaterThan(score(97, 40))
  })
  it('with Fast the full latency weight still applies (latency is the chosen priority)', async () => {
    const { latencyPart, latencyScore, weightsFor } = await import('@/utils/wizardScoring')
    const w = weightsFor(new Set(['fast']), 'small')
    expect(latencyPart(w, 100, 1000, true)).toBeCloseTo(w.latency * latencyScore(100, 1000, true), 12)
  })
})

// U5 (UI/UX report 2026-11-22): the line under #1 names up to two concrete reasons from the score parts.
describe('whyBestReasons / whyBestText', () => {
  const entry = (o: Partial<WhyBestEntry['parts']>, mint: Partial<WhyBestEntry['mint']>, latencyMs: number | null = null): WhyBestEntry => ({
    parts: { latency: 0, reliability: 0, nuts: 0, reviews: 0, software: 0, ...o },
    latencyMs,
    mint: { reliabilityScore: 90, nutCount: 12, reviewAvgRating: null, reviewRatedCount: 0, reviewCount: 0, reviewSurge: false, ...mint },
  })
  it('names the parts where #1 gains most over #2, largest first, at most two', () => {
    // The report's case: 98 above 99 because of reviews and NUTs.
    const best = entry({ reliability: 0.617, reviews: 0.09, nuts: 0.09 }, { reliabilityScore: 98, nutCount: 14, reviewAvgRating: 4.9, reviewRatedCount: 16 })
    const second = entry({ reliability: 0.624, reviews: 0.07, nuts: 0.08, latency: 0.01 }, { reliabilityScore: 99, nutCount: 12, reviewAvgRating: 5, reviewRatedCount: 4 })
    const r = whyBestReasons(best, second)
    // Review 2026-11-28 (W1): a lower average from more people is "rated by more people", and the lower score is said.
    expect(r).toEqual(['rated by more people (4.9★ from 16 vs 5.0★ from 4)', 'more NUTs supported (14 vs 12)', 'Reliability Score nearly the same (98 vs 99)'])
    expect(whyBestText(r)).toBe('Best match: rated by more people (4.9★ from 16 vs 5.0★ from 4) · more NUTs supported (14 vs 12) · Reliability Score nearly the same (98 vs 99)')
  })
  it('W1: a higher average reads "better reviews" with both; a clearly lower score reads "lower"', () => {
    const best = entry({ reliability: 0.55, reviews: 0.2 }, { reliabilityScore: 90, reviewAvgRating: 4.8, reviewRatedCount: 30 })
    const second = entry({ reliability: 0.6, reviews: 0.05 }, { reliabilityScore: 96, reviewAvgRating: 3.9, reviewRatedCount: 8 })
    expect(whyBestReasons(best, second)).toEqual(['better reviews (4.8★ from 30 vs 3.9★ from 8)', 'Reliability Score lower (90 vs 96)'])
    // No caveat when #1 also has the higher (or the same) score.
    expect(whyBestReasons(entry({ reviews: 0.2 }, { reliabilityScore: 96, reviewAvgRating: 4.8, reviewRatedCount: 30 }), entry({ reviews: 0.1 }, { reliabilityScore: 96 }))).toEqual(['better reviews (4.8★ from 30 ratings)'])
  })
  it('a higher Reliability Score, the browser latency and the preferred software', () => {
    const best = entry({ reliability: 0.7, latency: 0.3, software: 0.02 }, { reliabilityScore: 95 }, 120)
    const second = entry({ reliability: 0.6, latency: 0.1 }, { reliabilityScore: 85 }, 900)
    expect(whyBestReasons(best, second)).toEqual(['faster from your browser (120 vs 900 ms)', 'higher Reliability Score (95 vs 85)'])
    expect(whyBestReasons(best, second, 3)[2]).toBe('your preferred software')
  })
  it('never praises reviews that do not count, and falls back without a runner-up or a lead', () => {
    const best = entry({ reviews: 0.08 }, { reviewAvgRating: 5, reviewRatedCount: 1 })
    const second = entry({ reviews: 0.05 }, {})
    expect(whyBestReasons(best, second)).toEqual([])
    expect(whyBestReasons(best, null)).toEqual([])
    expect(whyBestText([])).toBe(WHY_BEST_FALLBACK)
  })
})
