import { Link } from 'react-router-dom'
import { ArrowLeftRight } from 'lucide-react'
import type { KnownMint } from '@/hooks/useKnownMints'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { UptimeBars } from '@/components/mint/UptimeBars'
import { IcStar } from '@/components/mint/IcStar'
import { WatchAlerts } from '@/components/mint/NotifyStrip'
import { useMintHoverPrefetch } from '@/hooks/useMintHoverPrefetch'
import { displayName as mintDisplayName, cardLatencyLabel, latencyColor, formatTimeAgo, mintStatusLabel } from '@/utils/mintFormatting'
import { mintStatus } from '@/utils/mintStatus'
import { isTestMint } from '@/constants/testMints'
import { removeWatchedMint } from '@/core/nostr/removeWatchedMint'

function hostnameOf(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

function hostOf(url: string): string {
  try { const u = new URL(url); return u.host + (u.pathname === '/' ? '' : u.pathname) } catch { return url }
}

/**
 * One watched mint on the Watchlist (2026-11-19 mockup alignment, watchlist.html "Your mints"): icon | name with the
 * watch star, host | 30 daily bars | latency | the score | Alerts switch and "More alerts" | Compare. Online is the quiet
 * default: only another state is named, after the host. Phones keep icon, name, score and the alerts.
 */
export function WatchlistRow({ mint, onCompare, duplicateDisplayNames }: {
  mint: KnownMint
  onCompare?: (url: string) => void
  duplicateDisplayNames?: ReadonlySet<string>
}) {
  const { onMintPointerEnter, onMintPointerLeave } = useMintHoverPrefetch()
  const name = mintDisplayName(mint, duplicateDisplayNames)
  const status = mintStatusLabel(mintStatus(mint))
  const online = mint.online === true
  const offline = mint.degraded === true
  const archived = mint.archived === true && !online
  const stateWord = archived ? 'Archived' : status === 'Online' ? null : status
  const score = mint.reliabilityScore
  const testMint = isTestMint(mint.url)
  const tier = testMint || score == null ? 'none' : offline ? 'off' : score >= 70 ? 'high' : score >= 40 ? 'mod' : 'low'
  const latency = offline
    ? (mint.lastOnlineAt ? `Last seen ${formatTimeAgo(new Date(mint.lastOnlineAt))}` : 'Never seen online')
    : online && mint.latencyMs != null ? null : cardLatencyLabel(mint)
  const slow = mint.latencyMs != null && latencyColor(mint.latencyMs) === 'var(--slow)'

  return (
    <div
      className={`mint-card wl-row${offline ? ' offline' : ''}`}
      onPointerEnter={() => { onMintPointerEnter(mint.url) }}
      onPointerLeave={onMintPointerLeave}
    >
      <MintFavicon url={mint.url} iconUrl={mint.iconUrl ?? null} size={36} radius={9} className={`wl-row-ico${offline ? ' card-avatar-offline' : ''}`} />
      <div className="wl-row-id">
        <div className="card-name-line">
          {/* Stretched link: the whole row opens the mint; the controls sit above its overlay. */}
          <Link className="card-link" to={`/mint/${encodeURIComponent(mint.url)}`}>
            <span className="card-name" title={mint.nameFull ?? name}>{name}</span>
          </Link>
          <button
            type="button"
            className="card-star on"
            aria-label={`Remove ${name} from watchlist`}
            aria-pressed={true}
            title={`Remove ${name} from watchlist`}
            onClick={e => { e.stopPropagation(); void removeWatchedMint(mint.url, name) }}
          >
            <IcStar filled />
          </button>
        </div>
        <div className="card-host wl-row-host">
          <span className="wl-row-hostname" title={hostnameOf(mint.url)}>{hostOf(mint.url)}</span>
          {stateWord && <span className={`wl-row-state wl-row-state-${status.toLowerCase()}`}> · {stateWord}</span>}
          {testMint && <span className="wl-row-state"> · Test mint</span>}
        </div>
      </div>
      <div className="wl-row-bars">
        <UptimeBars days={mint.uptimeDaily30} />
        <span className="wl-row-k" aria-hidden="true">30 days</span>
      </div>
      <div className="wl-row-lat">
        <span className="wl-row-k">Latency</span>
        {latency === null
          ? <span className="wl-row-v" style={slow ? { color: 'color-mix(in srgb, var(--red) 85%, var(--text))' } : undefined}>{mint.latencyMs}<small> ms</small></span>
          : <span className="wl-row-v wl-row-v-muted">{latency}</span>}
      </div>
      <div className={`card-reliability wl-row-score wl-tier-${tier}`} aria-label={score == null || testMint ? 'No Reliability Score' : `Reliability Score ${score}`}>
        <span className="card-reliability-score">{testMint || score == null ? '–' : score}</span>
      </div>
      <div className="wl-row-alerts">
        <WatchAlerts mintUrl={mint.url} name={name} />
      </div>
      {onCompare && online && (
        <button
          type="button"
          className="card-compare-btn"
          aria-label={`Compare ${name}`}
          title={`Compare ${name}`}
          onClick={e => { e.stopPropagation(); onCompare(mint.url) }}
        >
          <ArrowLeftRight size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
