import { describe, it, expect } from 'vitest'
import { computeServerReliabilityScore } from '../prober.js'
import { TRACKED_NUT_COUNT, TRACKED_NUT_KEYS, isEligibleForRecommendation, MIN_RECOMMENDATION_AGE_DAYS, versionComponent, type AuditInput } from '../shared/reliabilityScore.js'

// Audit inputs: cashu.info attributed failures over the 7-day window (mints.audit_cz_*).
const NO_AUDIT: AuditInput = { blamed: null, total: null, fetchedAt: null }
const CLEAN: AuditInput = { blamed: 0, total: 100, fetchedAt: new Date().toISOString() }
// The ONE "latest" per family the API/prober use (versionCatalog.ts); there is no static fallback list.
const LATEST = { nutshell: { major: 0, minor: 20 }, cdk: { major: 0, minor: 17 } }

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
    expect(computeServerReliabilityScore(100, 14, 'Nutshell/0.20', 3, CLEAN, LATEST)).toBe(100)
  })

  it('a mint maxed on every component scores exactly 100', () => {
    expect(computeServerReliabilityScore(100, 28, 'Nutshell/0.20', 6, CLEAN, LATEST)).toBe(100)
  })

  it('returns a low, finite score for a mint with no data', () => {
    const score = computeServerReliabilityScore(0, null, null, 0, NO_AUDIT)
    expect(score).toBe(13) // 12.5 → 13
    expect(Number.isFinite(score)).toBe(true)
  })

  it('computes from remaining components when audit data is missing', () => {
    // 40+15+15+5+12.5 = 87.5 → 88
    expect(computeServerReliabilityScore(100, 14, 'Nutshell/0.20', 3, NO_AUDIT, LATEST)).toBe(88)
  })

  it('caps a brand-new mint at 75 even if components max out', () => {
    const now = new Date()
    const young = new Date(now.getTime() - 5 * 86_400_000).toISOString()
    expect(computeServerReliabilityScore(100, 14, 'Nutshell/0.20', 3, CLEAN, LATEST, young)).toBe(75)
  })

  it('does not cap a mint older than 30 days', () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString()
    expect(computeServerReliabilityScore(100, 14, 'Nutshell/0.20', 3, CLEAN, LATEST, old)).toBe(100)
  })

  describe('uptime component (40%)', () => {
    it('contributes 0 at 0% uptime', () => {
      expect(computeServerReliabilityScore(0, null, null, 0, NO_AUDIT)).toBe(13)
    })
    it('contributes 40 at 100% uptime', () => {
      // 40 + 12.5 = 52.5 → 53
      expect(computeServerReliabilityScore(100, null, null, 0, NO_AUDIT)).toBe(53)
    })
  })

  describe('NUT support component (15%)', () => {
    it('contributes 0 with 0 nuts', () => {
      expect(computeServerReliabilityScore(0, 0, null, 0, NO_AUDIT)).toBe(13)
    })
    it('contributes 15 at 14 nuts (the full tracked count)', () => {
      // 15 + 12.5 = 27.5 → 28
      expect(computeServerReliabilityScore(0, 14, null, 0, NO_AUDIT)).toBe(28)
    })
    it('caps NUT support at 14 nuts — a higher count scores no higher', () => {
      expect(computeServerReliabilityScore(0, 50, null, 0, NO_AUDIT)).toBe(28)
    })
  })

  describe('contact component (5%)', () => {
    it('contributes 0 with no contacts', () => {
      expect(computeServerReliabilityScore(0, null, null, 0, NO_AUDIT)).toBe(13)
    })
    it('contributes 5 with 3 contacts', () => {
      // 5 + 12.5 = 17.5 → 18
      expect(computeServerReliabilityScore(0, null, null, 3, NO_AUDIT)).toBe(18)
    })
    it('3, 6 and 60 contacts score identically', () => {
      expect(computeServerReliabilityScore(0, null, null, 3, NO_AUDIT)).toBe(18)
      expect(computeServerReliabilityScore(0, null, null, 6, NO_AUDIT)).toBe(18)
      expect(computeServerReliabilityScore(0, null, null, 60, NO_AUDIT)).toBe(18)
    })
    it('cannot inflate Reliability Score via contact count', () => {
      expect(computeServerReliabilityScore(0, null, null, 60, NO_AUDIT)).toBe(18)
    })
  })

  describe('audit reliability component (25%) — cashu.info attributed failures, 7-day window', () => {
    const NOW = Date.parse('2026-10-08T12:00:00Z')
    const fresh = new Date(NOW - 3_600_000).toISOString()
    const base = (blamed: number | null, total: number | null, fetchedAt: string | null = fresh) =>
      computeServerReliabilityScore(0, null, null, 0, { blamed, total, fetchedAt }, undefined, null, NOW)
    it('neutral 12.5 when audit data is missing', () => {
      expect(base(null, NO_AUDIT)).toBe(13)
    })
    it('neutral 12.5 below 10 swaps, whatever the blamed count', () => {
      expect(base(0, 9)).toBe(13)
      expect(base(1, 8)).toBe(13)
      expect(base(9, 9)).toBe(13)
    })
    it('25 for zero attributed failures from 10 swaps up', () => {
      expect(base(0, 10)).toBe(25)
      expect(base(0, 12)).toBe(25)
    })
    it('20 for attributed rate < 1%', () => {
      expect(base(1, 200)).toBe(20)
    })
    it('15 for attributed rate < 5%', () => {
      expect(base(1, 30)).toBe(15) // 3.3%
    })
    it('10 for attributed rate < 15%', () => {
      expect(base(10, 100)).toBe(10)
    })
    it('5 for attributed rate >= 15%', () => {
      expect(base(3, 10)).toBe(5) // 30%
    })
    it('clamps blamed above total to total', () => {
      expect(base(500, 20)).toBe(5)
    })
    it('neutral when the stored detail is older than 168 hours, scored at 167', () => {
      expect(base(0, 100, new Date(NOW - 167 * 3_600_000).toISOString())).toBe(25)
      expect(base(0, 100, new Date(NOW - 169 * 3_600_000).toISOString())).toBe(13)
    })
    it('treats a fetched_at in the future as fresh', () => {
      expect(base(0, 100, new Date(NOW + 3_600_000).toISOString())).toBe(25)
    })
    it('neutral when blamed or total is null, non-finite or negative', () => {
      expect(base(null, 100)).toBe(13)
      expect(base(0, null)).toBe(13)
      expect(base(Number.NaN, 100)).toBe(13)
      expect(base(0, Number.POSITIVE_INFINITY)).toBe(13)
      expect(base(-1, 100)).toBe(13)
    })
    it('never reads the audit.8333.space window: only the cashu.info inputs change the score', () => {
      expect(computeServerReliabilityScore(0, null, null, 0, NO_AUDIT, undefined, null, NOW)).toBe(13)
    })
  })

  describe('negative / null inputs never crash or return NaN', () => {
    it('handles negative uptime without NaN', () => {
      expect(Number.isFinite(computeServerReliabilityScore(-50, null, null, 0, NO_AUDIT))).toBe(true)
    })
    it('handles negative nutCount without NaN', () => {
      expect(Number.isFinite(computeServerReliabilityScore(0, -5, null, 0, NO_AUDIT))).toBe(true)
    })
    it('handles all-null inputs without NaN', () => {
      expect(Number.isNaN(computeServerReliabilityScore(0, null, null, 0, NO_AUDIT))).toBe(false)
    })
  })
})

