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
  const mints = useWatchlistStore(state => state.mints)
  const loadFromDb = useWatchlistStore(state => state.loadFromDb)

  const profile = useAuthStore(state => state.profile)

  const { data: knownMintsData, isLoading: knownLoading } = useKnownMints()
  const knownMintsMap = useMemo(() => new Map(knownMintsData?.map(m => [m.url, m]) ?? []), [knownMintsData])

  // Watchlists are small and personal — no filter/sort controls. Show every
  // watched mint, ordered alphabetically by hostname for a stable layout.
  const orderedMints = useMemo(
    () => [...mints].sort((a, b) => getHostname(a).localeCompare(getHostname(b))),
    [mints],
  )

  const sentinelRef = useRef<HTMLDivElement>(null)
  // Pagination extra is keyed by the current list content, so it resets
  // automatically when the visible list changes — no reset effect needed.
  const [extraVisible, setExtraVisible] = useState<{ key: string; n: number }>({ key: '', n: 0 })
  const listKey = orderedMints.join('\n')
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
      </div>

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
                {orderedMints.slice(0, visibleCount).map(url => (
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
              {visibleCount < orderedMints.length && (
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
          Showing {Math.min(visibleCount, orderedMints.length)} of {orderedMints.length}
        </div>
      )}

    </div>
  )
}
