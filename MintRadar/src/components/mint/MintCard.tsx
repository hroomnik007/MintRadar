import { useNavigate, Link } from 'react-router-dom'
import type { MintStatus } from '@core/mint/api'
import { useMintHistory } from '@/hooks/useMintHistory'
import './MintCard.css'

interface MintCardProps {
  status: MintStatus
  onAddToWatchlist?: () => void
  isWatching?: boolean
}

function getDisplayName(status: MintStatus): string {
  if (status.info?.name) return status.info.name
  try {
    return new URL(status.url).hostname
  } catch {
    return status.url
  }
}

export function MintCard({ status, onAddToWatchlist, isWatching = false }: MintCardProps) {
  const navigate = useNavigate()
  const nutCount = status.info ? Object.keys(status.info.nuts).length : 0
  const displayName = getDisplayName(status)
  const { records, uptimePercent } = useMintHistory(status.url)

  const uptimeColor =
    uptimePercent >= 99
      ? 'var(--accent)'
      : uptimePercent >= 95
        ? 'var(--yellow, #f5a623)'
        : 'var(--red)'

  function handleCardClick() {
    navigate(`/mint/${encodeURIComponent(status.url)}`)
  }

  return (
    <div
      className="card mint-card animate-fade-in"
      onClick={handleCardClick}
    >
      <div className="mint-card-top">
        <span
          className="status-dot"
          style={{ background: status.online ? 'var(--accent)' : 'var(--red)' }}
          title={status.online ? 'Online' : 'Offline'}
        />
        <Link
          to={`/mint/${encodeURIComponent(status.url)}`}
          className="mint-card-name"
          title={displayName}
          onClick={e => e.stopPropagation()}
        >{displayName}</Link>
      </div>

      <div className="mint-card-badges">
        {status.online && status.latencyMs !== null && (
          <span className="badge" title="Measured from our server in Frankfurt, DE. Open mint detail page to test your local latency.">{status.latencyMs}ms</span>
        )}
        {status.info?.version !== undefined && (
          <span className="badge">{status.info.version}</span>
        )}
        {status.info !== null && (
          <span className="badge">{nutCount} NIPs</span>
        )}
        {records.length > 0 && (
          <span className="badge uptime-badge" style={{ color: uptimeColor }}>
            {uptimePercent}% up
          </span>
        )}
      </div>

      {status.error !== undefined && (
        <p className="mint-card-error">{status.error}</p>
      )}

      <div className="mint-card-bottom">
        <Link
          to={`/mint/${encodeURIComponent(status.url)}`}
          className="mint-url"
          title={status.url}
          onClick={e => e.stopPropagation()}
        >{status.url}</Link>
        {onAddToWatchlist !== undefined && (
          <button
            type="button"
            className={`watch-btn${isWatching ? ' watching' : ''}`}
            onClick={e => { e.stopPropagation(); onAddToWatchlist?.() }}
          >
            {isWatching ? '✕ Unwatch' : '+ Watch'}
          </button>
        )}
      </div>
    </div>
  )
}
