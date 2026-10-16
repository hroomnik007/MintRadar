import { describe, it, expect } from 'vitest'
import { selectTrendTicks, trendTickLabels, TREND_TICK_MIN_SPACING } from '../utils/trendTicks'

const DAY = 86_400_000
function series(days: number, newest = '2026-10-16'): string[] {
  const end = Date.parse(newest)
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * DAY).toISOString().slice(0, 10))
}
const dayOf = (d: string) => Math.round(Date.parse(d) / DAY)
const gapsInDays = (ticks: string[]) => ticks.slice(1).map((t, i) => dayOf(t) - dayOf(ticks[i]!))
const minPx = (dates: string[], ticks: string[], width: number) => {
  const per = width / (dates.length - 1)
  const idx = ticks.map(t => dates.indexOf(t))
  return Math.min(...idx.slice(1).map((v, i) => (v - idx[i]!) * per))
}

describe('selectTrendTicks', () => {
  for (const [days, width] of [[30, 280], [30, 390], [30, 768], [30, 1440], [90, 280], [90, 390], [90, 768], [90, 1440]] as const) {
    it(`${days}d at ${width}px: newest is last, one step apart, at least ${TREND_TICK_MIN_SPACING}px between labels`, () => {
      const dates = series(days)
      const ticks = selectTrendTicks(dates, width)
      expect(ticks.at(-1)).toBe('2026-10-16')
      const gaps = gapsInDays(ticks)
      expect([7, 14, 28]).toContain(gaps[0])
      expect(new Set(gaps).size).toBe(1)
      expect(minPx(dates, ticks, width)).toBeGreaterThanOrEqual(TREND_TICK_MIN_SPACING)
    })
  }

  it('uses the smallest step that fits', () => {
    expect(gapsInDays(selectTrendTicks(series(30), 1000))[0]).toBe(7)
    expect(gapsInDays(selectTrendTicks(series(90), 1000))[0]).toBe(7)
    expect(gapsInDays(selectTrendTicks(series(90), 700))[0]).toBe(14)
    expect(gapsInDays(selectTrendTicks(series(90), 280))[0]).toBe(28)
  })

  it('gives about the expected counts', () => {
    expect(selectTrendTicks(series(30), 1000)).toHaveLength(5)
    expect(selectTrendTicks(series(90), 700)).toHaveLength(7)
    expect(selectTrendTicks(series(90), 280)).toHaveLength(4)
    expect(selectTrendTicks(series(30), 220)).toHaveLength(3)
  })

  it('falls back to 28 days when even that is tighter than the minimum', () => {
    const ticks = selectTrendTicks(series(90), 100)
    expect(gapsInDays(ticks)[0]).toBe(28)
    expect(ticks.at(-1)).toBe('2026-10-16')
  })

  it('crosses a calendar year', () => {
    const dates = series(90, '2027-01-20')
    const ticks = selectTrendTicks(dates, 700)
    expect(ticks.at(-1)).toBe('2027-01-20')
    expect(ticks.some(t => t.startsWith('2026-'))).toBe(true)
    expect(new Set(gapsInDays(ticks)).size).toBe(1)
  })

  it('a series with gaps: ticks are existing data dates, newest last, no duplicates', () => {
    const dates = series(90).filter((_, i) => i % 9 !== 4 && !(i > 30 && i < 38))
    const ticks = selectTrendTicks(dates, 700)
    for (const t of ticks) expect(dates).toContain(t)
    expect(ticks.at(-1)).toBe(dates.at(-1))
    expect(new Set(ticks).size).toBe(ticks.length)
    expect(minPx(dates, ticks, 700)).toBeGreaterThanOrEqual(TREND_TICK_MIN_SPACING)
    // A target that falls in the 7-day hole lands on the nearest existing day: at most 4 days off a multiple of 7.
    const newest = dayOf(dates.at(-1)!)
    for (const t of ticks) {
      const off = (newest - dayOf(t)) % 7
      expect(Math.min(off, 7 - off)).toBeLessThanOrEqual(4)
    }
  })

  it('a series shorter than the step gives just the newest date', () => {
    expect(selectTrendTicks(series(5), 700)).toEqual(['2026-10-16'])
  })

  it('a single point and an empty series', () => {
    expect(selectTrendTicks(['2026-10-16'], 700)).toEqual(['2026-10-16'])
    expect(selectTrendTicks([], 700)).toEqual([])
  })
})

describe('trendTickLabels', () => {
  it('uses the short format without a year', () => {
    const labels = trendTickLabels(['2026-10-02', '2026-10-16'])
    expect(labels.get('2026-10-16')).toBe('16 Oct')
    expect(labels.get('2026-10-02')).toBe('2 Oct')
  })

  it('shows the year only on the first label of the new year', () => {
    const labels = trendTickLabels(['2026-12-18', '2027-01-01', '2027-01-15'])
    expect(labels.get('2026-12-18')).toBe('18 Dec')
    expect(labels.get('2027-01-01')).toBe('1 Jan 2027')
    expect(labels.get('2027-01-15')).toBe('15 Jan')
  })
})
