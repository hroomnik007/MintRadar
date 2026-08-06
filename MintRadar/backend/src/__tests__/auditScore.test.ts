import { describe, it, expect } from 'vitest'
import { auditReliabilityScore, isAuditUnknown, AUDIT_MIN_SAMPLES } from '../shared/auditScore.js'

// auditReliabilityScore is computed from a rolling window of the mint's last ~100 swaps
// (audit_recent_total / audit_recent_errors), not audit.8333.space's cumulative lifetime
// counters — see discovery.ts's fetchRecentSwapStats.
describe('auditReliabilityScore', () => {
  it('returns 2.5 when there is no audit data at all (recentTotal null)', () => {
    expect(auditReliabilityScore(null, null)).toBe(2.5)
  })

  it('returns 2.5 (Unknown) below the minimum sample size, even with a bad error rate', () => {
    expect(auditReliabilityScore(0, 0)).toBe(2.5)
    expect(auditReliabilityScore(1, 1)).toBe(2.5)
    expect(auditReliabilityScore(AUDIT_MIN_SAMPLES - 1, AUDIT_MIN_SAMPLES - 1)).toBe(2.5)
  })

  it('scores normally once the minimum sample size is reached', () => {
    expect(auditReliabilityScore(AUDIT_MIN_SAMPLES, 0)).toBe(5)
  })

  it('gives 5 for a zero error rate', () => {
    expect(auditReliabilityScore(150, 0)).toBe(5)
  })

  it('gives 4 for error rate < 1%', () => {
    expect(auditReliabilityScore(1000, 5)).toBe(4) // 0.5%
  })

  it('gives 3 for error rate < 5%', () => {
    expect(auditReliabilityScore(100, 3)).toBe(3) // 3%
  })

  it('gives 2 for error rate < 15%', () => {
    expect(auditReliabilityScore(100, 10)).toBe(2) // 10%
  })

  it('gives 1 for error rate >= 15%', () => {
    expect(auditReliabilityScore(20, 10)).toBe(1) // 50%
  })

  it('treats null recentErrors as zero errors', () => {
    expect(auditReliabilityScore(100, null)).toBe(5)
  })

  it('does not penalize a mint whose recent swaps are clean, regardless of a troubled past', () => {
    // The whole point of the rolling window: an old mint that had errors long ago is judged
    // on its last ~100 swaps, not on a lifetime counter that never resets.
    expect(auditReliabilityScore(100, 0)).toBe(5)
  })
})

describe('isAuditUnknown', () => {
  it('is false when there is no audit data at all', () => {
    expect(isAuditUnknown(null)).toBe(false)
  })

  it('is true when sample count is below the minimum', () => {
    expect(isAuditUnknown(0)).toBe(true)
    expect(isAuditUnknown(1)).toBe(true)
    expect(isAuditUnknown(AUDIT_MIN_SAMPLES - 1)).toBe(true)
  })

  it('is false once the minimum sample size is reached', () => {
    expect(isAuditUnknown(AUDIT_MIN_SAMPLES)).toBe(false)
    expect(isAuditUnknown(100)).toBe(false)
  })
})
