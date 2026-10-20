import { useMemo, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Text, type XAxisTickContentProps } from 'recharts'
import { formatDate } from '@/utils/formatDate'
import { LoadError, LoadingNote } from '@/components/LoadError'
import { useIsMobile } from '@/hooks/useIsMobile'
import { trendMarkers, trendMarkersSummary, placeMarkerLabels } from '@/utils/methodologyMarkers'
import { selectTrendTicks, trendTickLabels, DESKTOP_TREND_TICK_STEPS, DESKTOP_TREND_TICK_MIN_SPACING, TREND_TICK_STEPS, TREND_TICK_MIN_SPACING } from '@/utils/trendTicks'

export interface TrendPoint { date: string; avgReliability: number }

const AXIS_TICK = { fontSize: 9, fill: 'var(--text3)', fontFamily: 'var(--font-mono)' } as const
// The chart margin (left -28) and the Y axis (width 60) leave the plot 32px in from the left edge, and the right margin
// is 4px: the first-to-last-point span is the container width minus 36.
const PLOT_INSET = 36

export function ReliabilityTrendChart({ data }: { data: readonly TrendPoint[] }) {
  const [width, setWidth] = useState(0)
  const dates = useMemo(() => data.map(d => d.date), [data])
  const isMobile = useIsMobile()
  const ticks = useMemo(
    () => selectTrendTicks(dates, width - PLOT_INSET, isMobile ? TREND_TICK_MIN_SPACING : DESKTOP_TREND_TICK_MIN_SPACING, isMobile ? TREND_TICK_STEPS : DESKTOP_TREND_TICK_STEPS),
    [dates, width, isMobile],
  )
  const labels = useMemo(() => trendTickLabels(ticks), [ticks])
  const first = dates[0]
  const last = dates[dates.length - 1]
  const markers = useMemo(() => trendMarkers(dates), [dates])
  // Version labels next to their lines; they never leave the plot or touch each other (placeMarkerLabels).
  const pxPerIndex = dates.length > 1 ? (width - PLOT_INSET) / (dates.length - 1) : 0
  const labelPlaces = useMemo(
    () => placeMarkerLabels(markers.map(m => dates.indexOf(m.at) * pxPerIndex), width - PLOT_INSET),
    [markers, dates, pxPerIndex, width],
  )

  // The newest date sits on the right edge and is right aligned, the oldest point on the left edge is left aligned:
  // neither label is clipped. Every other label is centred on its point.
  const renderTick = ({ x, y, payload, verticalAnchor }: XAxisTickContentProps) => {
    const value = String(payload?.value ?? '')
    const anchor = value === last ? 'end' : value === first ? 'start' : 'middle'
    return (
      <Text x={x} y={y} {...AXIS_TICK} verticalAnchor={verticalAnchor} textAnchor={anchor} className="recharts-cartesian-axis-tick-value">
        {labels.get(value) ?? ''}
      </Text>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%" onResize={w => setWidth(prev => (prev === w ? prev : w))}>
      <AreaChart data={data as TrendPoint[]} margin={{top:4,right:4,left:-28,bottom:0}}>
        <defs>
          <linearGradient id="reliabilityGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25}/>
            <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <XAxis dataKey="date" ticks={ticks} interval={0} tick={renderTick} axisLine={false} tickLine={false} />
        <YAxis domain={[0,100]} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:6,fontSize:11,fontFamily:'var(--font-mono)'}}
          labelStyle={{color:'var(--text3)'}}
          labelFormatter={d => formatDate(String(d)) || String(d)}
          formatter={(v) => [v ?? '—', 'Avg Reliability']}
        />
        {markers.map((m, i) => (
          <ReferenceLine
            key={m.version}
            x={m.at}
            className="stats-trend-marker"
            stroke="var(--copper)"
            strokeOpacity={0.7}
            strokeWidth={1}
            strokeDasharray="3 3"
            ifOverflow="visible"
            label={({ viewBox }: { viewBox?: { x?: number; y?: number } }) => {
              const { side, row } = labelPlaces[i] ?? { side: 'right', row: 0 }
              const left = side === 'left'
              return (
                <text x={(viewBox?.x ?? 0) + (left ? -3 : 3)} y={(viewBox?.y ?? 0) + 9 + row * 12} textAnchor={left ? 'end' : 'start'} {...AXIS_TICK} fill="var(--copper)">
                  {`v${m.version}`}
                </text>
              )
            }}
          />
        ))}
        <Area type="monotone" dataKey="avgReliability" stroke="var(--accent)" strokeWidth={1.5} fill="url(#reliabilityGrad)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

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
  else body = <ReliabilityTrendChart data={data} />
  const markerSummary = !isError && !isPending && data ? trendMarkersSummary(trendMarkers(data.map(d => d.date))) : ''
  return (
    <div className={`stats-trend-body${isPlaceholderData ? ' is-pending' : ''}`} aria-busy={isPlaceholderData || isPending} style={{marginTop:'var(--stats-header-gap)',height:120}}>
      {body}
      {markerSummary !== '' && <span className="sr-only">{markerSummary}</span>}
    </div>
  )
}
