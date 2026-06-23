import { useState, useEffect } from 'react'
import type { VariableExpense, Category } from '../types'
import { useFormatters } from '../hooks/useFormatters'
import { useTranslation } from '../i18n'

interface ExpenseHeatmapProps {
  expenses: VariableExpense[]
  month: number
  year: number
  categories?: Category[]
  onNavigate?: (page: 'variable-expenses') => void
}


function getDayColor(amount: number, maxAmount: number, isLight: boolean): string {
  if (isLight) {
    if (amount === 0) return '#E8E7F0'
    const ratio = amount / maxAmount
    if (ratio < 0.25) return '#C4B8E8'
    if (ratio < 0.5) return '#9B82D4'
    if (ratio < 0.75) return '#7C3AED'
    return '#5B21B6'
  }
  if (amount === 0) return '#1A1030'
  const ratio = amount / maxAmount
  if (ratio < 0.25) return '#3C3489'
  if (ratio < 0.5) return '#6D28D9'
  if (ratio < 0.75) return '#7C3AED'
  return '#A78BFA'
}

type TooltipState = {
  date: string
  amount: number
  x: number
  y: number
  dayExpenses: VariableExpense[]
} | null

export function ExpenseHeatmap({ expenses, month, year, categories = [], onNavigate }: ExpenseHeatmapProps) {
  const { formatAmount } = useFormatters()
  const { t } = useTranslation()
  const [tooltip, setTooltip] = useState<TooltipState>(null)
  const [lastClickedDay, setLastClickedDay] = useState<string | null>(null)
  const [isLight, setIsLight] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'light'
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsLight(document.documentElement.getAttribute('data-theme') === 'light')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDayOfMonth = new Date(year, month - 1, 1).getDay()
  const startOffset = (firstDayOfMonth + 6) % 7

  const dailyTotals: Record<string, number> = {}
  const dailyExpenses: Record<string, VariableExpense[]> = {}
  for (const exp of expenses) {
    dailyTotals[exp.date] = (dailyTotals[exp.date] || 0) + exp.amount
    if (!dailyExpenses[exp.date]) dailyExpenses[exp.date] = []
    dailyExpenses[exp.date].push(exp)
  }

  const maxAmount = Math.max(...Object.values(dailyTotals), 1)

  const cells: (number | null)[] = Array(startOffset).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(d)
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  const getCatIcon = (categoryId: string) =>
    categories.find(c => c.id === categoryId)?.icon ?? '📦'

  const monthLabel = `${t.months[month - 1]} ${year}`
  const legendBorder = isLight ? '1px solid rgba(0,0,0,0.1)' : '1px solid rgba(255,255,255,0.1)'

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, boxShadow: 'var(--card-shadow)', height: '100%', boxSizing: 'border-box' }}>
      <h3 className="text-center lg:text-left" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
        {t.dashboard.heatmapTitle}
      </h3>
      <p className="text-center lg:text-left" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'capitalize' }}>
        {monthLabel}
      </p>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 3 }}>
        {t.daysShort.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-hint)', fontWeight: 600, padding: '2px 0' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, position: 'relative', maxHeight: 160, overflow: 'hidden' }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
            {week.map((day, di) => {
              if (day === null) {
                return <div key={di} style={{ height: 12, borderRadius: 3 }} />
              }
              const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const amount = dailyTotals[dateStr] || 0
              const color = getDayColor(amount, maxAmount, isLight)
              const isToday = dateStr === new Date().toISOString().split('T')[0]
              const isSelected = lastClickedDay === dateStr

              return (
                <div
                  key={di}
                  style={{
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: color,
                    cursor: amount > 0 ? 'pointer' : 'default',
                    border: isSelected ? '1px solid #F59E0B' : isToday ? '1px solid #A78BFA' : '1px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9,
                    color: amount > 0 ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)',
                    fontWeight: 500,
                    position: 'relative',
                    transition: 'filter 0.15s',
                  }}
                  onMouseEnter={e => {
                    if (amount > 0) {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setTooltip({
                        date: dateStr,
                        amount,
                        x: rect.left + rect.width / 2,
                        y: rect.top - 8,
                        dayExpenses: dailyExpenses[dateStr] ?? [],
                      })
                    }
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  onClick={() => {
                    if (amount === 0) return
                    if (lastClickedDay === dateStr) {
                      if (onNavigate) onNavigate('variable-expenses')
                      setLastClickedDay(null)
                    } else {
                      setLastClickedDay(dateStr)
                    }
                  }}
                  onTouchStart={e => {
                    if (amount > 0) {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setTooltip({
                        date: dateStr,
                        amount,
                        x: rect.left + rect.width / 2,
                        y: rect.top - 8,
                        dayExpenses: dailyExpenses[dateStr] ?? [],
                      })
                      setTimeout(() => setTooltip(null), 2500)
                    }
                  }}
                >
                  {day}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
        <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>{t.dashboard.heatmapLess}</span>
        {(isLight
          ? ['#E8E7F0', '#C4B8E8', '#9B82D4', '#7C3AED', '#5B21B6']
          : ['#1A1030', '#3C3489', '#6D28D9', '#7C3AED', '#A78BFA']
        ).map(c => (
          <div key={c} style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: c }} />
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>{t.dashboard.heatmapMore}</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translateX(-50%) translateY(-100%)',
            background: 'var(--bg2)',
            border: legendBorder,
            borderRadius: 10,
            padding: '8px 12px',
            fontSize: 12,
            color: 'var(--text-primary)',
            pointerEvents: 'none',
            zIndex: 9999,
            minWidth: 160,
            maxWidth: 220,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{tooltip.date}</div>
          <div style={{ color: '#F87171', fontWeight: 600, marginBottom: 6, fontFamily: 'DM Mono, monospace' }}>
            -{formatAmount(tooltip.amount)}
          </div>
          {tooltip.dayExpenses.slice(0, 3).map((exp, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: 13 }}>{getCatIcon(exp.categoryId)}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 11 }}>
                {exp.note || '—'}
              </span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#F87171', flexShrink: 0 }}>
                -{formatAmount(exp.amount)}
              </span>
            </div>
          ))}
          {tooltip.dayExpenses.length > 3 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 4 }}>
              + {tooltip.dayExpenses.length - 3} ďalších
            </div>
          )}
        </div>
      )}
    </div>
  )
}
