import { describe, it, expect } from 'vitest'
import { computeServerReliabilityScore, serverVersionFreshnessScore } from '../prober.js'
import { TRACKED_NUT_COUNT, TRACKED_NUT_KEYS, isEligibleForRecommendation, MIN_RECOMMENDATION_AGE_DAYS } from '../shared/reliabilityScore.js'

describe('TRACKED_NUT_KEYS', () => {
  it('has exactly 14 entries and matches TRACKED_NUT_COUNT', () => {
    expect(TRACKED_NUT_KEYS.length).toBe(14)
    expect(TRACKED_NUT_KEYS.length).toBe(TRACKED_NUT_COUNT)
  })

  it('excludes wallet-only, auth, and payment-method NUT keys', () => {
    for (const excluded of ['13', '16', '18', '21', '22', '23', '24', '25', '26', '27', '28', '30']) {
      expect(TRACKED_NUT_KEYS).not.toContain(excluded)
    }
  })
})

describe('isEligibleForRecommendation', () => {
  const NOW = new Date('2026-09-19T00:00:00Z').getTime()
  const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

  it('rejects a mint discovered 5 days ago', () => {
    expect(isEligibleForRecommendation(daysAgo(5), NOW)).toBe(false)
  })

  it('rejects a mint discovered exactly at the threshold minus a moment', () => {
    expect(isEligibleForRecommendation(daysAgo(MIN_RECOMMENDATION_AGE_DAYS - 0.001), NOW)).toBe(false)
  })

  it('accepts a mint discovered exactly MIN_RECOMMENDATION_AGE_DAYS ago', () => {
    expect(isEligibleForRecommendation(daysAgo(MIN_RECOMMENDATION_AGE_DAYS), NOW)).toBe(true)
  })

  it('accepts a mint discovered 20 days ago', () => {
    expect(isEligibleForRecommendation(daysAgo(20), NOW)).toBe(true)
  })

  it('rejects null/undefined discoveredAt (unknown age is never eligible)', () => {
    expect(isEligibleForRecommendation(null, NOW)).toBe(false)
    expect(isEligibleForRecommendation(undefined, NOW)).toBe(false)
  })

  it('rejects an unparsable date string', () => {
    expect(isEligibleForRecommendation('not-a-date', NOW)).toBe(false)
  })
})

// uptime 40 | NUT 15 | version 15 | contact 5 | audit 25
// null/<3 audit samples → 12.5; new mint cap is optional last arg
// NUT support denominator is TRACKED_NUT_COUNT = 14 (src/shared/reliabilityScore.ts) — passing
// a nutCount at or above 14 always maxes this component out.
describe('computeServerReliabilityScore', () => {
  it('returns 100 for a perfect mint', () => {
    expect(computeServerReliabilityScore(100, 14, 'Nutshell/0.20', 3, 100, 0)).toBe(100)
  })

  it('a mint maxed on every component scores exactly 100', () => {
    expect(computeServerReliabilityScore(100, 28, 'Nutshell/0.20', 6, 100, 0)).toBe(100)
  })

  it('returns a low, finite score for a mint with no data', () => {
    const score = computeServerReliabilityScore(0, null, null, 0, null, null)
    expect(score).toBe(13) // 12.5 → 13
    expect(Number.isFinite(score)).toBe(true)
  })

  it('computes from remaining components when audit data is missing', () => {
    // 40+15+15+5+12.5 = 87.5 → 88
    expect(computeServerReliabilityScore(100, 14, 'Nutshell/0.20', 3, null, null)).toBe(88)
  })

  it('caps a brand-new mint at 75 even if components max out', () => {
    const now = new Date()
    const young = new Date(now.getTime() - 5 * 86_400_000).toISOString()
    expect(computeServerReliabilityScore(100, 14, 'Nutshell/0.20', 3, 100, 0, undefined, young)).toBe(75)
  })

  it('does not cap a mint older than 30 days', () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString()
    expect(computeServerReliabilityScore(100, 14, 'Nutshell/0.20', 3, 100, 0, undefined, old)).toBe(100)
  })

  describe('uptime component (40%)', () => {
    it('contributes 0 at 0% uptime', () => {
      expect(computeServerReliabilityScore(0, null, null, 0, null, null)).toBe(13)
    })
    it('contributes 40 at 100% uptime', () => {
      // 40 + 12.5 = 52.5 → 53
      expect(computeServerReliabilityScore(100, null, null, 0, null, null)).toBe(53)
    })
  })

  describe('NUT support component (15%)', () => {
    it('contributes 0 with 0 nuts', () => {
      expect(computeServerReliabilityScore(0, 0, null, 0, null, null)).toBe(13)
    })
    it('contributes 15 at 14 nuts (the full tracked count)', () => {
      // 15 + 12.5 = 27.5 → 28
      expect(computeServerReliabilityScore(0, 14, null, 0, null, null)).toBe(28)
    })
    it('caps NUT support at 14 nuts — a higher count scores no higher', () => {
      expect(computeServerReliabilityScore(0, 50, null, 0, null, null)).toBe(28)
    })
  })

  describe('contact component (5%)', () => {
    it('contributes 0 with no contacts', () => {
      expect(computeServerReliabilityScore(0, null, null, 0, null, null)).toBe(13)
    })
    it('contributes 5 with 3 contacts', () => {
      // 5 + 12.5 = 17.5 → 18
      expect(computeServerReliabilityScore(0, null, null, 3, null, null)).toBe(18)
    })
    it('3, 6 and 60 contacts score identically', () => {
      expect(computeServerReliabilityScore(0, null, null, 3, null, null)).toBe(18)
      expect(computeServerReliabilityScore(0, null, null, 6, null, null)).toBe(18)
      expect(computeServerReliabilityScore(0, null, null, 60, null, null)).toBe(18)
    })
    it('cannot inflate Reliability Score via contact count', () => {
      expect(computeServerReliabilityScore(0, null, null, 60, null, null)).toBe(18)
    })
  })

  describe('audit reliability component (25%)', () => {
    const base = (total: number | null, errors: number) =>
      computeServerReliabilityScore(0, null, null, 0, total, errors)
    it('neutral 12.5 when audit data is missing', () => {
      expect(base(null, 0)).toBe(13)
    })
    it('neutral 12.5 below minimum sample size', () => {
      expect(base(1, 0)).toBe(13)
      expect(base(2, 1)).toBe(13)
    })
    it('25 for zero error rate', () => {
      expect(base(3, 0)).toBe(25)
      expect(base(150, 0)).toBe(25)
    })
    it('20 for error rate < 0.01', () => {
      expect(base(1000, 5)).toBe(20)
    })
    it('15 for error rate < 0.05', () => {
      expect(base(100, 3)).toBe(15)
    })
    it('10 for error rate < 0.15', () => {
      expect(base(100, 10)).toBe(10)
    })
    it('5 for error rate >= 0.15', () => {
      expect(base(20, 10)).toBe(5)
    })
  })

  describe('negative / null inputs never crash or return NaN', () => {
    it('handles negative uptime without NaN', () => {
      expect(Number.isFinite(computeServerReliabilityScore(-50, null, null, 0, null, null))).toBe(true)
    })
    it('handles negative nutCount without NaN', () => {
      expect(Number.isFinite(computeServerReliabilityScore(0, -5, null, 0, null, null))).toBe(true)
    })
    it('handles all-null inputs without NaN', () => {
      expect(Number.isNaN(computeServerReliabilityScore(0, null, null, 0, null, null))).toBe(false)
    })
  })
})

