import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { BottomSheet } from './BottomSheet'
import { useIncomes } from '../hooks/useIncomes'
import { useVariableExpenses } from '../hooks/useVariableExpenses'
import { useFixedExpenses } from '../hooks/useFixedExpenses'
import { useCategories } from '../hooks/useCategories'
import { useBudgetStatus } from '../hooks/useBudgetStatus'
import { useFormatters } from '../hooks/useFormatters'
import { useTranslation } from '../i18n'
import { todayISO } from '../utils/format'

type ModalType = 'income' | 'variable' | 'fixed' | 'category' | null

const FAB_VISIBLE_PAGES = ['income', 'variable-expenses', 'fixed-expenses', 'categories']
const ALL_ACTIVE_PAGES = [...FAB_VISIBLE_PAGES, 'dashboard']

const PAGE_MODAL_MAP: Record<string, ModalType> = {
  'income': 'income',
  'variable-expenses': 'variable',
  'fixed-expenses': 'fixed',
  'categories': 'category',
}

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#22c55e',
  '#10b981', '#06b6d4', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#ec4899', '#64748b',
]

const PRESET_ICONS = [
  '🍔', '🛒', '🚗', '🏠', '💊', '🎉', '👕', '📚',
  '✈️', '🎮', '🐾', '💇', '🏋️', '📱', '💡', '🍕',
  '☕', '🎬', '🛻', '🏥', '🎓', '🌿', '🧴', '💰',
]

interface GlobalFABProps {
  month: number
  year: number
  showToast: (msg: string) => void
  currentPage: string
  openTrigger?: number
}

