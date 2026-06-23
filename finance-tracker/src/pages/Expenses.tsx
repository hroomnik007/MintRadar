import { useState, useEffect } from 'react'
import { Plus, Edit2, Trash2, Lock } from 'lucide-react'
import { BottomSheet } from '../components/BottomSheet'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DateInput } from '../components/DateInput'
import { MonthSwitcher } from '../components/MonthSwitcher'
import { useVariableExpenses } from '../hooks/useVariableExpenses'
import { useFixedExpenses } from '../hooks/useFixedExpenses'
import { useCategories } from '../hooks/useCategories'
import { useBudgetStatus } from '../hooks/useBudgetStatus'
import { useFormatters } from '../hooks/useFormatters'
import { formatDate, todayISO } from '../utils/format'
import { useTranslation } from '../i18n'
import type { VariableExpense, FixedExpense, BudgetStatus } from '../types'

interface ExpensesPageProps {
  month: number
  year: number
  onMonthChange: (month: number, year: number) => void
  showToast: (msg: string) => void
  initialTab?: 'variable' | 'fixed'
  onTabChange?: (tab: 'variable' | 'fixed') => void
}

type Tab = 'variable' | 'fixed'

interface VarFormState {
  amount: string
  categoryId: string
  note: string
  date: string
}

interface FixedFormState {
  label: string
  amount: string
  dayOfMonth: string
}

const emptyVar = (): VarFormState => ({ amount: '', categoryId: '', note: '', date: todayISO() })
const emptyFixed: FixedFormState = { label: '', amount: '', dayOfMonth: '1' }

const getBudgetBarColor = (pct: number) => {
  if (pct >= 100) return '#f87171'
  if (pct >= 70) return '#fbbf24'
  return '#34d399'
}

