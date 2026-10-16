// X-axis ticks for the Reliability Score trend chart, chosen BY DATE (not by index).
//
// The ticks are the newest data date minus multiples of a step of 7, 14 or 28 days; the step is the smallest of these
// that leaves at least `minSpacing` px between neighbouring labels at the given chart width. The newest date is always
// the last tick, so the right edge of the chart shows the latest date and a 30d and a 90d chart both read as
// "weeks back from today". The chart is categorical (one point per data date, evenly spaced by index), so every tick is
// the data point NEAREST to its target date; with a gap in the series two targets can land on the same point (deduped)
// and the spacing is measured between the points actually chosen.

import { DATE_MONTHS } from '@/utils/formatDate'

export const TREND_TICK_STEPS = [7, 14, 28] as const
export const TREND_TICK_MIN_SPACING = 64

const DAY_MS = 86_400_000

const dayNumber = (date: string): number => Math.floor(Date.parse(date) / DAY_MS)

/**
 * `dates`: the chart's category values ('YYYY-MM-DD', ascending). `chartWidth`: the width in px the first..last point
 * span. Returns the tick dates, ascending; the last one is `dates[dates.length - 1]`.
 */
export function selectTrendTicks(
  dates: readonly string[],
  chartWidth: number,
  minSpacing: number = TREND_TICK_MIN_SPACING,
): string[] {
  const n = dates.length
  if (n === 0) return []
  if (n === 1) return [dates[0]!]

  const days = dates.map(dayNumber)
  const oldest = days[0]!
  const newest = days[n - 1]!
  const pxPerIndex = chartWidth / (n - 1)

  const nearestIndex = (target: number): number => {
    let best = n - 1
    for (let i = n - 1; i >= 0; i--) {
      if (Math.abs(days[i]! - target) < Math.abs(days[best]! - target)) best = i
    }
    return best
  }

  const indicesFor = (step: number): number[] => {
    const found = new Set<number>()
    for (let target = newest; target >= oldest; target -= step) found.add(nearestIndex(target))
    return [...found].sort((a, b) => a - b)
  }

  const fits = (indices: number[]): boolean => {
    for (let i = 1; i < indices.length; i++) {
      if ((indices[i]! - indices[i - 1]!) * pxPerIndex < minSpacing) return false
    }
    return true
  }

  let chosen = indicesFor(TREND_TICK_STEPS[TREND_TICK_STEPS.length - 1]!)
  for (const step of TREND_TICK_STEPS) {
    const indices = indicesFor(step)
    if (fits(indices)) { chosen = indices; break }
  }
  return chosen.map(i => dates[i]!)
}

/**
 * The label of every tick ("16 Oct"). When the ticks cross a calendar year, the first tick of the new year also shows
 * the year ("1 Jan 2027"), so a January label is never ambiguous.
 */
export function trendTickLabels(ticks: readonly string[]): Map<string, string> {
  const labels = new Map<string, string>()
  const firstYear = ticks.length > 0 ? new Date(ticks[0]!).getUTCFullYear() : 0
  let yearShown = false
  for (const tick of ticks) {
    const d = new Date(tick)
    const day = d.getUTCDate()
    const month = DATE_MONTHS[d.getUTCMonth()]
    if (!yearShown && d.getUTCFullYear() > firstYear) {
      labels.set(tick, `${day} ${month} ${d.getUTCFullYear()}`)
      yearShown = true
    } else {
      labels.set(tick, `${day} ${month}`)
    }
  }
  return labels
}
