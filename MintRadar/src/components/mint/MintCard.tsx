import { useNavigate } from 'react-router-dom'
import { MintFavicon } from '@/components/mint/MintFavicon'
import type { KnownMint } from '@/hooks/useKnownMints'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { useAuthStore } from '@/stores/auth.store'
import { mintAgeBadge, uptimeColor, formatTimeAgo } from '@/utils/mintFormatting'

const IcPlus = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
    <line x1="6" y1="1.5" x2="6" y2="10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="1.5" y1="6" x2="10.5" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IcClose = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

// Shared mint card used on both the Dashboard grid and the Watchlist grid.
export function MintCard({
  mint,
  onCompare,
}: {
  mint: KnownMint
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
  const isOfflineDegraded = mint.degraded === true
  const displayName = mint.name ?? hostname
  const uptimePct24h = mint.uptimePct24h ?? null
  const ageBadge = mintAgeBadge(mint.discoveredAt ?? null)

  return (
    <div
      className={`mint-card${isOfflineDegraded ? ' offline' : ''}`}
      onClick={() => { navigate(`/mint/${encodeURIComponent(mint.url)}`) }}
    >
      <div className="card-top">
        <div className="card-name-row">
          <MintFavicon url={mint.url} iconUrl={mint.iconUrl ?? null} size={32} radius={7} />
          <div style={{ minWidth: 0 }}>
            <div className="card-name">{displayName}</div>
            {mint.name && <div className="card-host">{hostname}</div>}
          </div>
          {isOfflineDegraded ? (
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--red)', background: 'var(--red-soft)', border: '1px solid rgba(219,106,93,0.3)', borderRadius: 5, padding: '2px 7px', flexShrink: 0, marginLeft: 'auto', marginRight: 12 }}>
              Offline 24h+
            </span>
          ) : ageBadge && (
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: ageBadge.color, background: ageBadge.bg, border: `1px solid ${ageBadge.border}`, borderRadius: 5, padding: '2px 7px', flexShrink: 0, marginLeft: 'auto', marginRight: 12 }}>
              {ageBadge.label}
            </span>
          )}
        </div>
        <div
          className={`status-dot${isOnline ? ' online' : ''}`}
          style={{ background: isOnline ? 'var(--green-bright)' : 'var(--red)' }}
        />
      </div>

      <div className="card-pills">
        {mint.version && (
          <span className="card-pill">{mint.version}</span>
        )}
        {mint.nutCount !== null && mint.nutCount !== undefined && (
          <span className="card-pill" style={{ fontFamily: 'var(--font-mono-data)' }}>{mint.nutCount} NUTs</span>
        )}
        {uptimePct24h !== null && (
          <span className="card-pill" style={{ color: uptimeColor(uptimePct24h), fontFamily: 'var(--font-mono-data)' }}>
            {uptimePct24h}% up
          </span>
        )}
        {mint.online === true && mint.trustScore != null && (
          <span className="card-pill" style={{ color: mint.trustScore >= 70 ? 'var(--green-bright)' : mint.trustScore >= 40 ? 'var(--amber)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono-data)' }}>
            <span style={{ fontSize: 15, lineHeight: 1 }}>★</span><span>{mint.trustScore}%</span>
          </span>
        )}
      </div>

      <div className="card-bottom">
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
            <div className="latency-value muted">—</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {onCompare && isOnline && (
            <button
              type="button"
              style={{
                background: 'transparent',
                color: 'var(--green-bright)',
                border: '1px solid var(--green-soft-strong)',
                borderRadius: 'var(--radius-m)',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                flexShrink: 0,
                transition: 'all 150ms ease',
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
