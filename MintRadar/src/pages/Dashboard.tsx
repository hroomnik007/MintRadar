import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { nip19 } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import type { NostrEvent } from 'nostr-tools'
import { useNostrDiscovery } from '@/hooks/useNostrDiscovery'
import { useWatchlistNotifications } from '@/hooks/useWatchlistNotifications'
import { useUserRelays } from '@/hooks/useUserRelays'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { useNostrMints } from '@/hooks/useNostrMints'
import { useKnownMints, type KnownMint } from '@/hooks/useKnownMints'
import { useMintHistory } from '@/hooks/useMintHistory'
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
const IcList = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <rect x="1" y="2" width="11" height="1.5" rx="0.75" fill="currentColor"/>
    <rect x="1" y="5.75" width="11" height="1.5" rx="0.75" fill="currentColor"/>
    <rect x="1" y="9.5" width="11" height="1.5" rx="0.75" fill="currentColor"/>
  </svg>
)
const IcCards = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <rect x="1" y="1" width="4.5" height="4.5" rx="1" fill="currentColor"/>
    <rect x="7.5" y="1" width="4.5" height="4.5" rx="1" fill="currentColor"/>
    <rect x="1" y="7.5" width="4.5" height="4.5" rx="1" fill="currentColor"/>
    <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="1" fill="currentColor"/>
  </svg>
)
const IcShield = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M7 1.5L2 3.5v3.5C2 9.8 4.2 12.3 7 13c2.8-.7 5-3.2 5-6V3.5L7 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <polyline points="4.5,7 6.2,8.7 9.5,5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
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

// ── Helpers ────────────────────────────────────────────────────

function trustScoreInfo(score: number): { label: string; color: string; bg: string; border: string } {
  if (score >= 70) return { label: 'High Trust', color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.25)' }
  if (score >= 40) return { label: 'Moderate Trust', color: '#ffa500', bg: 'rgba(255,165,0,0.1)', border: 'rgba(255,165,0,0.25)' }
  return { label: 'Low Trust', color: '#ff4d4d', bg: 'rgba(255,77,77,0.1)', border: 'rgba(255,77,77,0.25)' }
}

