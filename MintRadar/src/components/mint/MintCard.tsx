import type { MouseEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMintHoverPrefetch } from '@/hooks/useMintHoverPrefetch'
import { usePendingAutoWatch } from '@/hooks/usePendingAutoWatch'
import './WatchLoginModal.css'
import { Zap } from 'lucide-react'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { IcShield } from '@/components/mint/IcShield'
import { IcStar } from '@/components/mint/IcStar'
import { InfoTooltip } from '@/components/InfoTooltip'
import type { KnownMint } from '@/hooks/useKnownMints'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { useAuthStore } from '@/stores/auth.store'
import { useUserRelays } from '@/hooks/useUserRelays'
import { displayName as mintDisplayName, isNewMint, cardLatencyLabel, cardLatencyLocationSuffix, cardLightningLabel, uptimeColor, formatTimeAgo } from '@/utils/mintFormatting'
import { isTestMint } from '@/constants/testMints'
import { db } from '@/db'
import { resolveNotificationRelays, syncSubscribeToServer, syncUnsubscribeFromServer } from '@/core/nostr/notificationSubscription'

const IcBellDown = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M6 1.2C4.6 1.2 3.5 2.4 3.5 3.9V5.6C3.5 6.3 3.2 6.9 2.8 7.3H9.2C8.8 6.9 8.5 6.3 8.5 5.6V3.9C8.5 2.4 7.4 1.2 6 1.2Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
    <path d="M6 7.3V10.3M6 10.3L4.7 9M6 10.3L7.3 9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IcBellUp = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M6 4.7C4.6 4.7 3.5 5.9 3.5 7.4V9.1C3.5 9.8 3.2 10.4 2.8 10.8H9.2C8.8 10.4 8.5 9.8 8.5 9.1V7.4C8.5 5.9 7.4 4.7 6 4.7Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
    <path d="M6 4.7V1.7M6 1.7L4.7 3M6 1.7L7.3 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

