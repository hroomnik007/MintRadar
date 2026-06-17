import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { useKnownMints, type KnownMint } from '@/hooks/useKnownMints'
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
  if (score >= 70) return { label: 'High Trust', color: '#17E87F', bg: 'rgba(23,232,127,0.1)', border: 'rgba(23,232,127,0.25)' }
  if (score >= 40) return { label: 'Moderate Trust', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)' }
  return { label: 'Low Trust', color: '#E24B4A', bg: 'rgba(226,75,74,0.1)', border: 'rgba(226,75,74,0.25)' }
}

function uptimeColor(pct: number): string {
  if (pct >= 80) return '#17E87F'
  if (pct >= 50) return '#f59e0b'
  return '#E24B4A'
}

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

const NUT_META: Record<string, { short: string; desc: string; specNum: string }> = {
  'NUT-04': { short: 'Mint tokens', desc: 'Minting new Cashu tokens against a Lightning invoice.', specNum: '04' },
  'NUT-05': { short: 'Melt tokens', desc: 'Melting Cashu tokens to pay a Lightning invoice.', specNum: '05' },
  'NUT-07': { short: 'Token state', desc: 'Checking whether a proof has been spent or is still valid.', specNum: '07' },
  'NUT-08': { short: 'Overpay melt', desc: 'Overpaying melt fees and receiving change tokens back.', specNum: '08' },
  'NUT-09': { short: 'Restore', desc: 'Restoring blinded signatures from mint backup data.', specNum: '09' },
  'NUT-10': { short: 'Spending conditions', desc: 'Conditions that must be met to use a proof.', specNum: '10' },
  'NUT-11': { short: 'Pay-to-PK', desc: 'Lock tokens to a specific public key for secure transfers.', specNum: '11' },
  'NUT-12': { short: 'DLEQ proofs', desc: 'Discrete Log Equality proofs for verifiable blind signatures.', specNum: '12' },
  'NUT-14': { short: 'HTLCs', desc: 'Hash Time Locked Contracts for atomic swaps.', specNum: '14' },
  'NUT-15': { short: 'Multipart melt', desc: 'Split a melt payment across multiple Lightning invoices.', specNum: '15' },
  'NUT-17': { short: 'WebSocket', desc: 'Real-time mint updates via WebSocket subscription.', specNum: '17' },
  'NUT-19': { short: 'Cached responses', desc: 'Mints cache successful responses so wallets can replay after a network error.', specNum: '19' },
  'NUT-20': { short: 'Mint quote sig', desc: 'Mint signs quote requests for authenticity.', specNum: '20' },
  'NUT-29': { short: 'Batched minting', desc: 'Wallets can mint tokens for multiple quotes in a single atomic request.', specNum: '29' },
}

function countryFlag(cc: string): string {
  if (cc.length !== 2) return ''
  const base = 0x1F1E6 - 65
  return String.fromCodePoint(base + cc.toUpperCase().charCodeAt(0), base + cc.toUpperCase().charCodeAt(1))
}

function geoLabel(loc: string): { display: string; flag: string } {
  if (loc === 'Unknown') return { display: 'Unknown', flag: '' }
  const commaIdx = loc.lastIndexOf(', ')
  if (commaIdx === -1) return { display: loc, flag: '' }
  const cc = loc.slice(commaIdx + 2)
  const city = loc.slice(0, commaIdx)
  return { display: city, flag: cc.length === 2 ? countryFlag(cc) : '' }
}

