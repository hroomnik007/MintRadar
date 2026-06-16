import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { MintFavicon } from '@/components/mint/MintFavicon'
import './Stats.css'

interface StatsData {
  totalMints: number
  onlineMints: number
  offlineMints: number
  avgTrustScore: number | null
  avgLatency24h: number | null
  trustDistribution: { low: number; moderate: number; high: number }
  nutAdoption: Array<{ nut: string; count: number; percent: number }>
  top5ByTrustScore: Array<{ url: string; name: string | null; trustScore: number }>
}

function trustScoreInfo(score: number): { label: string; color: string; bg: string; border: string } {
  if (score >= 70) return { label: 'High Trust', color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.25)' }
  if (score >= 40) return { label: 'Moderate Trust', color: '#ffa500', bg: 'rgba(255,165,0,0.1)', border: 'rgba(255,165,0,0.25)' }
  return { label: 'Low Trust', color: '#ff4d4d', bg: 'rgba(255,77,77,0.1)', border: 'rgba(255,77,77,0.25)' }
}

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

export default function Stats() {
  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats'],
    queryFn: async (): Promise<StatsData> => {
      const res = await fetch('/api/stats')
      if (!res.ok) throw new Error('Failed to fetch stats')
      return res.json() as Promise<StatsData>
    },
    staleTime: 2 * 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  })

  if (isLoading) return (
    <div className="stats-page">
      <div className="stats-header">
        <div className="stats-title">Statistics</div>
      </div>
      <div className="stats-loading">Loading…</div>
    </div>
  )

  if (error !== null && error !== undefined || !data) return (
    <div className="stats-page">
      <div className="stats-header">
        <div className="stats-title">Statistics</div>
      </div>
      <div className="stats-loading">Failed to load statistics</div>
    </div>
  )

  const avgTsInfo = data.avgTrustScore != null ? trustScoreInfo(data.avgTrustScore) : null
  const trustDistData = [
    { name: 'Low Trust', value: data.trustDistribution.low, color: '#ff4d4d' },
    { name: 'Moderate Trust', value: data.trustDistribution.moderate, color: '#ffa500' },
    { name: 'High Trust', value: data.trustDistribution.high, color: '#4ade80' },
  ]

  return (
    <div className="stats-page">
      <div className="stats-header">
        <div className="stats-title">Statistics</div>
        <div className="stats-subtitle">Network-wide metrics across all monitored Cashu mints</div>
      </div>

      <div className="stats-metrics">
        <div className="stats-metric-card">
          <div className="smc-label">Total Mints</div>
          <div className="smc-value">{data.totalMints}</div>
        </div>
        <div className="stats-metric-card">
          <div className="smc-label">Online</div>
          <div className="smc-value" style={{ color: '#4ade80' }}>{data.onlineMints}</div>
        </div>
        <div className="stats-metric-card">
          <div className="smc-label">Offline</div>
          <div className="smc-value" style={{ color: '#ff4d4d' }}>{data.offlineMints}</div>
        </div>
        <div className="stats-metric-card">
          <div className="smc-label">Avg Trust Score</div>
          <div className="smc-value" style={avgTsInfo ? { color: avgTsInfo.color } : undefined}>
            {data.avgTrustScore != null ? `${data.avgTrustScore}%` : '—'}
          </div>
          {avgTsInfo && <div className="smc-sub">{avgTsInfo.label}</div>}
        </div>
        <div className="stats-metric-card">
          <div className="smc-label">Avg Latency (24h)</div>
          <div className="smc-value">
            {data.avgLatency24h != null ? `${data.avgLatency24h} ms` : '—'}
          </div>
        </div>
      </div>

      <div className="stats-body">
        <div className="stats-panel">
          <div className="stats-panel-title">NUT Adoption (Online Mints)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
            {data.nutAdoption.map(({ nut, percent }) => {
              const barColor = percent >= 70 ? '#639922' : percent >= 40 ? '#EF9F27' : '#E24B4A'
              return (
                <div key={nut} style={{ display: 'grid', gridTemplateColumns: '68px 1fr 44px', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text2)', textAlign: 'right' }}>{nut}</span>
                  <div style={{ height: 8, borderRadius: 99, background: 'var(--bg3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${percent}%`, borderRadius: 99, background: barColor }} />
                  </div>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: barColor, textAlign: 'right' }}>{percent}%</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="stats-panel">
          <div className="stats-panel-title">Trust Score Distribution</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28, padding: '12px 0' }}>
            <div style={{ width: 160, height: 160, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={trustDistData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={72}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {trustDistData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} opacity={0.85} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                    formatter={(value, name) => [value as number, String(name)]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {trustDistData.map(d => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text2)', minWidth: 90 }}>{d.name}</span>
                  <span style={{ fontSize: 15, fontFamily: 'var(--font-mono)', fontWeight: 700, color: d.color }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="stats-panel">
          <div className="stats-panel-title">Top 5 by Trust Score</div>
          {data.top5ByTrustScore.length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: '8px 0' }}>No data yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.top5ByTrustScore.map((mint, idx) => {
                const tsInfo = trustScoreInfo(mint.trustScore)
                const hostname = getHostname(mint.url)
                return (
                  <div
                    key={mint.url}
                    onClick={() => navigate(`/mint/${encodeURIComponent(mint.url)}`)}
                    className="stats-top5-row"
                  >
                    <span className="stats-top5-rank">#{idx + 1}</span>
                    <MintFavicon url={mint.url} iconUrl={null} size={20} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mint.name ?? hostname}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hostname}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: tsInfo.color, background: tsInfo.bg, border: `0.5px solid ${tsInfo.border}`, borderRadius: 4, padding: '1px 5px' }}>{tsInfo.label}</span>
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: tsInfo.color }}>{mint.trustScore}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
