import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { nip19 } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { sharedPool } from '@/core/nostr/pool'
import { useNostrDiscovery } from '@/hooks/useNostrDiscovery'
import { useWatchlistNotifications } from '@/hooks/useWatchlistNotifications'
import { useUserRelays } from '@/hooks/useUserRelays'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { useNostrMints } from '@/hooks/useNostrMints'
import { useKnownMints, type KnownMint } from '@/hooks/useKnownMints'

import { useWatchlistStore } from '@/stores/watchlist.store'
import { useAuthStore } from '@/stores/auth.store'
import { useUIStore } from '@/stores/ui.store'
import type { MintStatus } from '@core/mint/api'
import { ComparisonModal } from '@/components/ComparisonModal'
import './Dashboard.css'

// ── SVG Icons ──────────────────────────────────────────────────

const IcSignal = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.8" stroke="currentColor" strokeWidth="1.1"/>
    <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" opacity="0.6"/>
    <circle cx="8" cy="8" r="1.2" fill="currentColor"/>
  </svg>
)

const IcGrid = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="2" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.1"/>
    <rect x="8.5" y="2" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.1"/>
    <rect x="2" y="8.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.1"/>
    <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.1"/>
  </svg>
)
const IcSuccess = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.8" stroke="currentColor" strokeWidth="1.1"/>
    <polyline points="5,8 7,10 11,6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IcSearch = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <circle cx="5.8" cy="5.8" r="4.3" stroke="currentColor" strokeWidth="1.3"/>
    <line x1="9.2" y1="9.2" x2="12.5" y2="12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)
const IcPlus = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
    <line x1="6" y1="1.5" x2="6" y2="10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="1.5" y1="6" x2="10.5" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IcRefresh = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M2 7a5 5 0 1 1 1.4 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <polyline points="2,4.5 2,7 4.5,7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IcEye = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
    <path d="M1 7s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.3"/>
    <circle cx="7" cy="7" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
)

const IcTimer = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="9.5" r="5" stroke="currentColor" strokeWidth="1.1"/>
    <path d="M8 7v2.5l1.5 1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M6 1.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
  </svg>
)
const IcFilter = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <line x1="1.5" y1="3" x2="11.5" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <line x1="3" y1="6.5" x2="10" y2="6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <line x1="4.5" y1="10" x2="8.5" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)
const IcClose = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)
const IcList = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <line x1="5" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    <line x1="5" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    <line x1="5" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    <circle cx="2.5" cy="4" r="1" fill="currentColor"/>
    <circle cx="2.5" cy="8" r="1" fill="currentColor"/>
    <circle cx="2.5" cy="12" r="1" fill="currentColor"/>
  </svg>
)

// ── Helpers ────────────────────────────────────────────────────

function mintAgeBadge(discoveredAt: string | null | undefined): { label: string; color: string; bg: string; border: string } | null {
  if (!discoveredAt) return null
  const months = (Date.now() - new Date(discoveredAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  if (months < 1) return { label: 'Fresh', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.25)' }
  if (months < 6) return { label: 'Established', color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.25)' }
  if (months < 12) return { label: 'Veteran', color: '#ffa500', bg: 'rgba(255,165,0,0.1)', border: 'rgba(255,165,0,0.25)' }
  return { label: 'OG', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' }
}

function latencyColor(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return 'var(--t3)'
  if (ms < 500) return 'var(--fast)'
  if (ms < 2000) return 'var(--med)'
  return 'var(--slow)'
}

function uptimeColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'var(--t3)'
  if (pct >= 95) return 'var(--fast)'
  if (pct >= 80) return 'var(--med)'
  return 'var(--slow)'
}

function listTrustScore(mint: KnownMint): number {
  if (mint.online !== true) return 0
  return mint.trustScore ?? 0
}

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

function formatTimeAgo(date: Date | null): string {
  if (!date) return '—'
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}


const NOSTR_LOOKUP_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
]
const DEFAULT_SORT_DIRS: Record<'name' | 'latency' | 'status' | 'trust', 'asc' | 'desc'> = { status: 'desc', latency: 'asc', trust: 'desc', name: 'asc' }

const NUT_FILTER_KEYS = ['4','5','7','8','9','10','11','12','14','15','17','19','20','29']
const AGE_LABELS = ['Fresh', 'Established', 'Veteran', 'OG']

interface FilterState {
  status: 'all' | 'online' | 'offline'
  minTrustScore: number
  mintAges: string[]
  requiredNuts: string[]
}
const DEFAULT_FILTERS: FilterState = { status: 'all', minTrustScore: 0, mintAges: [], requiredNuts: [] }

function applyFilters(mints: KnownMint[], filters: FilterState): KnownMint[] {
  return mints.filter(mint => {
    if (filters.status === 'online' && mint.online !== true) return false
    if (filters.status === 'offline' && mint.online !== false) return false
    if (listTrustScore(mint) < filters.minTrustScore) return false
    if (filters.mintAges.length > 0) {
      const badge = mintAgeBadge(mint.discoveredAt)
      if (!badge || !filters.mintAges.includes(badge.label)) return false
    }
    if (filters.requiredNuts.length > 0) {
      const nuts = mint.nutsLimits as Record<string, unknown> | null
      if (!nuts) return false
      if (!filters.requiredNuts.every(nut => nuts[nut] != null)) return false
    }
    return true
  })
}

function countActiveFilters(f: FilterState): number {
  return [f.status !== 'all' ? 1 : 0, f.minTrustScore > 0 ? 1 : 0, f.mintAges.length > 0 ? 1 : 0, f.requiredNuts.length > 0 ? 1 : 0].reduce((a, b) => a + b, 0)
}

// ── Skeleton Card ─────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="sk-row">
        <div className="sk-avatar" />
        <div className="sk-lines">
          <div className="sk-line" style={{ width: '58%' }} />
          <div className="sk-line" style={{ width: '38%', marginTop: 6 }} />
        </div>
        <div className="sk-dot" />
      </div>
      <div className="sk-pills">
        <div className="sk-pill" style={{ width: 48 }} />
        <div className="sk-pill" style={{ width: 54 }} />
        <div className="sk-pill" style={{ width: 42 }} />
      </div>
      <div className="sk-bottom">
        <div className="sk-latency" />
        <div className="sk-btn" />
      </div>
    </div>
  )
}

