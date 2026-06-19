import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { useKnownMints, type KnownMint } from '@/hooks/useKnownMints'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { useAuthStore } from '@/stores/auth.store'
import { ComparisonModal } from '@/components/ComparisonModal'
import './Watchlist.css'

const IcEye = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
    <path d="M1 7s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.3"/>
    <circle cx="7" cy="7" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
  </svg>
)
const IcPlus = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
    <line x1="6" y1="1.5" x2="6" y2="10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="1.5" y1="6" x2="10.5" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IcRadar = () => (
  <svg width="48" height="48" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="9.5" stroke="currentColor" strokeWidth="1.15"/>
    <circle cx="11" cy="11" r="5.8" stroke="currentColor" strokeWidth="0.9" strokeDasharray="2.2 1.8" opacity="0.7"/>
    <circle cx="11" cy="11" r="2.2" stroke="currentColor" strokeWidth="1.1"/>
    <circle cx="11" cy="11" r="0.9" fill="currentColor"/>
    <line x1="11" y1="11" x2="17" y2="5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
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

function uptimeColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'var(--text3)'
  if (pct >= 80) return '#4ade80'
  if (pct >= 50) return '#ffa500'
  return '#ff4d4d'
}


function mintAgeBadge(discoveredAt: string | null | undefined): { label: string; color: string; bg: string; border: string } | null {
  if (!discoveredAt) return null
  const months = (Date.now() - new Date(discoveredAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  if (months < 1) return { label: 'Fresh', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.25)' }
  if (months < 6) return { label: 'Established', color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.25)' }
  if (months < 12) return { label: 'Veteran', color: '#ffa500', bg: 'rgba(255,165,0,0.1)', border: 'rgba(255,165,0,0.25)' }
  return { label: 'OG', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' }
}

function listTrustScore(mint: KnownMint | null): number {
  if (!mint || mint.online !== true) return 0
  return mint.trustScore ?? 0
}


function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

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

function countActiveFilters(f: FilterState): number {
  return [f.status !== 'all' ? 1 : 0, f.minTrustScore > 0 ? 1 : 0, f.mintAges.length > 0 ? 1 : 0, f.requiredNuts.length > 0 ? 1 : 0].reduce((a, b) => a + b, 0)
}

function applyFilters(urls: string[], knownMintsMap: Map<string, KnownMint>, filters: FilterState): string[] {
  return urls.filter(url => {
    const mint = knownMintsMap.get(url) ?? null
    if (filters.status === 'online' && mint?.online !== true) return false
    if (filters.status === 'offline' && mint?.online !== false) return false
    if (listTrustScore(mint) < filters.minTrustScore) return false
    if (filters.mintAges.length > 0) {
      const badge = mintAgeBadge(mint?.discoveredAt)
      if (!badge || !filters.mintAges.includes(badge.label)) return false
    }
    if (filters.requiredNuts.length > 0) {
      const nuts = mint?.nutsLimits as Record<string, unknown> | null | undefined
      if (!nuts) return false
      if (!filters.requiredNuts.every(nut => nuts[nut] != null)) return false
    }
    return true
  })
}

// ── Watchlist Card ─────────────────────────────────────────────

function WatchlistCard({
  url,
  knownMint,
  isSelected = false,
  onToggleSelect,
}: {
  url: string
  knownMint: KnownMint | null
  isSelected?: boolean
  onToggleSelect?: (url: string, selected: boolean) => void
}) {
  const navigate = useNavigate()
  const mints = useWatchlistStore(state => state.mints)
  const addMint = useWatchlistStore(state => state.addMint)
  const removeMint = useWatchlistStore(state => state.removeMint)
  const isWatched = mints.includes(url)

  const hostname = getHostname(url)
  const isOnline = knownMint?.online === true
  const isDegraded = knownMint?.degraded ?? false
  const displayName = knownMint?.name ?? hostname
  const latency = knownMint?.latencyMs ?? null
  const uptimePct24h = knownMint?.uptimePct24h ?? null

  const borderLeftColor = isDegraded ? '#F5A623' : knownMint?.online === true ? '#17E87F' : '#E24B4A'

  return (
    <div
      className="mint-card"
      style={{ borderLeft: `3px solid ${borderLeftColor}` }}
      onClick={() => navigate(`/mint/${encodeURIComponent(url)}`)}
    >
      {onToggleSelect && (
        <div
          className="card-select-box"
          onClick={e => { e.stopPropagation(); onToggleSelect(url, !isSelected) }}
        >
          <div className={`card-checkbox${isSelected ? ' checked' : ''}`}>
            {isSelected && <span>✓</span>}
          </div>
        </div>
      )}
      <div className="card-top" style={onToggleSelect ? { paddingLeft: 24 } : undefined}>
        <div className="card-name-row">
          <MintFavicon url={url} iconUrl={knownMint?.iconUrl ?? null} size={32} radius={7} />
          <div style={{ minWidth: 0 }}>
            <div className="card-name">{displayName}</div>
            <div className="card-host">{hostname}</div>
          </div>
        </div>
        <div
          className={`status-dot${isOnline ? ' online' : ''}`}
          style={{ background: knownMint?.online === true ? '#17E87F' : '#E24B4A' }}
        />
      </div>
      <div className="card-pills">
        {knownMint?.version && <span className="card-pill">{knownMint.version}</span>}
        {knownMint?.nutCount != null && (
          <span className="card-pill">{knownMint.nutCount} NUTs</span>
        )}
        {uptimePct24h !== null && (
          <span className="card-pill" style={{ color: uptimeColor(uptimePct24h) }}>
            {uptimePct24h}% up
          </span>
        )}
        {isOnline && knownMint != null && knownMint.trustScore != null && (
          <span className="card-pill" style={{ color: knownMint.trustScore >= 70 ? '#4ade80' : knownMint.trustScore >= 40 ? '#ffa500' : '#ff4d4d' }}>
            ★ {knownMint.trustScore}%
          </span>
        )}
      </div>
      <div className="card-bottom">
        <div className="latency-block">
          <div className="latency-label">LATENCY</div>
          {isOnline && latency !== null ? (
            <div className="latency-value" style={{ color: '#e6edf3' }}>
              {latency}<span className="latency-unit">ms</span>
            </div>
          ) : (
            <div className="latency-value muted">—</div>
          )}
        </div>
        <button
          type="button"
          className={`watch-btn${isWatched ? ' watching' : ''}`}
          onClick={e => { e.stopPropagation(); void (isWatched ? removeMint(url) : addMint(url)) }}
        >
          {isWatched ? <><IcEye /><span>Watching</span></> : <><IcPlus /><span>Watch</span></>}
        </button>
      </div>
    </div>
  )
}

export default function Watchlist() {
  const [sortBy, setSortBy] = useState<'name' | 'latency' | 'trust' | 'status'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

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

  function handleSortClick(s: typeof sortBy) {
    if (s === sortBy) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(s)
      setSortDir(DEFAULT_SORT_DIRS[s])
    }
  }

  const mints = useWatchlistStore(state => state.mints)
  const loadFromDb = useWatchlistStore(state => state.loadFromDb)
  const removeMintFromStore = useWatchlistStore(state => state.removeMint)

  const profile = useAuthStore(state => state.profile)
  const login = useAuthStore(state => state.login)
  const authIsLoading = useAuthStore(state => state.isLoading)
  const authError = useAuthStore(state => state.error)

  const { data: knownMintsData } = useKnownMints()
  const knownMintsMap = useMemo(() => new Map(knownMintsData?.map(m => [m.url, m]) ?? []), [knownMintsData])

  const activeFilterCount = countActiveFilters(activeFilters)
  const filteredMints = useMemo(() => applyFilters(mints, knownMintsMap, activeFilters), [mints, knownMintsMap, activeFilters])
  const selectedMints = useMemo(() => filteredMints.map(url => knownMintsMap.get(url)).filter((m): m is KnownMint => m !== undefined && selectedUrls.has(m.url)), [filteredMints, knownMintsMap, selectedUrls])

  const sentinelRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(20)

  useEffect(() => {
    void loadFromDb()
  }, [loadFromDb])

  useEffect(() => { setVisibleCount(20) }, [filteredMints, sortBy, sortDir])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) setVisibleCount(prev => prev + 20)
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).type === 'mintradar:escape') {
        setShowFilters(false)
        setShowComparison(false)
      }
    }
    window.addEventListener('mintradar:escape', handler)
    return () => window.removeEventListener('mintradar:escape', handler)
  }, [])

  function handleExport() {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), mints }, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mintradar-watchlist.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleExportCsv() {
    const header = ['Name', 'URL', 'Latency (ms)', 'Uptime (%)', 'Version', 'NUT Count', 'Online']
    const rows = mints.map(url => {
      const m = knownMintsMap.get(url)
      return [
        m?.name ?? getHostname(url),
        url,
        m?.latencyMs !== null && m?.latencyMs !== undefined ? String(m.latencyMs) : '',
        '',
        m?.version ?? '',
        m?.nutCount !== null && m?.nutCount !== undefined ? String(m.nutCount) : '',
        m?.online === true ? 'true' : m?.online === false ? 'false' : '',
      ]
    })
    const csv = [header, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = 'mintradar-watchlist.csv'
    a.click()
    URL.revokeObjectURL(objectUrl)
  }

  if (profile === null) {
    return (
      <div className="watchlist-page">
        <div className="wl-login-gate">
          <h2>My Watchlist</h2>
          <p>Login via Nostr to track your personal mints. Your data stays in your browser.</p>
          <button
            type="button"
            className="wl-add-btn"
            onClick={() => { void login() }}
            disabled={authIsLoading}
          >
            {authIsLoading ? 'Connecting...' : 'Login via Nostr'}
          </button>
          {authError !== null && <p style={{ color: 'var(--red)', fontSize: '13px', marginTop: '8px' }}>{authError}</p>}
        </div>
      </div>
    )
  }

  const sortedFiltered = [...filteredMints].sort((a, b) => {
    const ma = knownMintsMap.get(a) ?? null
    const mb = knownMintsMap.get(b) ?? null
    let result = 0
    if (sortBy === 'status') {
      result = (mb?.online === true ? 1 : 0) - (ma?.online === true ? 1 : 0)
    } else if (sortBy === 'latency') {
      const la = ma?.online === true && ma.latencyMs != null ? ma.latencyMs : Infinity
      const lb = mb?.online === true && mb.latencyMs != null ? mb.latencyMs : Infinity
      result = la - lb
    } else if (sortBy === 'trust') {
      result = listTrustScore(mb) - listTrustScore(ma)
    } else {
      result = getHostname(a).localeCompare(getHostname(b))
    }
    return sortDir === DEFAULT_SORT_DIRS[sortBy] ? result : -result
  })

  return (
    <div className="watchlist-page">
      <div className="wl-controls">
        <div className="wl-controls-top">
          <div className="wl-page-title">My Watchlist</div>
          {mints.length > 0 && (
            <div className="wl-export-links">
              <span className="wl-export-link" onClick={handleExport}>↓ JSON</span>
              <span className="wl-export-sep">·</span>
              <span className="wl-export-link" onClick={handleExportCsv}>↓ CSV</span>
            </div>
          )}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:7}}>
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
        </div>
      </div>

      {showFilters && (
        <div className="filter-panel">
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
                    <input type="radio" name="wl-filter-status" checked={pendingFilters.status === s} onChange={() => setPendingFilters(p => ({ ...p, status: s }))} />
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
                  <button key={age} type="button" className={`filter-pill${pendingFilters.mintAges.includes(age) ? ' active' : ''}`}
                    onClick={() => setPendingFilters(p => ({ ...p, mintAges: p.mintAges.includes(age) ? p.mintAges.filter(a => a !== age) : [...p.mintAges, age] }))}
                  >{age}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="filter-group" style={{ marginBottom: 10 }}>
            <div className="filter-group-label">NUT support</div>
            <div className="filter-nut-grid">
              {NUT_FILTER_KEYS.map(key => (
                <button key={key} type="button" className={`filter-nut-chip${pendingFilters.requiredNuts.includes(key) ? ' active' : ''}`}
                  onClick={() => setPendingFilters(p => ({ ...p, requiredNuts: p.requiredNuts.includes(key) ? p.requiredNuts.filter(n => n !== key) : [...p.requiredNuts, key] }))}
                >NUT-{key.padStart(2, '0')}</button>
              ))}
            </div>
          </div>

          <div className="filter-footer">
            <div className="filter-count">Showing <strong>{filteredMints.length}</strong> of <strong>{mints.length}</strong> mints</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="filter-reset-btn" onClick={() => { setPendingFilters(DEFAULT_FILTERS); setActiveFilters(DEFAULT_FILTERS) }}>Reset filters</button>
              <button type="button" className="filter-apply-btn" onClick={() => { setActiveFilters(pendingFilters); setShowFilters(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Apply filter</button>
            </div>
          </div>
        </div>
      )}

      {mints.length === 0 ? (
        <div className="wl-empty">
          <div className="wl-empty-icon"><IcRadar /></div>
          <div className="wl-empty-title">Nothing on radar</div>
          <div className="wl-empty-sub">Watch mints from the Dashboard to track them here</div>
        </div>
      ) : (
        <>
          <div className="wl-grid">
            {sortedFiltered.slice(0, visibleCount).map(url => (
              <WatchlistCard
                key={url}
                url={url}
                knownMint={knownMintsMap.get(url) ?? null}
                isSelected={selectedUrls.has(url)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
          <div style={{fontSize:13,color:'var(--text3)',textAlign:'center',marginTop:16,fontFamily:'var(--font-mono)'}}>
            Showing {Math.min(visibleCount, sortedFiltered.length)} of {sortedFiltered.length}
          </div>
          {visibleCount < sortedFiltered.length && (
            <div ref={sentinelRef} style={{height:1}} />
          )}
        </>
      )}

      {selectedUrls.size >= 1 && (
        <div className="cmp-bar">
          <span className="cmp-bar-text">Selected: {selectedUrls.size} mints</span>
          {selectedUrls.size >= 2 && (
            <button type="button" className="cmp-bar-btn primary" onClick={() => setShowComparison(true)}>Compare</button>
          )}
          <button
            type="button"
            className="cmp-bar-btn danger"
            onClick={() => {
              selectedUrls.forEach(url => { void removeMintFromStore(url) })
              setSelectedUrls(new Set())
            }}
          >Remove from watchlist</button>
          <button type="button" className="cmp-bar-btn" onClick={() => setSelectedUrls(new Set())}>Clear selection</button>
        </div>
      )}

      {showComparison && selectedMints.length >= 2 && (
        <ComparisonModal mints={selectedMints} onClose={() => setShowComparison(false)} />
      )}

      <div className="wl-footer">Watchlist is stored locally in your browser. When logged in with Nostr, it is also synced as an encrypted event (NIP-44) to Nostr relays for cross-device access. Mint URLs are included in encrypted alert DMs when a watched mint goes offline.</div>
    </div>
  )
}