export function GlobalFAB({ month, year, showToast, currentPage, openTrigger }: GlobalFABProps) {
  const [activeModal, setActiveModal] = useState<ModalType>(null)
  const [showTypeSelector, setShowTypeSelector] = useState(false)
  const [isMobile] = useState(() => window.innerWidth < 1024)

  useEffect(() => {
    if (!openTrigger) return
    if (currentPage === 'dashboard') {
      setShowTypeSelector(true)
    } else {
      const modalType = PAGE_MODAL_MAP[currentPage] ?? 'variable'
      setActiveModal(modalType)
    }
  }, [openTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data hooks ────────────────────────────────────────────────────────────
  const { addIncome } = useIncomes(month, year)
  const { addVariableExpense, variableExpenses } = useVariableExpenses(month, year)
  const { addFixedExpense } = useFixedExpenses()
  const { categories, addCategory } = useCategories()
  const budgetStatuses = useBudgetStatus({ categories, variableExpenses })
  const { formatAmount } = useFormatters()
  const { t } = useTranslation()

  // ── Income form state ─────────────────────────────────────────────────────
  const [incAmt, setIncAmt] = useState('')
  const [incLabel, setIncLabel] = useState('')
  const [incDate, setIncDate] = useState(todayISO())
  const [incRecurring, setIncRecurring] = useState(false)

  // ── Variable expense form state ───────────────────────────────────────────
  const [varAmt, setVarAmt] = useState('')
  const [varCatId, setVarCatId] = useState('')
  const [varNote, setVarNote] = useState('')
  const [varDate, setVarDate] = useState(todayISO())
  const [varNewCatMode, setVarNewCatMode] = useState(false)
  const [varNewCatName, setVarNewCatName] = useState('')

  // ── Fixed expense form state ──────────────────────────────────────────────
  const [fixLabel, setFixLabel] = useState('')
  const [fixAmt, setFixAmt] = useState('')
  const [fixDay, setFixDay] = useState('1')

  // ── Category form state ───────────────────────────────────────────────────
  const [catName, setCatName] = useState('')
  const [catColor, setCatColor] = useState(PRESET_COLORS[6])
  const [catIcon, setCatIcon] = useState('🛒')
  const [catBudgetLimit, setCatBudgetLimit] = useState('')

  // ── Open / close helpers ──────────────────────────────────────────────────
  function openModal(type: ModalType) {
    setTimeout(() => {
      if (type === 'income') {
        setIncAmt(''); setIncLabel(''); setIncDate(todayISO()); setIncRecurring(false)
      } else if (type === 'variable') {
        setVarAmt(''); setVarCatId(''); setVarNote(''); setVarDate(todayISO())
        setVarNewCatMode(false); setVarNewCatName('')
      } else if (type === 'fixed') {
        setFixLabel(''); setFixAmt(''); setFixDay('1')
      } else if (type === 'category') {
        setCatName(''); setCatColor(PRESET_COLORS[6]); setCatIcon('🛒'); setCatBudgetLimit('')
      }
      setActiveModal(type)
    }, 50)
  }

  function closeModal() { setActiveModal(null) }

  // ── Save handlers ─────────────────────────────────────────────────────────
  async function saveIncome() {
    const amt = parseFloat(incAmt.replace(',', '.'))
    if (!incLabel.trim() || isNaN(amt) || amt <= 0) return
    await addIncome({ amount: amt, label: incLabel.trim(), date: incDate, recurring: incRecurring })
    closeModal()
  }

  async function saveVariable() {
    const amt = parseFloat(varAmt.replace(',', '.'))
    if (isNaN(amt) || amt <= 0) return
    let catId: string
    if (varNewCatMode) {
      if (!varNewCatName.trim()) return
      catId = await addCategory({ name: varNewCatName.trim(), color: '#64748b', icon: '📦', type: 'expense' })
    } else {
      if (!varCatId) return
      catId = varCatId
      const bs = budgetStatuses.find(b => b.categoryId === catId)
      if (bs) {
        const newSpent = bs.spent + amt
        const newPct = (newSpent / bs.limit) * 100
        if (newPct >= 100 && bs.percentage < 100) showToast(t.expenses.categories.limitExceededToast.replace('{name}', bs.categoryName))
        else if (newPct >= 90 && bs.percentage < 90) showToast(t.expenses.categories.nearLimitToast.replace('{name}', bs.categoryName))
      }
    }
    await addVariableExpense({ amount: amt, categoryId: catId, note: varNote, date: varDate })
    closeModal()
  }

  async function saveFixed() {
    const amt = parseFloat(fixAmt.replace(',', '.'))
    const day = parseInt(fixDay)
    if (!fixLabel.trim() || isNaN(amt) || amt <= 0 || isNaN(day) || day < 1 || day > 31) return
    await addFixedExpense({ label: fixLabel.trim(), amount: amt, dayOfMonth: day, note: '' })
    closeModal()
  }

  async function saveCategory() {
    if (!catName.trim()) return
    const limit = catBudgetLimit ? parseFloat(catBudgetLimit.replace(',', '.')) : undefined
    await addCategory({
      name: catName.trim(),
      color: catColor,
      icon: catIcon,
      type: 'expense',
      budgetLimit: limit && limit > 0 ? limit : undefined,
    })
    closeModal()
  }

  // ── Live budget preview (variable expense) ────────────────────────────────
  const liveBudget = varCatId ? budgetStatuses.find(b => b.categoryId === varCatId) : null
  const liveVarAmt = parseFloat(varAmt.replace(',', '.')) || 0
  const liveSpent = liveBudget ? liveBudget.spent + liveVarAmt : 0
  const liveLimit = liveBudget?.limit
  const livePct = liveLimit ? Math.min((liveSpent / liveLimit) * 100, 100) : null
  const livePctColor = livePct !== null
    ? (livePct >= 100 ? '#f87171' : livePct >= 70 ? '#fbbf24' : '#34d399')
    : '#34d399'

  // ── Only render on allowed pages ──────────────────────────────────────────
  if (!ALL_ACTIVE_PAGES.includes(currentPage)) return null

  const handleFABClick = () => {
    if (currentPage === 'dashboard') {
      setShowTypeSelector(true)
      return
    }
    const modalType = PAGE_MODAL_MAP[currentPage]
    if (modalType) openModal(modalType)
  }

  return (
    <>
      {/* ── Floating Action Button — mobile only, dashboard only ────────── */}
      {isMobile && currentPage === 'dashboard' && (
        <button
          onClick={handleFABClick}
          aria-label="Pridať záznam"
          className="fixed right-4 w-14 h-14 rounded-full flex items-center justify-center text-white shadow-xl cursor-pointer"
          style={{
            bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
            zIndex: 40,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            boxShadow: '0 8px 25px rgba(99,102,241,0.4)',
          }}
        >
          <Plus size={26} />
        </button>
      )}

      {/* ── TYPE SELECTOR (dashboard) ────────────────────────────────────── */}
      <BottomSheet open={showTypeSelector} onClose={() => setShowTypeSelector(false)} title={t.fab.title}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {([
            { type: 'income' as ModalType, label: t.fab.incomeLabel, icon: '💰', desc: t.fab.incomeDesc, color: '#34d399' },
            { type: 'variable' as ModalType, label: t.fab.expenseLabel, icon: '💸', desc: t.fab.expenseDesc, color: '#f87171' },
            { type: 'fixed' as ModalType, label: t.fab.fixedLabel, icon: '🔒', desc: t.fab.fixedDesc, color: '#fbbf24' },
            { type: 'category' as ModalType, label: t.fab.categoryLabel, icon: '🏷️', desc: t.fab.categoryDesc, color: '#a78bfa' },
          ]).map(item => (
            <button
              key={item.type}
              onClick={() => { setShowTypeSelector(false); openModal(item.type) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', borderRadius: 14,
                background: 'var(--bg3)', border: '1px solid var(--border)',
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg4)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg3)' }}
            >
              <div style={{ width: 42, height: 42, borderRadius: 12, background: item.color + '1a', border: '1px solid ' + item.color + '33', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                {item.icon}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{item.desc}</div>
              </div>
              <svg style={{ marginLeft: 'auto', flexShrink: 0 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* ── ADD INCOME modal ─────────────────────────────────────────────── */}
      <BottomSheet open={activeModal === 'income'} onClose={closeModal} title={t.income.addTitle}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="form-label">{t.income.amount}</label>
            <div className="amount-input-wrap">
              <input
                type="text" inputMode="decimal" placeholder="0,00"
                value={incAmt}
                onChange={e => {
                  const raw = e.target.value.replace(/[^0-9,]/g, '')
                  if ((raw.match(/,/g) || []).length > 1) return
                  setIncAmt(raw)
                }}
                onKeyDown={e => {
                  const allowed = ['0','1','2','3','4','5','6','7','8','9',',','Backspace','Delete','Tab','ArrowLeft','ArrowRight','Enter']
                  if (!allowed.includes(e.key)) e.preventDefault()
                }}
              />
              <span className="currency">€</span>
            </div>
          </div>
          <div>
            <label className="form-label">{t.income.description}</label>
            <input
              type="text" placeholder={t.income.descriptionPlaceholder}
              value={incLabel}
              onChange={e => setIncLabel(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="form-label">{t.income.date}</label>
            <input
              type="date"
              value={incDate}
              onChange={e => setIncDate(e.target.value)}
              className="input-field"
              style={{ colorScheme: 'dark' }}
            />
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', borderRadius: 14,
            background: 'var(--bg3)', border: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{t.income.recurringToggle}</span>
            <button
              type="button"
              onClick={() => setIncRecurring(r => !r)}
              style={{
                width: 44, height: 24, borderRadius: 99, cursor: 'pointer', flexShrink: 0, position: 'relative',
                background: incRecurring ? 'var(--violet)' : 'var(--bg4)',
                border: 'none', transition: 'background 0.2s',
              }}
            >
              <div style={{
                position: 'absolute', top: 2, left: incRecurring ? 22 : 2,
                width: 20, height: 20, borderRadius: '50%', background: 'white',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={closeModal}
              style={{
                flex: 1, height: 48, borderRadius: 12, border: '1px solid var(--border2)',
                background: 'transparent', color: 'var(--text2)', fontSize: 14, fontWeight: 500, cursor: 'pointer',
              }}
            >{t.common.cancel}</button>
            <button
              onClick={saveIncome}
              disabled={!incLabel.trim() || !incAmt}
              style={{
                flex: 2, height: 48, borderRadius: 12, border: 'none',
                background: (incLabel.trim() && incAmt) ? 'linear-gradient(135deg,#8B5CF6,#6D28D9)' : 'var(--bg3)',
                color: (incLabel.trim() && incAmt) ? 'white' : 'var(--text3)',
                fontSize: 14, fontWeight: 700, cursor: (incLabel.trim() && incAmt) ? 'pointer' : 'not-allowed',
                boxShadow: (incLabel.trim() && incAmt) ? '0 4px 16px rgba(139,92,246,0.35)' : 'none',
                transition: 'all 0.2s',
              }}
            >{t.fab.saveIncome} →</button>
          </div>
        </div>
      </BottomSheet>

      {/* ── ADD VARIABLE EXPENSE modal ────────────────────────────────────── */}
      <BottomSheet open={activeModal === 'variable'} onClose={closeModal} title={t.expenses.variable.addTitle}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="form-label">{t.expenses.variable.amount}</label>
            <div className="amount-input-wrap">
              <input
                type="text" inputMode="decimal" placeholder="0,00"
                value={varAmt}
                onChange={e => {
                  const raw = e.target.value.replace(/[^0-9,]/g, '')
                  if ((raw.match(/,/g) || []).length > 1) return
                  setVarAmt(raw)
                }}
                onKeyDown={e => {
                  const allowed = ['0','1','2','3','4','5','6','7','8','9',',','Backspace','Delete','Tab','ArrowLeft','ArrowRight','Enter']
                  if (!allowed.includes(e.key)) e.preventDefault()
                }}
              />
              <span className="currency">€</span>
            </div>
          </div>

          {livePct !== null && liveLimit != null && (
            <div style={{ borderRadius: 14, padding: '12px 14px', background: 'var(--bg3)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8, color: 'var(--text2)' }}>
                <span>{t.expenses.variable.budgetLabel}: {liveBudget?.categoryName}</span>
                <span style={{ fontFamily: "'DM Mono',monospace" }}>{formatAmount(liveSpent)} / {formatAmount(liveLimit)}</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--bg4)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 2, width: `${livePct}%`, background: livePctColor }} />
              </div>
            </div>
          )}

          <div>
            <label className="form-label">{t.expenses.variable.category}</label>
            {!varNewCatMode ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {categories.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setVarCatId(c.id ?? '')}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '5px 11px', borderRadius: 99, border: 'none',
                      fontSize: 12.5, fontWeight: 500, cursor: 'pointer', flexShrink: 0,
                      background: varCatId === c.id ? `${c.color}22` : 'var(--bg3)',
                      color: varCatId === c.id ? c.color : 'var(--text2)',
                      outline: varCatId === c.id ? `1.5px solid ${c.color}55` : 'none',
                      transition: 'all 0.12s',
                    }}
                  >{c.icon} {c.name}</button>
                ))}
                <button
                  type="button"
                  onClick={() => setVarNewCatMode(true)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '5px 11px', borderRadius: 99,
                    border: '1px dashed var(--border2)',
                    background: 'transparent', color: 'var(--text3)',
                    fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                >+ {t.expenses.variable.newCategory}</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text" placeholder={t.expenses.variable.newCategoryName}
                  value={varNewCatName}
                  onChange={e => setVarNewCatName(e.target.value)}
                  className="input-field"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => { setVarNewCatMode(false); setVarNewCatName('') }}
                  style={{
                    padding: '0 14px', borderRadius: 10, border: '1px solid var(--border2)',
                    background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer', flexShrink: 0,
                  }}
                >✕</button>
              </div>
            )}
          </div>

          <div>
            <label className="form-label">{t.expenses.variable.note}</label>
            <input
              type="text" placeholder={t.expenses.variable.notePlaceholder}
              value={varNote}
              onChange={e => setVarNote(e.target.value)}
              className="input-field"
            />
          </div>

          <div>
            <label className="form-label">{t.expenses.variable.date}</label>
            <input
              type="date"
              value={varDate}
              onChange={e => setVarDate(e.target.value)}
              className="input-field"
              style={{ colorScheme: 'dark' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={closeModal}
              style={{
                flex: 1, height: 48, borderRadius: 12, border: '1px solid var(--border2)',
                background: 'transparent', color: 'var(--text2)', fontSize: 14, fontWeight: 500, cursor: 'pointer',
              }}
            >{t.common.cancel}</button>
            <button
              onClick={saveVariable}
              disabled={varNewCatMode ? !varNewCatName.trim() || !varAmt : !varCatId || !varAmt}
              style={{
                flex: 2, height: 48, borderRadius: 12, border: 'none',
                background: (varNewCatMode ? varNewCatName.trim() && varAmt : varCatId && varAmt) ? 'linear-gradient(135deg,#8B5CF6,#6D28D9)' : 'var(--bg3)',
                color: (varNewCatMode ? varNewCatName.trim() && varAmt : varCatId && varAmt) ? 'white' : 'var(--text3)',
                fontSize: 14, fontWeight: 700,
                cursor: (varNewCatMode ? varNewCatName.trim() && varAmt : varCatId && varAmt) ? 'pointer' : 'not-allowed',
                boxShadow: (varNewCatMode ? varNewCatName.trim() && varAmt : varCatId && varAmt) ? '0 4px 16px rgba(139,92,246,0.35)' : 'none',
                transition: 'all 0.2s',
              }}
            >{t.fab.saveExpense} →</button>
          </div>
        </div>
      </BottomSheet>

      {/* ── ADD FIXED EXPENSE modal ───────────────────────────────────────── */}
      <BottomSheet open={activeModal === 'fixed'} onClose={closeModal} title={t.expenses.fixed.newTitle}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="form-label">{t.expenses.fixed.amountLabel}</label>
            <div className="amount-input-wrap">
              <input
                type="text" inputMode="decimal" placeholder="0,00"
                value={fixAmt}
                onChange={e => {
                  const raw = e.target.value.replace(/[^0-9,]/g, '')
                  if ((raw.match(/,/g) || []).length > 1) return
                  setFixAmt(raw)
                }}
                onKeyDown={e => {
                  const allowed = ['0','1','2','3','4','5','6','7','8','9',',','Backspace','Delete','Tab','ArrowLeft','ArrowRight','Enter']
                  if (!allowed.includes(e.key)) e.preventDefault()
                }}
              />
              <span className="currency">€</span>
            </div>
          </div>
          <div>
            <label className="form-label">{t.expenses.fixed.nameLabel}</label>
            <input
              className="input-field" placeholder={t.expenses.fixed.namePlaceholder}
              value={fixLabel}
              onChange={e => setFixLabel(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">{t.expenses.fixed.dayLabel}</label>
            <input
              className="input-field"
              type="number" inputMode="numeric" placeholder="1" min="1" max="31"
              value={fixDay}
              onChange={e => setFixDay(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={closeModal}
              style={{
                flex: 1, height: 48, borderRadius: 12, border: '1px solid var(--border2)',
                background: 'transparent', color: 'var(--text2)', fontSize: 14, fontWeight: 500, cursor: 'pointer',
              }}
            >{t.common.cancel}</button>
            <button
              onClick={saveFixed}
              disabled={!fixLabel.trim() || !fixAmt}
              style={{
                flex: 2, height: 48, borderRadius: 12, border: 'none',
                background: (fixLabel.trim() && fixAmt) ? 'linear-gradient(135deg,#8B5CF6,#6D28D9)' : 'var(--bg3)',
                color: (fixLabel.trim() && fixAmt) ? 'white' : 'var(--text3)',
                fontSize: 14, fontWeight: 700,
                cursor: (fixLabel.trim() && fixAmt) ? 'pointer' : 'not-allowed',
                boxShadow: (fixLabel.trim() && fixAmt) ? '0 4px 16px rgba(139,92,246,0.35)' : 'none',
                transition: 'all 0.2s',
              }}
            >{t.fab.saveFixed} →</button>
          </div>
        </div>
      </BottomSheet>

      {/* ── ADD CATEGORY modal ────────────────────────────────────────────── */}
      <BottomSheet open={activeModal === 'category'} onClose={closeModal} title={t.expenses.categories.newTitle}>
        <div className="flex flex-col gap-5">
          <div>
            <label className="form-label">{t.expenses.categories.nameLabel}</label>
            <input
              className="input-field"
              placeholder={t.expenses.categories.namePlaceholder}
              value={catName}
              onChange={e => setCatName(e.target.value)}
            />
          </div>

          <div>
            <label className="form-label">
              {t.expenses.categories.iconLabel} <span style={{ color: 'var(--text)', marginLeft: 6, fontSize: 14, textTransform: 'none', letterSpacing: 0 }}>{catIcon}</span>
            </label>
            <div className="grid grid-cols-8 gap-1.5">
              {PRESET_ICONS.map(em => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setCatIcon(em)}
                  style={{
                    height: 40, width: '100%', borderRadius: 10, fontSize: 18,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.12s', cursor: 'pointer',
                    background: catIcon === em ? catColor + '26' : 'var(--bg3)',
                    border: catIcon === em ? `1px solid ${catColor}55` : '1px solid var(--border)',
                  }}
                >{em}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="form-label">{t.expenses.categories.colorLabel}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCatColor(c)}
                  style={{
                    width: 32, height: 32, borderRadius: '50%', background: c,
                    border: 'none', cursor: 'pointer',
                    transition: 'transform 0.15s',
                    transform: catColor === c ? 'scale(1.12)' : 'scale(1)',
                    boxShadow: catColor === c ? `0 0 0 3px var(--bg2), 0 0 0 5px ${c}` : 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  {catColor === c && <span style={{ color: 'white', fontSize: 12, fontWeight: 700 }}>✓</span>}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="form-label">
              {t.expenses.categories.limitLabel}{' '}
              <span style={{ color: 'var(--text3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{t.expenses.categories.limitOptional}</span>
            </label>
            <input
              className="input-field"
              type="text" inputMode="decimal"
              placeholder={t.expenses.categories.limitPlaceholder}
              value={catBudgetLimit}
              onChange={e => {
                const raw = e.target.value.replace(/[^0-9,]/g, '')
                if ((raw.match(/,/g) || []).length > 1) return
                setCatBudgetLimit(raw)
              }}
              onKeyDown={e => {
                const allowed = ['0','1','2','3','4','5','6','7','8','9',',','Backspace','Delete','Tab','ArrowLeft','ArrowRight','Enter']
                if (!allowed.includes(e.key)) e.preventDefault()
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={closeModal}
              style={{
                flex: 1, height: 48, borderRadius: 12, border: '1px solid var(--border2)',
                background: 'transparent', color: 'var(--text2)', fontSize: 14, fontWeight: 500, cursor: 'pointer',
              }}
            >{t.common.cancel}</button>
            <button
              onClick={saveCategory}
              disabled={!catName.trim()}
              style={{
                flex: 2, height: 48, borderRadius: 12, border: 'none',
                background: catName.trim() ? 'linear-gradient(135deg,#8B5CF6,#6D28D9)' : 'var(--bg3)',
                color: catName.trim() ? 'white' : 'var(--text3)',
                fontSize: 14, fontWeight: 700,
                cursor: catName.trim() ? 'pointer' : 'not-allowed',
                boxShadow: catName.trim() ? '0 4px 16px rgba(139,92,246,0.35)' : 'none',
                transition: 'all 0.2s',
              }}
            >{t.fab.saveCategory} →</button>
          </div>
        </div>
      </BottomSheet>
    </>
  )
}
