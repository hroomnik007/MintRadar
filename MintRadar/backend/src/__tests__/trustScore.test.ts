import { describe, it, expect } from 'vitest'
import { computeServerTrustScore, serverVersionFreshnessScore } from '../prober.js'

// computeServerTrustScore weighting:
//   uptime 45% | NUT support 30% | version freshness 15% | contact 5% | audit 5%
// Signature: (uptimePct, nutCount, version, contactCount, auditNMints, auditNMelts, auditNErrors)
describe('computeServerTrustScore', () => {
  it('returns ~100 for a perfect mint (100% on every component)', () => {
    // uptime 100→45, nutCount 26→30, version 0.16→15, contact 3→5, audit errRate 0→5
    expect(computeServerTrustScore(100, 26, '0.16', 3, 100, 50, 0)).toBe(100)
  })

  it('caps the total at 100 even when components would exceed it', () => {
    // contactCount 6 → cScore 10 (uncapped per-component), so raw sum > 100
    expect(computeServerTrustScore(100, 28, '1.0', 6, 100, 50, 0)).toBe(100)
  })

  it('returns a low, finite score for a mint with no data (no crash, no NaN)', () => {
    // all zero/null → only audit default (auditNMints null → 2.5) contributes; round(2.5)=3
    const score = computeServerTrustScore(0, null, null, 0, null, null, null)
    expect(score).toBe(3)
    expect(Number.isFinite(score)).toBe(true)
    expect(Number.isNaN(score)).toBe(false)
  })

  it('computes from remaining components when audit data is missing', () => {
    // 45 + 30 + 15 + 5 + (audit null →2.5) = 97.5 → round 98
    expect(computeServerTrustScore(100, 26, '0.16', 3, null, null, null)).toBe(98)
  })

  describe('uptime component (45%)', () => {
    it('contributes 0 at 0% uptime', () => {
      // baseline: everything else zero, audit null → 2.5 → 3
      expect(computeServerTrustScore(0, null, null, 0, null, null, null)).toBe(3)
    })
    it('contributes 45 at 100% uptime', () => {
      // 45 + audit(null→2.5) = 47.5 → 48
      expect(computeServerTrustScore(100, null, null, 0, null, null, null)).toBe(48)
    })
  })

  describe('NUT support component (30%)', () => {
    it('contributes 0 with 0 nuts', () => {
      expect(computeServerTrustScore(0, 0, null, 0, null, null, null)).toBe(3) // 0 + 2.5
    })
    it('contributes 30 at 26 nuts', () => {
      // 0 + 30 + 2.5 = 32.5 → 33
      expect(computeServerTrustScore(0, 26, null, 0, null, null, null)).toBe(33)
    })
    it('caps NUT support at 26 nuts (52 nuts gives the same score)', () => {
      expect(computeServerTrustScore(0, 52, null, 0, null, null, null)).toBe(33)
    })
  })

  describe('contact component (5%) — NOT capped per-component', () => {
    it('contributes 0 with no contacts', () => {
      expect(computeServerTrustScore(0, null, null, 0, null, null, null)).toBe(3)
    })
    it('contributes 5 with 3 contacts', () => {
      // 0 + 5 + 2.5 = 7.5 → 8
      expect(computeServerTrustScore(0, null, null, 3, null, null, null)).toBe(8)
    })
    it('exceeds 5 with 6 contacts (documents missing per-component cap)', () => {
      // contactCount 6 → round(6/3*5)=10; 0 + 10 + 2.5 = 12.5 → 13
      expect(computeServerTrustScore(0, null, null, 6, null, null, null)).toBe(13)
    })
  })

  describe('audit reliability component (5%)', () => {
    const base = (m: number | null, melts: number, errors: number) =>
      computeServerTrustScore(0, null, null, 0, m, melts, errors)
    it('gives 2.5 (→ rounds with baseline to 3) when auditNMints is null', () => {
      expect(base(null, 0, 0)).toBe(3)
    })
    it('gives 5 for a zero error rate', () => {
      expect(base(100, 50, 0)).toBe(5) // errRate 0 → aScore 5
    })
    it('gives 4 for error rate < 0.01', () => {
      expect(base(1000, 0, 5)).toBe(4) // 5/1005 ≈ 0.005
    })
    it('gives 3 for error rate < 0.05', () => {
      expect(base(100, 0, 3)).toBe(3) // 3/103 ≈ 0.029
    })
    it('gives 2 for error rate < 0.15', () => {
      expect(base(100, 0, 10)).toBe(2) // 10/110 ≈ 0.091
    })
    it('gives 1 for error rate >= 0.15', () => {
      expect(base(10, 0, 10)).toBe(1) // 10/20 = 0.5
    })
    it('gives 5 when audit counts are all zero but auditNMints is 0 (not null)', () => {
      expect(base(0, 0, 0)).toBe(5) // total 0 → errRate 0 → aScore 5
    })
  })

  describe('negative / null inputs never crash or return NaN', () => {
    it('handles negative uptime without NaN', () => {
      const score = computeServerTrustScore(-50, null, null, 0, null, null, null)
      expect(Number.isFinite(score)).toBe(true)
      expect(Number.isNaN(score)).toBe(false)
    })
    it('handles negative nutCount without NaN', () => {
      const score = computeServerTrustScore(0, -5, null, 0, null, null, null)
      expect(Number.isFinite(score)).toBe(true)
      expect(Number.isNaN(score)).toBe(false)
    })
    it('handles all-null inputs without NaN', () => {
      const score = computeServerTrustScore(0, null, null, 0, null, null, null)
      expect(Number.isNaN(score)).toBe(false)
    })
  })
})

describe('serverVersionFreshnessScore', () => {
  it('returns 0 for null / undefined / empty', () => {
    expect(serverVersionFreshnessScore(null)).toBe(0)
    expect(serverVersionFreshnessScore(undefined)).toBe(0)
    expect(serverVersionFreshnessScore('')).toBe(0)
  })

  it('returns 3 for a non-version string (regex no-match fallback)', () => {
    expect(serverVersionFreshnessScore('garbage')).toBe(3)
    expect(serverVersionFreshnessScore('12')).toBe(3) // no dot
  })

  it('scores the newest known version highest', () => {
    expect(serverVersionFreshnessScore('0.16')).toBe(10)
  })

  it('decreases by 2 per version step', () => {
    expect(serverVersionFreshnessScore('0.15')).toBe(8)
    expect(serverVersionFreshnessScore('0.14')).toBe(6)
    expect(serverVersionFreshnessScore('0.13')).toBe(4)
    expect(serverVersionFreshnessScore('0.12')).toBe(2)
    expect(serverVersionFreshnessScore('0.11')).toBe(0)
  })

  it('returns 0 for a version older than the known list', () => {
    expect(serverVersionFreshnessScore('0.10')).toBe(0)
  })

  it('treats a future/newer version as freshest', () => {
    expect(serverVersionFreshnessScore('1.0')).toBe(10)
    expect(serverVersionFreshnessScore('0.20')).toBe(10)
  })

  it('matches the first major.minor inside a longer version string', () => {
    expect(serverVersionFreshnessScore('0.16.3')).toBe(10)
    expect(serverVersionFreshnessScore('Nutshell/0.15.1')).toBe(8)
  })
})
