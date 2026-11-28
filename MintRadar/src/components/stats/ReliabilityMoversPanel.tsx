import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { clickableProps } from '@/utils/clickableProps'
import { MintFavicon } from '../mint/MintFavicon'

export interface ReliabilityMover {
  url: string
  name: string | null
  delta: number
}

export interface ReliabilityMoversData {
  risers: ReliabilityMover[]
  fallers: ReliabilityMover[]
}

interface ReliabilityMoversPanelProps {
  period: '7d' | '30d'
  onPeriodChange: (period: '7d' | '30d') => void
  data: ReliabilityMoversData | undefined
  // True only on the very first load, when there is no data (not even stale
  // previous-period data) to show — renders a skeleton, never "No data yet".
  loading: boolean
  // True when data IS shown but a fresh fetch is in flight (background refresh,
  // or the 7d↔30d switch while keepPreviousData holds the old rows) — dims the
  // existing rows slightly instead of blanking them.
  refreshing?: boolean
  onMintClick: (url: string) => void
  getDisplayName: (mover: ReliabilityMover) => string
  getIconUrl: (mover: ReliabilityMover) => string | null
  /** The mint's current score and state from the mint list (review 2026-11-28, S2): "before → now" and the status dot. */
  getCurrent?: (mover: ReliabilityMover) => { score: number | null; online: boolean | null } | null
  // Optional muted line under the rows.
  footer?: ReactNode
  // Optional note ABOVE the rows, under the panel head: the methodology note (supplied by Stats.tsx). It explains why the
  // deltas below moved, so it is read before them (2026-11-15 audit; it was the footer). Same box as before, so the
  // reserved panel height (Stats.css --stats-reserve-note) is unchanged.
  note?: ReactNode
}

function SkeletonRows() {
  return (
    <div className="stats-movers-skeleton" aria-hidden="true">
      {[0, 1, 2].map(i => (
        <div key={i} className="stats-movers-sk-row">
          <div className="stats-movers-sk-avatar" />
          <div className="stats-movers-sk-lines">
            <div className="stats-movers-sk-line" style={{ width: '58%' }} />
            <div className="stats-movers-sk-line" style={{ width: '38%' }} />
          </div>
          <div className="stats-movers-sk-badge" />
        </div>
      ))}
    </div>
  )
}

// Extracted from Stats.tsx (rather than kept inline like its sibling modals)
// specifically so the toggle/empty-state/color-differentiation behavior can
// be unit-tested without mounting the whole Stats page — see
// ReliabilityMoversPanel.test.tsx. No `@/...`-aliased imports: vitest.config.ts has
// no path-alias resolution (unlike vite.config.ts), so this component takes
// all data via props instead of reaching into hooks/utils itself, and imports
// MintFavicon by relative path.
export function ReliabilityMoversPanel({ period, onPeriodChange, data, loading, refreshing = false, onMintClick, getDisplayName, getIconUrl, getCurrent, footer, note }: ReliabilityMoversPanelProps) {
  // Row markup mirrors .stats-top5-row (Most Reliable, in Stats.tsx) — favicon,
  // name on top with its hostname underneath, value flush right — so the two
  // panels in the same grid row read as one visual family. Only the right-hand
  // value differs: a colored delta badge instead of a plain percentage.
  const renderRows = (movers: ReliabilityMover[], direction: 'up' | 'down') => {
    if (!data) {
      // Skeleton while the request is still in flight; "No data yet" only once
      // the query has settled without ever producing data (e.g. a failed fetch).
      if (loading) return <SkeletonRows />
      return <div style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>No data yet</div>
    }
    if (movers.length === 0) {
      return <div className="stats-movers-empty">No significant changes this period</div>
    }
    return movers.map(m => {
      const name = getDisplayName(m)
      // Review 2026-11-28 (S2): no host line (it cut the names off); the score before and now under the name, and the
      // mint's state as the dot after its name (green online, red offline), the word for screen readers only.
      const cur = getCurrent?.(m) ?? null
      const now = cur?.score ?? null
      return (
        <div key={m.url} className="stats-top5-row" {...clickableProps(() => onMintClick(m.url))}>
          <MintFavicon url={m.url} name={name} iconUrl={getIconUrl(m)} size={22} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="stats-movers-name">
              {name}
              {cur && cur.online !== null && (
                <>
                  <span className={`stats-movers-dot${cur.online ? ' on' : ''}`} aria-hidden="true" />
                  <span className="sr-only">{cur.online ? 'online' : 'offline'}</span>
                </>
              )}
            </div>
            {now !== null && <div className="stats-movers-fromto" data-testid="movers-from-to">{now - m.delta} → {now}</div>}
          </div>
          <span className={`stats-movers-delta ${direction}`}>{direction === 'up' ? '+' : ''}{m.delta}</span>
        </div>
      )
    })
  }

  return (
    <div className="stats-panel stats-movers-panel">
      <div className="stats-panel-head">
        <div>
          <div className="stats-panel-title">Score movers</div>
          <div className="stats-panel-desc">Test mints are not included.</div>
        </div>
        <div className="stats-tab-toggle">
          <button type="button" className={`stats-tab-btn${period === '7d' ? ' active' : ''}`} onClick={() => onPeriodChange('7d')}>7d</button>
          <button type="button" className={`stats-tab-btn${period === '30d' ? ' active' : ''}`} onClick={() => onPeriodChange('30d')}>30d</button>
        </div>
      </div>
      {note}
      <div
        style={{ opacity: refreshing ? 0.5 : 1, transition: 'opacity 0.15s ease' }}
        aria-busy={refreshing || loading}
      >
        <div className="stats-movers-section-label up"><TrendingUp size={15} aria-hidden="true" /> Up</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--stats-row-gap)' }}>
          {renderRows(data?.risers ?? [], 'up')}
        </div>

        <div className="stats-movers-section-label down"><TrendingDown size={15} aria-hidden="true" /> Down</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--stats-row-gap)' }}>
          {renderRows(data?.fallers ?? [], 'down')}
        </div>
      </div>
      {footer}
    </div>
  )
}
