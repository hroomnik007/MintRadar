import { TrendingUp, TrendingDown } from 'lucide-react'

export interface TrustMover {
  url: string
  name: string | null
  delta: number
}

export interface TrustMoversData {
  risers: TrustMover[]
  fallers: TrustMover[]
}

interface TrustMoversPanelProps {
  period: '7d' | '30d'
  onPeriodChange: (period: '7d' | '30d') => void
  data: TrustMoversData | undefined
  onMintClick: (url: string) => void
  getDisplayName: (mover: TrustMover) => string
}

// Extracted from Stats.tsx (rather than kept inline like its sibling modals)
// specifically so the toggle/empty-state/color-differentiation behavior can
// be unit-tested without mounting the whole Stats page — see
// TrustMoversPanel.test.tsx. No `@/...`-aliased imports: vitest.config.ts has
// no path-alias resolution (unlike vite.config.ts), so this component takes
// all data via props instead of reaching into hooks/utils itself.
export function TrustMoversPanel({ period, onPeriodChange, data, onMintClick, getDisplayName }: TrustMoversPanelProps) {
  const renderRows = (movers: TrustMover[], direction: 'up' | 'down') => {
    if (!data) {
      return <div style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>No data yet</div>
    }
    if (movers.length === 0) {
      return <div className="stats-movers-empty">No significant changes this period</div>
    }
    return movers.map(m => (
      <div key={m.url} className="stats-movers-row" onClick={() => onMintClick(m.url)}>
        <span className="stats-movers-name">{getDisplayName(m)}</span>
        <span className={`stats-movers-delta ${direction}`}>{direction === 'up' ? '+' : ''}{m.delta}%</span>
      </div>
    ))
  }

  return (
    <div className="stats-panel">
      <div className="stats-card-header">
        <div className="stats-panel-title" style={{ marginBottom: 0 }}>Trust Score Movers</div>
        <div className="stats-tab-toggle">
          <button type="button" className={`stats-tab-btn${period === '7d' ? ' active' : ''}`} onClick={() => onPeriodChange('7d')}>7d</button>
          <button type="button" className={`stats-tab-btn${period === '30d' ? ' active' : ''}`} onClick={() => onPeriodChange('30d')}>30d</button>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="stats-movers-section-label"><TrendingUp size={11} /> Risers</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--stats-row-gap)' }}>
          {renderRows(data?.risers ?? [], 'up')}
        </div>

        <div className="stats-movers-section-label"><TrendingDown size={11} /> Fallers</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--stats-row-gap)' }}>
          {renderRows(data?.fallers ?? [], 'down')}
        </div>
      </div>
    </div>
  )
}
