import { describe, it, expect } from 'vitest'
import { AUDIT_SOURCE_SWITCH_DATE, AUDIT_SWITCH_NOTE_DAYS, showAuditSwitchNote } from '../utils/auditSourceSwitch'

const DAY = 86_400_000
const T0 = Date.parse('2026-10-08')

describe('showAuditSwitchNote (one-time Stats note, 30 days)', () => {
  it('the constant is an ISO date and the window is 30 days', () => {
    expect(AUDIT_SOURCE_SWITCH_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isFinite(Date.parse(AUDIT_SOURCE_SWITCH_DATE))).toBe(true)
    expect(AUDIT_SWITCH_NOTE_DAYS).toBe(30)
  })
  it('is shown on the switch day and on day 1', () => {
    expect(showAuditSwitchNote(T0, '2026-10-08')).toBe(true)
    expect(showAuditSwitchNote(T0 + DAY, '2026-10-08')).toBe(true)
  })
  it('is shown on day 29', () => {
    expect(showAuditSwitchNote(T0 + 29 * DAY, '2026-10-08')).toBe(true)
    expect(showAuditSwitchNote(T0 + 29 * DAY + 23 * 3_600_000, '2026-10-08')).toBe(true)
  })
  it('is hidden from day 30 on, so hidden on day 31', () => {
    expect(showAuditSwitchNote(T0 + 30 * DAY, '2026-10-08')).toBe(false)
    expect(showAuditSwitchNote(T0 + 31 * DAY, '2026-10-08')).toBe(false)
  })
  it('a switch date in the future still shows it (fixture date today)', () => {
    expect(showAuditSwitchNote(T0 - 5 * DAY, '2026-10-08')).toBe(true)
  })
  it('an unparseable date never shows it', () => {
    expect(showAuditSwitchNote(T0, 'not a date')).toBe(false)
  })
})