// Shared mint card used on both the Dashboard grid and the Watchlist grid.
export function MintCard({
  mint,
  onCompare,
  showNotifyToggles,
  sameOperatorUrls,
}: {
  mint: KnownMint
  onCompare?: (url: string) => void
  showNotifyToggles?: boolean
  // Other tracked mint URLs sharing this mint's /v1/info pubkey — see
  // groupMintsByPubkey() in mintFormatting.ts. Renders a "Same operator" badge
  // in the pill row; cards are never merged, only labeled.
  sameOperatorUrls?: string[]
}) {
  const navigate = useNavigate()
  const { onMintPointerEnter, onMintPointerLeave } = useMintHoverPrefetch()
  const mints = useWatchlistStore(state => state.mints)
  const addMint = useWatchlistStore(state => state.addMint)
  const removeMint = useWatchlistStore(state => state.removeMint)
  const isWatched = mints.includes(mint.url)
  const profile = useAuthStore(state => state.profile)
  const isLoggedIn = profile !== null
  const [showWatchLoginModal, setShowWatchLoginModal] = useState(false)
  const autoWatch = useCallback((u: string) => {
    if (!useWatchlistStore.getState().mints.includes(u)) void addMint(u)
  }, [addMint])
  const { arm: armAutoWatch, disarm: disarmAutoWatch } = usePendingAutoWatch(mint.url, isLoggedIn, autoWatch)
  const closeWatchLoginModal = useCallback(() => {
    setShowWatchLoginModal(false)
    disarmAutoWatch()
  }, [disarmAutoWatch])
  const confirmWatchLogin = useCallback(() => {
    armAutoWatch()
    setShowWatchLoginModal(false)
    window.dispatchEvent(new CustomEvent('mintradar:open-login'))
  }, [armAutoWatch])
  useEffect(() => {
    if (!showWatchLoginModal) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeWatchLoginModal() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [showWatchLoginModal, closeWatchLoginModal])
  const { read: userReadRelays } = useUserRelays()
  const hostname = getHostname(mint.url)
  const notifyEntry = useLiveQuery(
    () => showNotifyToggles ? db.watchlist.get(mint.url) : undefined,
    [mint.url, showNotifyToggles]
  )
  const toggleNotify = (field: 'notifyOnDown' | 'notifyOnUp') => (e: MouseEvent) => {
    e.stopPropagation()
    if (!notifyEntry) return
    const nextValue = !notifyEntry[field]
    const writeAndSync = async () => {
      await db.watchlist.update(mint.url, { [field]: nextValue })

      if (!isLoggedIn) return

      const current = await db.watchlist.get(mint.url)
      if (!current) return
      if (current.notifyOnDown || current.notifyOnUp) {
        await syncSubscribeToServer({
          mintUrl: mint.url,
          notifyOnDown: current.notifyOnDown,
          notifyOnUp: current.notifyOnUp,
          relays: resolveNotificationRelays(userReadRelays),
        })
      } else {
        await syncUnsubscribeFromServer(mint.url)
      }
    }
    void writeAndSync()
  }
  const isOnline = mint.online === true
  const isOfflineDegraded = mint.degraded === true
  const displayName = mintDisplayName(mint)
  const showHost = displayName !== hostname
  const uptimePct24h = mint.uptimePct24h ?? null
  const isNew = isNewMint(mint.discoveredAt ?? null)
  const lightningLabel = cardLightningLabel(mint)
  const reliabilityBadges = (
    <>
      {isTestMint(mint.url) && (
        <span
          className="card-reliability-badge card-reliability-badge-test-mint"
          title="Not for real funds — for testing and development only"
        >
          Test mint
        </span>
      )}
      {sameOperatorUrls && sameOperatorUrls.length > 0 && (
        <span
          className="card-reliability-badge card-reliability-badge-same-op"
          title={`Same operator (pubkey) as: ${sameOperatorUrls.map(getHostname).join(', ')}. Not merged — tracked as separate mints.`}
        >
          Same op
        </span>
      )}
    </>
  )

  return (
    <>
    <div
      className={`mint-card${isOfflineDegraded ? ' offline' : ''}`}
      onClick={() => { navigate(`/mint/${encodeURIComponent(mint.url)}`) }}
      onPointerEnter={() => { onMintPointerEnter(mint.url) }}
      onPointerLeave={onMintPointerLeave}
    >
      <div className="card-top">
        <div className="card-name-row">
          <MintFavicon url={mint.url} iconUrl={mint.iconUrl ?? null} size={28} radius={6} />
          <div style={{ minWidth: 0 }}>
            <div className="card-name-line">
              <span className="card-name">{displayName}</span>
              <span
                className={`status-dot${isOnline ? ' online' : ''}`}
                style={{ background: isOnline ? 'var(--green-bright)' : 'var(--red)' }}
                title={isOnline ? 'Online' : 'Offline'}
              />
            </div>
            {showHost && <div className="card-host">{hostname}</div>}
          </div>
          <div className="card-hdr-right">
          {onCompare && isOnline && (
            <button
              type="button"
              className="card-compare-btn"
              aria-label="Compare"
              title="Compare"
              onClick={e => { e.stopPropagation(); onCompare(mint.url) }}
            >
              ⇄
            </button>
          )}
          <button
            type="button"
            className={`card-star${isLoggedIn && isWatched ? ' on' : ''}`}
            aria-label={isLoggedIn ? (isWatched ? 'Unwatch' : 'Watch') : 'Watch'}
            aria-pressed={isLoggedIn && isWatched}
            title={isLoggedIn ? (isWatched ? 'Unwatch' : 'Watch') : 'Login with Nostr to add to watchlist'}
            onClick={e => {
              e.stopPropagation()
              if (!isLoggedIn) {
                setShowWatchLoginModal(true)
                return
              }
              void (isWatched ? removeMint(mint.url) : addMint(mint.url))
            }}
          >
            <IcStar filled={isLoggedIn && isWatched} />
          </button>
          </div>
        </div>
      </div>

      <div className="card-pills">
        {mint.units && mint.units.length > 0 && (
          <span className="card-pill" style={{ fontFamily: 'var(--font-mono-data)' }}>
            {mint.units.map(u => u.toUpperCase()).join(' / ')}
          </span>
        )}
        {lightningLabel && (
          <span
            className="card-pill card-ln"
            style={{ fontFamily: 'var(--font-mono-data)', display: 'flex', alignItems: 'center', gap: 3 }}
          >
            <Zap size={10} aria-hidden />
            <span>{lightningLabel}</span>
          </span>
        )}
        {uptimePct24h !== null && (
          <span className="card-pill" style={{ color: uptimeColor(uptimePct24h), fontFamily: 'var(--font-mono-data)' }}>
            {uptimePct24h}% up 24h
          </span>
        )}
        {isOfflineDegraded ? (
          <span className="card-pill card-hdr-badge" style={{ fontWeight: 600, color: 'var(--red)', background: 'var(--red-soft)', border: '1px solid rgba(219,106,93,0.3)' }}>
            Offline 24h+
          </span>
        ) : isNew && (
          <span className="card-pill card-hdr-badge card-hdr-new" style={{ fontWeight: 600, color: '#d3a446', background: 'rgba(211,164,70,.14)', border: '1px solid rgba(211,164,70,.3)' }}>
            New
          </span>
        )}
      </div>

      <div className="card-lower">
        <div className="card-reliability-toprow">
          <div className="card-reliability-badges">{reliabilityBadges}</div>
          <div className={mint.reliabilityScore == null ? 'card-reliability-na' : 'card-reliability-label'}>
            <IcShield /><span>{mint.reliabilityScore == null ? 'Reliability n/a' : 'Reliability'}</span>
          </div>
        </div>

        <div className="card-lower-row">
        <div className="card-bottom-main">
          <div className="latency-block">
            <div className="latency-label">{isOfflineDegraded ? 'LAST SEEN' : 'LATENCY'}</div>
            {isOfflineDegraded ? (
              <div
                className="latency-value muted"
                style={mint.lastOnlineAt ? { fontSize: 15 } : { fontSize: 13, whiteSpace: 'normal', lineHeight: 1.25 }}
              >
                {mint.lastOnlineAt
                  ? formatTimeAgo(new Date(mint.lastOnlineAt))
                  : 'Never seen online'}
              </div>
            ) : isOnline && mint.latencyMs !== null ? (
              <div className="latency-value" style={{ color: 'var(--text)' }}>
                {mint.latencyMs}<span className="latency-unit">ms</span>
                {cardLatencyLocationSuffix(mint) && (
                  <span className="latency-source"> {cardLatencyLocationSuffix(mint)}</span>
                )}
              </div>
            ) : (
              <div className="latency-value muted">
                {cardLatencyLabel(mint)}
                {cardLatencyLocationSuffix(mint) && (
                  <span className="latency-source"> {cardLatencyLocationSuffix(mint)}</span>
                )}
              </div>
            )}
          </div>
          <div className="card-actions">
            {showNotifyToggles && notifyEntry && (
              <>
                <button
                  type="button"
                  className={`notify-toggle-btn${notifyEntry.notifyOnDown ? ' on' : ''}`}
                  onClick={toggleNotify('notifyOnDown')}
                >
                  <IcBellDown /><span>Down</span>
                </button>
                <button
                  type="button"
                  className={`notify-toggle-btn${notifyEntry.notifyOnUp ? ' on' : ''}`}
                  onClick={toggleNotify('notifyOnUp')}
                >
                  <IcBellUp /><span>Up</span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="card-reliability">
          {mint.reliabilityScore != null && (
            <div
              className="card-reliability-score"
              style={{ color: mint.reliabilityScore >= 70 ? 'var(--green-bright)' : mint.reliabilityScore >= 40 ? 'var(--amber)' : 'var(--red)' }}
            >
              {mint.reliabilityScore}
            </div>
          )}
          {(mint.reviewCount ?? 0) > 0 && mint.reviewAvgRating != null ? (
            <span className="card-reliability-rating">
              <span className="card-reliability-star">★</span>
              <span className="card-reliability-rating-val">{mint.reviewAvgRating.toFixed(1)}</span>
              <span className="card-reliability-rating-n">({mint.reviewCount})</span>
              {mint.reviewSurge && (
                <InfoTooltip
                  className="card-review-surge-flag"
                  tone="warn"
                  width={200}
                  iconSize={10}
                  label="Recent review surge"
                  text="This mint's review count grew unusually fast recently — worth a closer look before trusting the rating."
                />
              )}
            </span>
          ) : (
            <span className="card-reliability-no-reviews">No reviews yet</span>
          )}
        </div>
        </div>
      </div>
    </div>
      {showWatchLoginModal && (
        <div
          className="rv-modal-overlay"
          onClick={e => { e.stopPropagation(); closeWatchLoginModal() }}
        >
          <div className="rv-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Watch this mint">
            <div className="rv-modal-head">
              <div className="rv-modal-heading">
                <div className="rv-modal-title">Watch this mint</div>
                <div className="rv-modal-sub">
                  Log in with Nostr to add it to your watchlist. Your list syncs over Nostr and you'll get a message if this mint goes offline or comes back online.
                </div>
              </div>
              <button type="button" className="rv-modal-close" onClick={e => { e.stopPropagation(); closeWatchLoginModal() }} aria-label="Close">×</button>
            </div>
            <div className="rv-actions">
              <button type="button" className="rv-btn-cancel" onClick={e => { e.stopPropagation(); closeWatchLoginModal() }}>Cancel</button>
              <button type="button" className="rv-btn-submit" onClick={e => { e.stopPropagation(); confirmWatchLogin() }}>⚡ Login via Nostr</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
