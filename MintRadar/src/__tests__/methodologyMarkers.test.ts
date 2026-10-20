import { describe, it, expect } from 'vitest'
import { METHODOLOGY_CHANGES, type MethodologyChange } from '@/utils/methodology'
import {
  methodologyChangesInRange, methodologyChangesInWindow, trendMarkers, trendMarkersSummary, moversMethodologyNote, placeMarkerLabels,
} from '@/utils/methodologyMarkers'

const CHANGES: MethodologyChange[] = [
  { version: 1, date: '2026-09-12', summary: 'initial' },
  { version: 2, date: '2026-10-08', summary: 'two' },
  { version: 3, date: '2026-10-09', summary: 'three' },
]
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10))

describe('methodologyChangesInRange', () => {
  it('returns the changes dated inside the range (both ends included) and never the initial formula', () => {
    expect(methodologyChangesInRange('2026-09-01', '2026-10-20', CHANGES).map(c => c.version)).toEqual([2, 3])
    expect(methodologyChangesInRange('2026-10-08', '2026-10-08', CHANGES).map(c => c.version)).toEqual([2])
    expect(methodologyChangesInRange('2026-10-10', '2026-10-20', CHANGES)).toEqual([])
    expect(methodologyChangesInRange('2026-09-01', '2026-10-07', CHANGES)).toEqual([])
  })

  it('works on the real change log, whose dates are YYYY-MM-DD', () => {
    for (const c of METHODOLOGY_CHANGES) expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(methodologyChangesInRange('2000-01-01', '2999-12-31').map(c => c.version)).toEqual(METHODOLOGY_CHANGES.slice(1).map(c => c.version))
  })
})

describe('methodologyChangesInWindow', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  it('7 days back holds none, 30 days back holds both', () => {
    expect(methodologyChangesInWindow(7, now, CHANGES)).toEqual([])
    expect(methodologyChangesInWindow(30, now, CHANGES).map(c => c.version)).toEqual([2, 3])
  })
  it('a change exactly `days` ago is inside, one day older is not', () => {
    expect(methodologyChangesInWindow(12, now, CHANGES).map(c => c.version)).toEqual([2, 3])
    expect(methodologyChangesInWindow(11, now, CHANGES).map(c => c.version)).toEqual([3])
  })
})

describe('trendMarkers', () => {
  it('marks the changes inside the shown period on a data date', () => {
    const d30 = days('2026-09-21', 30) // 21 Sep .. 20 Oct
    expect(trendMarkers(d30, CHANGES).map(m => [m.version, m.at])).toEqual([[2, '2026-10-08'], [3, '2026-10-09']])
  })
  it('a change before the first data date or after the last is not marked', () => {
    expect(trendMarkers(days('2026-10-09', 5), CHANGES).map(m => m.version)).toEqual([3])
    expect(trendMarkers(days('2026-10-10', 5), CHANGES)).toEqual([])
    expect(trendMarkers(days('2026-09-20', 10), CHANGES)).toEqual([])
    expect(trendMarkers([], CHANGES)).toEqual([])
  })
  it('a change on a day without data sits on the next data date', () => {
    expect(trendMarkers(['2026-10-07', '2026-10-09', '2026-10-10'], CHANGES).map(m => [m.version, m.at])).toEqual([[2, '2026-10-09'], [3, '2026-10-09']])
  })
})

describe('texts', () => {
  it('the chart summary names version and day', () => {
    const m = trendMarkers(days('2026-09-21', 30), CHANGES)
    expect(trendMarkersSummary(m)).toBe('Methodology changed to v2 on 8 Oct. Methodology changed to v3 on 9 Oct.')
    expect(trendMarkersSummary([])).toBe('')
  })
  it('the movers note', () => {
    expect(moversMethodologyNote([])).toBe('')
    expect(moversMethodologyNote([CHANGES[2]!])).toBe('Includes a methodology change on 9 Oct (v3).')
    expect(moversMethodologyNote([CHANGES[1]!, CHANGES[2]!])).toBe('Includes methodology changes on 8 Oct (v2), 9 Oct (v3).')
  })
})

describe('placeMarkerLabels', () => {
  it('puts a label right of its line when there is room', () => {
    expect(placeMarkerLabels([100], 300)).toEqual([{ side: 'right', row: 0 }])
  })
  it('puts it left at the right edge of the plot', () => {
    expect(placeMarkerLabels([290], 300)).toEqual([{ side: 'left', row: 0 }])
  })
  it('two close lines: the first label goes left, the second right, so they read in order on one row', () => {
    expect(placeMarkerLabels([100, 108], 300)).toEqual([{ side: 'left', row: 0 }, { side: 'right', row: 0 }])
  })
  it('two close lines with no room on the right: the second label drops to the next row', () => {
    expect(placeMarkerLabels([100, 103], 112)).toEqual([{ side: 'left', row: 0 }, { side: 'left', row: 1 }])
  })
  it('a close pair at the right edge: left of both lines, on two rows', () => {
    expect(placeMarkerLabels([290, 294], 300)).toEqual([{ side: 'left', row: 0 }, { side: 'left', row: 1 }])
  })
  it('lines far apart keep one row', () => {
    expect(placeMarkerLabels([20, 120, 220], 300).map(p => p.row)).toEqual([0, 0, 0])
  })
})
