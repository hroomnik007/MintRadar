import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
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

const CITY_SHORT: Record<string, string> = {
  'Frankfurt am Main': 'Frankfurt',
  'Saint Petersburg': 'St. Petersburg',
}

function shortenCity(city: string): string {
  return CITY_SHORT[city] ?? (city.length > 12 ? city.slice(0, 11) + '…' : city)
}

function geoLabel(loc: string): { display: string; flag: string; color?: string } {
  if (loc === 'Cloudflare CDN') return { display: 'Cloudflare CDN', flag: '🌐', color: '#f59e0b' }
  if (loc === 'Unknown') return { display: 'Unknown', flag: '' }
  const commaIdx = loc.lastIndexOf(', ')
  if (commaIdx === -1) return { display: shortenCity(loc), flag: '' }
  const cc = loc.slice(commaIdx + 2)
  const city = loc.slice(0, commaIdx)
  return { display: shortenCity(city), flag: cc.length === 2 ? countryFlag(cc) : '' }
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

function mintAgeBadge(discoveredAt: string | null | undefined): { label: string; color: string; bg: string; border: string } | null {
  if (!discoveredAt) return null
  const months = (Date.now() - new Date(discoveredAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  if (months < 1) return { label: 'Fresh', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.25)' }
  if (months < 6) return { label: 'Established', color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.25)' }
  if (months < 12) return { label: 'Veteran', color: '#ffa500', bg: 'rgba(255,165,0,0.1)', border: 'rgba(255,165,0,0.25)' }
  return { label: 'OG', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' }
}

function CityMintsModal({ loc, mints, onClose }: {
  loc: string
  mints: KnownMint[]
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const sorted = useMemo(() =>
    [...mints].sort((a, b) => (b.trustScore ?? 0) - (a.trustScore ?? 0))
  , [mints])

  const { display, flag } = geoLabel(loc)
  const displayed = showAll ? sorted : sorted.slice(0, 10)
  const onlineCount = mints.filter(m => m.online === true).length
  const offlineCount = mints.filter(m => m.online === false).length

  return (
    <div className="nut-modal-overlay" onClick={onClose}>
      <div className="nut-modal" onClick={e => e.stopPropagation()}>
        <button type="button" className="nut-modal-close" onClick={onClose}>✕</button>
        <div className="nut-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {flag && <span style={{ fontSize: 20 }}>{flag}</span>}
            <span className="nut-modal-title">{display}</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text3)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 7px' }}>{mints.length} mints</span>
          </div>
        </div>
        <div className="nut-modal-list">
          {displayed.map(m => {
            const score = m.trustScore ?? null
            const scoreColor = score != null ? (score >= 70 ? '#4ade80' : score >= 40 ? '#ffa500' : '#ff4d4d') : 'var(--text3)'
            const badge = mintAgeBadge(m.discoveredAt ?? null)
            return (
              <div
                key={m.url}
                className="nut-modal-row"
                style={{ cursor: 'pointer' }}
                onClick={() => { onClose(); navigate(`/mint/${encodeURIComponent(m.url)}`) }}
              >
                <span
                  style={{ width: 8, height: 8, borderRadius: '50%', background: m.online === true ? '#17E87F' : '#E24B4A', display: 'inline-block', flexShrink: 0 }}
                />
                <div className="nut-modal-row-info" style={{ flex: 1 }}>
                  <span className="nut-modal-row-name" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{m.name ?? getHostname(m.url)}</span>
                  {badge && (
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: badge.color, background: badge.bg, border: `1px solid ${badge.border}`, borderRadius: 4, padding: '1px 5px', marginLeft: 6 }}>{badge.label}</span>
                  )}
                </div>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: scoreColor, flexShrink: 0 }}>
                  {score != null ? `${score}%` : '—'}
                </span>
              </div>
            )
          })}
          {!showAll && sorted.length > 10 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              style={{ width: '100%', background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer', padding: '8px 0' }}
            >
              Show all {sorted.length} mints
            </button>
          )}
          {sorted.length === 0 && <div className="nut-modal-empty">No mints</div>}
        </div>
        <div className="nut-modal-footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{onlineCount} online · {offlineCount} offline</span>
          <span>Sorted by Trust Score</span>
        </div>
      </div>
    </div>
  )
}

export default function Stats() {
  const navigate = useNavigate()
  const [modalNut, setModalNut] = useState<string | null>(null)
  const [cityModal, setCityModal] = useState<string | null>(null)
  const [reliableTab, setReliableTab] = useState<'reliable' | 'trust'>('reliable')
  const [softGeoTab, setSoftGeoTab] = useState<'software' | 'geographic'>('software')

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

  const avgUptime24h = useMemo(() => {
    if (!knownMintsData || knownMintsData.length === 0) return null
    const total = knownMintsData.length
    const sum = knownMintsData.reduce((acc, m) => acc + (m.uptimePct24h ?? 0), 0)
    return Math.round(sum / total)
  }, [knownMintsData])

  const top5ByUptime = useMemo(() => {
    if (!knownMintsData) return []
    return [...knownMintsData]
      .filter(m => m.online === true && m.uptimePct24h != null)
      .sort((a, b) => (b.uptimePct24h ?? 0) - (a.uptimePct24h ?? 0))
      .slice(0, 6)
  }, [knownMintsData])

  const top5ByLatency = useMemo(() => {
    if (!knownMintsData) return []
    return [...knownMintsData]
      .filter(m => m.online === true && m.latencyMs != null)
      .sort((a, b) => (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity))
      .slice(0, 6)
  }, [knownMintsData])

  const top5ByTrust = useMemo(() => {
    if (!knownMintsData) return []
    return [...knownMintsData]
      .filter(m => m.online === true && m.trustScore != null)
      .sort((a, b) => (b.trustScore ?? 0) - (a.trustScore ?? 0))
      .slice(0, 6)
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

  const cityMints = useMemo(() => {
    if (!cityModal || !knownMintsData) return []
    return knownMintsData.filter(m => m.serverLocation === cityModal)
  }, [cityModal, knownMintsData])

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

  const NUT_ORDER = ['NUT-04','NUT-05','NUT-07','NUT-08','NUT-09','NUT-10','NUT-11','NUT-12','NUT-14','NUT-15','NUT-17','NUT-19','NUT-20','NUT-29']
  const nutAdoptionMap = Object.fromEntries(data.nutAdoption.map(n => [n.nut, n]))

  const modalNutMints = modalNut ? (nutSupportingMints[modalNut] ?? []) : []
  const modalNutMeta = modalNut ? NUT_META[modalNut] : null

  return (
    <div className="stats-page">
      {/* ── 5 flat stat boxes ── */}
      <div className="stats-metrics">
        <div className="stats-metric-card">
          <div className="smc-icon smc-gray">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.1"/></svg>
          </div>
          <div>
            <div className="smc-label">Mints Tracked</div>
            <div className="smc-value">{data.totalMints}</div>
          </div>
        </div>
        <div className="stats-metric-card">
          <div className="smc-icon smc-green">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 11C3 8 5 7 8 7s5 1 7-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M3 14C5 11.5 6.5 10 8 10s3 1.5 5-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><circle cx="8" cy="4" r="2" stroke="currentColor" strokeWidth="1.2"/></svg>
          </div>
          <div>
            <div className="smc-label">Online Now</div>
            <div className="smc-value">{data.onlineMints}</div>
          </div>
        </div>
        <div className="stats-metric-card">
          <div className="smc-icon smc-orange">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v5l3 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="8" cy="9" r="6" stroke="currentColor" strokeWidth="1.2"/><path d="M6 1.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
          </div>
          <div>
            <div className="smc-label">Network Uptime</div>
            <div className="smc-value" style={{color: avgUptime24h != null ? uptimeColor(avgUptime24h) : undefined}}>
              {avgUptime24h != null ? `${avgUptime24h}%` : '—'}
            </div>
          </div>
        </div>
        <div className="stats-metric-card">
          <div className="smc-icon smc-orange">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.1"/><path d="M8 6v3.5l2 1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 1h5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
          </div>
          <div>
            <div className="smc-label">Median Latency</div>
            <div className="smc-value">{data.avgLatency24h != null ? `${data.avgLatency24h} ms` : '—'}</div>
          </div>
        </div>
        <div className="stats-metric-card">
          <div className="smc-icon smc-green">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="10" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.1"/><rect x="2" y="6" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.1"/><rect x="2" y="2" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.1"/></svg>
          </div>
          <div>
            <div className="smc-label">NUTs in Spec</div>
            <div className="smc-value">{NUT_ORDER.length}</div>
          </div>
        </div>
      </div>

      {/* ── 2-column card grid ── */}
      <div className="stats-cards-grid">
        {/* Card 1: Software / Geographic */}
        <div className="stats-panel">
          <div className="stats-card-header">
            <div className="stats-panel-title" style={{marginBottom:0}}>
              {softGeoTab === 'software' ? 'Software in Use' : 'Geographic Distribution'}
            </div>
            <div className="stats-tab-toggle">
              <button type="button" className={`stats-tab-btn${softGeoTab === 'software' ? ' active' : ''}`} onClick={() => setSoftGeoTab('software')}>Software</button>
              <button type="button" className={`stats-tab-btn${softGeoTab === 'geographic' ? ' active' : ''}`} onClick={() => setSoftGeoTab('geographic')}>Geographic</button>
            </div>
          </div>
          <div style={{marginTop:10}}>
            {softGeoTab === 'software' ? (
              softwareDist.length === 0 ? (
                <div style={{color:'var(--text3)',fontSize:12,fontFamily:'var(--font-mono)'}}>No data</div>
              ) : softwareDist.map(({name, count, pct}) => (
                <div key={name} className="dist-row">
                  <span className="dist-label">{name}</span>
                  <div className="dist-track"><div className="dist-fill" style={{width:`${pct}%`,background:'#17E87F'}} /></div>
                  <span className="dist-count">{count}</span>
                </div>
              ))
            ) : (
              geoDist.length === 0 ? (
                <div style={{color:'var(--text3)',fontSize:12,fontFamily:'var(--font-mono)'}}>No data</div>
              ) : geoDist.map(({loc, count, pct}) => {
                const {display, flag, color: geoColor} = geoLabel(loc)
                const barColor = geoColor ?? '#60a5fa'
                return (
                  <div key={loc} className="dist-row dist-row-clickable" onClick={() => setCityModal(loc)}>
                    <span className="dist-label dist-label-city" style={geoColor ? {color:geoColor} : undefined}>
                      {flag ? `${flag} ${display}` : display}
                    </span>
                    <div className="dist-track"><div className="dist-fill" style={{width:`${pct}%`,background:barColor}} /></div>
                    <span className="dist-count">{count}</span>
                  </div>
                )
              })
            )}
          </div>
          {softGeoTab === 'software' && softwareDist.length > 0 && (
            <div style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--font-mono)',marginTop:10,lineHeight:1.5}}>
              Implementation reported by each mint's info document.
            </div>
          )}
        </div>

        {/* Card 2: Most Reliable / Fastest */}
        <div className="stats-panel">
          <div className="stats-card-header">
            <div className="stats-panel-title" style={{marginBottom:0}}>
              {reliableTab === 'reliable' ? 'Most Reliable · 24H' : 'Top Trust Score'}
            </div>
            <div className="stats-tab-toggle">
              <button type="button" className={`stats-tab-btn${reliableTab === 'reliable' ? ' active' : ''}`} onClick={() => setReliableTab('reliable')}>Most Reliable</button>
              <button type="button" className={`stats-tab-btn${reliableTab === 'trust' ? ' active' : ''}`} onClick={() => setReliableTab('trust')}>Trust Score</button>
            </div>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:5,marginTop:10}}>
            {reliableTab === 'reliable' ? (
              top5ByUptime.length === 0 ? (
                <div style={{color:'var(--text3)',fontSize:12,fontFamily:'var(--font-mono)'}}>No data yet</div>
              ) : top5ByUptime.map((mint, idx) => {
                const uptime = mint.uptimePct24h ?? 0
                const color = uptimeColor(uptime)
                const hostname = getHostname(mint.url)
                return (
                  <div key={mint.url} onClick={() => navigate(`/mint/${encodeURIComponent(mint.url)}`)} className="stats-top5-row">
                    <span className="stats-top5-rank">#{idx+1}</span>
                    <MintFavicon url={mint.url} iconUrl={mint.iconUrl} size={22} />
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:500,color:'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{mint.name ?? hostname}</div>
                      <div style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--font-mono)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{hostname}</div>
                    </div>
                    <span style={{fontSize:12,fontFamily:'var(--font-mono)',fontWeight:700,color,flexShrink:0}}>{uptime}%</span>
                  </div>
                )
              })
            ) : (
              top5ByTrust.length === 0 ? (
                <div style={{color:'var(--text3)',fontSize:12,fontFamily:'var(--font-mono)'}}>No data yet</div>
              ) : top5ByTrust.map((mint, idx) => {
                const score = mint.trustScore ?? 0
                const color = score >= 70 ? '#4ade80' : score >= 40 ? '#ffa500' : '#ff4d4d'
                const hostname = getHostname(mint.url)
                return (
                  <div key={mint.url} onClick={() => navigate(`/mint/${encodeURIComponent(mint.url)}`)} className="stats-top5-row">
                    <span className="stats-top5-rank">#{idx+1}</span>
                    <MintFavicon url={mint.url} iconUrl={mint.iconUrl} size={22} />
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:500,color:'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{mint.name ?? hostname}</div>
                      <div style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--font-mono)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{hostname}</div>
                    </div>
                    <span style={{fontSize:12,fontFamily:'var(--font-mono)',fontWeight:700,color,flexShrink:0}}>{score}%</span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      <div className="stats-section-divider" />

      {/* ── NUT Coverage ── */}
      <div className="stats-nut-section">
        <div className="stats-section-label">NUT Coverage Across the Network</div>
        <div className="stats-section-sublabel">Protocol adoption across {data.onlineMints} online mints · click any NUT to see supporting mints</div>
        <div className="stats-nut-rows-grid">
          {NUT_ORDER.map(nut => {
            const adoption = nutAdoptionMap[nut] ?? { count: 0, percent: 0 }
            const { count, percent } = adoption
            const meta = NUT_META[nut]
            if (!meta) return null
            const barColor = percent >= 80 ? '#17E87F' : percent >= 40 ? '#f59e0b' : '#E24B4A'
            return (
              <div key={nut} className="stats-nut-row" onClick={() => setModalNut(nut)}>
                <span className="snr-nut-tag">{nut}</span>
                <span className="snr-nut-name">{meta.short}</span>
                <div className="snr-bar-track">
                  <div className="snr-bar-fill" style={{width:`${percent}%`,background:barColor}} />
                </div>
                <span className="snr-nut-count" style={{color:barColor}}>{count}/{data.onlineMints}</span>
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
      {cityModal !== null && (
        <CityMintsModal
          loc={cityModal}
          mints={cityMints}
          onClose={() => setCityModal(null)}
        />
      )}
    </div>
  )
}
