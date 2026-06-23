import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from '../i18n'

interface MonthSwitcherProps {
  month: number
  year: number
  onChange: (month: number, year: number) => void
  canGoPrev?: boolean
}

export function MonthSwitcher({ month, year, onChange, canGoPrev = true }: MonthSwitcherProps) {
  const { t } = useTranslation()

  const prev = () => {
    if (!canGoPrev) return
    if (month === 1) onChange(12, year - 1)
    else onChange(month - 1, year)
  }

  const next = () => {
    if (month === 12) onChange(1, year + 1)
    else onChange(month + 1, year)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 2,
      background: 'var(--bg3)', border: '1px solid var(--border2)',
      borderRadius: 11, padding: 3, flexShrink: 0,
    }}>
      <button
        onClick={prev}
        disabled={!canGoPrev}
        aria-label="Predchádzajúci mesiac"
        style={{
          width: 26, height: 26, borderRadius: 7, border: 'none',
          background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: canGoPrev ? 'var(--text2)' : 'var(--border2)',
          cursor: canGoPrev ? 'pointer' : 'default',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (canGoPrev) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg4)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
      >
        <ChevronLeft size={13} />
      </button>

      <span style={{
        fontFamily: "'DM Mono', monospace", fontSize: 11.5, fontWeight: 500,
        color: 'var(--text)', padding: '0 8px', minWidth: 100, textAlign: 'center',
        whiteSpace: 'nowrap',
      }}>
        {t.months[month - 1]} {year}
      </span>

      <button
        onClick={next}
        aria-label="Nasledujúci mesiac"
        style={{
          width: 26, height: 26, borderRadius: 7, border: 'none',
          background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text2)', cursor: 'pointer', transition: 'background 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg4)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
      >
        <ChevronRight size={13} />
      </button>
    </div>
  )
}
