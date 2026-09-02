import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { verifyEvent, nip19 } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { sharedPool } from '@/core/nostr/pool'
import { useFollowRecommendations, FOLLOW_RELAYS } from '@/hooks/useFollowRecommendations'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { useKnownMints, type KnownMint } from '@/hooks/useKnownMints'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { useAuthStore } from '@/stores/auth.store'
import { MintCard } from '@/components/mint/MintCard'
import { mintAgeBadge } from '@/utils/mintFormatting'
import './Watchlist.css'

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

function listTrustScore(mint: KnownMint | null): number {
  if (!mint || mint.online !== true) return 0
  return mint.trustScore ?? 0
}


function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

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

const DEFAULT_SORT_DIRS: Record<'name' | 'latency' | 'rating' | 'trust', 'asc' | 'desc'> = { rating: 'desc', latency: 'asc', trust: 'desc', name: 'asc' }

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

interface ProfileInfo { name: string | undefined; picture: string | undefined }

function FollowRecommendations({ pubkey, watchlistUrls, knownMintsData }: {
  pubkey: string
  watchlistUrls: string[]
  knownMintsData: KnownMint[] | undefined
}) {
  const navigate = useNavigate()
  const addMint = useWatchlistStore(s => s.addMint)
  const { data, isLoading } = useFollowRecommendations(pubkey)

  const knownMap = useMemo(() => {
    const m = new Map<string, KnownMint>()
    if (knownMintsData) for (const mint of knownMintsData) m.set(mint.url, mint)
    return m
  }, [knownMintsData])

  const watchlistSet = useMemo(() => new Set(watchlistUrls), [watchlistUrls])

  const filteredRecs = useMemo(() => {
    if (!data) return []
    return data.recs
      .filter(r => !watchlistSet.has(r.url))
      .filter(r => knownMap.get(r.url)?.online === true)
      .slice(0, 3)
  }, [data, watchlistSet, knownMap])

  const allRecommenderPubkeys = useMemo(
    () => [...new Set(filteredRecs.flatMap(r => r.recommenders))],
    [filteredRecs]
  )

  const { data: profiles } = useQuery({
    queryKey: ['nostr-profiles-batch', [...allRecommenderPubkeys].sort().join(',')],
    queryFn: async () => {
      const events = await Promise.race([
        sharedPool.querySync(FOLLOW_RELAYS, { kinds: [0], authors: allRecommenderPubkeys }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
      ]).catch(() => [] as NostrEvent[])
      const map: Record<string, ProfileInfo> = {}
      for (const ev of (events as NostrEvent[])) {
        if (!verifyEvent(ev)) continue
        try {
          const content = JSON.parse(ev.content) as Record<string, unknown>
          const name = (content['display_name'] ?? content['name']) as string | undefined
          const picture = content['picture'] as string | undefined
          map[ev.pubkey] = { name, picture }
        } catch { /* ignore */ }
      }
      return map
    },
    enabled: allRecommenderPubkeys.length > 0,
    staleTime: 10 * 60 * 1000,
  })

  const getDisplayName = (pk: string): string => {
    const info = profiles?.[pk]
    if (info?.name) return info.name.slice(0, 14)
    try { return nip19.npubEncode(pk).slice(0, 10) + '…' } catch { return pk.slice(0, 8) + '…' }
  }

  const followCount = data?.followCount ?? 0

  return (
    <div className="wl-rec-panel">
      <div className="wl-rec-panel-header">
        <span className="wl-rec-panel-title">Recommended by Follows</span>
        <span className="wl-rec-panel-badge">NIP-87</span>
      </div>
      {!isLoading && filteredRecs.length > 0 && (
        <div className="wl-rec-panel-subheader">{filteredRecs.length} mints · from {followCount} follows</div>
      )}

      {isLoading ? (
        <div className="wl-recs-loading">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="wl-rec-skeleton">
              <div className="wl-rec-sk-avatar" />
              <div className="wl-rec-sk-lines">
                <div className="wl-rec-sk-line" style={{ width: '55%' }} />
                <div className="wl-rec-sk-line" style={{ width: '35%', marginTop: 5 }} />
              </div>
            </div>
          ))}
        </div>
      ) : filteredRecs.length === 0 ? (
        <div className="wl-recs-empty">No recommendations from your follows yet</div>
      ) : (
        <div className="wl-recs-list">
          {filteredRecs.map(({ url, recommenders }) => {
            const mint = knownMap.get(url)
            const hostname = (() => { try { return new URL(url).hostname } catch { return url } })()
            const name = mint?.name ?? hostname
            const score = mint?.trustScore ?? null
            const scoreColor = score == null ? 'var(--text3)' : score >= 70 ? '#4ade80' : score >= 40 ? '#f59e0b' : '#E24B4A'
            const followerNames = recommenders.slice(0, 3).map(pk => getDisplayName(pk)).join(', ')
            return (
              <div key={url} className="wl-rec-row" onClick={() => navigate(`/mint/${encodeURIComponent(url)}`)}>
                <MintFavicon url={url} iconUrl={mint?.iconUrl ?? null} size={28} radius={6} />
                <div className="wl-rec-body">
                  <div className="wl-rec-name">{name}</div>
                  <div className="wl-rec-url">{hostname}</div>
                  <div className="wl-rec-followers-row">
                    <div className="wl-rec-avatars-overlap">
                      {recommenders.slice(0, 3).map(pk => {
                        const pic = profiles?.[pk]?.picture
                        const initial = (profiles?.[pk]?.name ?? pk).slice(0, 1).toUpperCase()
                        return (
                          <div key={pk} className="wl-rec-avatar-overlap" title={getDisplayName(pk)}>
                            {pic ? (
                              <img src={pic} alt={initial} className="wl-rec-avatar-img" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement | null)?.removeAttribute('hidden') }} />
                            ) : null}
                            <span style={pic ? { display: 'none' } : undefined}>{initial}</span>
                          </div>
                        )
                      })}
                    </div>
                    {followerNames && <span className="wl-rec-follower-names">{followerNames}</span>}
                  </div>
                </div>
                <div className="wl-rec-right">
                  {score != null && (
                    <span className="wl-rec-trust" style={{ color: scoreColor, borderColor: scoreColor + '44', background: scoreColor + '11' }}>{score}%</span>
                  )}
                  <span className="wl-rec-online-dot">●</span>
                  <button
                    type="button"
                    className="wl-rec-watch-btn"
                    onClick={e => { e.stopPropagation(); void addMint(url) }}
                  >+ Watch</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Watchlist() {
  const [sortBy, setSortBy] = useState<'name' | 'latency' | 'trust' | 'rating'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Filter state
  const [showFilters, setShowFilters] = useState(false)
  const [pendingFilters, setPendingFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [activeFilters, setActiveFilters] = useState<FilterState>(DEFAULT_FILTERS)

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

  const profile = useAuthStore(state => state.profile)

  const { data: knownMintsData, isLoading: knownLoading } = useKnownMints()
  const knownMintsMap = useMemo(() => new Map(knownMintsData?.map(m => [m.url, m]) ?? []), [knownMintsData])

  const activeFilterCount = countActiveFilters(activeFilters)
  const filteredMints = useMemo(() => {
    return applyFilters(mints, knownMintsMap, activeFilters)
  }, [mints, knownMintsMap, activeFilters])

  const sentinelRef = useRef<HTMLDivElement>(null)
  // Pagination extra is keyed by the current list content + sort, so it
  // resets automatically when the visible list changes — no reset effect needed.
  const [extraVisible, setExtraVisible] = useState<{ key: string; n: number }>({ key: '', n: 0 })
  const listKey = `${sortBy}|${sortDir}|${filteredMints.join('\n')}`
  const visibleCount = 20 + (extraVisible.key === listKey ? extraVisible.n : 0)

  useEffect(() => {
    void loadFromDb()
  }, [loadFromDb])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) {
        setExtraVisible(prev => ({ key: listKey, n: prev.key === listKey ? prev.n + 20 : 20 }))
      }
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [listKey])

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).type === 'mintradar:escape') {
        setShowFilters(false)
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
            onClick={() => window.dispatchEvent(new CustomEvent('mintradar:open-login'))}
          >
            ⚡ Login via Nostr
          </button>
        </div>
      </div>
    )
  }

  const sortedFiltered = [...filteredMints].sort((a, b) => {
    const ma = knownMintsMap.get(a) ?? null
    const mb = knownMintsMap.get(b) ?? null
    let result: number
    if (sortBy === 'rating') {
      const ra = ma?.reviewAvgRating ?? -1
      const rb = mb?.reviewAvgRating ?? -1
      result = rb - ra
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
        <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}>
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
            {(['rating', 'latency', 'name', 'trust'] as const).map(s => (
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
                  {activeFilters.status === 'online' ? 'Online' : 'Offline'}
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
            <div className="filter-group filter-box">
              <div className="filter-group-label">Status</div>
              <div className="filter-radio-group">
                {(['all', 'online', 'offline'] as const).map(s => (
                  <label key={s} className="filter-radio">
                    <input type="radio" name="wl-filter-status" checked={pendingFilters.status === s} onChange={() => setPendingFilters(p => ({ ...p, status: s }))} />
                    {s === 'all' ? 'All' : s === 'online' ? 'Online' : 'Offline'}
                  </label>
                ))}
              </div>
            </div>

            <div className="filter-group filter-box">
              <div className="filter-group-label">Min. Trust Score: <strong>{pendingFilters.minTrustScore}%</strong></div>
              <input
                type="range" min={0} max={100} step={5}
                value={pendingFilters.minTrustScore}
                onChange={e => setPendingFilters(p => ({ ...p, minTrustScore: parseInt(e.target.value) }))}
                className="filter-slider"
              />
            </div>

            <div className="filter-group filter-box">
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

          <div className="filter-footer">
            <div className="filter-count">Showing <strong>{filteredMints.length}</strong> of <strong>{mints.length}</strong> mints</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="filter-reset-btn" onClick={() => { setPendingFilters(DEFAULT_FILTERS); setActiveFilters(DEFAULT_FILTERS) }}>Reset filters</button>
              <button type="button" className="filter-apply-btn" onClick={() => { setActiveFilters(pendingFilters); setShowFilters(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Apply filter</button>
            </div>
          </div>
        </div>
      )}

      <div className="wl-body wl-body-two-col">
        <div className="wl-main-col">
          {knownLoading ? (
            <div className="wl-grid">
              {Array.from({ length: 9 }, (_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : mints.length === 0 ? (
            <div className="wl-empty">
              <div className="wl-empty-icon"><IcRadar /></div>
              <div className="wl-empty-title">Nothing on radar</div>
              <div className="wl-empty-sub">Watch mints from the Dashboard to track them here</div>
            </div>
          ) : (
            <>
              <div className="wl-grid">
                {sortedFiltered.slice(0, visibleCount).map(url => (
                  <MintCard
                    key={url}
                    mint={knownMintsMap.get(url) ?? {
                      url, name: null, iconUrl: null, degraded: false, online: null,
                      latencyMs: null, version: null, nutCount: null, tosUrl: null,
                      descriptionLong: null, nutsLimits: null,
                    }}
                    showNotifyToggles
                  />
                ))}
              </div>
              {visibleCount < sortedFiltered.length && (
                <div ref={sentinelRef} style={{height:1}} />
              )}
            </>
          )}
        </div>

        <div className="wl-side-col">
          <FollowRecommendations pubkey={profile.pubkey} watchlistUrls={mints} knownMintsData={knownMintsData} />
        </div>
      </div>

      {mints.length > 0 && (
        <div className="wl-showing">
          Showing {Math.min(visibleCount, sortedFiltered.length)} of {sortedFiltered.length}
        </div>
      )}

    </div>
  )
}
