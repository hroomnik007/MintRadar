import { reviewSurgeText, sameOperatorText, TEST_MINT_TEXT } from '@/utils/tooltipTexts'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { IcClose } from '@/components/IcClose'
import { Link } from 'react-router-dom'
import { useMintHoverPrefetch } from '@/hooks/useMintHoverPrefetch'
import { usePendingAutoWatch } from '@/hooks/usePendingAutoWatch'
import { useModalFocus } from '@/hooks/useModalFocus'
import './WatchLoginModal.css'
import { Zap, ArrowLeftRight } from 'lucide-react'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { UptimeBars } from '@/components/mint/UptimeBars'
import { IcStar } from '@/components/mint/IcStar'
import { InfoTooltip } from '@/components/InfoTooltip'
import type { KnownMint } from '@/hooks/useKnownMints'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { useAuthStore } from '@/stores/auth.store'
import { displayName as mintDisplayName, shouldShowHostLine, isNewMint, cardLatencyLabel, cardLightningLabel, latencyColor, isUptime30dLow, uptime30dShown, formatUptime30d, formatTimeAgo, statusDotColor, mintStatusLabel } from '@/utils/mintFormatting'
import { mintStatus } from '@/utils/mintStatus'
import { isTestMint } from '@/constants/testMints'
import { sortUnits } from '@/utils/sortUnits'

// MintCard is on the home page, so what pulls in Dexie and the relay code (the Watchlist alerts, unwatch with its
// subscription cancel) is loaded on use, not with the card (src/core/nostr/lazy.ts). The Watchlist page imports the
// alerts statically, so they are ready by the time its cards render.
const WatchAlerts = lazy(() => import('@/components/mint/NotifyStrip').then(m => ({ default: m.WatchAlerts })))
const removeWatchedMint = (url: string, name: string) =>
  import('@/core/nostr/removeWatchedMint').then(m => m.removeWatchedMint(url, name))

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

