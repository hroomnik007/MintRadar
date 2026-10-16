import { useMemo, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Text, type XAxisTickContentProps } from 'recharts'
import { formatDate } from '@/utils/formatDate'
import { selectTrendTicks, trendTickLabels } from '@/utils/trendTicks'

export interface TrendPoint { date: string; avgReliability: number }

const AXIS_TICK = { fontSize: 9, fill: 'var(--text3)', fontFamily: 'var(--font-mono)' } as const
// The chart margin (left -28) and the Y axis (width 60) leave the plot 32px in from the left edge, and the right margin
// is 4px: the first-to-last-point span is the container width minus 36.
const PLOT_INSET = 36

export function ReliabilityTrendChart({ data }: { data: readonly TrendPoint[] }) {
  const [width, setWidth] = useState(0)
  const dates = useMemo(() => data.map(d => d.date), [data])
  const ticks = useMemo(() => selectTrendTicks(dates, width - PLOT_INSET), [dates, width])
  const labels = useMemo(() => trendTickLabels(ticks), [ticks])
  const first = dates[0]
  const last = dates[dates.length - 1]

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
          formatter={(v) => [`${v ?? '—'}%`, 'Avg Reliability']}
        />
        <Area type="monotone" dataKey="avgReliability" stroke="var(--accent)" strokeWidth={1.5} fill="url(#reliabilityGrad)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
