import { memo } from 'react'
import {
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts'
import { latencyScale } from '@/utils/chartScale'

// The History tab's line chart. Lives in its own file so recharts (~350 kB) is a separate chunk that Mint Detail
// loads with React.lazy only when the History tab is opened (see MintDetail.tsx).

export interface HistoryChartPoint { label: string; latency: number | null; uptime: number | null; reliability: number | null }

// memo: MintDetailContent re-renders on every useNow tick (30 s) and the inline margin/tick/style objects below are
// new on each render, which made recharts rebuild its points and replay the line animation (~90 commits per tick).
// With memo the chart only re-renders when data, metric, interval or height actually change.
function MintDetailHistoryChart({ data, metric, interval, height }: {
  data: HistoryChartPoint[]
  metric: 'latency' | 'uptime' | 'reliability'
  interval: '24h' | '7d' | '30d' | '90d'
  height: number
}) {
  const latency = metric === 'latency' ? latencyScale(data.map(d => d.latency)) : null
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 10, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: 'var(--text3)' }}
          axisLine={false} tickLine={false}
          interval={interval === '24h' ? 3 : data.length <= 7 ? 0 : Math.ceil(data.length / 7) - 1}
        />
        <YAxis
          tick={{ fontSize: 9, fill: 'var(--text3)' }}
          axisLine={false} tickLine={false}
          width={60}
          domain={latency ? latency.domain : [0, 100]}
          {...(latency ? { ticks: latency.ticks } : {})}
          tickFormatter={(v: number) => metric === 'latency' ? `${Math.round(v)}ms` : `${Math.round(v)}%`}
        />
        <Tooltip
          contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 11 }}
          formatter={(value) => [metric === 'latency' ? `${String(value)}ms` : `${String(value)}%`, metric === 'latency' ? 'Latency' : metric === 'uptime' ? 'Uptime' : 'Reliability Score']}
        />
        <Line
          type="monotone"
          dataKey={metric}
          stroke="var(--accent)"
          dot={false}
          strokeWidth={2}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export default memo(MintDetailHistoryChart)
