import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { MintComparePicker } from '@/components/MintComparePicker'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { displayName as mintDisplayName, groupMintsByPubkey, sameOperatorUrls, computeDuplicateMintNames } from '@/utils/mintFormatting'
import { showWatchlistCount } from '@/utils/watchlistCount'
import { useLegacyNotifyNotice, LEGACY_NOTIFY_NOTICE_TEXT } from '@/hooks/useLegacyNotifyNotice'
import { parseCompareParam, buildCompareParam, resolveComparedMints } from '@/utils/compareUrlParam'
import './Watchlist.css'

// Same lazy-loading rationale as Dashboard.tsx — Recharts only loads once a
// user actually opens Compare.
const ComparisonModal = lazy(() => import('@/components/ComparisonModal').then(m => ({ default: m.ComparisonModal })))

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

interface ProfileInfo { name: string | undefined }

function FollowRecommendations({ pubkey, watchlistUrls, knownMintsData }: {
  pubkey: string
  watchlistUrls: string[]
  knownMintsData: KnownMint[] | undefined
}) {
  const navigate = useNavigate()
  const addMint = useWatchlistStore(s => s.addMint)
  const { data, isLoading, isError } = useFollowRecommendations(pubkey)

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
          map[ev.pubkey] = { name }
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

  // Loading and load errors render nothing (no flash of the empty line, no
  // error chrome). The section always sits below the card grid, so the grid
  // never moves with this data.
  if (isLoading || isError) return null

  const isEmpty = filteredRecs.length === 0

  return (
    <section className={`wl-rec-panel${isEmpty ? ' wl-rec-slim' : ''}`} aria-label="Recommended by follows">
      <div className="wl-rec-panel-header">
        <span className="wl-rec-panel-title">Recommended by follows</span>
        <span className="wl-rec-panel-badge">NIP-87</span>
      </div>
      {!isEmpty && (
        <div className="wl-rec-panel-subheader">{filteredRecs.length} mints · from {followCount} follows</div>
      )}

      {isEmpty ? (
        <span className="wl-rec-slim-text">None from your follows yet</span>
      ) : (
        <div className="wl-recs-list">
          {filteredRecs.map(({ url, recommenders }) => {
            const mint = knownMap.get(url)
            const hostname = (() => { try { return new URL(url).hostname } catch { return url } })()
            const name = mint?.name ?? hostname
            const score = mint?.reliabilityScore ?? null
            const scoreTone = score == null ? null : score >= 70 ? 'green' : score >= 40 ? 'amber' : 'red'
            const scoreColor = scoreTone === 'green' ? 'var(--accent)' : scoreTone === 'amber' ? 'var(--amber)' : scoreTone === 'red' ? 'var(--red)' : 'var(--text3)'
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
                        const initial = (profiles?.[pk]?.name ?? pk).slice(0, 1).toUpperCase()
                        return (
                          <div key={pk} className="wl-rec-avatar-overlap" title={getDisplayName(pk)}>
                            <span>{initial}</span>
                          </div>
                        )
                      })}
                    </div>
                    {followerNames && <span className="wl-rec-follower-names">{followerNames}</span>}
                  </div>
                </div>
                <div className="wl-rec-right">
                  {score != null && (
                    <span className="wl-rec-reliability" style={{ color: scoreColor, borderColor: `var(--${scoreTone}-soft-strong)`, background: `var(--${scoreTone}-soft)` }}>{score}%</span>
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
    </section>
  )
}

export default function Watchlist() {
  const navigate = useNavigate()
  const mints = useWatchlistStore(state => state.mints)
  const loadFromDb = useWatchlistStore(state => state.loadFromDb)
  const syncStatus = useWatchlistStore(state => state.syncStatus)

  const profile = useAuthStore(state => state.profile)
  const legacyNotice = useLegacyNotifyNotice(profile?.pubkey)

  const { data: knownMintsData, isLoading: knownLoading } = useKnownMints()
  const knownMintsMap = useMemo(() => new Map(knownMintsData?.map(m => [m.url, m]) ?? []), [knownMintsData])
  const pubkeyGroups = useMemo(() => groupMintsByPubkey(knownMintsData ?? []), [knownMintsData])
  const duplicateDisplayNames = useMemo(() => computeDuplicateMintNames(knownMintsData ?? []), [knownMintsData])

  // Compare feature — same ?compare=url1,url2[,url3,url4] URL persistence as
  // Dashboard.tsx (see "Compare feature" in docs/claude/stats-dashboard-watchlist-ui.md); compareBaseUrl/
  // showComparePicker are transient in-progress picker UI state only.
  const [searchParams, setSearchParams] = useSearchParams()
  const compareUrls = useMemo(() => parseCompareParam(searchParams.get('compare')), [searchParams])
  const comparedMints = useMemo(
    () => resolveComparedMints(compareUrls, knownMintsData ?? []),
    [knownMintsData, compareUrls]
  )
  const [compareBaseUrl, setCompareBaseUrl] = useState<string | null>(null)
  const [showComparePicker, setShowComparePicker] = useState(false)

  function openComparePicker(url: string) {
    setCompareBaseUrl(url)
    setShowComparePicker(true)
  }

  // Functional setSearchParams form so this stays correct even if called
  // from a handler whose closure predates a later URL change (same
  // rationale as Dashboard.tsx's closeComparisonModal).
  const closeComparisonModal = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('compare')
      return next
    }, { replace: true })
  }, [setSearchParams])

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).type !== 'mintradar:escape') return
      setShowComparePicker(false)
      closeComparisonModal()
    }
    window.addEventListener('mintradar:escape', handler)
    return () => window.removeEventListener('mintradar:escape', handler)
  }, [closeComparisonModal])

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
    // The sentinel only exists once the skeleton is gone (knownLoading / syncStatus), so those are
    // dependencies too — a list that arrived while the skeleton was up used to leave the observer
    // unattached for good ("Showing 20 of N" forever). visibleCount re-creates the observer after
    // every page: an IntersectionObserver reports only CHANGES, so a sentinel that stays in view after
    // a page was appended (e.g. browser scroll anchoring) would otherwise never load the next one.
  }, [listKey, knownLoading, syncStatus, visibleCount])

  useDocumentMeta(
    'My Watchlist - MintRadar',
    'Track your favorite Cashu mints and optionally get a Nostr DM when one goes offline or comes back online.',
    { noindex: true }
  )

  if (profile === null) {
    return (
      <div className="watchlist-page">
        <div className="wl-login-gate">
          <h2>My Watchlist</h2>
          <p>Log in with Nostr to sync your watchlist across devices. You can turn on optional Nostr DMs for a watched mint that goes offline or comes back online.</p>
          <button
            type="button"
            className="wl-add-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('mintradar:open-login'))}
          >
            ⚡ Login via Nostr
          </button>
          <div className="wl-login-hint">Your list is stored on Nostr. Optional DMs go to your Nostr identity.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="watchlist-page">
      <h1 className="sr-only">Your Cashu Mints Watchlist</h1>
      <div className="wl-body">
        <div className="wl-main-col">
          {syncStatus === 'error' && (
            <div className="wl-sync-error-banner" role="status">
              {mints.length > 0
                ? "Couldn't sync with Nostr relays — showing local data."
                : "Couldn't sync with Nostr relays — your watchlist may be out of date on this device."}
            </div>
          )}
          {knownLoading || syncStatus === 'pending' ? (
            <div className="wl-grid">
              {Array.from({ length: 9 }, (_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : mints.length === 0 ? (
            <div className="wl-empty">
              <div className="wl-empty-icon"><IcRadar /></div>
              <div className="wl-empty-title">No mints watched yet</div>
              <div className="wl-empty-sub">Add mints from the Dashboard with + Watch. Your list syncs over Nostr. Turn on Nostr DMs per mint if you want to hear when its status changes.</div>
              <button type="button" className="wl-add-btn" onClick={() => navigate('/dashboard')}>
                Go to Dashboard
              </button>
            </div>
          ) : (
            <>
              {legacyNotice.visible && (
                <div className="queued-banner queued-banner-info wl-legacy-notice" role="status">
                  <span>{LEGACY_NOTIFY_NOTICE_TEXT}</span>
                  <button type="button" className="queued-banner-dismiss" aria-label="Dismiss" onClick={legacyNotice.dismiss}>
                    ×
                  </button>
                </div>
              )}
              <p className="wl-notify-explainer">
                Optional: turn on Nostr DMs for a watched mint. You get one message when it goes down and one when it comes back (at most one of each per hour), even if this tab is closed. Your Nostr client must support private messages.
              </p>
              <div className="wl-grid">
                {orderedMints.slice(0, visibleCount).map(url => {
                  const mint = knownMintsMap.get(url) ?? {
                    url, name: null, iconUrl: null, degraded: false, online: null,
                    latencyMs: null, version: null, nutCount: null, tosUrl: null,
                    descriptionLong: null, nutsLimits: null,
                  }
                  return (
                  <MintCard
                    key={url}
                    mint={mint}
                    showNotifyToggles
                    onCompare={openComparePicker}
                    sameOperatorUrls={sameOperatorUrls(mint, pubkeyGroups)}
                    duplicateDisplayNames={duplicateDisplayNames}
                  />
                  )
                })}
              </div>
              {visibleCount < orderedMints.length && (
                <div ref={sentinelRef} style={{height:1}} />
              )}
            </>
          )}
          <FollowRecommendations pubkey={profile.pubkey} watchlistUrls={mints} knownMintsData={knownMintsData} />
        </div>

        {/* Compare picker */}
        {showComparePicker && compareBaseUrl && (() => {
          const baseMint = knownMintsMap.get(compareBaseUrl)
          const candidates = (knownMintsData ?? []).filter(m => m.url !== compareBaseUrl && m.online === true)
          return (
            <MintComparePicker
              candidates={candidates}
              baseLabel={baseMint ? mintDisplayName(baseMint, duplicateDisplayNames) : compareBaseUrl}
              duplicateDisplayNames={duplicateDisplayNames}
              onClose={() => setShowComparePicker(false)}
              onConfirm={urls => {
                setSearchParams(prev => {
                  const next = new URLSearchParams(prev)
                  next.set('compare', buildCompareParam([compareBaseUrl, ...urls]))
                  return next
                })
                setShowComparePicker(false)
              }}
            />
          )
        })()}

        {/* Comparison modal — driven by ?compare= in the URL so a result can be shared via link */}
        {comparedMints.length >= 2 && (
          <Suspense fallback={null}>
            <ComparisonModal mints={comparedMints} onClose={closeComparisonModal} />
          </Suspense>
        )}
      </div>

      {showWatchlistCount(Math.min(visibleCount, orderedMints.length), orderedMints.length) && (
        <div className="wl-showing">
          Showing {Math.min(visibleCount, orderedMints.length)} of {orderedMints.length}
        </div>
      )}

    </div>
  )
}
