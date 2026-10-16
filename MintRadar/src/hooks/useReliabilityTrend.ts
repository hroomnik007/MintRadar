import { useEffect, useRef } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'

export type TrendDays = 30 | 90

export interface ReliabilityTrendResponse {
  trend: Array<{ date: string; avgReliability: number }>
  periodDays: number
  earliestCheckedAt: string | null
  daysOfDataAvailable: number
}

const TREND_STALE_MS = 10 * 60 * 1000

const trendKey = (days: TrendDays) => ['stats-reliability-trend', days] as const

async function fetchTrend(days: TrendDays): Promise<ReliabilityTrendResponse> {
  const res = await fetch(`/api/stats/reliability-trend?days=${days}`)
  if (!res.ok) throw new Error('reliability-trend fetch failed')
  return res.json() as Promise<ReliabilityTrendResponse>
}

type IdleHandle = { cancel: () => void }
function whenIdle(run: () => void): IdleHandle {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run)
    return { cancel: () => cancelIdleCallback(id) }
  }
  const id = setTimeout(run, 0)
  return { cancel: () => clearTimeout(id) }
}

/**
 * The Reliability Score trend for 30 or 90 days. While the other period is loading the previous period's data stays
 * available (`isPlaceholderData` is true), so the chart is never swapped for an empty state. After the first successful
 * load the OTHER period is prefetched once when the browser is idle (its response is about 4 KB, 0.5 KB gzipped) so the
 * toggle is instant; a failed first load never prefetches, and the prefetch itself does not retry.
 */
export function useReliabilityTrend(days: TrendDays) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: trendKey(days),
    queryFn: () => fetchTrend(days),
    staleTime: TREND_STALE_MS,
    placeholderData: keepPreviousData,
  })

  const prefetched = useRef(false)
  const loaded = query.isSuccess && !query.isPlaceholderData
  useEffect(() => {
    if (!loaded || prefetched.current) return
    const other: TrendDays = days === 30 ? 90 : 30
    const handle = whenIdle(() => {
      prefetched.current = true
      void queryClient.prefetchQuery({ queryKey: trendKey(other), queryFn: () => fetchTrend(other), staleTime: TREND_STALE_MS, retry: false })
    })
    return () => handle.cancel()
  }, [loaded, days, queryClient])

  return query
}