describe('version component (15 points, one rule: shared/versionRule.ts)', () => {
  const L = { nutshell: { major: 0, minor: 21 }, cdk: { major: 0, minor: 18 } }
  it('is 0 for a missing version', () => {
    expect(versionComponent(null)).toBe(0)
    expect(versionComponent(undefined)).toBe(0)
    expect(versionComponent('')).toBe(0)
  })
  it('keeps 4 points for unrecognized software (no "/" or an unknown name)', () => {
    expect(versionComponent('garbage', L)).toBe(4)
    expect(versionComponent('0.20', L)).toBe(4)
    expect(versionComponent('LekMint/1.1.1', L)).toBe(4)
    expect(versionComponent('Nutshell-CF/1.0.0', L)).toBe(4)
  })
  it('keeps 5 points for recognized software with an unreadable version number', () => {
    expect(versionComponent('Nutshell/garbage', L)).toBe(5)
    expect(versionComponent('Nutshell/12', L)).toBe(5)
  })
  it('0 or 1 minor behind = 15, then 9 / 6 / 3 / 0', () => {
    expect(versionComponent('Nutshell/0.21.0', L)).toBe(15)
    expect(versionComponent('Nutshell/0.21.1', L)).toBe(15)
    expect(versionComponent('Nutshell/0.20.3', L)).toBe(15)
    expect(versionComponent('Nutshell/0.19.2', L)).toBe(9)
    expect(versionComponent('Nutshell/0.18.2', L)).toBe(6)
    expect(versionComponent('Nutshell/0.17.0', L)).toBe(3)
    expect(versionComponent('Nutshell/0.16.0', L)).toBe(0)
    expect(versionComponent('Nutshell/0.10.0', L)).toBe(0)
  })
  it('measures cdk-mintd against its own latest, not Nutshell\'s', () => {
    expect(versionComponent('cdk-mintd/0.18.1', L)).toBe(15)
    expect(versionComponent('cdk-mintd/0.17.7', L)).toBe(15)
    expect(versionComponent('cdk-mintd/0.16.0', L)).toBe(9)
    expect(versionComponent('cdk-mintd/0.13.4', L)).toBe(0)
  })
  it('a pre-release counts as its base version; v prefix is ignored', () => {
    expect(versionComponent('cdk-mintd/0.18.0-rc.1', L)).toBe(15)
    expect(versionComponent('cdk-mintd/0.17.0-rc.3', L)).toBe(15)
    expect(versionComponent('cdk-mintd/v0.16.2', L)).toBe(9)
  })
  it('a lower major is outdated with 0 points, a higher major is current', () => {
    expect(versionComponent('Nutshell/1.0.0', { nutshell: { major: 2, minor: 0 } })).toBe(0)
    expect(versionComponent('Nutshell/1.0.0', L)).toBe(15)
  })
  it('a recognized family with no latest at all scores neutrally (4)', () => {
    expect(versionComponent('Nutshell/0.21.0')).toBe(4)
    expect(versionComponent('Nutshell/0.21.0', { cdk: { major: 0, minor: 18 } })).toBe(4)
  })
})