// ── Mint Card ──────────────────────────────────────────────────

function MintCardDisplay({
  mint,
  isDegraded = false,
  onCompare,
}: {
  mint: KnownMint
  isDegraded?: boolean
  onCompare?: (url: string) => void
}) {
  const navigate = useNavigate()
  const mints = useWatchlistStore(state => state.mints)
  const addMint = useWatchlistStore(state => state.addMint)
  const removeMint = useWatchlistStore(state => state.removeMint)
  const isWatched = mints.includes(mint.url)
  const profile = useAuthStore(state => state.profile)
  const isLoggedIn = profile !== null
  const hostname = getHostname(mint.url)
  const isOnline = mint.online === true
  const displayName = mint.name ?? hostname
  const uptimePct24h = mint.uptimePct24h ?? null
  const ageBadge = mintAgeBadge(mint.discoveredAt ?? null)

  const cardStyle: React.CSSProperties =
    mint.online === true
      ? { background: 'linear-gradient(135deg, rgba(23, 232, 127, 0.28) 0%, rgba(13, 17, 23, 1) 55%)', border: '1px solid rgba(23, 232, 127, 0.45)', boxShadow: '0 0 0 1px rgba(23, 232, 127, 0.15), 0 0 12px rgba(23, 232, 127, 0.08)' }
      : { background: 'linear-gradient(135deg, rgba(226, 75, 74, 0.28) 0%, rgba(13, 17, 23, 1) 55%)', border: '1px solid rgba(226, 75, 74, 0.45)', boxShadow: '0 0 0 1px rgba(226, 75, 74, 0.15), 0 0 12px rgba(226, 75, 74, 0.08)' }

  return (
    <div
      className="mint-card"
      style={cardStyle}
      onClick={() => { navigate(`/mint/${encodeURIComponent(mint.url)}`) }}
    >
      <div className="card-top">
        <div className="card-name-row">
          <MintFavicon url={mint.url} iconUrl={mint.iconUrl ?? null} size={32} radius={7} />
          <div style={{ minWidth: 0 }}>
            <div className="card-name">{displayName}</div>
            <div className="card-host">{hostname}</div>
          </div>
          {ageBadge && (
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: ageBadge.color, background: ageBadge.bg, border: `1px solid ${ageBadge.border}`, borderRadius: 5, padding: '2px 7px', flexShrink: 0, marginLeft: 'auto', marginRight: 12 }}>
              {ageBadge.label}
            </span>
          )}
        </div>
        <div
          className={`status-dot${isOnline ? ' online' : ''}`}
          style={{ background: mint.online === true ? '#17E87F' : '#E24B4A' }}
        />
      </div>

      <div className="card-pills">
        {mint.version && (
          <span className="card-pill">{mint.version}</span>
        )}
        {mint.nutCount !== null && mint.nutCount !== undefined && (
          <span className="card-pill">{mint.nutCount} NUTs</span>
        )}
        {uptimePct24h !== null && (
          <span className="card-pill" style={{ color: uptimeColor(uptimePct24h) }}>
            {uptimePct24h}% up
          </span>
        )}
        {mint.online === true && mint.trustScore != null && (
          <span className="card-pill" style={{ color: mint.trustScore >= 70 ? '#4ade80' : mint.trustScore >= 40 ? '#ffa500' : '#ff4d4d', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 15, lineHeight: 1 }}>★</span><span>{mint.trustScore}%</span>
          </span>
        )}
      </div>

      <div className="card-bottom">
        <div className="latency-block">
          <div className="latency-label">LATENCY</div>
          {isOnline && mint.latencyMs !== null ? (
            <div className="latency-value" style={{ color: '#e6edf3' }}>
              {mint.latencyMs}<span className="latency-unit">ms</span>
            </div>
          ) : (
            <div className="latency-value muted">—</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {onCompare && isOnline && (
            <button
              type="button"
              style={{
                background: 'transparent',
                color: '#378ADD',
                border: '1px solid #378ADD',
                borderRadius: 7,
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                flexShrink: 0,
                transition: 'opacity 150ms ease',
              }}
              onClick={e => { e.stopPropagation(); onCompare(mint.url) }}
            >
              ⇄ Compare
            </button>
          )}
          {isLoggedIn && (
            <button
              type="button"
              className={`watch-btn${isWatched ? ' watching' : ''}`}
              onClick={e => { e.stopPropagation(); void (isWatched ? removeMint(mint.url) : addMint(mint.url)) }}
            >
              {isWatched ? <><IcClose /><span>Unwatch</span></> : <><IcPlus /><span>Watch</span></>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function trustColor(score: number): string {
  if (score >= 70) return '#4ade80'
  if (score >= 40) return '#ffa500'
  return '#ff4d4d'
}

function MintListView({
  mints,
  search,
  sortBy,
  sortDir,
  totalAll,
}: {
  mints: KnownMint[]
  search: string
  sortBy: 'name' | 'latency' | 'status' | 'trust'
  sortDir: 'asc' | 'desc'
  totalAll?: number
}) {
  const navigate = useNavigate()
  const sortedFiltered = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = mints.filter(mint => {
      if (!q) return true
      const name = (mint.name ?? getHostname(mint.url)).toLowerCase()
      return getHostname(mint.url).toLowerCase().includes(q) || name.includes(q)
    })
    return [...filtered].sort((a, b) => {
      let result = 0
      if (sortBy === 'status') {
        result = (b.online === true ? 1 : 0) - (a.online === true ? 1 : 0)
      } else if (sortBy === 'latency') {
        const la = a.online === true && a.latencyMs != null ? a.latencyMs : Infinity
        const lb = b.online === true && b.latencyMs != null ? b.latencyMs : Infinity
        result = la - lb
      } else if (sortBy === 'trust') {
        result = listTrustScore(b) - listTrustScore(a)
      } else {
        result = (a.name ?? getHostname(a.url)).localeCompare(b.name ?? getHostname(b.url))
      }
      return sortDir === DEFAULT_SORT_DIRS[sortBy] ? result : -result
    })
  }, [mints, search, sortBy, sortDir])

  return (
    <>
      <div className="mint-list-table-wrap">
        <table className="mint-list-table">
          <thead>
            <tr>
              <th>Mint</th>
              <th>Status</th>
              <th>Uptime 24h</th>
              <th className="col-hide-mobile">Latency</th>
              <th>Trust</th>
              <th className="col-hide-mobile">NUTs</th>
              <th className="col-hide-mobile">Age</th>
            </tr>
          </thead>
          <tbody>
            {sortedFiltered.map(mint => {
              const isOnline = mint.online === true
              const displayName = mint.name ?? getHostname(mint.url)
              const ageBadge = mintAgeBadge(mint.discoveredAt ?? null)
              const score = mint.trustScore ?? null
              return (
                <tr key={mint.url} className="mint-list-row" onClick={() => navigate(`/mint/${encodeURIComponent(mint.url)}`)}>
                  <td className="mint-list-td-name">
                    <MintFavicon url={mint.url} iconUrl={mint.iconUrl ?? null} size={24} radius={5} />
                    <span className="mint-list-name">{displayName}</span>
                  </td>
                  <td>
                    <span style={{ fontSize: 10, color: isOnline ? '#17E87F' : '#E24B4A' }}>
                      ●<span className="status-text-mobile-hide">{isOnline ? ' Online' : ' Offline'}</span>
                    </span>
                  </td>
                  <td style={{ color: uptimeColor(mint.uptimePct24h), fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {mint.uptimePct24h != null ? `${mint.uptimePct24h}%` : '—'}
                  </td>
                  <td className="col-hide-mobile" style={{ color: latencyColor(mint.latencyMs), fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {isOnline && mint.latencyMs != null ? `${mint.latencyMs}ms` : '—'}
                  </td>
                  <td className="trust-col" style={{ color: score != null ? trustColor(score) : 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600 }}>
                    {score != null ? `${score}%` : '—'}
                  </td>
                  <td className="col-hide-mobile" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text2)' }}>
                    {mint.nutCount != null ? `${mint.nutCount}/14` : '—'}
                  </td>
                  <td className="col-hide-mobile">
                    {ageBadge && (
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: ageBadge.color, background: ageBadge.bg, border: `1px solid ${ageBadge.border}`, borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap' }}>
                        {ageBadge.label}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', marginTop: 16, fontFamily: 'var(--font-mono)' }}>
        Showing {sortedFiltered.length} of {totalAll || sortedFiltered.length}
      </div>
    </>
  )
}

function MintGrid({
  mints,
  search,
  sortBy,
  sortDir,
  onCompare,
  totalAll,
}: {
  mints: KnownMint[]
  search: string
  sortBy: 'name' | 'latency' | 'status' | 'trust'
  sortDir: 'asc' | 'desc'
  onCompare?: (url: string) => void
  totalAll?: number
}) {
  const sortedFiltered = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = mints.filter(mint => {
      if (!q) return true
      const name = (mint.name ?? getHostname(mint.url)).toLowerCase()
      return getHostname(mint.url).toLowerCase().includes(q) || name.includes(q)
    })

    return [...filtered].sort((a, b) => {
      let result = 0
      if (sortBy === 'status') {
        result = (b.online === true ? 1 : 0) - (a.online === true ? 1 : 0)
      } else if (sortBy === 'latency') {
        const la = a.online === true && a.latencyMs != null ? a.latencyMs : Infinity
        const lb = b.online === true && b.latencyMs != null ? b.latencyMs : Infinity
        result = la - lb
      } else if (sortBy === 'trust') {
        result = listTrustScore(b) - listTrustScore(a)
      } else {
        result = (a.name ?? getHostname(a.url)).localeCompare(b.name ?? getHostname(b.url))
      }
      return sortDir === DEFAULT_SORT_DIRS[sortBy] ? result : -result
    })
  }, [mints, search, sortBy, sortDir])

  return (
    <>
      <div className="mint-grid">
        {sortedFiltered.map(mint => (
          <MintCardDisplay
            key={mint.url}
            mint={mint}
            isDegraded={mint.degraded}
            {...(onCompare ? { onCompare } : {})}
          />
        ))}
      </div>
      <div style={{fontSize:13,color:'var(--text3)',textAlign:'center',marginTop:16,fontFamily:'var(--font-mono)'}}>
        Showing {sortedFiltered.length} of {totalAll || sortedFiltered.length}
      </div>
    </>
  )
}

// ── Dashboard ──────────────────────────────────────────────────

export default function Dashboard() {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'latency' | 'status' | 'trust'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [viewMode, setViewMode] = useState<'cards' | 'list'>(() => {
    const saved = localStorage.getItem('mintRadar_viewMode')
    return saved === 'list' ? 'list' : 'cards'
  })

  // Filter state
  const [showFilters, setShowFilters] = useState(false)
  const [pendingFilters, setPendingFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [activeFilters, setActiveFilters] = useState<FilterState>(DEFAULT_FILTERS)

  // Comparison state
  const [compareBaseUrl, setCompareBaseUrl] = useState<string | null>(null)
  const [showComparePicker, setShowComparePicker] = useState(false)
  const [showComparisonModal, setShowComparisonModal] = useState(false)
  const [comparePickerSelected, setComparePickerSelected] = useState<Set<string>>(new Set())
  const [comparePickerSearch, setComparePickerSearch] = useState('')

  function openComparePicker(url: string) {
    setCompareBaseUrl(url)
    setComparePickerSelected(new Set())
    setComparePickerSearch('')
    setShowComparePicker(true)
  }

  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null)
  const [, setTick] = useState(0)
  const [showDegraded, setShowDegraded] = useState(false)
  const [showSubmit, setShowSubmit] = useState(false)
  const [submitTab, setSubmitTab] = useState<'single' | 'bulk'>('single')
  const [submitInput, setSubmitInput] = useState('')
  const [submitUrl, setSubmitUrl] = useState('')
  const [submitState, setSubmitState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [submitMsg, setSubmitMsg] = useState('')
  const [probeState, setProbeState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [probeResult, setProbeResult] = useState<{ name: string | null; version: string | null; nutCount: number; latencyMs: number | null } | null>(null)
  const [nostrLookupState, setNostrLookupState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [searchFocused, setSearchFocused] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [nostrLookupMsg, setNostrLookupMsg] = useState('')

  // Bulk submit state
  const [bulkInput, setBulkInput] = useState('')
  const [bulkProgress, setBulkProgress] = useState<Array<{ url: string; status: 'pending' | 'probing' | 'added' | 'failed'; error?: string }>>([])
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkDone, setBulkDone] = useState(false)

  const queryClient = useQueryClient()
  useNostrDiscovery()
  const { mints: nostrMints } = useNostrMints()
  const { data: knownMintsData, isLoading: knownLoading, error: knownError } = useKnownMints()

  const statusRecord = useMemo(() => {
    if (!knownMintsData) return {}
    return Object.fromEntries(
      knownMintsData
        .filter(m => m.online != null)
        .map(m => [m.url, { online: m.online as boolean, latencyMs: m.latencyMs ?? null }])
    )
  }, [knownMintsData])

  const trustScoreRecord = useMemo(() => {
    if (!knownMintsData) return {}
    return Object.fromEntries(knownMintsData.map(m => [m.url, m.trustScore ?? null]))
  }, [knownMintsData])

  const { read: userReadRelays } = useUserRelays()
  useWatchlistNotifications(statusRecord, trustScoreRecord, userReadRelays)

  const { degradedCount, allMints, totalAllCount } = useMemo(() => {
    const degradedUrls = knownMintsData?.filter(m => m.degraded).map(m => m.url) ?? []
    const knownMintUrlSet = new Set(knownMintsData?.map(m => m.url) ?? [])
    const degradedSetLocal = new Set(degradedUrls)
    const nostrOnly = nostrMints.filter(m => !knownMintUrlSet.has(m.url))
    return {
      degradedCount: degradedUrls.length,
      totalAllCount: (knownMintsData?.length ?? 0) + nostrOnly.length,
      allMints: [
        ...(knownMintsData?.filter(m => showDegraded ? true : !m.degraded) ?? []),
        ...nostrOnly
          .filter(m => showDegraded || !degradedSetLocal.has(m.url))
          .map((m): KnownMint => ({ url: m.url, name: null, iconUrl: null, degraded: false, online: null, latencyMs: null, version: null, nutCount: null, tosUrl: null, descriptionLong: null, nutsLimits: null, auditNMints: null, auditNMelts: null, auditNErrors: null, auditCheckedAt: null })),
      ] as KnownMint[],
    }
  }, [knownMintsData, nostrMints, showDegraded])

  const filteredMints = useMemo(() => {
    return applyFilters(allMints, activeFilters)
  }, [allMints, activeFilters])
  const activeFilterCount = countActiveFilters(activeFilters)

  const avgLatency24h = useMemo(() => {
    const lats = allMints
      .filter(m => m.online === true && m.latencyMs !== null && m.latencyMs > 0 && m.latencyMs < 10000)
      .map(m => m.latencyMs as number)
      .sort((a, b) => a - b)
    if (lats.length === 0) return null
    const mid = Math.floor(lats.length / 2)
    return lats.length % 2 !== 0 ? lats[mid]! : Math.round((lats[mid - 1]! + lats[mid]!) / 2)
  }, [allMints])

  const totalCount = allMints.length
  const onlineCount = allMints.filter(m => m.online === true).length

  const comparedMints = useMemo(() => {
    if (!compareBaseUrl) return []
    const base = allMints.find(m => m.url === compareBaseUrl)
    if (!base) return []
    return [base, ...allMints.filter(m => comparePickerSelected.has(m.url))]
  }, [allMints, compareBaseUrl, comparePickerSelected])

  useEffect(() => {
    if (!knownMintsData || knownMintsData.length === 0) return
    let latest: Date | null = null
    for (const mint of knownMintsData) {
      if (mint.lastCheckedAt) {
        const t = new Date(mint.lastCheckedAt)
        if (!latest || t > latest) latest = t
      }
    }
    setLastCheckTime(latest)
  }, [knownMintsData])

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!showSubmit) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSubmit(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showSubmit])

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).type === 'mintradar:escape') {
        setShowFilters(false)
        setShowComparePicker(false)
        setShowComparisonModal(false)
        setShowSubmit(false)
      }
    }
    window.addEventListener('mintradar:escape', handler)
    return () => window.removeEventListener('mintradar:escape', handler)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '/') return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
      e.preventDefault()
      searchInputRef.current?.focus()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (submitState !== 'success') return
    const timer = setTimeout(() => setShowSubmit(false), 3000)
    return () => clearTimeout(timer)
  }, [submitState])

  function handleViewMode(mode: 'cards' | 'list') {
    setViewMode(mode)
    localStorage.setItem('mintRadar_viewMode', mode)
  }

  function handleSortClick(s: typeof sortBy) {
    if (s === sortBy) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(s)
      setSortDir(DEFAULT_SORT_DIRS[s])
    }
  }

  function handleSubmitInputChange(value: string) {
    setSubmitInput(value)
    const trimmed = value.trim()
    if (trimmed.startsWith('https://')) {
      setSubmitUrl(trimmed)
      setNostrLookupState('idle')
      setNostrLookupMsg('')
    } else {
      setSubmitUrl('')
    }
  }

  useEffect(() => {
    if (!showSubmit) return
    const input = submitInput.trim()
    const isNpub = input.startsWith('npub1')
    const isHex = /^[0-9a-f]{64}$/i.test(input)
    if (!isNpub && !isHex) {
      setNostrLookupState('idle')
      setNostrLookupMsg('')
      return
    }
    setNostrLookupState('loading')
    setNostrLookupMsg('')
    const timer = setTimeout(() => {
      void (async () => {
        try {
          let pubkey = input
          if (isNpub) {
            const decoded = nip19.decode(input)
            if (decoded.type !== 'npub') {
              setNostrLookupState('error')
              setNostrLookupMsg('Invalid npub format')
              return
            }
            pubkey = decoded.data as string
          }
          const events = await Promise.race([
            sharedPool.querySync(NOSTR_LOOKUP_RELAYS, { kinds: [38172], authors: [pubkey], limit: 5 }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
          ]) as NostrEvent[]
          const mintUrl = events
            .flatMap(e => e.tags)
            .find(t => t[0] === 'u' && t[1])?.[1]
          if (!mintUrl) {
            setNostrLookupState('error')
            setNostrLookupMsg('No mint announcement found for this Nostr key')
            return
          }
          setNostrLookupState('idle')
          setSubmitUrl(mintUrl)
        } catch {
          setNostrLookupState('error')
          setNostrLookupMsg('Failed to reach Nostr relays. Try again.')
        }
      })()
    }, 600)
    return () => clearTimeout(timer)
  }, [submitInput, showSubmit])

  useEffect(() => {
    if (!showSubmit) return
    if (!submitUrl.startsWith('https://')) {
      setProbeState('idle')
      setProbeResult(null)
      return
    }
    setProbeState('loading')
    const timer = setTimeout(() => {
      fetch(`/api/mint/probe?url=${encodeURIComponent(submitUrl)}`)
        .then(res => { if (!res.ok) throw new Error(); return res.json() as Promise<MintStatus> })
        .then(data => {
          if (data.online && data.info) {
            setProbeState('success')
            setProbeResult({
              name: data.info.name ?? null,
              version: data.info.version ?? null,
              nutCount: Object.keys(data.info.nuts).length,
              latencyMs: data.latencyMs,
            })
          } else {
            setProbeState('error')
            setProbeResult(null)
          }
        })
        .catch(() => {
          setProbeState('error')
          setProbeResult(null)
        })
    }, 600)
    return () => clearTimeout(timer)
  }, [submitUrl, showSubmit])

  function handleSubmitMint() {
    if (!submitUrl.startsWith('https://')) {
      setSubmitState('error')
      setSubmitMsg('URL must start with https://')
      return
    }
    setSubmitState('loading')
    fetch('/api/mint/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: submitUrl }),
    })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }: { ok: boolean; data: { success?: boolean; error?: string; name?: string | null } }) => {
        if (!ok) {
          setSubmitState('error')
          setSubmitMsg((data.error) ?? 'Submission failed')
        } else {
          setSubmitState('success')
          setSubmitMsg('Mint submitted! It will appear on the dashboard after the next probe cycle (~5 min).')
          void queryClient.invalidateQueries({ queryKey: ['mints-known'] })
        }
      })
      .catch(() => {
        setSubmitState('error')
        setSubmitMsg('Network error. Please try again.')
      })
  }

  async function handleBulkSubmit() {
    const lines = bulkInput.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    const initial = lines.map(url => ({ url, status: 'pending' as const }))
    setBulkProgress(initial)
    setBulkRunning(true)
    setBulkDone(false)

    for (let i = 0; i < lines.length; i++) {
      const url = lines[i]!
      if (!url.startsWith('https://')) {
        setBulkProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'failed', error: 'Must start with https://' } : p))
        continue
      }
      setBulkProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'probing' } : p))
      try {
        const res = await fetch('/api/mint/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        })
        const data = await res.json() as { success?: boolean; error?: string }
        if (res.ok && data.success) {
          setBulkProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'added' } : p))
        } else {
          setBulkProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'failed', error: data.error ?? 'Failed' } : p))
        }
      } catch {
        setBulkProgress(prev => prev.map((p, j) => j === i ? { ...p, status: 'failed', error: 'Network error' } : p))
      }
    }
    setBulkRunning(false)
    setBulkDone(true)
    void queryClient.invalidateQueries({ queryKey: ['mints-known'] })
  }

  const bulkAdded = bulkProgress.filter(p => p.status === 'added').length
  const bulkFailed = bulkProgress.filter(p => p.status === 'failed').length

  return (
    <div className="dashboard">
      <div className="stats-bar">
        <div className="stat-card">
          <div className="stat-icon green"><IcSignal /></div>
          <div>
            <div className="stat-label">Online Mints</div>
            <div className="stat-value green">{onlineCount} / {totalCount}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><IcTimer /></div>
          <div>
            <div className="stat-label">Median Latency</div>
            <div className="stat-value">
              {avgLatency24h !== null ? `${avgLatency24h} ms` : '—'}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon gray"><IcGrid /></div>
          <div>
            <div className="stat-label">Known Mints</div>
            <div className="stat-value">{knownMintsData?.length ?? 0}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon gray"><IcSuccess /></div>
          <div>
            <div className="stat-label">Last Check</div>
            <div className="stat-value muted">{formatTimeAgo(lastCheckTime)}</div>
          </div>
        </div>
      </div>

      <div className="dashboard-controls">
        <div className="search-wrap">
          <span className="search-icon"><IcSearch /></span>
          <input
            ref={searchInputRef}
            className="search-input"
            type="text"
            placeholder="Search mints by name, URL or version…  ( / )"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            data-search-input
          />
          {!searchFocused && search === '' && (
            <span className="search-shortcut">/</span>
          )}
        </div>
        <button
          type="button"
          className={`filter-btn${showFilters ? ' active' : ''}`}
          onClick={() => setShowFilters(v => !v)}
        >
          <IcFilter />
          Filters
          {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
        </button>
        <div className="sort-segment">
          {(['status', 'latency', 'name', 'trust'] as const).map(s => (
            <button
              key={s}
              type="button"
              className={`sort-btn${sortBy === s ? ' active' : ''}`}
              onClick={() => handleSortClick(s)}
            >
              {s === 'trust' ? 'Trust Score' : s.charAt(0).toUpperCase() + s.slice(1)}
              {sortBy === s && <span style={{marginLeft: 3, fontSize: 10, opacity: 0.7}}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
            </button>
          ))}
        </div>
        <div className="view-toggle">
          <button type="button" className={`view-toggle-btn${viewMode === 'cards' ? ' active' : ''}`} onClick={() => handleViewMode('cards')} title="Card view">
            <IcGrid />
          </button>
          <button type="button" className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => handleViewMode('list')} title="List view">
            <IcList />
          </button>
        </div>
        <button type="button" className="submit-btn" onClick={() => { setShowSubmit(true); setSubmitTab('single'); setSubmitState('idle'); setSubmitInput(''); setSubmitUrl(''); setProbeState('idle'); setProbeResult(null); setNostrLookupState('idle'); setNostrLookupMsg(''); setBulkInput(''); setBulkProgress([]); setBulkRunning(false); setBulkDone(false) }}>
          <IcPlus /> Submit mint
        </button>
        <button type="button" className="refresh-btn" onClick={() => void queryClient.invalidateQueries({ queryKey: ['mints-known'] })}>
          <IcRefresh />
        </button>
      </div>

      {showFilters && (
        <div className="filter-panel">
          {/* Active filter tags */}
          {activeFilterCount > 0 && (
            <div className="filter-active-tags">
              {activeFilters.status !== 'all' && (
                <span className="filter-tag">
                  {activeFilters.status === 'online' ? 'Online only' : 'Offline only'}
                  <button type="button" onClick={() => { const f = { ...activeFilters, status: 'all' as const }; setActiveFilters(f); setPendingFilters(f) }}><IcClose /></button>
                </span>
              )}
              {activeFilters.minTrustScore > 0 && (
                <span className="filter-tag">
                  Trust ≥ {activeFilters.minTrustScore}%
                  <button type="button" onClick={() => { const f = { ...activeFilters, minTrustScore: 0 }; setActiveFilters(f); setPendingFilters(f) }}><IcClose /></button>
                </span>
              )}
              {activeFilters.mintAges.map(age => (
                <span key={age} className="filter-tag">
                  {age}
                  <button type="button" onClick={() => { const f = { ...activeFilters, mintAges: activeFilters.mintAges.filter(a => a !== age) }; setActiveFilters(f); setPendingFilters(f) }}><IcClose /></button>
                </span>
              ))}
              {activeFilters.requiredNuts.map(nut => (
                <span key={nut} className="filter-tag">
                  NUT-{nut.padStart(2, '0')}
                  <button type="button" onClick={() => { const f = { ...activeFilters, requiredNuts: activeFilters.requiredNuts.filter(n => n !== nut) }; setActiveFilters(f); setPendingFilters(f) }}><IcClose /></button>
                </span>
              ))}
            </div>
          )}

          <div className="filter-row">
            <div className="filter-group">
              <div className="filter-group-label">Status</div>
              <div className="filter-radio-group">
                {(['all', 'online', 'offline'] as const).map(s => (
                  <label key={s} className="filter-radio">
                    <input type="radio" name="filter-status" checked={pendingFilters.status === s} onChange={() => setPendingFilters(p => ({ ...p, status: s }))} />
                    {s === 'all' ? 'All' : s === 'online' ? 'Online only' : 'Offline only'}
                  </label>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <div className="filter-group-label">Min. Trust Score: <strong>{pendingFilters.minTrustScore}%</strong></div>
              <input
                type="range" min={0} max={100} step={5}
                value={pendingFilters.minTrustScore}
                onChange={e => setPendingFilters(p => ({ ...p, minTrustScore: parseInt(e.target.value) }))}
                className="filter-slider"
              />
            </div>

            <div className="filter-group">
              <div className="filter-group-label">Mint age</div>
              <div className="filter-pills">
                {AGE_LABELS.map(age => (
                  <button
                    key={age}
                    type="button"
                    className={`filter-pill${pendingFilters.mintAges.includes(age) ? ' active' : ''}`}
                    onClick={() => setPendingFilters(p => ({
                      ...p,
                      mintAges: p.mintAges.includes(age) ? p.mintAges.filter(a => a !== age) : [...p.mintAges, age],
                    }))}
                  >{age}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="filter-group" style={{ marginBottom: 10 }}>
            <div className="filter-group-label">NUT support</div>
            <div className="filter-nut-grid">
              {NUT_FILTER_KEYS.map(key => (
                <button
                  key={key}
                  type="button"
                  className={`filter-nut-chip${pendingFilters.requiredNuts.includes(key) ? ' active' : ''}`}
                  onClick={() => setPendingFilters(p => ({
                    ...p,
                    requiredNuts: p.requiredNuts.includes(key) ? p.requiredNuts.filter(n => n !== key) : [...p.requiredNuts, key],
                  }))}
                >NUT-{key.padStart(2, '0')}</button>
              ))}
            </div>
          </div>

          <div className="filter-footer">
            <div className="filter-count">Showing <strong>{filteredMints.length}</strong> of <strong>{totalCount}</strong> mints</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="filter-reset-btn" onClick={() => { setPendingFilters(DEFAULT_FILTERS); setActiveFilters(DEFAULT_FILTERS) }}>Reset filters</button>
              <button type="button" className="filter-apply-btn" onClick={() => { setActiveFilters(pendingFilters); setShowFilters(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Apply filter</button>
            </div>
          </div>
        </div>
      )}

      {knownError ? (
        <p className="error-msg">Failed to load mints</p>
      ) : knownLoading ? (
        <div className="mint-grid">
          {Array.from({ length: 9 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <>
          {viewMode === 'list' ? (
            <MintListView
              mints={filteredMints}
              search={search}
              sortBy={sortBy}
              sortDir={sortDir}
              totalAll={!showDegraded && degradedCount > 0 ? totalAllCount : 0}
            />
          ) : (
            <MintGrid
              mints={filteredMints}
              search={search}
              sortBy={sortBy}
              sortDir={sortDir}
              onCompare={openComparePicker}
              totalAll={!showDegraded && degradedCount > 0 ? totalAllCount : 0}
            />
          )}
          {degradedCount > 0 && (
            <p className="degraded-note">
              {!showDegraded && <>{degradedCount} mints hidden (offline 24h+){' '}</>}
              <button onClick={() => setShowDegraded(v => !v)}
                style={{background:'none',border:'none',color:'var(--accent)',fontSize:11,cursor:'pointer',textDecoration:'underline'}}>
                {showDegraded ? 'Hide' : 'Show'}
              </button>
            </p>
          )}
        </>
      )}

      {/* Compare picker */}
      {showComparePicker && (() => {
        const q = comparePickerSearch.toLowerCase()
        const otherMints = allMints.filter(m =>
          m.url !== compareBaseUrl &&
          m.online === true &&
          (q === '' || (m.name ?? m.url).toLowerCase().includes(q) || m.url.toLowerCase().includes(q))
        )
        return (
          <div className="cmp-overlay" onClick={() => setShowComparePicker(false)}>
            <div className="md-picker-modal" onClick={e => e.stopPropagation()}>
              <div className="md-picker-header">
                <div style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>Compare with...</div>
                <button onClick={() => setShowComparePicker(false)} style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:18}}>×</button>
              </div>
              <div style={{padding:'8px 16px 0'}}>
                <div style={{fontSize:11,color:'var(--text3)',marginBottom:8}}>
                  Select 1–3 mints to compare with <strong style={{color:'var(--text)'}}>{allMints.find(m => m.url === compareBaseUrl)?.name ?? compareBaseUrl}</strong>
                </div>
                <input
                  className="md-picker-search"
                  type="text"
                  placeholder="Search mints..."
                  value={comparePickerSearch}
                  onChange={e => setComparePickerSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="md-picker-list">
                {otherMints.slice(0, 50).map(m => {
                  const isChecked = comparePickerSelected.has(m.url)
                  const disabled = !isChecked && comparePickerSelected.size >= 3
                  return (
                    <div
                      key={m.url}
                      className={`md-picker-item${isChecked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}
                      onClick={() => {
                        if (disabled) return
                        setComparePickerSelected(prev => {
                          const next = new Set(prev)
                          if (next.has(m.url)) next.delete(m.url); else next.add(m.url)
                          return next
                        })
                      }}
                    >
                      <div className={`card-checkbox${isChecked ? ' checked' : ''}`} style={{width:14,height:14,borderRadius:3,flexShrink:0}}>
                        {isChecked && <span style={{fontSize:10,lineHeight:1}}>✓</span>}
                      </div>
                      <span style={{width:7,height:7,borderRadius:'50%',background:m.online===true?'var(--accent)':'#ff4d4d',display:'inline-block',flexShrink:0}} />
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.name ?? getHostname(m.url)}</div>
                        <div style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--font-mono)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{getHostname(m.url)}</div>
                      </div>
                    </div>
                  )
                })}
                {otherMints.length === 0 && (
                  <div style={{padding:'16px',fontSize:12,color:'var(--text3)',textAlign:'center'}}>No mints found</div>
                )}
              </div>
              <div className="md-picker-footer">
                <span style={{fontSize:11,color:'var(--text3)'}}>{comparePickerSelected.size} / 3 selected</span>
                <button
                  className="md-picker-confirm"
                  disabled={comparePickerSelected.size === 0}
                  onClick={() => { setShowComparePicker(false); setShowComparisonModal(true) }}
                >
                  Compare ({comparedMints.length})
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Comparison modal */}
      {showComparisonModal && comparedMints.length >= 2 && (
        <ComparisonModal mints={comparedMints} onClose={() => setShowComparisonModal(false)} />
      )}

      {showSubmit && (
        <div className="submit-modal-overlay" onClick={() => setShowSubmit(false)}>
          <div className="submit-modal" onClick={e => e.stopPropagation()}>
            <div className="submit-modal-title">Submit a mint</div>
            <div className="submit-tabs">
              <button type="button" className={`submit-tab-btn${submitTab === 'single' ? ' active' : ''}`} onClick={() => setSubmitTab('single')}>Single</button>
              <button type="button" className={`submit-tab-btn${submitTab === 'bulk' ? ' active' : ''}`} onClick={() => setSubmitTab('bulk')}>Bulk</button>
            </div>

            {submitTab === 'single' && (
              <>
                <div className="submit-modal-desc">
                  Submit a Cashu mint URL to be listed. The mint must be reachable and respond to <code>/v1/info</code>.
                </div>
                {submitState !== 'success' && (
                  <>
                    <input
                      className="submit-modal-input"
                      type="text"
                      placeholder="https://yourmint.cash or npub1..."
                      value={submitInput}
                      onChange={e => handleSubmitInputChange(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && probeState === 'success') handleSubmitMint() }}
                      autoFocus
                    />
                    <div className="submit-input-hint">Enter a mint URL or the mint operator's Nostr public key</div>
                    {nostrLookupState === 'loading' && <div className="submit-probe-loading">Looking up mint on Nostr…</div>}
                    {nostrLookupState === 'error' && <div className="submit-probe-error">{nostrLookupMsg}</div>}
                    {probeState === 'loading' && submitUrl.startsWith('https://') && <div className="submit-probe-loading">Checking mint…</div>}
                    {probeState === 'success' && probeResult !== null && (
                      <div className="submit-probe-preview">
                        <div className="submit-probe-name">{probeResult.name ?? 'Unknown mint'}</div>
                        <div className="submit-probe-meta">
                          <span>v{probeResult.version ?? '?'}</span>
                          <span>·</span>
                          <span>{probeResult.nutCount} NUTs</span>
                          {probeResult.latencyMs !== null && (<><span>·</span><span style={{ color: latencyColor(probeResult.latencyMs) }}>{probeResult.latencyMs} ms</span></>)}
                        </div>
                      </div>
                    )}
                    {probeState === 'error' && submitUrl.startsWith('https://') && nostrLookupState === 'idle' && <div className="submit-probe-error">Mint unreachable or invalid</div>}
                    {submitState === 'error' && <div className="submit-result error">{submitMsg}</div>}
                    <div className="submit-modal-actions">
                      <button className="submit-cancel-btn" onClick={() => setShowSubmit(false)}>Cancel</button>
                      <button className="submit-ok-btn" onClick={handleSubmitMint} disabled={probeState !== 'success' || submitState === 'loading'}>
                        {submitState === 'loading' ? 'Submitting…' : 'Submit'}
                      </button>
                    </div>
                    <div className="submit-no-account">No account required.</div>
                  </>
                )}
                {submitState === 'success' && (
                  <>
                    <div className="submit-result success">{submitMsg}</div>
                    <div className="submit-modal-actions">
                      <button className="submit-ok-btn" onClick={() => setShowSubmit(false)}>Close</button>
                    </div>
                  </>
                )}
              </>
            )}

            {submitTab === 'bulk' && (
              <>
                <div className="submit-modal-desc">
                  Paste one mint URL per line. Each must start with <code>https://</code>.
                </div>
                {!bulkRunning && !bulkDone && (
                  <>
                    <textarea
                      className="bulk-textarea"
                      placeholder={'https://mint1.example.com\nhttps://mint2.example.com'}
                      value={bulkInput}
                      onChange={e => setBulkInput(e.target.value)}
                      rows={6}
                      autoFocus
                    />
                    <div className="submit-modal-actions">
                      <button className="submit-cancel-btn" onClick={() => setShowSubmit(false)}>Cancel</button>
                      <button
                        className="submit-ok-btn"
                        onClick={() => { void handleBulkSubmit() }}
                        disabled={bulkInput.trim().length === 0}
                      >Submit All</button>
                    </div>
                  </>
                )}
                {(bulkRunning || bulkProgress.length > 0) && (
                  <div className="bulk-progress">
                    {bulkProgress.map((p, i) => (
                      <div key={i} className={`bulk-row status-${p.status}`}>
                        <span className="bulk-url">{getHostname(p.url)}</span>
                        <span className="bulk-status">
                          {p.status === 'pending' && '…'}
                          {p.status === 'probing' && '⟳ probing'}
                          {p.status === 'added' && '✓ Added'}
                          {p.status === 'failed' && `✗ ${p.error ?? 'Failed'}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {bulkDone && (
                  <div style={{ marginTop: 10 }}>
                    <div className={`submit-result ${bulkFailed === 0 ? 'success' : 'error'}`}>
                      {bulkAdded} added, {bulkFailed} failed
                    </div>
                    <div className="submit-modal-actions">
                      <button className="submit-ok-btn" onClick={() => setShowSubmit(false)}>Close</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
