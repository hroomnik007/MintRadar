import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { ApiTransaction } from '../types'
import { useTranslation } from '../i18n'

interface TxRowProps {
  t: ApiTransaction
  compact?: boolean
  onDelete?: (id: string) => void
  onClick?: () => void
}

export function TxRow({ t, compact = false, onDelete, onClick }: TxRowProps) {
  const { t: tr } = useTranslation()
  const [hover, setHover] = useState(false)

  const isIncome = t.type === 'income'
  const tileSize = compact ? 38 : 44
  const tileRadius = compact ? 10 : 12
  const tileBg = isIncome
    ? 'rgba(52,211,153,0.14)'
    : `${t.categoryColor ?? '#9D84D4'}22`

  const label = t.description ?? ''
  const dateStr = t.date

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: hover ? 'var(--bg3)' : 'var(--bg2)',
        border: `1px solid ${hover ? 'var(--border2)' : 'var(--border)'}`,
        borderRadius: compact ? 14 : 16,
        padding: compact ? '10px 12px' : '12px 14px',
        transition: 'all 0.15s', cursor: 'pointer',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      {/* Icon tile */}
      <div style={{
        width: tileSize, height: tileSize, borderRadius: tileRadius,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: compact ? 15 : 18, flexShrink: 0,
        background: tileBg,
      }}>
        {isIncome ? '💰' : (t.categoryIcon ?? '📦')}
      </div>

      {/* Middle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: compact ? 13 : 14, fontWeight: 500, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2,
        }}>
          {label || (isIncome ? tr.fab.incomeLabel : tr.fab.expenseLabel)}
        </p>
        <p style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'DM Mono', monospace" }}>
          {!isIncome && t.categoryName ? `${t.categoryName} · ` : ''}{dateStr}
        </p>
      </div>

      {/* Delete button (hover-revealed) */}
      {hover && onDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(t.id) }}
          style={{
            padding: 6, borderRadius: 8, border: 'none',
            background: 'rgba(248,113,113,0.1)', color: 'var(--red)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            cursor: 'pointer',
          }}
        >
          <Trash2 size={14} />
        </button>
      )}

      {/* Amount */}
      <span style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: compact ? 13 : 14, fontWeight: 700,
        color: isIncome ? 'var(--green)' : 'var(--red)',
        flexShrink: 0,
      }}>
        {isIncome ? '+' : '-'}{t.amount.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
      </span>
    </div>
  )
}
