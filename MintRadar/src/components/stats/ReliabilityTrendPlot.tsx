import { useMemo, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Text, type XAxisTickContentProps } from 'recharts'
import { formatDate } from '@/utils/formatDate'
import { useIsMobile } from '@/hooks/useIsMobile'
import { trendMarkers, placeMarkerLabels } from '@/utils/methodologyMarkers'
import { selectTrendTicks, trendTickLabels, trendScoreDomain, DESKTOP_TREND_TICK_STEPS, DESKTOP_TREND_TICK_MIN_SPACING, TREND_TICK_STEPS, TREND_TICK_MIN_SPACING } from '@/utils/trendTicks'
import type { TrendPoint } from './ReliabilityTrendChart'

// The recharts part of the Reliability Score trend. It lives in its own file so that ReliabilityTrendChart.tsx (and with
// it the Stats route chunk) does not import recharts statically: this file is loaded with React.lazy when a chart is drawn.

// Axis labels are dates and numbers, not code: the body face (2026-11-18 type change; they were 9px mono).
const AXIS_TICK = { fontSize: 12, fill: 'var(--text3)', fontFamily: 'var(--font-body)' } as const
// One marker label row: the text box of a 12px label is 17px tall, so rows are 18px apart (9px labels had 12px).
const MARKER_ROW_PX = 18
// Width of a "v<N>" label at 12px (the helper's default of 16 was for the 9px label).
const MARKER_LABEL_PX = 20
// The chart margin (left -28) and the Y axis (width 60) leave the plot 32px in from the left edge, and the right margin
// is 4px: the first-to-last-point span is the container width minus 36.
const PLOT_INSET = 36

function ReliabilityTrendPlot({ data }: { data: readonly TrendPoint[] }) {
  const [width, setWidth] = useState(0)
  const dates = useMemo(() => data.map(d => d.date), [data])
  const isMobile = useIsMobile()
  const ticks = useMemo(
    () => selectTrendTicks(dates, width - PLOT_INSET, isMobile ? TREND_TICK_MIN_SPACING : DESKTOP_TREND_TICK_MIN_SPACING, isMobile ? TREND_TICK_STEPS : DESKTOP_TREND_TICK_STEPS),
    [dates, width, isMobile],
  )
  const labels = useMemo(() => trendTickLabels(ticks), [ticks])
  const yAxis = useMemo(() => trendScoreDomain(data.map(d => d.avgReliability)), [data])
  const first = dates[0]
  const last = dates[dates.length - 1]
  const markers = useMemo(() => trendMarkers(dates), [dates])
  // Version labels next to their lines; they never leave the plot or touch each other (placeMarkerLabels).
  const pxPerIndex = dates.length > 1 ? (width - PLOT_INSET) / (dates.length - 1) : 0
  const labelPlaces = useMemo(
    () => placeMarkerLabels(markers.map(m => dates.indexOf(m.at) * pxPerIndex), width - PLOT_INSET, MARKER_LABEL_PX),
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
        <YAxis domain={[yAxis.lo, yAxis.hi]} ticks={yAxis.ticks} allowDataOverflow tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:6,fontSize:12,fontFamily:'var(--font-body)'}}
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
                <text x={(viewBox?.x ?? 0) + (left ? -3 : 3)} y={(viewBox?.y ?? 0) + 10 + row * MARKER_ROW_PX} textAnchor={left ? 'end' : 'start'} {...AXIS_TICK} fill="var(--copper)">
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

export default ReliabilityTrendPlot
