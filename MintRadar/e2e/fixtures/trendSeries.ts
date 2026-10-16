// Deterministic Reliability Score trend payloads for the Stats trend specs: a daily series ending on a fixed date
// (so tick labels do not depend on the day the test runs).

export const TREND_NEWEST = '2026-10-16'

export interface TrendPayload {
  trend: Array<{ date: string; avgReliability: number }>
  periodDays: number
  earliestCheckedAt: string | null
  daysOfDataAvailable: number
}

export function trendPayload(days: 30 | 90, newest = TREND_NEWEST): TrendPayload {
  const end = Date.parse(`${newest}T00:00:00Z`)
  const trend = Array.from({ length: days }, (_, i) => ({
    date: new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    avgReliability: 70 + ((i * 7) % 23),
  }))
  return { trend, periodDays: days, earliestCheckedAt: `${trend[0]!.date}T00:00:00.000Z`, daysOfDataAvailable: days }
}

export function emptyTrendPayload(days: 30 | 90): TrendPayload {
  return { trend: [], periodDays: days, earliestCheckedAt: null, daysOfDataAvailable: 0 }
}

export const trendDaysOf = (url: string): 30 | 90 => (new URL(url).searchParams.get('days') === '90' ? 90 : 30)
