import { describe, it, expect } from 'vitest'
import { auditFreshness, formatAuditSyncDate, formatAuditDate, staleAuditSince, AUDIT_DATA_OLD_DAYS, AUDIT_SYNC_STALE_HOURS } from '@/utils/auditFreshness'

const NOW = Date.parse('2026-09-30T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const H = 3_600_000, D = 86_400_000

describe('auditFreshness', () => {
  it('thresholds are 7 days / 24 hours', () => {
    expect(AUDIT_DATA_OLD_DAYS).toBe(7)
    expect(AUDIT_SYNC_STALE_HOURS).toBe(24)
  })
  it('fresh data: nothing flagged', () => {
    const f = auditFreshness(ago(3 * H), ago(2 * H), NOW)
    expect(f).toEqual({ auditorAgeDays: 0, syncAgeHours: 2, auditorDataOld: false, syncStale: false })
  })
  it('exactly 7 days / 24h is not yet flagged, just past is', () => {
    expect(auditFreshness(ago(7 * D), ago(24 * H), NOW)).toMatchObject({ auditorDataOld: false, syncStale: false })
    expect(auditFreshness(ago(7 * D + 1), ago(24 * H + 1), NOW)).toMatchObject({ auditorDataOld: true, syncStale: true })
  })
  it('auditor data 10 days old, sync fresh', () => {
    expect(auditFreshness(ago(10 * D), ago(H), NOW)).toMatchObject({ auditorAgeDays: 10, auditorDataOld: true, syncStale: false })
  })
  it('sync 2 days old, auditor fresh', () => {
    expect(auditFreshness(ago(H), ago(2 * D), NOW)).toMatchObject({ syncAgeHours: 48, auditorDataOld: false, syncStale: true })
  })
  it('null / invalid inputs yield unknown, never flagged', () => {
    expect(auditFreshness(null, undefined, NOW)).toEqual({ auditorAgeDays: null, syncAgeHours: null, auditorDataOld: false, syncStale: false })
    expect(auditFreshness('garbage', 'nope', NOW)).toMatchObject({ auditorAgeDays: null, auditorDataOld: false, syncStale: false })
  })
  it('future timestamps clamp to age 0', () => {
    expect(auditFreshness(ago(-5 * H), ago(-H), NOW)).toMatchObject({ auditorAgeDays: 0, syncAgeHours: 0 })
  })
  it('formats the sync date in UTC', () => {
    expect(formatAuditSyncDate('2026-09-27T12:13:41.466Z')).toBe('27 Sep 2026, 12:13 UTC')
  })
})

describe('staleAuditSince (Stats note)', () => {
  it('exactly 7 days since the newest check is not stale, just past is (same boundary as auditorDataOld)', () => {
    expect(staleAuditSince([ago(7 * D)], NOW)).toBeNull()
    expect(staleAuditSince([ago(7 * D + 1)], NOW)).toBe(ago(7 * D + 1))
  })
  it('uses the newest check across mints, so one fresh mint hides the note', () => {
    expect(staleAuditSince([ago(30 * D), ago(2 * H), ago(20 * D)], NOW)).toBeNull()
    expect(staleAuditSince([ago(30 * D), ago(9 * D), ago(20 * D)], NOW)).toBe(ago(9 * D))
  })
  it('ignores null, empty and unparseable values; no usable timestamp means unknown, not stale', () => {
    expect(staleAuditSince([], NOW)).toBeNull()
    expect(staleAuditSince([null, undefined, '', 'garbage'], NOW)).toBeNull()
    expect(staleAuditSince([null, 'garbage', ago(10 * D)], NOW)).toBe(ago(10 * D))
  })
  it('formats the date part in UTC', () => {
    expect(formatAuditDate('2026-09-27T12:13:41.466Z')).toBe('27 Sep 2026')
    expect(formatAuditDate('garbage')).toBe('garbage')
  })
})
