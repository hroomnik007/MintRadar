import { useFormatters } from '../hooks/useFormatters'
import { useTranslation } from '../i18n'
import type { BudgetStatus } from '../types'

interface RightPanelProps {
  budgetStatuses: BudgetStatus[]
}

const getBudgetBarColor = (pct: number) => {
  if (pct >= 100) return '#F87171'
  if (pct >= 80) return '#FBBF24'
  return '#A78BFA'
}

export function RightPanel({ budgetStatuses }: RightPanelProps) {
  const { formatAmount } = useFormatters()
  const { t } = useTranslation()

  return (
    <aside
      className="hidden lg:flex flex-col gap-4 flex-shrink-0 overflow-y-auto"
      style={{
        width: '320px',
        minWidth: '320px',
        padding: '20px',
        paddingLeft: '16px',
      }}
    >
      {/* Budget panel */}
      {budgetStatuses.length > 0 && (
        <div
          className="rounded-[20px] w-full"
          style={{ backgroundColor: '#2A1F4A', border: '0.5px solid #4C3A8A', overflow: 'visible' }}
        >
          <div className="px-4 py-3" style={{ borderBottom: '0.5px solid #4C3A8A55' }}>
            <p
              className="font-semibold uppercase text-[#9D84D4]"
              style={{ fontSize: '11px', letterSpacing: '0.1em' }}
            >
              {t.dashboard.budget}
            </p>
          </div>
          <div className="flex flex-col gap-3 p-4">
            {budgetStatuses.map(bs => {
              const barColor = getBudgetBarColor(bs.percentage)
              const pct = Math.min(bs.percentage, 100)
              return (
                <div key={bs.categoryId}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className="w-6 h-6 rounded-lg flex items-center justify-center text-xs shrink-0"
                        style={{ backgroundColor: bs.categoryColor + '22' }}
                      >
                        {bs.categoryIcon}
                      </span>
                      <span className="text-[13px] font-medium text-[#E2D9F3] truncate">
                        {bs.categoryName}
                      </span>
                    </div>
                    <span
                      className="text-[11px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ml-2"
                      style={{ color: barColor, backgroundColor: barColor + '20' }}
                    >
                      {Math.round(bs.percentage)}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#32265A' }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: bs.categoryColor }}
                    />
                  </div>
                  <p className="text-[11px] text-[#6B5A9E] mt-1" style={{ whiteSpace: 'nowrap', overflow: 'visible' }}>
                    {formatAmount(bs.spent)} {t.common.of} {formatAmount(bs.limit)}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

    </aside>
  )
}
