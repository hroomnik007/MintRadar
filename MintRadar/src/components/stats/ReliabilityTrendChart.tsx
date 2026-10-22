import { lazy, Suspense } from 'react'
import { LoadError, LoadingNote } from '@/components/LoadError'
import { trendMarkers, trendMarkersSummary } from '@/utils/methodologyMarkers'

export interface TrendPoint { date: string; avgReliability: number }

// recharts (vendor-charts, ~99 kB gzip) is fetched only when a chart is drawn, not with the Stats route chunk. The chart
// box (`.stats-trend-body`, 120px) has a fixed height, so the loading note inside it moves nothing when the chart lands.
const ReliabilityTrendPlot = lazy(() => import('./ReliabilityTrendPlot'))

// Same fixed sentence as the page-level statistics error (Stats.tsx STATS_ERROR).
const TREND_ERROR = 'Could not load the statistics. Please try again.'

/**
 * The chart card body (the reserved 120px area under the header). Loading never looks like empty:
 *  - first load, nothing to show yet: the loading note;
 *  - another period is loading: the previous chart stays, dimmed and not clickable (`is-pending`);
 *  - a failed request: the app's LoadError with Try again;
 *  - "No data yet" only for a successful response that is empty.
 */
export function ReliabilityTrendView({ data, isPending, isError, isPlaceholderData, onRetry }: {
  data: readonly TrendPoint[] | undefined
  isPending: boolean
  isError: boolean
  isPlaceholderData: boolean
  onRetry: () => void
}) {
  let body
  if (isError) body = <LoadError message={TREND_ERROR} onRetry={onRetry} />
  else if (isPending || !data) body = <LoadingNote />
  else if (data.length === 0) body = <div style={{color:'var(--text3)',fontSize:12,fontFamily:'var(--font-mono)',paddingTop:30,textAlign:'center'}}>No data yet</div>
  else body = <Suspense fallback={<LoadingNote />}><ReliabilityTrendPlot data={data} /></Suspense>
  const markerSummary = !isError && !isPending && data ? trendMarkersSummary(trendMarkers(data.map(d => d.date))) : ''
  return (
    <div className={`stats-trend-body${isPlaceholderData ? ' is-pending' : ''}`} aria-busy={isPlaceholderData || isPending} style={{marginTop:'var(--stats-header-gap)',height:120}}>
      {body}
      {markerSummary !== '' && <span className="sr-only">{markerSummary}</span>}
    </div>
  )
}
