import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMintHoverPrefetch } from '@/hooks/useMintHoverPrefetch'
import { Zap } from 'lucide-react'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { IcShield } from '@/components/mint/IcShield'
import { InfoTooltip } from '@/components/InfoTooltip'
import type { KnownMint } from '@/hooks/useKnownMints'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { useAuthStore } from '@/stores/auth.store'
import { useUserRelays } from '@/hooks/useUserRelays'
import { displayName as mintDisplayName, isNewMint, cardLatencyLabel, cardLightningLabel, uptimeColor, formatTimeAgo, MIN_MEANINGFUL_REVIEWS } from '@/utils/mintFormatting'
import { isTestMint } from '@/constants/testMints'
import { db } from '@/db'
import { resolveNotificationRelays, syncSubscribeToServer, syncUnsubscribeFromServer } from '@/core/nostr/notificationSubscription'

const IcStar = ({ filled }: { filled: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
    <path d="M12 2.6l2.85 5.78 6.38.93-4.62 4.5 1.09 6.35L12 17.56 6.3 20.56l1.09-6.35L2.77 9.7l6.38-.93z"/>
  </svg>
)
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
}: {
  mint: KnownMint
  onCompare?: (url: string) => void
  showNotifyToggles?: boolean
}) {
  const navigate = useNavigate()
  const { onMintPointerEnter, onMintPointerLeave } = useMintHoverPrefetch()
  const mints = useWatchlistStore(state => state.mints)
  const addMint = useWatchlistStore(state => state.addMint)
  const removeMint = useWatchlistStore(state => state.removeMint)
  const isWatched = mints.includes(mint.url)
  const profile = useAuthStore(state => state.profile)
  const isLoggedIn = profile !== null
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
    // Local Dexie write is the source of truth for the UI. It's awaited
    // inside the async IIFE below (not fired separately) so the server
    // mirror's follow-up read can't race ahead of it.
    const writeAndSync = async () => {
      await db.watchlist.update(mint.url, { [field]: nextValue })

      if (!isLoggedIn) return

      // Best-effort server mirror. Re-read from Dexie (not the `notifyEntry`
      // React closure) for the flag that ISN'T being toggled here: if the
      // user (or an automated test) fires the Down and Up toggles in rapid
      // succession, the second click's render closure can still reflect the
      // pre-first-click state, which would send a stale combination to the
      // server. Awaiting the write above, then reading Dexie fresh, makes
      // this immune to that ordering regardless of click speed.
      const current = await db.watchlist.get(mint.url)
      if (!current) return
      // Both flags off → no preference left → remove the server row
      // entirely rather than upserting an all-false one.
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

  return (
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
          {(isOfflineDegraded || isNew || isTestMint(mint.url)) && (
            <span className="card-hdr-badges" style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {isOfflineDegraded ? (
                <span className="card-hdr-badge" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--red)', background: 'var(--red-soft)', border: '1px solid rgba(219,106,93,0.3)', borderRadius: 5, padding: '2px 7px' }}>
                  Offline 24h+
                </span>
              ) : isNew && (
                <span className="card-hdr-badge card-hdr-new" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#d3a446', background: 'rgba(211,164,70,.14)', border: '1px solid rgba(211,164,70,.3)', borderRadius: 5, padding: '2px 7px' }}>
                  New
                </span>
              )}
              {isTestMint(mint.url) && (
                <span className="card-hdr-badge card-hdr-test-mint" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--amber)', background: 'var(--amber-soft)', border: '1px solid var(--amber-soft-strong)', borderRadius: 5, padding: '2px 7px' }} title="Not for real funds — for testing and development only">
                  🧪 Test mint
                </span>
              )}
            </span>
          )}
          {isLoggedIn && (
            <button
              type="button"
              className={`card-star${isWatched ? ' on' : ''}`}
              aria-label={isWatched ? 'Unwatch' : 'Watch'}
              aria-pressed={isWatched}
              title={isWatched ? 'Unwatch' : 'Watch'}
              onClick={e => { e.stopPropagation(); void (isWatched ? removeMint(mint.url) : addMint(mint.url)) }}
            >
              <IcStar filled={isWatched} />
            </button>
          )}
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
      </div>

      <div className="card-lower">
        <div className="card-bottom-main">
          <div className="latency-block">
            <div className="latency-label">{isOfflineDegraded ? 'LAST SEEN' : 'LATENCY'}</div>
            {isOfflineDegraded ? (
              <div className="latency-value muted" style={{ fontSize: 15 }}>
                {formatTimeAgo(mint.lastCheckedAt ? new Date(mint.lastCheckedAt) : null)}
              </div>
            ) : isOnline && mint.latencyMs !== null ? (
              <div className="latency-value" style={{ color: 'var(--text)' }}>
                {mint.latencyMs}<span className="latency-unit">ms</span>
              </div>
            ) : (
              <div className="latency-value muted">{cardLatencyLabel(mint)}</div>
            )}
          </div>
          <div className="card-actions">
            {onCompare && isOnline && (
              <button
                type="button"
                className="card-compare-btn"
                onClick={e => { e.stopPropagation(); onCompare(mint.url) }}
              >
                ⇄ Compare
              </button>
            )}
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

        <div className="card-trust">
          {mint.trustScore == null ? (
            <div className="card-trust-na"><IcShield /><span>Trust n/a</span></div>
          ) : (
            <>
              <div className="card-trust-label"><IcShield /><span>Trust</span></div>
              <div
                className="card-trust-score"
                style={{ color: mint.trustScore >= 70 ? 'var(--green-bright)' : mint.trustScore >= 40 ? 'var(--amber)' : 'var(--red)' }}
              >
                {mint.trustScore}
              </div>
            </>
          )}
          {(mint.reviewCount ?? 0) > 0 && mint.reviewAvgRating != null && (
            <span
              className="card-trust-rating"
              style={{ opacity: (mint.reviewCount ?? 0) < MIN_MEANINGFUL_REVIEWS ? 0.6 : 1 }}
            >
              <span className="card-trust-star">★</span>
              <span>{mint.reviewAvgRating.toFixed(1)} ({mint.reviewCount})</span>
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
          )}
        </div>
      </div>
    </div>
  )
}
