// Methodology 8: the long audit window. Pure parts only (the daily rows, the sums, the per-day counts and the
// rule "worse of the two windows"); the SQL around them is covered by the integration tests.
import { describe, it, expect } from 'vitest'
import { sumLongWindow, utcDay, LONG_STEP_DAYS, LONG_MAX_ROWS } from '../auditCzDetail.js'
import { sumSince, buildAuditCzDaily, buildAuditCzWeeks, buildAuditCzPeriodTotal, buildAuditCzTotals, type DailyWeekRow } from '../auditCz.js'
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


const weekRow = (back: number, extra: Partial<DailyWeekRow> = {}): DailyWeekRow => ({
  day: day(back), total: 20, blamed: 0, ...extra,
})

describe('buildAuditCzWeeks', () => {
  it('keeps only non-overlapping rows, oldest first, and names the span the same way as since.day', () => {
    const weeks = buildAuditCzWeeks([
      weekRow(0, { total: 50, blamed: 1, failed: 5 }),
      weekRow(7, { total: 40, blamed: 0, failed: 3 }),
      weekRow(3, { total: 999, blamed: 999 }), // overlaps
      weekRow(14, { total: 30, blamed: 0 }),
    ], TODAY)
    expect(weeks.map(w => w.end)).toEqual([day(14), day(7), day(0)])
    expect(weeks[2]).toMatchObject({ start: day(7), end: day(0), swaps: 50, attributedFailures: 1, failed: 5, succeeded: 45, failedElsewhere: 4 })
    expect(weeks[1]).toMatchObject({ succeeded: 37, failedElsewhere: 3, attributedFailures: 0 })
    expect(weeks[0]).toMatchObject({ succeeded: null, failedElsewhere: null, failed: null, swaps: 30 })
  })

  it('clamps failed and blamed so succeeded + failed elsewhere + blamed = total', () => {
    const [w] = buildAuditCzWeeks([weekRow(0, { total: 10, blamed: 8, failed: 3 })], TODAY)
    expect(w).toMatchObject({ swaps: 10, attributedFailures: 8, failed: 8, succeeded: 2, failedElsewhere: 0 })
    const [w2] = buildAuditCzWeeks([weekRow(0, { total: 10, blamed: 2, failed: 40 })], TODAY)
    expect(w2).toMatchObject({ failed: 10, succeeded: 0, failedElsewhere: 8, attributedFailures: 2 })
  })

  it('passes through the direction split and the money figures, or null when they were not stored', () => {
    const [w] = buildAuditCzWeeks([weekRow(0, {
      total: 10, blamed: 0, failed: 2, success: 8, avg_ms: 1000, amount: 500, fees: 7,
      dest_total: 6, dest_success: 5, dest_failed: 1, dest_avg_ms: 800, dest_amount: 200, dest_fees: 3,
      source_total: 4, source_success: 3, source_failed: 1,
    })], TODAY)
    expect(w.deposits).toEqual({ total: 6, success: 5, failed: 1, avgMs: 800, amount: 200, fees: 3 })
    expect(w.withdrawals).toEqual({ total: 4, success: 3, failed: 1, avgMs: null, amount: null, fees: null })
    expect(w).toMatchObject({ avgMs: 1000, amount: 500, fees: 7, succeeded: 8 })
    const [old] = buildAuditCzWeeks([weekRow(0, { total: 10, blamed: 0 })], TODAY)
    expect(old.deposits).toBeNull()
    expect(old.withdrawals).toBeNull()
    expect(old.avgMs).toBeNull()
  })

  it('leaves out a future row and a row with no usable totals', () => {
    expect(buildAuditCzWeeks([weekRow(-7, { total: 9 }), weekRow(0, { total: 'x', blamed: 0 })], TODAY)).toEqual([])
  })
})

describe('buildAuditCzPeriodTotal and buildAuditCzTotals', () => {
  const full = (back: number, swaps: number, ok: number, elsewhere: number, blamed: number, dirs?: { d: [number, number, number]; w: [number, number, number] }): ReturnType<typeof buildAuditCzWeeks>[number] => {
    const failed = elsewhere + blamed
    const row: DailyWeekRow = { day: day(back), total: swaps, blamed, failed, success: ok }
    if (dirs) {
      row.dest_total = dirs.d[0]; row.dest_success = dirs.d[1]; row.dest_failed = dirs.d[2]
      row.source_total = dirs.w[0]; row.source_success = dirs.w[1]; row.source_failed = dirs.w[2]
    }
    return buildAuditCzWeeks([row], TODAY)[0]!
  }

  it('sums every week and walks back for the outcome and direction splits', () => {
    const weeks = [
      full(21, 10, 8, 2, 0),                          // no direction split
      full(14, 20, 16, 4, 0, { d: [12, 10, 2], w: [8, 6, 2] }),
      full(7, 15, 14, 0, 1, { d: [7, 7, 0], w: [8, 7, 1] }),
      full(0, 25, 20, 5, 0, { d: [13, 10, 3], w: [12, 10, 2] }),
    ]
    const all = buildAuditCzPeriodTotal(weeks)!
    expect(all).toMatchObject({ days: 28, weeks: 4, start: day(28), end: day(0), swaps: 70, attributedFailures: 1 })
    // Outcomes exist on every week, so the split covers the whole period.
    expect(all.outcomes).toEqual({ since: day(28), swaps: 70, succeeded: 58, failedElsewhere: 11, attributedFailures: 1 })
    // Directions start at the 14-days-back week (the oldest with a split).
    expect(all.directions).toEqual({
      since: day(21),
      deposits: { total: 32, success: 27, failed: 5 },
      withdrawals: { total: 28, success: 23, failed: 5 },
    })
  })

  it('stops the outcome split at the first older week that has no failed count', () => {
    const weeks = [
      buildAuditCzWeeks([weekRow(14, { total: 10, blamed: 0 })], TODAY)[0]!,
      full(7, 20, 18, 2, 0),
      full(0, 15, 14, 1, 0),
    ]
    const all = buildAuditCzPeriodTotal(weeks)!
    expect(all.swaps).toBe(45)
    expect(all.outcomes).toEqual({ since: day(14), swaps: 35, succeeded: 32, failedElsewhere: 3, attributedFailures: 0 })
    expect(all.directions).toBeNull()
  })

  it('buildAuditCzTotals maps the 7-day, 28-day and all views; a gap ends the 28-day window', () => {
    const weeks = [
      full(28, 10, 10, 0, 0), // behind a gap of day 21
      full(14, 20, 19, 1, 0),
      full(7, 15, 15, 0, 0),
      full(0, 25, 24, 1, 0),
    ]
    const t = buildAuditCzTotals(weeks, TODAY)
    expect(t.d7).toMatchObject({ days: 7, weeks: 1, swaps: 25, start: day(7), end: day(0) })
    // 21 is missing, so d28 stops at today + 7 + 14 = 3 weeks, 21 days (same as sumLongWindow).
    expect(t.d28).toMatchObject({ days: 21, weeks: 3, swaps: 60, start: day(21), end: day(0) })
    expect(t.all).toMatchObject({ days: 28, weeks: 4, swaps: 70, start: day(35), end: day(0) })
    expect(buildAuditCzTotals([], TODAY)).toEqual({ d7: null, d28: null, all: null })
  })
})