// The mint card of the Mints page and the Watchlist (there with its alerts).
export function MintCard({
  mint,
  onCompare,
  showAlerts,
  sameOperatorUrls,
  duplicateDisplayNames,
}: {
  mint: KnownMint
  onCompare?: (url: string) => void
  /** Watchlist: the Alerts switch and "More alerts" at the bottom of the card. */
  showAlerts?: boolean
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
  // Archived: the backend stopped probing the mint after a long outage. The card says "Archived" (muted,
  // not the red "Degraded"): it is a state of the listing, not a fresh failure. Still dimmed like a degraded card.
  const isArchived = mint.archived === true
  // One status rule with the wallet API (utils/mintStatus.ts): the dot title says "Degraded" for a
  // degraded mint, the same word as its badge.
  const statusWord = mintStatusLabel(mintStatus(mint))
  // Offline (24h+) cards are not dimmed with opacity; status colours are muted towards a text token instead.
  const offlineTone = (color: string, base: string) =>
    isOfflineDegraded ? `color-mix(in srgb, ${color} 50%, ${base})` : color
  // Latency is coloured only when slow (latencyColor, the list view's rule); the error tone is lifted like the chip's.
  const latencyTone = (ms: number) => {
    const c = latencyColor(ms)
    return c === 'var(--slow)' ? 'color-mix(in srgb, var(--red) 85%, var(--text))' : c
  }
  const displayName = mintDisplayName(mint, duplicateDisplayNames)
  const starLabel = isLoggedIn && isWatched ? `Remove ${displayName} from watchlist` : `Add ${displayName} to watchlist`
  const showHost = shouldShowHostLine(mint, duplicateDisplayNames)
  const isNew = isNewMint(mint.discoveredAt ?? null)
  const lightningLabel = cardLightningLabel(mint)
  const reliabilityBadges = (
    <>
      {isTestMint(mint.url) && (
        <InfoTooltip text={TEST_MINT_TEXT}>
          <span className="card-reliability-badge card-reliability-badge-test-mint">Test mint</span>
        </InfoTooltip>
      )}
      {sameOperatorUrls && sameOperatorUrls.length > 0 && (
        <InfoTooltip
          width={260}
          text={sameOperatorText(sameOperatorUrls.map(getHostname))}
        >
          <span className="card-reliability-badge card-reliability-badge-same-op">Same op</span>
        </InfoTooltip>
      )}
    </>
  )

  // Reliability readout (2026-11-19 redesign, phase 3): the condensed number in its band colour and one word under it.
  const score = mint.reliabilityScore
  const scoreColor = score == null ? 'var(--text3)' : offlineTone(score >= 70 ? 'var(--green-bright)' : score >= 40 ? 'var(--amber)' : 'var(--red)', 'var(--text3)')
  // The state (Offline / Degraded) is said once, in the card foot; the score keeps its band word (greyed when offline).
  const scoreWord = score == null ? 'No score yet' : score >= 70 ? 'High' : score >= 40 ? 'Moderate' : 'Low'
  const units = mint.units && mint.units.length > 0 ? sortUnits(mint.units).join(', ') : null
  const lightningText = lightningLabel ? lightningLabel.replace(/^LN/, 'Lightning') : null
  const uptime24h = uptime30dShown(mint.uptimePct24hExact, mint.uptimePct24h)
  const lowUptime24h = isUptime30dLow(uptime24h)
  const stateBadge = isArchived && !isOnline ? (
    <span className="card-pill card-hdr-badge card-hdr-archived" style={{ fontWeight: 600, color: 'var(--text2)', background: 'var(--bg3)', border: '1px solid var(--border2)' }}>Archived</span>
  ) : isNew ? (
    <span className="card-pill card-hdr-badge card-hdr-new" style={{ fontWeight: 600, color: 'color-mix(in srgb, var(--amber) 80%, var(--text))', background: 'var(--amber-soft)', border: '1px solid var(--amber-soft-strong)' }}>New</span>
  ) : null
  const hasBadges = stateBadge !== null || isTestMint(mint.url) || (sameOperatorUrls?.length ?? 0) > 0

  return (
    <>
    <div
      className={`mint-card${isOfflineDegraded ? ' offline' : ''}`}
      onPointerEnter={() => { onMintPointerEnter(mint.url) }}
      onPointerLeave={onMintPointerLeave}
    >
      <div className="card-top">
        <div className="card-name-row">
          <MintFavicon url={mint.url} iconUrl={mint.iconUrl ?? null} size={36} radius={9} className={isOfflineDegraded ? 'card-avatar-offline' : ''} />
          <div className="card-id">
            <div className="card-name-line">
              {/* Stretched link: its ::after covers the whole card (see .card-link in Dashboard.css), so the
                  card opens with middle/ctrl/cmd-click and "copy link address". Buttons and chips with a
                  title sit above the overlay (z-index: 1) and are not nested inside the <a>. */}
              <Link className="card-link" to={`/mint/${encodeURIComponent(mint.url)}`}>
                <span className="card-name" title={mint.nameFull ?? displayName}>{displayName}</span>
              </Link>
              {/* Watch star right after the name (owner, 2026-11-18), not next to Compare. */}
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
            {showHost && <div className="card-host" title={hostname}>{hostname}</div>}
          </div>
          <div className="card-reliability">
            <div className={`card-reliability-score${score == null ? ' card-reliability-score-na' : ''}`} style={{ color: scoreColor }}>
              {score ?? '–'}
            </div>
            <div className={score == null ? 'card-reliability-na' : 'card-reliability-label'}>{scoreWord}</div>
          </div>
        </div>
      </div>

      {/* The lower block is pinned to the bottom of the card, so cards in one grid row line up whether or not they carry
          a badges row. */}
      <div className="card-lower">
      {/* The last 24 hours, one bar per hour (owner 2026-11-22); Mint Detail keeps the 30 daily bars. */}
      {mint.uptimeHourly24 && (
        <div className="card-trace">
          <UptimeBars days={mint.uptimeHourly24} unit="hour" />
          <div className="uptime-scale" aria-hidden="true"><span>24 h</span><span>Now</span></div>
        </div>
      )}

      <dl className="card-facts">
        <div className="latency-block">
          <dt className="latency-label">{isOfflineDegraded ? 'Last seen' : 'Latency'}</dt>
          {isOfflineDegraded ? (
            <dd className="latency-value muted">
              {mint.lastOnlineAt ? formatTimeAgo(new Date(mint.lastOnlineAt)) : 'Never seen online'}
            </dd>
          ) : isOnline && mint.latencyMs !== null ? (
            <dd className="latency-value" style={{ color: latencyTone(mint.latencyMs) }}>
              {mint.latencyMs}<span className="latency-unit">ms</span>
            </dd>
          ) : (
            <dd className="latency-value muted">{cardLatencyLabel(mint)}</dd>
          )}
        </div>
        <div>
          <dt>Uptime 24 h</dt>
          {/* The last 24 hours since 2026-11-22 (owner; it was the 30-day figure, which stays on Mint Detail): one decimal,
              rounded down, never 100 with a failed probe. Below the 30-day gate's threshold it is ochre, as before. */}
          <dd className="card-fact-value" data-testid="card-uptime-24h" data-low={lowUptime24h ? 'true' : undefined} style={lowUptime24h ? { color: offlineTone('var(--med)', 'var(--text2)') } : undefined}>
            {uptime24h == null ? '–' : <>{formatUptime30d(uptime24h)}<span className="latency-unit">%</span></>}
          </dd>
        </div>
        <div className="card-fact-reviews">
          <dt>Reviews</dt>
          {(mint.reviewCount ?? 0) > 0 && mint.reviewAvgRating != null ? (
            <dd className="card-reliability-rating">
              <span className="card-reliability-star" aria-hidden="true">★</span>
              <span className="card-reliability-rating-val">{mint.reviewAvgRating.toFixed(1)}</span>
              <span className="card-reliability-rating-n">({mint.reviewCount})</span>
              {mint.reviewSurge && (
                <InfoTooltip
                  className="card-review-surge-flag"
                  tone="warn"
                  width={200}
                  iconSize={12}
                  label="Recent review surge"
                  text={reviewSurgeText()}
                />
              )}
            </dd>
          ) : (
            <dd className="card-reliability-no-reviews">None yet</dd>
          )}
        </div>
      </dl>

      <div className="card-foot">
        <span className="card-state">
          <span
            className={`status-dot${isOnline ? ' online' : ''}`}
            style={{ background: statusDotColor(statusWord) }}
            aria-hidden="true"
          />
          <span className="card-state-word" style={isOfflineDegraded ? { color: 'color-mix(in srgb, var(--red) 65%, var(--text))', fontWeight: 600 } : undefined}>{statusWord}</span>
        </span>
        {/* State and identity badges sit in the foot, so a badge never makes one card taller than the next. */}
        {hasBadges && <span className="card-pills">{stateBadge}{reliabilityBadges}</span>}
        {(units || lightningText) && (
          <span className="card-units">
            {units}
            {units && lightningText ? ', ' : ''}
            {lightningText && <span className="card-ln">{lightningText}</span>}
          </span>
        )}
        {onCompare && isOnline && (
          <button
            type="button"
            className="card-compare-btn"
            aria-label={`Compare ${displayName}`}
            title={`Compare ${displayName}`}
            onClick={e => { e.stopPropagation(); onCompare(mint.url) }}
          >
            <ArrowLeftRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      </div>

      {showAlerts && (
        <Suspense fallback={null}>
          <WatchAlerts mintUrl={mint.url} name={displayName} />
        </Suspense>
      )}
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
              <button type="button" className="rv-modal-close" onClick={e => { e.stopPropagation(); closeWatchLoginModal() }} aria-label="Close"><IcClose /></button>
            </div>
            <div className="rv-actions">
              <button type="button" className="rv-btn-cancel" onClick={e => { e.stopPropagation(); closeWatchLoginModal() }}>Cancel</button>
              <button type="button" className="rv-btn-submit rv-btn-login" onClick={e => { e.stopPropagation(); confirmWatchLogin() }}><Zap size={14} strokeWidth={2.2} aria-hidden="true" /> Log in with Nostr</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