describe('serverVersionFreshnessScore', () => {
  it('returns 0 for null / undefined / empty', () => {
    expect(serverVersionFreshnessScore(null)).toBe(0)
    expect(serverVersionFreshnessScore(undefined)).toBe(0)
    expect(serverVersionFreshnessScore('')).toBe(0)
  })
  it('returns 2.5 for unrecognized software', () => {
    expect(serverVersionFreshnessScore('garbage')).toBe(2.5)
    expect(serverVersionFreshnessScore('0.20')).toBe(2.5)
  })
  it('returns 3 for recognized software with unparseable version', () => {
    expect(serverVersionFreshnessScore('Nutshell/garbage')).toBe(3)
    expect(serverVersionFreshnessScore('Nutshell/12')).toBe(3)
  })
  it('scores newest Nutshell highest', () => {
    expect(serverVersionFreshnessScore('Nutshell/0.20')).toBe(10)
  })
  it('decreases by 2 per version step', () => {
    expect(serverVersionFreshnessScore('Nutshell/0.19')).toBe(8)
    expect(serverVersionFreshnessScore('Nutshell/0.18')).toBe(6)
    expect(serverVersionFreshnessScore('Nutshell/0.15')).toBe(0)
  })
  it('treats a newer Nutshell as freshest', () => {
    expect(serverVersionFreshnessScore('Nutshell/0.21')).toBe(10)
  })
  it('recognizes cdk-mintd on its own ladder', () => {
    expect(serverVersionFreshnessScore('cdk-mintd/0.17.5')).toBe(10)
    expect(serverVersionFreshnessScore('cdk-mintd/0.16.0')).toBe(8)
  })
  it('strips v and -rc suffix', () => {
    expect(serverVersionFreshnessScore('cdk-mintd/v0.17.5')).toBe(10)
    expect(serverVersionFreshnessScore('cdk-mintd/0.17.0-rc.3')).toBe(10)
  })
  it('scores unrecognized software neutrally', () => {
    expect(serverVersionFreshnessScore('LekMint/1.1.1')).toBe(2.5)
    expect(serverVersionFreshnessScore('Nutshell-CF/1.0.0')).toBe(2.5)
  })
  it('prefers latestVersions cache', () => {
    const latest = { cdk: { major: 0, minor: 18 } }
    expect(serverVersionFreshnessScore('cdk-mintd/0.17.5', latest)).toBe(8)
    expect(serverVersionFreshnessScore('cdk-mintd/0.18.0', latest)).toBe(10)
  })
})
