import { describe, it, expect } from 'vitest'
import {
  auditComponent, auditDataState, auditAgeHours, isAuditUnknown,
  AUDIT_MIN_SAMPLES, AUDIT_MAX_AGE_HOURS, AUDIT_NEUTRAL, AUDIT_TAB_MIN_SAMPLES,
} from '../shared/auditScore.js'

// The audit component is computed from cashu.info's 7-day window stored on mints.audit_cz_*
// (errorsBlamed / swaps7d.all.total / the detail's fetched_at), see auditCzDetail.ts.
const NOW = Date.parse('2026-10-08T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const score = (blamed: number | null, total: number | null, fetchedAt: string | Date | null = hoursAgo(1)) =>
  auditComponent(blamed, total, fetchedAt, NOW)

describe('constants', () => {
  it('has the owner-decided thresholds', () => {
    expect(AUDIT_MIN_SAMPLES).toBe(10)
    expect(AUDIT_MAX_AGE_HOURS).toBe(168)
    expect(AUDIT_NEUTRAL).toBe(12.5)
  })
})

describe('auditComponent', () => {
  it('0 blamed of 12 gives 25', () => expect(score(0, 12)).toBe(25))
  it('0 blamed of exactly 10 gives 25 (the minimum sample size is inclusive)', () => expect(score(0, 10)).toBe(25))
  it('0 blamed of 9 gives neutral 12.5', () => expect(score(0, 9)).toBe(12.5))
  it('1 of 200 (0.5 percent) gives 20', () => expect(score(1, 200)).toBe(20))
  it('1 of 30 (3.3 percent) gives 15', () => expect(score(1, 30)).toBe(15))
  it('1 of 100 (exactly 1 percent) gives 15, not 20', () => expect(score(1, 100)).toBe(15))
  it('5 of 100 (exactly 5 percent) gives 10', () => expect(score(5, 100)).toBe(10))
  it('3 of 10 (30 percent) gives 5', () => expect(score(3, 10)).toBe(5))
  it('15 of 100 (exactly 15 percent) gives 5', () => expect(score(15, 100)).toBe(5))
  it('1 of 8 gives neutral (fewer than 10 swaps)', () => expect(score(1, 8)).toBe(12.5))
  it('blamed above total is clamped to total', () => {
    expect(score(500, 20)).toBe(5)
    expect(score(500, 20)).toBe(score(20, 20))
  })
  it('null, non-finite and negative inputs give neutral', () => {
    expect(score(null, 100)).toBe(12.5)
    expect(score(0, null)).toBe(12.5)
    expect(score(null, null)).toBe(12.5)
    expect(score(Number.NaN, 100)).toBe(12.5)
    expect(score(0, Number.POSITIVE_INFINITY)).toBe(12.5)
    expect(score(-1, 100)).toBe(12.5)
    expect(score(0, -5)).toBe(12.5)
    expect(auditComponent(undefined, undefined, undefined, NOW)).toBe(12.5)
  })
  it('a missing or unparseable fetched_at gives neutral', () => {
    expect(score(0, 100, null)).toBe(12.5)
    expect(score(0, 100, 'not a date')).toBe(12.5)
  })
  it('age 167 h is scored, 169 h is neutral, 168 h exactly is still scored', () => {
    expect(score(0, 100, hoursAgo(167))).toBe(25)
    expect(score(0, 100, hoursAgo(168))).toBe(25)
    expect(score(0, 100, hoursAgo(169))).toBe(12.5)
  })
  it('a fetched_at in the future is treated as fresh', () => {
    expect(score(0, 100, hoursAgo(-5))).toBe(25)
    expect(auditAgeHours(hoursAgo(-5), NOW)).toBe(0)
  })
  it('accepts a Date (what pg returns for timestamptz)', () => {
    expect(score(0, 100, new Date(NOW - 3_600_000))).toBe(25)
  })
})

describe('auditDataState', () => {
  it('names the reason a mint is or is not scored', () => {
    expect(auditDataState(0, 100, hoursAgo(1), NOW)).toBe('scored')
    expect(auditDataState(0, 9, hoursAgo(1), NOW)).toBe('too-few')
    expect(auditDataState(0, 100, hoursAgo(200), NOW)).toBe('too-old')
    expect(auditDataState(null, null, null, NOW)).toBe('no-data')
    expect(auditDataState(0, 5, hoursAgo(200), NOW)).toBe('too-old')
  })
})

// The Audit tab (audit.8333.space window) keeps its own, unchanged "too few" floor.
describe('isAuditUnknown (Audit tab only)', () => {
  it('is false when there is no audit data at all', () => expect(isAuditUnknown(null)).toBe(false))
  it('is true below the tab floor of 3', () => {
    expect(AUDIT_TAB_MIN_SAMPLES).toBe(3)
    expect(isAuditUnknown(0)).toBe(true)
    expect(isAuditUnknown(2)).toBe(true)
  })
  it('is false from the tab floor up', () => {
    expect(isAuditUnknown(3)).toBe(false)
    expect(isAuditUnknown(100)).toBe(false)
  })
})
