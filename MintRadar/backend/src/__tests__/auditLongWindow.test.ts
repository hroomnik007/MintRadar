// Methodology 8: the long audit window. Pure parts only (the daily rows, the sums, the per-day counts and the
// rule "worse of the two windows"); the SQL around them is covered by the integration tests.
import { describe, it, expect } from 'vitest'
import { sumLongWindow, utcDay, LONG_STEP_DAYS, LONG_MAX_ROWS } from '../auditCzDetail.js'
import { sumSince, buildAuditCzDaily } from '../auditCz.js'
import { auditComponent, auditDataState, AUDIT_LONG_WINDOW_DAYS, AUDIT_MIN_SAMPLES, AUDIT_NEUTRAL } from '../shared/auditScore.js'

const TODAY = '2026-11-13'
const NOW = Date.parse(`${TODAY}T12:00:00Z`)
const at = new Date(NOW)
const day = (back: number) => utcDay(Date.parse(`${TODAY}T00:00:00Z`) - back * 86_400_000)
const row = (back: number, total: number, blamed = 0) => ({ day: day(back), total, blamed })

describe('sumLongWindow', () => {
  it('the window is four 7-day totals: 28 days', () => {
    expect(LONG_STEP_DAYS * LONG_MAX_ROWS).toBe(AUDIT_LONG_WINDOW_DAYS)
  })
  it('adds rows 7 days apart, at most four, and says how many days they cover', () => {
    expect(sumLongWindow([row(0, 50, 1)], TODAY)).toEqual({ total: 50, blamed: 1, days: 7 })
    expect(sumLongWindow([row(0, 50, 1), row(7, 40, 2)], TODAY)).toEqual({ total: 90, blamed: 3, days: 14 })
    expect(sumLongWindow([row(0, 50), row(7, 40), row(14, 30), row(21, 20), row(28, 999, 999)], TODAY)).toEqual({ total: 140, blamed: 0, days: 28 })
  })
  it('rows of other days are ignored: they would overlap', () => {
    expect(sumLongWindow([row(0, 50), row(1, 49), row(6, 48), row(8, 47)], TODAY)).toEqual({ total: 50, blamed: 0, days: 7 })
  })
  it('a missing row ends the sum: no gap inside the window', () => {
    expect(sumLongWindow([row(0, 50), row(14, 30), row(21, 20)], TODAY)).toEqual({ total: 50, blamed: 0, days: 7 })
  })
  it('no row for today: no window; blamed above total is limited to the total', () => {
    expect(sumLongWindow([row(7, 40)], TODAY)).toBeNull()
    expect(sumLongWindow([], TODAY)).toBeNull()
    expect(sumLongWindow([row(0, 5, 9)], TODAY)).toEqual({ total: 5, blamed: 5, days: 7 })
  })
})

describe('sumSince', () => {
  it('adds every row a multiple of 7 days back and names the first day covered', () => {
    expect(sumSince([row(0, 50, 1), row(7, 40), row(35, 10, 2), row(3, 999)], TODAY)).toEqual({ day: day(42), swaps: 100, attributedFailures: 3 })
    expect(sumSince([row(0, 50)], TODAY)).toEqual({ day: day(7), swaps: 50, attributedFailures: 0 })
  })
  it('nothing usable: null; a row of the future is not counted', () => {
    expect(sumSince([], TODAY)).toBeNull()
    expect(sumSince([row(3, 9)], TODAY)).toBeNull()
    expect(sumSince([row(-7, 9)], TODAY)).toBeNull()
  })
})

describe('buildAuditCzDaily', () => {
  it('seven days ending today, oldest first, zero-filled', () => {
    const d = buildAuditCzDaily([
      { day: day(0), outcome: 'paid', n: '3' }, { day: day(0), outcome: 'failed', n: 1 },
      { day: day(6), outcome: 'pending', n: 2 }, { day: day(7), outcome: 'paid', n: 99 },
    ], TODAY)
    expect(d).toHaveLength(7)
    expect(d[0]).toEqual({ day: day(6), ok: 0, failed: 0, other: 2 })
    expect(d[6]).toEqual({ day: day(0), ok: 3, failed: 1, other: 0 })
    expect(d.slice(1, 6).every(x => x.ok + x.failed + x.other === 0)).toBe(true)
  })
})

describe('audit part: the worse of the two windows', () => {
  const long = (blamed: number, total: number, days = 28) => ({ blamed, total, days })
  it('without a long window the 7-day rule is unchanged', () => {
    expect(auditComponent(0, 50, at, NOW)).toBe(25)
    expect(auditComponent(0, 50, at, NOW, null)).toBe(25)
    expect(auditComponent(0, 50, at, NOW, long(30, 200, 7))).toBe(25)
    expect(auditComponent(0, 50, at, NOW, { blamed: null, total: null, days: null })).toBe(25)
  })
  it('a clean week does not hide failures of the long window', () => {
    expect(auditComponent(0, 50, at, NOW, long(1, 200))).toBe(20)
    expect(auditComponent(0, 50, at, NOW, long(30, 200))).toBe(5)
  })
  it('a long clean history does not hide a bad week', () => {
    expect(auditComponent(10, 50, at, NOW, long(10, 2000))).toBe(5)
  })
  it('too few swaps in 7 days: the long window alone decides, if it has enough', () => {
    expect(auditComponent(0, AUDIT_MIN_SAMPLES - 1, at, NOW)).toBe(AUDIT_NEUTRAL)
    expect(auditDataState(0, AUDIT_MIN_SAMPLES - 1, at, NOW, long(0, 40, 21))).toBe('scored')
    expect(auditComponent(0, AUDIT_MIN_SAMPLES - 1, at, NOW, long(0, 40, 21))).toBe(25)
    expect(auditComponent(0, 3, at, NOW, long(4, 40, 21))).toBe(10)
    expect(auditDataState(0, 3, at, NOW, long(0, AUDIT_MIN_SAMPLES - 1, 28))).toBe('too-few')
  })
  it('stale or missing 7-day data stays neutral whatever the long window says', () => {
    const old = new Date(NOW - 169 * 3_600_000)
    expect(auditComponent(0, 50, old, NOW, long(0, 200))).toBe(AUDIT_NEUTRAL)
    expect(auditComponent(null, null, at, NOW, long(0, 200))).toBe(AUDIT_NEUTRAL)
  })
})