export function ExpensesPage({
  month, year, onMonthChange, showToast, initialTab = 'variable', onTabChange,
}: ExpensesPageProps) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [fixedSheetOpen, setFixedSheetOpen] = useState(false)
  const [editingVar, setEditingVar] = useState<VariableExpense | null>(null)
  const [editingFixed, setEditingFixed] = useState<FixedExpense | null>(null)
  const [varForm, setVarForm] = useState<VarFormState>(emptyVar())
  const [fixedForm, setFixedForm] = useState<FixedFormState>(emptyFixed)
  const [confirmVarId, setConfirmVarId] = useState<string | null>(null)
  const [confirmFixedId, setConfirmFixedId] = useState<string | null>(null)
  const [newCatMode, setNewCatMode] = useState(false)
  const [newCatName, setNewCatName] = useState('')

  // Sync tab from sidebar nav
  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  const handleTabChange = (t: Tab) => {
    setTab(t)
    onTabChange?.(t)
  }

  const { t } = useTranslation()

  const { variableExpenses, addVariableExpense, updateVariableExpense, deleteVariableExpense } =
    useVariableExpenses(month, year)
  const { fixedExpenses, addFixedExpense, updateFixedExpense, deleteFixedExpense } = useFixedExpenses()
  const { categories, addCategory } = useCategories()
  const budgetStatuses = useBudgetStatus({ categories, variableExpenses })
  const { formatAmount } = useFormatters()

  const getCategoryById = (id: string) => categories.find((c) => c.id === id)
  const getBudgetForCategory = (catId: string) => budgetStatuses.find(b => b.categoryId === catId)

  const selectedCatId = varForm.categoryId || null
  const liveBudget = selectedCatId ? getBudgetForCategory(selectedCatId) : null
  const liveAmount = parseFloat(varForm.amount.replace(',', '.')) || 0
  const liveSpent = (liveBudget?.spent ?? 0) + (editingVar ? 0 : liveAmount)
  const liveLimit = liveBudget?.limit
  const livePct = liveLimit ? Math.min((liveSpent / liveLimit) * 100, 100) : null

  const openAdd = () => {
    setEditingVar(null)
    setVarForm(emptyVar())
    setNewCatMode(false)
    setSheetOpen(true)
  }

  const openEditVar = (expense: VariableExpense) => {
    setEditingVar(expense)
    setVarForm({
      amount: String(expense.amount),
      categoryId: String(expense.categoryId),
      note: expense.note,
      date: expense.date,
    })
    setNewCatMode(false)
    setSheetOpen(true)
  }

  const openAddFixed = () => {
    setEditingFixed(null)
    setFixedForm(emptyFixed)
    setFixedSheetOpen(true)
  }

  const openEditFixed = (expense: FixedExpense) => {
    setEditingFixed(expense)
    setFixedForm({ label: expense.label, amount: String(expense.amount), dayOfMonth: String(expense.dayOfMonth) })
    setFixedSheetOpen(true)
  }

  const handleSaveVar = async () => {
    const amount = parseFloat(varForm.amount.replace(',', '.'))
    if (isNaN(amount) || amount <= 0 || !varForm.categoryId) return

    if (newCatMode) {
      if (!newCatName.trim()) return
      const catId = await addCategory({ name: newCatName, color: '#9D84D4', icon: '📦', type: 'expense' })
      await addVariableExpense({ amount, categoryId: catId, note: varForm.note, date: varForm.date })
      setSheetOpen(false)
      return
    }

    const catId = varForm.categoryId
    if (catId) {
      const bs = getBudgetForCategory(catId)
      if (bs) {
        const newSpent = bs.spent + amount
        const newPct = (newSpent / bs.limit) * 100
        if (newPct >= 100 && bs.percentage < 100) showToast(t.expenses.variable.toastLimitExceeded.replace('{name}', bs.categoryName))
        else if (newPct >= 90 && bs.percentage < 90) showToast(t.expenses.variable.toastLimitWarning.replace('{name}', bs.categoryName))
      }
    }

    if (editingVar?.id) {
      await updateVariableExpense(editingVar.id, { amount, categoryId: catId || '', note: varForm.note, date: varForm.date })
    } else {
      await addVariableExpense({ amount, categoryId: catId || '', note: varForm.note, date: varForm.date })
    }
    setSheetOpen(false)
  }

  const handleSaveFixed = async () => {
    const amount = parseFloat(fixedForm.amount.replace(',', '.'))
    const dayOfMonth = parseInt(fixedForm.dayOfMonth)
    if (!fixedForm.label.trim() || isNaN(amount) || amount <= 0) return
    if (editingFixed?.id) {
      await updateFixedExpense(editingFixed.id, { label: fixedForm.label, amount, dayOfMonth })
    } else {
      await addFixedExpense({ label: fixedForm.label, amount, dayOfMonth, note: '' })
    }
    setFixedSheetOpen(false)
  }

  const grouped = variableExpenses.reduce<Record<string, VariableExpense[]>>(
    (acc: Record<string, VariableExpense[]>, e: VariableExpense) => {
      acc[e.date] = acc[e.date] ?? []
      acc[e.date].push(e)
      return acc
    }, {}
  )
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))
  const sortedVariableExpenses = [...variableExpenses].sort((a, b) => b.date.localeCompare(a.date))
  const totalFixed = fixedExpenses.reduce((s, f) => s + f.amount, 0)


  return (
    <div className="flex flex-col gap-4 lg:gap-5 pb-4">

      {/* ── HEADER ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="flex-1 lg:hidden min-w-0">
            <MonthSwitcher month={month} year={year} onChange={onMonthChange} />
          </div>
          <h2 className="hidden lg:block text-2xl font-bold text-white shrink-0">{t.nav.expenses}</h2>
          <div className="hidden lg:block">
            <MonthSwitcher month={month} year={year} onChange={onMonthChange} />
          </div>
        </div>
        {/* Desktop: two buttons */}
        <div className="hidden lg:flex items-center gap-2 shrink-0">
          <button onClick={openAddFixed} className="btn-secondary">
            <Plus size={15} /> {t.expenses.fixed.add}
          </button>
          <button onClick={openAdd} className="btn-primary">
            <Plus size={15} /> {t.expenses.variable.add}
          </button>
        </div>
      </div>

      {/* ── MOBILE/TABLET: Tab switcher ── */}
      <div
        className="flex rounded-2xl p-1 gap-1 lg:hidden"
        style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
      >
        {(['variable', 'fixed'] as Tab[]).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => handleTabChange(tabKey)}
            className="flex-1 py-2.5 min-h-[44px] rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer"
            style={{
              background: tab === tabKey ? 'linear-gradient(135deg, #A78BFA, #7C3AED)' : 'transparent',
              color: tab === tabKey ? '#ffffff' : '#B8A3E8',
            }}
          >
            {tabKey === 'variable' ? t.nav.variable : t.nav.fixed}
          </button>
        ))}
      </div>

      {/* ── MOBILE/TABLET: Variable tab ── */}
      {tab === 'variable' && (
        <div className="lg:hidden">
          {sortedDates.length === 0 ? (
            <div className="text-center py-16 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)]">
              <p className="text-4xl mb-3">🧾</p>
              <p className="text-white font-semibold mb-1">{t.expenses.variable.noExpenses}</p>
              <p className="text-[#9D84D4] text-sm">{t.expenses.variable.noExpensesSubtitle}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {sortedDates.map(date => (
                <div key={date}>
                  <p className="text-[#9D84D4] text-xs mb-2 px-1 uppercase tracking-wide">{formatDate(date)}</p>
                  <div className="flex flex-col gap-2">
                    {grouped[date].map((expense: VariableExpense) => {
                      const cat = getCategoryById(expense.categoryId)
                      const bs = cat?.id ? getBudgetForCategory(cat.id) : null
                      return (
                        <div key={expense.id}
                          className="bg-[var(--bg-surface)] rounded-xl px-4 py-3 border border-[var(--border-subtle)] hover:bg-[#32265A]/50 transition-all duration-200 cursor-pointer"
                          onClick={() => openEditVar(expense)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                                style={{ backgroundColor: (cat?.color ?? '#9D84D4') + '33' }}>
                                {cat?.icon ?? '📦'}
                              </div>
                              <div>
                                <p className="text-white text-sm">{expense.note || cat?.name || t.expenses.variable.defaultExpense}</p>
                                <p className="text-[#9D84D4] text-xs">{cat?.name}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                              <span className="text-[#f87171] font-medium text-sm">-{formatAmount(expense.amount)}</span>
                              <button onClick={() => openEditVar(expense)}
                                className="text-[#9D84D4] hover:text-[#B8A3E8] min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer">
                                <Edit2 size={14} />
                              </button>
                              <button onClick={() => setConfirmVarId(expense.id!)}
                                className="text-[#9D84D4] hover:text-[#f87171] min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                          {bs && (
                            <div className="mt-2 h-1.5 bg-[#32265A] rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all"
                                style={{ width: `${Math.min(bs.percentage, 100)}%`, backgroundColor: getBudgetBarColor(bs.percentage) }} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MOBILE/TABLET: Fixed tab ── */}
      {tab === 'fixed' && (
        <div className="lg:hidden flex flex-col gap-3">
          <div className="flex justify-end">
            <button onClick={openAddFixed} className="btn-primary">
              <Plus size={16} /> {t.expenses.fixed.add}
            </button>
          </div>
          {fixedExpenses.length === 0 ? (
            <div className="text-center py-16 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)]">
              <p className="text-4xl mb-3">📌</p>
              <p className="text-white font-semibold mb-1">{t.expenses.fixed.noExpenses}</p>
              <p className="text-[#9D84D4] text-sm">{t.expenses.fixed.noExpensesSubtitle}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {fixedExpenses.map((expense: FixedExpense) => (
                <div key={expense.id}
                  className="bg-[var(--bg-surface)] rounded-xl px-4 py-3 flex items-center justify-between border border-[var(--border-subtle)] hover:bg-[#32265A]/50 transition-all duration-200">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#A78BFA]/15 flex items-center justify-center shrink-0">
                      <span className="text-[#A78BFA] text-xs font-bold">{expense.dayOfMonth}.</span>
                    </div>
                    <div>
                      <p className="text-white text-sm">{expense.label}</p>
                      <p className="text-[#9D84D4] text-xs">{t.expenses.fixed.everyMonth}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#f87171] font-semibold">{formatAmount(expense.amount)}</span>
                    <button onClick={() => openEditFixed(expense)}
                      className="text-[#9D84D4] hover:text-[#B8A3E8] min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => setConfirmFixedId(expense.id!)}
                      className="text-[#9D84D4] hover:text-[#f87171] min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── DESKTOP: Two-panel layout ── */}
      <div className="hidden lg:grid lg:grid-cols-[35fr_65fr] lg:gap-5">

        {/* Left panel: category budget only (no fixed) */}
        <div className="bg-[var(--bg-surface)] rounded-xl p-5 border border-[var(--border-subtle)]">
          <h3 className="text-white font-semibold mb-4 text-sm">{t.expenses.variable.categoriesAndBudget}</h3>
          {budgetStatuses.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-2xl mb-2">📊</p>
              <p className="text-[#9D84D4] text-sm">{t.dashboard.noLimits}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {budgetStatuses.map((bs: BudgetStatus) => {
                const barColor = getBudgetBarColor(bs.percentage)
                return (
                  <div key={bs.categoryId}
                    className={`rounded-xl py-3 px-3 border-l-[3px] transition-all duration-200 ${
                      bs.isOver ? 'pulse-glow border-l-red-500 bg-red-500/5' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
                    }`}
                    style={!bs.isOver ? { borderLeftColor: bs.categoryColor } : undefined}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-white truncate mr-2">
                        {bs.categoryIcon} {bs.categoryName}
                      </span>
                      <span className="text-xs font-semibold shrink-0"
                        style={{ color: barColor }}>
                        {Math.round(bs.percentage)}%
                      </span>
                    </div>
                    <div className="h-2 bg-[#32265A] rounded-full overflow-hidden mb-1">
                      <div className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(bs.percentage, 100)}%`, backgroundColor: barColor }} />
                    </div>
                    <p className="text-xs text-[#9D84D4]">
                      {formatAmount(bs.spent)} z {formatAmount(bs.limit)}
                    </p>
                    {bs.isOver && <p className="text-[#f87171] text-xs mt-0.5 font-medium">{t.dashboard.limitExceeded}</p>}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right panel: variable expenses table */}
        <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
          {sortedVariableExpenses.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-4xl mb-3">🧾</p>
              <p className="text-white font-semibold mb-1">{t.expenses.variable.noExpenses}</p>
              <p className="text-[#9D84D4] text-sm">{t.expenses.variable.noExpensesDesktop}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[#9D84D4] text-xs border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                  <th className="px-5 py-4 font-medium">{t.expenses.variable.date_col}</th>
                  <th className="px-5 py-4 font-medium">{t.expenses.variable.category_col}</th>
                  <th className="px-5 py-4 font-medium">{t.expenses.variable.note_col}</th>
                  <th className="px-5 py-4 font-medium text-right">{t.expenses.variable.amount_col}</th>
                  <th className="px-5 py-4 font-medium text-center">{t.expenses.variable.actions_col}</th>
                </tr>
              </thead>
              <tbody>
                {sortedVariableExpenses.map((expense: VariableExpense, idx: number) => {
                  const cat = getCategoryById(expense.categoryId)
                  const bs = cat?.id ? getBudgetForCategory(cat.id) : null
                  return (
                    <tr key={expense.id}
                      className={`border-b border-[#4C3A8A33] last:border-0 hover:bg-[#32265A]/40 transition-all duration-150 cursor-pointer ${
                        idx % 2 === 1 ? '' : ''
                      }`}
                      onClick={() => openEditVar(expense)}
                    >
                      <td className="px-5 py-4 text-[#9D84D4] whitespace-nowrap">{formatDate(expense.date)}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0"
                            style={{ backgroundColor: (cat?.color ?? '#9D84D4') + '33' }}>
                            {cat?.icon ?? '📦'}
                          </span>
                          <div>
                            <p className="text-white text-xs">{cat?.name ?? '—'}</p>
                            {bs && (
                              <div className="w-16 h-1 bg-[#32265A] rounded-full mt-0.5">
                                <div className="h-full rounded-full"
                                  style={{ width: `${Math.min(bs.percentage, 100)}%`, backgroundColor: getBudgetBarColor(bs.percentage) }} />
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-[#B8A3E8]">{expense.note || '—'}</td>
                      <td className="px-5 py-4 text-right text-[#f87171] font-semibold whitespace-nowrap">
                        -{formatAmount(expense.amount)}
                      </td>
                      <td className="px-5 py-4 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-3">
                          <button onClick={() => openEditVar(expense)}
                            className="text-[#9D84D4] hover:text-[#B8A3E8] transition-colors cursor-pointer">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => setConfirmVarId(expense.id!)}
                            className="text-[#9D84D4] hover:text-[#f87171] transition-colors cursor-pointer">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── DESKTOP: Fixné výdavky full-width card ── */}
      <div className="hidden lg:block bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)]">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <Lock size={14} className="text-[#9D84D4]" /> {t.expenses.fixed.thisMonthTitle}
          </h3>
          <button onClick={openAddFixed}
            className="text-[#A78BFA] text-xs hover:text-sky-300 transition-colors cursor-pointer flex items-center gap-1">
            <Plus size={13} /> {t.common.add}
          </button>
        </div>
        {fixedExpenses.length === 0 ? (
          <p className="text-[#9D84D4] text-sm text-center py-8">
            {t.expenses.fixed.noExpenses}. {t.expenses.fixed.noExpensesSubtitle}.
          </p>
        ) : (
          <div>
            <div className="divide-y divide-slate-700/30">
              {fixedExpenses.map((exp: FixedExpense) => (
                <div key={exp.id}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-[#32265A]/20 transition-all duration-150 cursor-pointer"
                  onClick={() => openEditFixed(exp)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-[#A78BFA]/15 flex items-center justify-center shrink-0">
                      <span className="text-[#A78BFA] text-xs font-bold">{exp.dayOfMonth}.</span>
                    </div>
                    <div>
                      <p className="text-white text-sm">{exp.label}</p>
                      <p className="text-[#9D84D4] text-xs">{t.expenses.fixed.everyMonthDay} {exp.dayOfMonth}.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                    <span className="text-[#f87171] font-semibold text-sm">{formatAmount(exp.amount)}</span>
                    <button onClick={() => openEditFixed(exp)}
                      className="text-[#9D84D4] hover:text-[#B8A3E8] cursor-pointer"><Edit2 size={13} /></button>
                    <button onClick={() => setConfirmFixedId(exp.id!)}
                      className="text-[#9D84D4] hover:text-[#f87171] cursor-pointer"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
            {/* Total row */}
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-[var(--border-subtle)] bg-[rgba(167,139,250,0.06)]">
              <span className="text-white font-semibold text-sm">{t.expenses.fixed.total}</span>
              <span className="text-[#f87171] font-bold">{formatAmount(totalFixed)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── FAB: mobile/tablet only ── */}
      <button
        onClick={openAdd}
        className="lg:hidden fixed right-4 w-14 h-14 rounded-full flex items-center justify-center text-white z-30 shadow-xl cursor-pointer"
        style={{
          bottom: '5rem',
          background: 'var(--accent-strong)',
          boxShadow: '0 4px 20px rgba(124, 58, 237, 0.4)',
        }}
      >
        <Plus size={26} />
      </button>

      {/* Modals */}
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editingVar ? t.expenses.variable.editTitle : t.expenses.variable.addTitle}
        footer={
          <button
            onClick={handleSaveVar}
            style={{
              width: '100%', height: '56px', borderRadius: '16px',
              background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
              fontSize: '16px', fontWeight: 600, color: 'white',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {editingVar ? t.expenses.variable.saveChanges : t.expenses.variable.add}
          </button>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9D84D4] mb-2 leading-relaxed">
              {t.expenses.variable.amount}
            </label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={varForm.amount}
              onChange={e => {
                const raw = e.target.value.replace(/[^0-9,]/g, '')
                if ((raw.match(/,/g) || []).length > 1) return
                setVarForm(f => ({ ...f, amount: raw }))
              }}
              onKeyDown={e => {
                const allowed = ['0','1','2','3','4','5','6','7','8','9',',','Backspace','Delete','Tab','ArrowLeft','ArrowRight','Enter']
                if (!allowed.includes(e.key)) e.preventDefault()
              }}
              className="input-field font-mono font-bold"
              style={{ height: '60px', fontSize: '1.5rem' }}
            />
          </div>

          {livePct !== null && liveLimit && (
            <div
              className="rounded-2xl p-3.5"
              style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex justify-between text-xs mb-2">
                <span className="text-[#B8A3E8]">{t.expenses.variable.budgetLabel}: {liveBudget?.categoryName}</span>
                <span className="font-mono text-[#B8A3E8]">{formatAmount(liveSpent)} / {formatAmount(liveLimit)}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#32265A' }}>
                <div className="h-full rounded-full progress-fill"
                  style={{ width: `${livePct}%`, backgroundColor: getBudgetBarColor(livePct) }} />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9D84D4] mb-2 leading-relaxed">
              {t.expenses.variable.category}
            </label>
            {!newCatMode ? (
              <select
                value={varForm.categoryId}
                onChange={e => {
                  if (e.target.value === '__new__') { setNewCatMode(true); setVarForm(f => ({ ...f, categoryId: '' })) }
                  else setVarForm(f => ({ ...f, categoryId: e.target.value }))
                }}
                className="input-field cursor-pointer"
              >
                <option value="">{t.expenses.variable.selectCategory}</option>
                {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>)}
                <option value="__new__">{t.expenses.variable.newCategory}</option>
              </select>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t.expenses.variable.newCategoryName}
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  className="input-field flex-1"
                />
                <button
                  onClick={() => { setNewCatMode(false); setNewCatName('') }}
                  className="btn-secondary px-3 rounded-xl shrink-0"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9D84D4] mb-2 leading-relaxed">
              {t.expenses.variable.noteLabelOptional}
            </label>
            <input
              type="text"
              placeholder="napr. Večera v reštaurácii"
              value={varForm.note}
              onChange={e => setVarForm(f => ({ ...f, note: e.target.value }))}
              className="input-field"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9D84D4] mb-2 leading-relaxed">
              {t.expenses.variable.date}
            </label>
            <DateInput
              value={varForm.date}
              onChange={date => setVarForm(f => ({ ...f, date }))}
            />
          </div>
        </div>
      </BottomSheet>

      <BottomSheet
        open={fixedSheetOpen}
        onClose={() => setFixedSheetOpen(false)}
        title={editingFixed ? t.expenses.fixed.editTitle : t.expenses.fixed.newTitle}
        footer={
          <button
            onClick={handleSaveFixed}
            style={{
              width: '100%', height: '56px', borderRadius: '16px',
              background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
              fontSize: '16px', fontWeight: 600, color: 'white',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {editingFixed ? t.expenses.variable.saveChanges : t.expenses.fixed.add}
          </button>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9D84D4] mb-2 leading-relaxed">
              {t.expenses.fixed.nameLabel}
            </label>
            <input
              type="text"
              placeholder="napr. Nájom"
              value={fixedForm.label}
              onChange={e => setFixedForm(f => ({ ...f, label: e.target.value }))}
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9D84D4] mb-2 leading-relaxed">
              {t.expenses.fixed.amountLabel}
            </label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={fixedForm.amount}
              onChange={e => {
                const raw = e.target.value.replace(/[^0-9,]/g, '')
                if ((raw.match(/,/g) || []).length > 1) return
                setFixedForm(f => ({ ...f, amount: raw }))
              }}
              onKeyDown={e => {
                const allowed = ['0','1','2','3','4','5','6','7','8','9',',','Backspace','Delete','Tab','ArrowLeft','ArrowRight','Enter']
                if (!allowed.includes(e.key)) e.preventDefault()
              }}
              className="input-field font-mono font-bold"
              style={{ height: '60px', fontSize: '1.5rem' }}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9D84D4] mb-2 leading-relaxed">
              {t.expenses.fixed.dayLabel}
            </label>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="31"
              value={fixedForm.dayOfMonth}
              onChange={e => setFixedForm(f => ({ ...f, dayOfMonth: e.target.value }))}
              className="input-field"
            />
          </div>
        </div>
      </BottomSheet>

      <ConfirmDialog open={confirmVarId !== null}
        message={t.expenses.variable.deleteConfirm}
        onConfirm={async () => { if (confirmVarId !== null) { await deleteVariableExpense(confirmVarId); setConfirmVarId(null) } }}
        onCancel={() => setConfirmVarId(null)}
      />
      <ConfirmDialog open={confirmFixedId !== null}
        message={t.expenses.fixed.deleteConfirm}
        onConfirm={async () => { if (confirmFixedId !== null) { await deleteFixedExpense(confirmFixedId); setConfirmFixedId(null) } }}
        onCancel={() => setConfirmFixedId(null)}
      />
    </div>
  )
}