function mintAgeBadge(discoveredAt: string | null | undefined): { label: string; color: string; bg: string; border: string } | null {
  if (!discoveredAt) return null
  const months = (Date.now() - new Date(discoveredAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  if (months < 1) return { label: 'Fresh', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.25)' }
  if (months < 6) return { label: 'Established', color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.25)' }
  if (months < 12) return { label: 'Veteran', color: '#ffa500', bg: 'rgba(255,165,0,0.1)', border: 'rgba(255,165,0,0.25)' }
  return { label: 'OG', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' }
}

function latencyColor(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return 'var(--text)'
  if (ms < 800) return '#4ade80'
  if (ms < 1500) return '#ffa500'
  return '#ff4d4d'
}

function uptimeColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'var(--text3)'
  if (pct >= 80) return '#4ade80'
  if (pct >= 50) return '#ffa500'
  return '#ff4d4d'
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


const NOSTR_LOOKUP_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band']
const DEFAULT_SORT_DIRS: Record<'name' | 'latency' | 'status' | 'trust', 'asc' | 'desc'> = { status: 'desc', latency: 'asc', trust: 'desc', name: 'asc' }

const NUT_FILTER_KEYS = ['1','2','3','4','5','6','7','8','9','10','11','12','13','14']
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

// ── Mint Card ──────────────────────────────────────────────────

function MintCardDisplay({
  mint,
  isDegraded = false,
  viewMode = 'compact',
  isSelected = false,
  onToggleSelect,
}: {
  mint: KnownMint
  isDegraded?: boolean
  viewMode?: 'compact' | 'expanded'
  isSelected?: boolean
  onToggleSelect?: (url: string, selected: boolean) => void
}) {
  const navigate = useNavigate()
  const mints = useWatchlistStore(state => state.mints)
  const addMint = useWatchlistStore(state => state.addMint)
  const removeMint = useWatchlistStore(state => state.removeMint)
  const isWatched = mints.includes(mint.url)
  const profile = useAuthStore(state => state.profile)
  const isLoggedIn = profile !== null
  const { records, uptimePercent } = useMintHistory(mint.url)

  const cardStyle = isDegraded ? { opacity: 0.45 } : undefined
  const hostname = getHostname(mint.url)
  const isOnline = mint.online === true
  const displayName = mint.name ?? hostname
  const uptimePct = records.length > 0 ? uptimePercent : (isOnline ? 100 : 0)
  const showUptime = records.length > 0 || isOnline

  const trustScore = listTrustScore(mint)
  const tsInfo = trustScoreInfo(trustScore)
  const ageBadge = mintAgeBadge(mint.discoveredAt)

  const isNew = mint.discoveredAt != null
    && (Date.now() - new Date(mint.discoveredAt).getTime()) < 48 * 3600 * 1000

  return (
    <div
      className={`mint-card ${mint.online === true ? 'online' : mint.online === false ? 'offline' : ''}`}
      style={cardStyle}
      onClick={() => { navigate(`/mint/${encodeURIComponent(mint.url)}`) }}
    >
      {onToggleSelect && (
        <div
          className="card-select-box"
          onClick={e => { e.stopPropagation(); onToggleSelect(mint.url, !isSelected) }}
        >
          <div className={`card-checkbox${isSelected ? ' checked' : ''}`}>
            {isSelected && <span>✓</span>}
          </div>
        </div>
      )}
      <div className="card-top">
        <div className="card-name-row">
          <MintFavicon url={mint.url} iconUrl={mint.iconUrl ?? null} size={22} />
          <div style={{minWidth:0}}>
            <div className="card-name" style={{display:'flex',alignItems:'center',gap:5,minWidth:0}}>
              <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{displayName}</span>
              {isNew && (
                <span style={{flexShrink:0,background:'rgba(74,222,128,0.15)',color:'#4ade80',border:'0.5px solid rgba(74,222,128,0.3)',fontSize:10,padding:'1px 5px',borderRadius:4,fontFamily:'var(--font-mono)',fontWeight:600}}>New</span>
              )}
              {ageBadge && !isNew && (
                <span style={{flexShrink:0,background:ageBadge.bg,color:ageBadge.color,border:`0.5px solid ${ageBadge.border}`,fontSize:9,padding:'1px 5px',borderRadius:4,fontFamily:'var(--font-mono)',fontWeight:600}}>{ageBadge.label}</span>
              )}
            </div>
            <div className="card-host">{hostname}</div>
          </div>
        </div>
        <div className="status-dot" style={{background: isOnline ? 'var(--accent)' : '#ff4d4d'}} />
      </div>

      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
        <span style={{fontSize:10,fontFamily:'var(--font-mono)',color:tsInfo.color,background:tsInfo.bg,border:`0.5px solid ${tsInfo.border}`,borderRadius:4,padding:'1px 5px',flexShrink:0}}>{tsInfo.label}</span>
        <span style={{fontSize:11,fontFamily:'var(--font-mono)',color:tsInfo.color,fontWeight:600}}>{trustScore}%</span>
        {showUptime && (
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:4}}>
            <div className="uptime-bar-track">
              <div className="uptime-bar-fill" style={{width:`${uptimePct}%`,background:uptimeColor(uptimePct)}}/>
            </div>
            <span className="uptime-pct" style={{color:uptimeColor(uptimePct)}}>{uptimePct}%</span>
          </div>
        )}
      </div>

      {viewMode === 'expanded' && (
        <div style={{display:'flex',gap:14,marginBottom:8,fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text2)'}}>
          <div>
            <span style={{color:'var(--text3)',marginRight:3}}>Latency</span>
            <span style={{color:isOnline && mint.latencyMs !== null ? 'var(--text)' : 'var(--text3)'}}>
              {!isOnline ? '—' : mint.latencyMs !== null ? `${mint.latencyMs}ms` : '—'}
            </span>
          </div>
          {mint.nutCount !== null && (
            <div>
              <span style={{color:'var(--text3)',marginRight:3}}>NUTs</span>
              <span>{mint.nutCount} / 14</span>
            </div>
          )}
        </div>
      )}

      <div className="card-bottom" style={{justifyContent:'flex-end'}}>
        {isLoggedIn && (
          <button
            type="button"
            className={`watch-btn${isWatched ? ' watching' : ''}`}
            onClick={e => { e.stopPropagation(); void (isWatched ? removeMint(mint.url) : addMint(mint.url)) }}
          >
            {isWatched ? <><IcEye /><span>Watching</span></> : <><IcPlus /><span>Watch</span></>}
          </button>
        )}
      </div>
    </div>
  )
}

function MintGrid({
  mints,
  search,
  sortBy,
  sortDir,
  viewMode,
  selectedUrls,
  onToggleSelect,
}: {
  mints: KnownMint[]
  search: string
  sortBy: 'name' | 'latency' | 'status' | 'trust'
  sortDir: 'asc' | 'desc'
  viewMode: 'compact' | 'expanded'
  selectedUrls: Set<string>
  onToggleSelect: (url: string, selected: boolean) => void
}) {
  const [visibleCount, setVisibleCount] = useState(20)
  const sentinelRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => { setVisibleCount(20) }, [sortedFiltered])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) setVisibleCount(prev => prev + 20)
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const visible = sortedFiltered.slice(0, visibleCount)
  const hasMore = visibleCount < sortedFiltered.length

  return (
    <>
      <div className="mint-grid">
        {visible.map(mint => (
          <MintCardDisplay
            key={mint.url}
            mint={mint}
            isDegraded={mint.degraded}
            viewMode={viewMode}
            isSelected={selectedUrls.has(mint.url)}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
      <div style={{fontSize:13,color:'var(--text3)',textAlign:'center',marginTop:16,fontFamily:'var(--font-mono)'}}>
        Zobrazených {visible.length} z {sortedFiltered.length}
      </div>
      {hasMore && <div ref={sentinelRef} style={{height:1}} />}
    </>
  )
}

// ── Dashboard ──────────────────────────────────────────────────

export default function Dashboard() {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'latency' | 'status' | 'trust'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const { viewMode, setViewMode } = useUIStore()

  // Filter state
  const [showFilters, setShowFilters] = useState(false)
  const [pendingFilters, setPendingFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [activeFilters, setActiveFilters] = useState<FilterState>(DEFAULT_FILTERS)

  // Comparison state
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set())
  const [showComparison, setShowComparison] = useState(false)

  function toggleSelect(url: string, selected: boolean) {
    setSelectedUrls(prev => {
      const next = new Set(prev)
      if (selected && next.size < 4) next.add(url)
      else next.delete(url)
      return next
    })
  }
  function clearSelection() { setSelectedUrls(new Set()) }

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

  const userReadRelays = useUserRelays()
  useWatchlistNotifications(statusRecord, trustScoreRecord, userReadRelays)

  const { degradedCount, allMints } = useMemo(() => {
    const degradedUrls = knownMintsData?.filter(m => m.degraded).map(m => m.url) ?? []
    const knownMintUrlSet = new Set(knownMintsData?.map(m => m.url) ?? [])
    const degradedSetLocal = new Set(degradedUrls)
    return {
      degradedCount: degradedUrls.length,
      allMints: [
        ...(knownMintsData?.filter(m => showDegraded ? true : (!m.degraded && m.online !== false)) ?? []),
        ...nostrMints
          .filter(m => !knownMintUrlSet.has(m.url) && (showDegraded || !degradedSetLocal.has(m.url)))
          .map((m): KnownMint => ({ url: m.url, name: null, iconUrl: null, degraded: false, online: null, latencyMs: null, version: null, nutCount: null, tosUrl: null, descriptionLong: null, nutsLimits: null, auditNMints: null, auditNMelts: null, auditNErrors: null, auditCheckedAt: null })),
      ] as KnownMint[],
    }
  }, [knownMintsData, nostrMints, showDegraded])

  const filteredMints = useMemo(() => applyFilters(allMints, activeFilters), [allMints, activeFilters])
  const activeFilterCount = countActiveFilters(activeFilters)

  const avgTrustScore = useMemo(() => {
    const scores = allMints.filter(m => m.online === true).map(m => listTrustScore(m))
    return scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b) / scores.length) : 0
  }, [allMints])
  const avgTsInfo = trustScoreInfo(avgTrustScore)

  const totalCount = allMints.length
  const onlineCount = allMints.filter(m => m.online === true).length

  const selectedMints = useMemo(() => allMints.filter(m => selectedUrls.has(m.url)), [allMints, selectedUrls])

  useEffect(() => {
    if (knownMintsData && knownMintsData.length > 0) {
      setLastCheckTime(new Date())
    }
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
        setShowComparison(false)
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
        const pool = new SimplePool()
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
            pool.querySync(NOSTR_LOOKUP_RELAYS, { kinds: [38172], authors: [pubkey], limit: 5 }),
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
        } finally {
          pool.destroy()
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
            <div className={`stat-value ${onlineCount > 0 ? 'green' : ''}`}>{onlineCount} / {totalCount}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: avgTsInfo.bg, color: avgTsInfo.color, width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <IcShield />
          </div>
          <div>
            <div className="stat-label">Avg Trust Score</div>
            <div className="stat-value" style={{ color: avgTsInfo.color }}>{avgTrustScore > 0 ? `${avgTrustScore}%` : '—'}</div>
            {avgTrustScore > 0 && <div style={{ fontSize: 9, color: avgTsInfo.color, fontFamily: 'var(--font-mono)', marginTop: 2 }}>{avgTsInfo.label}</div>}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon gray"><IcGrid /></div>
          <div>
            <div className="stat-label">Known Mints</div>
            <div className="stat-value">{totalCount}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon yellow"><IcSuccess /></div>
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
            placeholder="Search mints by name, URL or version…"
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
          Filtre
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
          <button type="button" className={`view-toggle-btn${viewMode === 'compact' ? ' active' : ''}`} onClick={() => setViewMode('compact')} title="Compact view"><IcList /></button>
          <button type="button" className={`view-toggle-btn${viewMode === 'expanded' ? ' active' : ''}`} onClick={() => setViewMode('expanded')} title="Expanded view"><IcCards /></button>
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
                  {activeFilters.status === 'online' ? 'Len online' : 'Len offline'}
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
              <div className="filter-group-label">Stav</div>
              <div className="filter-radio-group">
                {(['all', 'online', 'offline'] as const).map(s => (
                  <label key={s} className="filter-radio">
                    <input type="radio" name="filter-status" checked={pendingFilters.status === s} onChange={() => setPendingFilters(p => ({ ...p, status: s }))} />
                    {s === 'all' ? 'Všetky' : s === 'online' ? 'Len online' : 'Len offline'}
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
              <div className="filter-group-label">Vek mintu</div>
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
            <div className="filter-group-label">Podpora NUT</div>
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
            <div className="filter-count">Zobrazených <strong>{filteredMints.length}</strong> z <strong>{totalCount}</strong> mintov</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="filter-reset-btn" onClick={() => { setPendingFilters(DEFAULT_FILTERS); setActiveFilters(DEFAULT_FILTERS) }}>Resetovať filtre</button>
              <button type="button" className="filter-apply-btn" onClick={() => { setActiveFilters(pendingFilters); setShowFilters(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Použiť filtre</button>
            </div>
          </div>
        </div>
      )}

      {knownError ? (
        <p className="error-msg">Nepodarilo sa načítať minty</p>
      ) : knownLoading ? (
        <div className="mint-grid">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="skeleton-card" />
          ))}
        </div>
      ) : (
        <>
          <MintGrid
            mints={filteredMints}
            search={search}
            sortBy={sortBy}
            sortDir={sortDir}
            viewMode={viewMode}
            selectedUrls={selectedUrls}
            onToggleSelect={toggleSelect}
          />
          {degradedCount > 0 && (
            <p className="degraded-note">
              {degradedCount} mints hidden (offline 24h+){' '}
              <button onClick={() => setShowDegraded(v => !v)}
                style={{background:'none',border:'none',color:'var(--accent)',fontSize:11,cursor:'pointer',textDecoration:'underline'}}>
                {showDegraded ? 'Hide' : 'Show'}
              </button>
            </p>
          )}
        </>
      )}

      {/* Floating comparison bar */}
      {selectedUrls.size >= 2 && (
        <div className="cmp-bar">
          <span className="cmp-bar-text">Porovnať {selectedUrls.size} mintov</span>
          <button type="button" className="cmp-bar-btn primary" onClick={() => setShowComparison(true)}>Porovnať</button>
          <button type="button" className="cmp-bar-btn" onClick={clearSelection}>Zrušiť výber</button>
        </div>
      )}

      {/* Comparison modal */}
      {showComparison && selectedMints.length >= 2 && (
        <ComparisonModal mints={selectedMints} onClose={() => setShowComparison(false)} />
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
                  Vlož URL mintov, každý na nový riadok. Každý musí začínať <code>https://</code>.
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
                      {bulkAdded} pridaných, {bulkFailed} zlyhalo
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
