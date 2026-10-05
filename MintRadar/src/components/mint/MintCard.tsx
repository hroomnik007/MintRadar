import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMintHoverPrefetch } from '@/hooks/useMintHoverPrefetch'
import { usePendingAutoWatch } from '@/hooks/usePendingAutoWatch'
import { useModalFocus } from '@/hooks/useModalFocus'
import './WatchLoginModal.css'
import { Zap } from 'lucide-react'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { IcShield } from '@/components/mint/IcShield'
import { IcStar } from '@/components/mint/IcStar'
import { InfoTooltip } from '@/components/InfoTooltip'
import type { KnownMint } from '@/hooks/useKnownMints'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { useAuthStore } from '@/stores/auth.store'
import { displayName as mintDisplayName, shouldShowHostLine, isNewMint, cardLatencyLabel, cardLatencyLocationSuffix, cardLightningLabel, uptimeColor, formatTimeAgo } from '@/utils/mintFormatting'
import { isTestMint } from '@/constants/testMints'
import { NotifyStrip } from '@/components/mint/NotifyStrip'
import { removeWatchedMint } from '@/core/nostr/removeWatchedMint'
import { sortUnits } from '@/utils/sortUnits'

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

// Shared mint card used on both the Dashboard grid and the Watchlist grid.
export function MintCard({
  mint,
  onCompare,
  showNotifyToggles,
  sameOperatorUrls,
  duplicateDisplayNames,
}: {
  mint: KnownMint
  onCompare?: (url: string) => void
  showNotifyToggles?: boolean
  // Other tracked mint URLs sharing this mint's /v1/info pubkey — see
  // groupMintsByPubkey() in mintFormatting.ts. Renders a "Same operator" badge
  // in the pill row; cards are never merged, only labeled.
  sameOperatorUrls?: string[]
  // From computeDuplicateMintNames() over the full known-mints list — lets
  // displayName()/shouldShowHostLine() tell a genuine sibling name collision
  // (e.g. two "aleafnd.org" mints) apart from a mint whose own name simply
  // happens to be a domain-suffix of its hostname with no real collision
  // (e.g. name="cashu.chat", url="https://mint.cashu.chat"). Omitted →
  // callers without the full list (rare) get the safe default: no fallback.
  duplicateDisplayNames?: ReadonlySet<string> | undefined
}) {
  const navigate = useNavigate()
  const { onMintPointerEnter, onMintPointerLeave } = useMintHoverPrefetch()
  const mints = useWatchlistStore(state => state.mints)
  const addMint = useWatchlistStore(state => state.addMint)
  const isWatched = mints.includes(mint.url)
  const profile = useAuthStore(state => state.profile)
  const isLoggedIn = profile !== null
  const [showWatchLoginModal, setShowWatchLoginModal] = useState(false)
  const autoWatch = useCallback((u: string) => {
    if (!useWatchlistStore.getState().mints.includes(u)) void addMint(u)
  }, [addMint])
  const { arm: armAutoWatch, disarm: disarmAutoWatch } = usePendingAutoWatch(mint.url, isLoggedIn, autoWatch)
  const dialogRef = useModalFocus()
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
  const hostname = getHostname(mint.url)
  const isOnline = mint.online === true
  const isOfflineDegraded = mint.degraded === true
  // Offline (24h+) cards are not dimmed with opacity; status colours are muted towards a text token instead.
  const offlineTone = (color: string, base: string) =>
    isOfflineDegraded ? `color-mix(in srgb, ${color} 50%, ${base})` : color
  // The red (<80%) "up 24h" chip text is lifted towards --text so it reaches 4.5:1 on the card surface.
  const upChipColor = (pct: number) => {
    const c = uptimeColor(pct)
    if (isOfflineDegraded) return offlineTone(c, 'var(--text2)')
    return c === 'var(--slow)' ? 'color-mix(in srgb, var(--red) 85%, var(--text))' : c
  }
  const displayName = mintDisplayName(mint, duplicateDisplayNames)
  const starLabel = isLoggedIn && isWatched ? `Remove ${displayName} from watchlist` : `Add ${displayName} to watchlist`
  const showHost = shouldShowHostLine(mint, duplicateDisplayNames)
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
      {mint.demoNotice === true && mint.demoNoticePhrase && !isTestMint(mint.url) && mint.demoNoticePhrase !== "for demonstration purposes" && (
        <span
          className="card-reliability-badge card-reliability-badge-demo"
          title={`This mint's own notice says: “${mint.demoNoticePhrase}”.`}
        >
          Demo
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
          <MintFavicon url={mint.url} iconUrl={mint.iconUrl ?? null} size={28} radius={6} className={isOfflineDegraded ? 'card-avatar-offline' : ''} />
          <div style={{ minWidth: 0 }}>
            <div className="card-name-line">
              <span className="card-name" title={mint.nameFull ?? displayName}>{displayName}</span>
              <span
                className={`status-dot${isOnline ? ' online' : ''}`}
                style={{ background: isOnline ? 'var(--green-bright)' : 'var(--red)' }}
                title={isOnline ? 'Online' : 'Offline'}
              />
            </div>
            {showHost && <div className="card-host" title={hostname}>{hostname}</div>}
          </div>
          <div className="card-hdr-right">
          {onCompare && isOnline && (
            <button
              type="button"
              className="card-compare-btn"
              aria-label={`Compare ${displayName}`}
              title={`Compare ${displayName}`}
              onClick={e => { e.stopPropagation(); onCompare(mint.url) }}
            >
              ⇄
            </button>
          )}
          <button
            type="button"
            className={`card-star${isLoggedIn && isWatched ? ' on' : ''}`}
            aria-label={starLabel}
            aria-pressed={isLoggedIn && isWatched}
            title={starLabel}
            onClick={e => {
              e.stopPropagation()
              if (!isLoggedIn) {
                setShowWatchLoginModal(true)
                return
              }
              void (isWatched ? removeWatchedMint(mint.url, displayName) : addMint(mint.url))
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
            {sortUnits(mint.units).map(u => u.toUpperCase()).join(' / ')}
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
          <span className="card-pill" style={{ color: upChipColor(uptimePct24h), fontFamily: 'var(--font-mono-data)' }}>
            {uptimePct24h}% up 24h
          </span>
        )}
        {isOfflineDegraded ? (
          <span className="card-pill card-hdr-badge" style={{ fontWeight: 600, color: 'color-mix(in srgb, var(--red) 65%, var(--text))', background: 'var(--red-soft)', border: '1px solid var(--red-soft-strong)' }}>
            Offline 24h+
          </span>
        ) : isNew && (
          <span className="card-pill card-hdr-badge card-hdr-new" style={{ fontWeight: 600, color: 'color-mix(in srgb, var(--amber) 80%, var(--text))', background: 'var(--amber-soft)', border: '1px solid var(--amber-soft-strong)' }}>
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
          </div>
        </div>

        <div className="card-reliability">
          {mint.reliabilityScore != null && (
            <div
              className="card-reliability-score"
              style={{ color: offlineTone(mint.reliabilityScore >= 70 ? 'var(--green-bright)' : mint.reliabilityScore >= 40 ? 'var(--amber)' : 'var(--red)', 'var(--text3)') }}
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

      {showNotifyToggles && <NotifyStrip mintUrl={mint.url} name={displayName} />}
    </div>
      {showWatchLoginModal && (
        <div
          className="rv-modal-overlay"
          onClick={e => { e.stopPropagation(); closeWatchLoginModal() }}
        >
          <div className="rv-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Watch this mint" ref={dialogRef}>
            <div className="rv-modal-head">
              <div className="rv-modal-heading">
                <div className="rv-modal-title">Watch this mint</div>
                <div className="rv-modal-sub">
                  Log in with Nostr to add it to your watchlist. Your list syncs over Nostr. You can then turn on an optional Nostr DM for this mint when it goes offline or comes back online.
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