function NutMintsModal({ nutId, nutMeta, mints, onClose }: {
  nutId: string
  nutMeta: { short: string; desc: string; specNum: string }
  mints: KnownMint[]
  onClose: () => void
}) {
  const [search, setSearch] = useState('')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const filtered = useMemo(() => {
    if (!search.trim()) return mints
    const q = search.toLowerCase()
    return mints.filter(m => {
      const name = (m.name ?? getHostname(m.url)).toLowerCase()
      return name.includes(q) || m.url.toLowerCase().includes(q)
    })
  }, [mints, search])

  const total = mints.length
  const online = mints.filter(m => m.online === true).length
  const offline = mints.filter(m => m.online === false).length

  return (
    <div className="nut-modal-overlay" onClick={onClose}>
      <div className="nut-modal" onClick={e => e.stopPropagation()}>
        <button type="button" className="nut-modal-close" onClick={onClose}>✕</button>
        <div className="nut-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="snc-nut-tag">{nutId}</span>
            <span className="nut-modal-title">{nutMeta.short}</span>
          </div>
          <div className="nut-modal-subtitle">{total} mint{total !== 1 ? 's' : ''} support this NUT</div>
        </div>
        <input
          className="nut-modal-search"
          type="text"
          placeholder="Filter by mint name or URL…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
        <div className="nut-modal-list">
          {filtered.map(m => (
            <div key={m.url} className="nut-modal-row">
              <MintFavicon url={m.url} iconUrl={m.iconUrl} size={22} />
              <div className="nut-modal-row-info">
                <span className="nut-modal-row-name">{m.name ?? getHostname(m.url)}</span>
                <span className="nut-modal-row-url">{getHostname(m.url)}</span>
              </div>
              <span
                className="nut-modal-row-dot"
                style={{ background: m.online === true ? '#17E87F' : '#E24B4A' }}
              />
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="nut-modal-empty">No mints match</div>
          )}
        </div>
        <div className="nut-modal-footer">
          {total} total · {online} online · {offline} offline
        </div>
      </div>
    </div>
  )
}

export default function Stats() {
  const navigate = useNavigate()
  const [modalNut, setModalNut] = useState<string | null>(null)
  const [top5Tab, setTop5Tab] = useState<'trust' | 'uptime'>('trust')

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

  const { data: knownMintsData } = useKnownMints()

  const nutSupportingMints = useMemo(() => {
    if (!knownMintsData) return {} as Record<string, KnownMint[]>
    const NUT_KEYS = ['4','5','7','8','9','10','11','12','14','15','17','19','20','29']
    const result: Record<string, KnownMint[]> = {}
    for (const key of NUT_KEYS) {
      const nutId = `NUT-${key.padStart(2, '0')}`
      result[nutId] = knownMintsData.filter(m => m.nutsLimits?.[key] != null)
    }
    return result
  }, [knownMintsData])

  const { avgUptime24h, uptimeMintCount } = useMemo(() => {
    if (!knownMintsData || knownMintsData.length === 0) return { avgUptime24h: null, uptimeMintCount: 0 }
    const total = knownMintsData.length
    const sum = knownMintsData.reduce((acc, m) => acc + (m.uptimePct24h ?? 0), 0)
    return {
      avgUptime24h: Math.round(sum / total),
      uptimeMintCount: total,
    }
  }, [knownMintsData])

  const mintIconByUrl = useMemo(() => {
    if (!knownMintsData) return {} as Record<string, string | null>
    return Object.fromEntries(knownMintsData.map(m => [m.url, m.iconUrl]))
  }, [knownMintsData])

  const top5ByUptime = useMemo(() => {
    if (!knownMintsData) return []
    return [...knownMintsData]
      .filter(m => m.online === true && m.uptimePct24h != null)
      .sort((a, b) => (b.uptimePct24h ?? 0) - (a.uptimePct24h ?? 0))
      .slice(0, 5)
  }, [knownMintsData])

  const softwareDist = useMemo(() => {
    if (!knownMintsData) return []
    const counts = new Map<string, number>()
    for (const m of knownMintsData) {
      if (m.online !== true) continue
      const raw = m.version ?? ''
      const software = raw.includes('/') ? raw.split('/')[0]! : raw.trim() || 'Unknown'
      counts.set(software, (counts.get(software) ?? 0) + 1)
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, pct: total > 0 ? Math.round(count / total * 100) : 0 }))
  }, [knownMintsData])

  const geoDist = useMemo(() => {
    if (!knownMintsData) return []
    const counts = new Map<string, number>()
    for (const m of knownMintsData) {
      if (m.online !== true) continue
      const loc = m.serverLocation ?? 'Unknown'
      counts.set(loc, (counts.get(loc) ?? 0) + 1)
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([loc, count]) => ({ loc, count, pct: total > 0 ? Math.round(count / total * 100) : 0 }))
  }, [knownMintsData])

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
    { name: 'Low Trust', value: data.trustDistribution.low, color: '#E24B4A' },
    { name: 'Moderate', value: data.trustDistribution.moderate, color: '#f59e0b' },
    { name: 'High Trust', value: data.trustDistribution.high, color: '#17E87F' },
  ]
  const singleSegment = trustDistData.filter(d => d.value > 0).length === 1

  const NUT_ORDER = ['NUT-04','NUT-05','NUT-07','NUT-08','NUT-09','NUT-10','NUT-11','NUT-12','NUT-14','NUT-15','NUT-17','NUT-19','NUT-20','NUT-29']
  const nutAdoptionMap = Object.fromEntries(data.nutAdoption.map(n => [n.nut, n]))

  const modalNutMints = modalNut ? (nutSupportingMints[modalNut] ?? []) : []
  const modalNutMeta = modalNut ? NUT_META[modalNut] : null

  return (
    <div className="stats-page">
      <div className="stats-header">
        <div className="stats-title">Statistics</div>
        <div className="stats-subtitle">Network-wide metrics across all monitored Cashu mints</div>
      </div>

      {/* ── Metric cards ── */}
      <div className="stats-metrics">
        <div className="stats-metric-card">
          <div className="smc-label">
            <span className="smc-dot" style={{ background: '#8b949e' }} />
            Total Mints
          </div>
          <div className="smc-value">{data.totalMints}</div>
        </div>
        <div className="stats-metric-card">
          <div className="smc-label">
            <span className="smc-dot" style={{ background: '#17E87F', boxShadow: '0 0 5px #17E87F' }} />
            Online
          </div>
          <div className="smc-value" style={{ color: '#17E87F', textShadow: '0 0 20px rgba(23,232,127,0.3)' }}>{data.onlineMints}</div>
        </div>
        <div className="stats-metric-card">
          <div className="smc-label">
            <span className="smc-dot" style={{ background: '#E24B4A' }} />
            Offline
          </div>
          <div className="smc-value" style={{ color: '#E24B4A' }}>{data.offlineMints}</div>
        </div>
        <div className="stats-metric-card">
          <div className="smc-label">
            <span className="smc-dot" style={{ background: '#8b949e' }} />
            Avg Trust Score
          </div>
          <div className="smc-value" style={avgTsInfo ? { color: avgTsInfo.color, textShadow: '0 0 20px rgba(23,232,127,0.3)' } : undefined}>
            {data.avgTrustScore != null ? `${data.avgTrustScore}%` : '—'}
          </div>
          {avgTsInfo && <div className="smc-sub">{avgTsInfo.label}</div>}
        </div>
        <div className="stats-metric-card">
          <div className="smc-label">
            <span className="smc-dot" style={{ background: '#8b949e' }} />
            Avg Uptime (24h)
          </div>
          <div className="smc-value" style={{ color: avgUptime24h != null ? uptimeColor(avgUptime24h) : undefined }}>
            {avgUptime24h != null ? `${avgUptime24h}%` : '—'}
          </div>
        </div>
      </div>

      {/* ── Mid section ── */}
      <div className="stats-body">
        {/* Left — Trust Score Distribution + Avg Uptime */}
        <div className="stats-panel">
          <div className="stats-panel-title">Trust Score Distribution</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="trust-donut-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={trustDistData}
                    cx="50%"
                    cy="50%"
                    innerRadius={26}
                    outerRadius={39}
                    paddingAngle={singleSegment ? 0 : 2}
                    dataKey="value"
                  >
                    {trustDistData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} opacity={0.9} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                    formatter={(value, name) => [value as number, String(name)]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {trustDistData.map(d => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#8b949e' }}>{d.name}</span>
                  <span style={{ fontSize: 16, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text)' }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="trust-divider" />

          <div>
            <div className="avg-uptime-label">Avg uptime (24h)</div>
            <div className="avg-uptime-value" style={{ color: avgUptime24h != null ? uptimeColor(avgUptime24h) : 'var(--text3)' }}>
              {avgUptime24h != null ? `${avgUptime24h}%` : '—'}
            </div>
            <div className="avg-uptime-sub">across {uptimeMintCount} mints</div>
          </div>
        </div>

        {/* Right — Top 5 with toggle */}
        <div className="stats-panel">
          <div className="top5-header">
            <div className="stats-panel-title" style={{ marginBottom: 0 }}>TOP 5</div>
            <div className="top5-toggle">
              <button
                type="button"
                className={`top5-toggle-btn${top5Tab === 'trust' ? ' active' : ''}`}
                onClick={() => setTop5Tab('trust')}
              >Trust Score</button>
              <button
                type="button"
                className={`top5-toggle-btn${top5Tab === 'uptime' ? ' active' : ''}`}
                onClick={() => setTop5Tab('uptime')}
              >Uptime</button>
            </div>
          </div>

          {top5Tab === 'trust' ? (
            data.top5ByTrustScore.length === 0 ? (
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
                      <MintFavicon url={mint.url} iconUrl={mintIconByUrl[mint.url] ?? null} size={24} />
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
            )
          ) : (
            top5ByUptime.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: '8px 0' }}>No uptime data yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {top5ByUptime.map((mint, idx) => {
                  const uptime = mint.uptimePct24h ?? 0
                  const color = uptimeColor(uptime)
                  const hostname = getHostname(mint.url)
                  return (
                    <div
                      key={mint.url}
                      onClick={() => navigate(`/mint/${encodeURIComponent(mint.url)}`)}
                      className="stats-top5-row"
                    >
                      <span className="stats-top5-rank">#{idx + 1}</span>
                      <MintFavicon url={mint.url} iconUrl={mint.iconUrl} size={24} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mint.name ?? hostname}</div>
                        <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hostname}</div>
                      </div>
                      <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 700, color, flexShrink: 0 }}>{uptime}%</span>
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>
      </div>

      {/* ── Distribution row ── */}
      <div className="stats-dist-row">
        <div className="stats-panel">
          <div className="stats-panel-title">Software Distribution</div>
          {softwareDist.length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>No data</div>
          ) : softwareDist.map(({ name, count, pct }) => (
            <div key={name} className="dist-row">
              <span className="dist-label">{name}</span>
              <div className="dist-track">
                <div className="dist-fill" style={{ width: `${pct}%`, background: '#17E87F' }} />
              </div>
              <span className="dist-count">{count}</span>
            </div>
          ))}
        </div>

        <div className="stats-panel">
          <div className="stats-panel-title">Geographic Distribution</div>
          {geoDist.length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>No data</div>
          ) : geoDist.map(({ loc, count, pct }) => {
            const { display, flag } = geoLabel(loc)
            return (
              <div key={loc} className="dist-row">
                <span className="dist-label">{flag ? `${flag} ${display}` : display}</span>
                <div className="dist-track">
                  <div className="dist-fill" style={{ width: `${pct}%`, background: '#60a5fa' }} />
                </div>
                <span className="dist-count">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="stats-section-divider" />

      {/* ── NUT Explorer ── */}
      <div className="stats-nut-section">
        <div className="stats-section-label">NUT Explorer</div>
        <div className="stats-section-sublabel">Protocol adoption across {data.onlineMints} online mints · click +N more to see all supporting mints</div>
        <div className="stats-nut-grid">
          {NUT_ORDER.map(nut => {
            const adoption = nutAdoptionMap[nut] ?? { count: 0, percent: 0 }
            const { count, percent } = adoption
            const meta = NUT_META[nut]
            if (!meta) return null
            const barColor = percent >= 80 ? '#17E87F' : percent >= 40 ? '#f59e0b' : '#E24B4A'
            const specUrl = `https://github.com/cashubtc/nuts/blob/main/${meta.specNum}.md`
            return (
              <div key={nut} className="stats-nut-card">
                <div className="snc-head">
                  <span className="snc-nut-tag">{nut}</span>
                  <a
                    href={specUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="snc-spec-link"
                    onClick={e => e.stopPropagation()}
                  >spec ↗</a>
                </div>
                <div className="snc-name">{meta.short}</div>
                <div className="snc-desc">{meta.desc}</div>
                <div className="snc-bar-track">
                  <div
                    className="snc-bar-fill"
                    style={{
                      width: `${percent}%`,
                      background: barColor,
                      ...(percent >= 40 ? { boxShadow: `0 0 6px ${barColor}66` } : {}),
                    }}
                  />
                </div>
                <div className="snc-footer">
                  <span className="snc-pct" style={{ color: barColor }}>{percent}%</span>
                  <span className="snc-count">{count} mint{count !== 1 ? 's' : ''}</span>
                  {count > 0 && (
                    <button
                      type="button"
                      className="snc-more-btn"
                      onClick={() => setModalNut(nut)}
                    >+{count} more</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {modalNut !== null && modalNutMeta !== null && modalNutMeta !== undefined && (
        <NutMintsModal
          nutId={modalNut}
          nutMeta={modalNutMeta}
          mints={modalNutMints}
          onClose={() => setModalNut(null)}
        />
      )}
    </div>
  )
}
