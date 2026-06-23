import { useState, useMemo, useEffect } from 'react'
import { Pencil, Trash2, Plus, Lock } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { BottomSheet } from '../components/BottomSheet'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { CsvImportModal } from '../components/CsvImportModal'
import { useFixedExpenses } from '../hooks/useFixedExpenses'
import { useVariableExpenses } from '../hooks/useVariableExpenses'
import { useCategories } from '../hooks/useCategories'
import { useFormatters } from '../hooks/useFormatters'
import { useTranslation } from '../i18n'
import type { FixedExpense, Category } from '../types'
import { SwipeableRow } from '../components/SwipeableRow'
import React from 'react'

const FALLBACK_ICON = '📦'
const FALLBACK_COLOR = '#6b7280'

function catBg(color: string) {
  return color + '26'
}

const pillStyle = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 14px', borderRadius: 50, fontSize: 13,
  fontWeight: active ? 600 : 500, cursor: 'pointer',
  border: active ? '1px solid rgba(139,92,246,0.3)' : '1px solid var(--border2)',
  background: active ? 'rgba(139,92,246,0.12)' : 'var(--bg3)',
  color: active ? 'var(--violet)' : 'var(--text2)',
  fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s', whiteSpace: 'nowrap',
  flexShrink: 0,
})

interface FixedExpensesPageProps {
  month: number
  year: number
}

export function FixedExpensesPage({ month, year }: FixedExpensesPageProps) {
  const { fixedExpenses, addFixedExpense, updateFixedExpense, deleteFixedExpense } = useFixedExpenses()
  const { variableExpenses } = useVariableExpenses(month, year)
  const { categories } = useCategories()
  const { formatAmount } = useFormatters()
  const { t } = useTranslation()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const expenseCategories = useMemo(
    () => categories.filter(c => c.type === 'expense'),
    [categories]
  )

  const getCat = (id?: string | null): Category | null =>
    expenseCategories.find(c => c.id === id) ?? null

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<FixedExpense | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null)
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [csvOpen, setCsvOpen] = useState(false)

  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [dayOfMonth, setDayOfMonth] = useState('1')
  const [categoryId, setCategoryId] = useState<string>('')
  const [note, setNote] = useState('')

  const total = useMemo(() => fixedExpenses.reduce((s, e) => s + e.amount, 0), [fixedExpenses])
  const filteredTotal = useMemo(() =>
    activeCat === null ? total : fixedExpenses.filter(e => (e.categoryId ?? '') === activeCat).reduce((s, e) => s + e.amount, 0)
  , [fixedExpenses, activeCat, total])
  const variableTotal = useMemo(() => variableExpenses.reduce((s, e) => s + e.amount, 0), [variableExpenses])

  const filtered = useMemo(
    () => activeCat === null
      ? fixedExpenses
      : fixedExpenses.filter(e => (e.categoryId ?? '') === activeCat),
    [fixedExpenses, activeCat]
  )

  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of fixedExpenses) {
      const key = e.categoryId ?? ''
      map.set(key, (map.get(key) ?? 0) + e.amount)
    }
    return Array.from(map.entries())
      .filter(([, amt]) => amt > 0)
      .map(([id, amount]) => ({ id, amount }))
  }, [fixedExpenses])

  const usedCategoryIds = useMemo(
    () => [...new Set(fixedExpenses.map(e => e.categoryId ?? ''))],
    [fixedExpenses]
  )

  const upcomingPayments = useMemo(() => {
    const today = new Date().getDate()
    return [...fixedExpenses]
      .map(e => ({ ...e, daysUntil: ((e.dayOfMonth - today + 31) % 31) }))
      .sort((a, b) => a.daysUntil - b.daysUntil)
      .slice(0, 4)
  }, [fixedExpenses])

  const daysInCurrentMonth = useMemo(() => new Date(year, month, 0).getDate(), [year, month])
  const calendarToday = (() => {
    const n = new Date()
    return (n.getFullYear() === year && n.getMonth() + 1 === month) ? n.getDate() : -1
  })()

  function countdownBadge(daysUntil: number) {
    if (daysUntil === 0) return { text: t.expenses.fixed.countdown.today, color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' }
    const text = t.expenses.fixed.countdown.days.replace('{n}', String(daysUntil))
    if (daysUntil <= 3) return { text, color: '#f97316', bg: 'rgba(249,115,22,0.15)' }
    if (daysUntil <= 7) return { text, color: '#eab308', bg: 'rgba(234,179,8,0.15)' }
    return { text, color: '#22c55e', bg: 'rgba(34,197,94,0.15)' }
  }

  function openAdd() {
    setEditing(null)
    setLabel(''); setAmount(''); setDayOfMonth('1')
    setCategoryId(expenseCategories[0]?.id ?? '')
    setNote('')
    setSheetOpen(true)
  }

  function openEdit(e: FixedExpense) {
    setEditing(e); setLabel(e.label); setAmount(String(e.amount))
    setDayOfMonth(String(e.dayOfMonth)); setCategoryId(e.categoryId ?? ''); setNote(e.note)
    setSheetOpen(true)
  }

  function closeSheet() { setSheetOpen(false); setEditing(null) }

  async function handleSave() {
    const amt = parseFloat(amount.replace(',', '.'))
    const day = parseInt(dayOfMonth)
    if (!label.trim() || isNaN(amt) || amt <= 0 || isNaN(day) || day < 1 || day > 28) return
    const catId = categoryId || null
    if (editing?.id != null) {
      await updateFixedExpense(editing.id, { label: label.trim(), amount: amt, dayOfMonth: day, categoryId: catId, note })
    } else {
      await addFixedExpense({ label: label.trim(), amount: amt, dayOfMonth: day, categoryId: catId, note })
    }
    closeSheet()
  }

  async function handleDelete(id: string) {
    await deleteFixedExpense(id)
    setDeleteId(null)
  }


  const MONTHS_SK = t.monthsShort

  const rpSection = (title: string, children: React.ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text3)', fontFamily: "'DM Mono', monospace", marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  )

  const yearlyContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', fontFamily: "'DM Mono', monospace", letterSpacing: '-0.5px' }}>{formatAmount(total * 12)}</div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>{formatAmount(total)} × 12 {t.expenses.fixed.monthly.toLowerCase()}</div>
      {categoryTotals.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {categoryTotals.map(({ id, amount: catAmt }) => {
            const cat = getCat(id)
            const icon = cat?.icon ?? FALLBACK_ICON
            const name = cat?.name ?? '—'
            return (
              <div key={id || '__none__'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                  <span style={{ flexShrink: 0 }}>{icon}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0, marginLeft: 8 }}>
                  <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: 'var(--text2)' }}>{formatAmount(catAmt)}<span style={{ fontSize: 10, color: 'var(--text3)' }}>/mes.</span></span>
                  <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: 'var(--text3)' }}>{formatAmount(catAmt * 12)} / rok</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const upcomingContent = upcomingPayments.length === 0 ? (
    <div style={{ color: 'var(--text3)', fontSize: 13 }}>—</div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {upcomingPayments.map(e => {
        const badge = countdownBadge(e.daysUntil)
        const cat = getCat(e.categoryId)
        const icon = cat?.icon ?? FALLBACK_ICON
        const color = cat?.color ?? FALLBACK_COLOR
        return (
          <div key={e.id ?? e.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: catBg(color), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
              {icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</div>
              <span style={{ fontSize: 11, fontWeight: 600, color: badge.color, background: badge.bg, padding: '2px 6px', borderRadius: 20 }}>{badge.text}</span>
            </div>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700, color: 'var(--red)', flexShrink: 0 }}>{formatAmount(e.amount)}</span>
          </div>
        )
      })}
    </div>
  )

  const vsContent = (total > 0 || variableTotal > 0) ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 100, height: 100, flexShrink: 0, minHeight: 100 }}>
        {mounted && (
          <ResponsiveContainer width={100} height={100}>
            <PieChart>
              <Pie
                data={[
                  { name: t.nav.fixed, value: total > 0 ? total : 0.001 },
                  { name: t.nav.variable, value: variableTotal > 0 ? variableTotal : 0.001 },
                ]}
                cx="50%" cy="50%" innerRadius={28} outerRadius={46}
                paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}
              >
                <Cell fill="#f97316" />
                <Cell fill="#7c3aed" />
              </Pie>
              <Tooltip
                formatter={(v: number) => [formatAmount(v)]}
                contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f97316', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t.nav.fixed}</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{formatAmount(total)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#7c3aed', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t.nav.variable}</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{formatAmount(variableTotal)}</div>
          </div>
        </div>
        {(total + variableTotal) > 0 && (
          <div style={{ fontSize: 11, color: '#f97316', fontWeight: 700, marginTop: 8 }}>
            {t.nav.fixed} {Math.round((total / (total + variableTotal)) * 100)}%
          </div>
        )}
      </div>
    </div>
  ) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

      <CsvImportModal open={csvOpen} onClose={() => setCsvOpen(false)} filterType="expense" />

      {/* FAB — mobile only */}
      {!sheetOpen && (
        <button
          onClick={openAdd}
          className="lg:hidden flex items-center justify-center"
          style={{ position: 'fixed', right: 20, bottom: 'calc(88px + env(safe-area-inset-bottom, 16px))', width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, #7C3AED, #6D28D9)', border: 'none', cursor: 'pointer', color: 'white', boxShadow: '0 4px 20px rgba(124,58,237,0.5)', zIndex: 50 }}
        >
          <Plus size={24} strokeWidth={2.5} />
        </button>
      )}

      {/* Content row */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

        {/* Main scroll area */}
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 20, paddingLeft: 20, paddingRight: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Hero wallet card */}
          <div style={{
            background: 'linear-gradient(135deg,#2a1d05 0%,#5d3f10 45%,#2a1d05 100%)',
            borderRadius: 24, padding: '24px 26px 20px', position: 'relative', overflow: 'hidden', color: 'white',
            boxShadow: '0 18px 50px -16px rgba(93,63,16,0.4),0 0 0 1px rgba(251,191,36,0.22)',
            flexShrink: 0,
          }}>
            <div style={{position:'absolute',top:-90,right:-50,width:240,height:240,borderRadius:'50%',background:'radial-gradient(circle,rgba(251,191,36,0.32),transparent 65%)',filter:'blur(40px)',pointerEvents:'none'}}/>
            <div style={{position:'absolute',inset:0,background:'linear-gradient(115deg,transparent 30%,rgba(255,255,255,0.05) 50%,transparent 70%)',pointerEvents:'none'}}/>
            <div style={{position:'absolute',top:22,right:22,width:38,height:38,borderRadius:11,background:'rgba(251,191,36,0.18)',border:'1px solid rgba(251,191,36,0.3)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <Lock size={18} color="#fde68a"/>
            </div>
            <div style={{position:'relative'}}>
              <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:14}}>
                <span style={{fontSize:11,fontWeight:700,letterSpacing:'0.15em',color:'rgba(255,255,255,0.9)'}}>FIXNÉ VÝDAVKY</span>
                <span style={{width:3,height:3,borderRadius:'50%',background:'rgba(255,255,255,0.35)'}}/>
                <span style={{fontSize:11,letterSpacing:'0.05em',color:'rgba(255,255,255,0.55)'}}>{t.expenses.fixed.recurringMonthly}</span>
              </div>
              <div style={{display:'flex',alignItems:'baseline',gap:2,marginBottom:16,flexWrap:'wrap'}}>
                <span style={{fontSize:14,fontWeight:500,color:'#fde68a',marginRight:4}}>−</span>
                <span style={{fontSize:46,fontWeight:300,color:'white',letterSpacing:'-1.8px',lineHeight:1}}>{Math.floor(filteredTotal).toLocaleString('sk-SK')}</span>
                <span style={{fontSize:22,fontWeight:300,color:'rgba(255,255,255,0.78)',letterSpacing:'-0.4px',marginLeft:1}}>,{String(Math.round((filteredTotal%1)*100)).padStart(2,'0')}</span>
                <span style={{fontSize:22,fontWeight:400,color:'rgba(255,255,255,0.55)',marginLeft:6}}>€/mes.</span>
              </div>
              <div style={{display:'flex',gap:18,fontSize:11.5,color:'rgba(255,255,255,0.7)',paddingTop:14,borderTop:'1px solid rgba(255,255,255,0.10)'}}>
                <div>{t.expenses.fixed.yearlyLabel}: <span style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:'white'}}>{formatAmount(filteredTotal * 12)}</span></div>
                <span style={{color:'rgba(255,255,255,0.2)'}}>·</span>
                <div>{t.expenses.fixed.installmentsLabel}: <span style={{fontFamily:"'DM Mono',monospace",fontWeight:600,color:'white'}}>{filtered.length}</span></div>
              </div>
            </div>
          </div>

          {/* Calendar strip — desktop only */}
          <div className="hidden lg:block">
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 18, padding: 18, boxShadow: 'var(--card-shadow)', flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.09em', color: 'var(--text3)', marginBottom: 14 }}>{t.expenses.fixed.monthCalendar}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(31, 1fr)', gap: 2, marginBottom: 8 }}>
              {Array.from({ length: daysInCurrentMonth }, (_, i) => {
                const day = i + 1
                const dayFixed = fixedExpenses.filter(f => f.dayOfMonth === day)
                const sum = dayFixed.reduce((s, f) => s + f.amount, 0)
                const isToday = day === calendarToday
                const isPast = calendarToday > 0 && day < calendarToday
                const hasPayment = dayFixed.length > 0
                return (
                  <div
                    key={day}
                    title={hasPayment ? dayFixed.map(f => `${f.label} ${formatAmount(f.amount)}`).join(', ') : t.expenses.fixed.noExpenses}
                    style={{
                      aspectRatio: '1',
                      borderRadius: 6,
                      background: hasPayment
                        ? (sum >= 100 ? 'rgba(248,113,113,0.6)' : sum >= 20 ? 'rgba(251,191,36,0.55)' : 'rgba(124,58,237,0.5)')
                        : 'var(--bg3)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 600,
                      color: hasPayment ? 'white' : isToday ? 'var(--violet)' : 'var(--text3)',
                      border: isToday ? '1.5px solid var(--violet)' : '1px solid transparent',
                      opacity: isPast ? 0.55 : 1,
                      cursor: hasPayment ? 'pointer' : 'default',
                      transition: 'transform 0.12s',
                    }}
                    onMouseEnter={e => { if (hasPayment) (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.18)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
                  >
                    {day}
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: 'var(--text3)', marginTop: 6, flexWrap: 'wrap' as const }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'rgba(124,58,237,0.5)', display: 'inline-block' }} />malé</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'rgba(251,191,36,0.55)', display: 'inline-block' }} />stredné</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'rgba(248,113,113,0.6)', display: 'inline-block' }} />veľké (≥100€)</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}><span style={{ width: 9, height: 9, borderRadius: 3, background: 'transparent', border: '1.5px solid var(--violet)', display: 'inline-block' }} />dnes</span>
            </div>
          </div>
          </div>

          {/* Category filter pills */}
          {usedCategoryIds.filter(id => id !== '').length >= 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', flexWrap: 'nowrap' }}>
                <button type="button" onClick={() => setActiveCat(null)} style={pillStyle(activeCat === null)}>
                  {t.expenses.fixed.allCategories}
                </button>
                {usedCategoryIds.filter(id => id !== '').map(catId => {
                  const cat = getCat(catId)
                  const isActive = activeCat === catId
                  return (
                    <button key={catId} type="button" onClick={() => setActiveCat(isActive ? null : catId)} style={pillStyle(isActive)}>
                      <span style={{ fontSize: 15, lineHeight: 1 }}>{cat?.icon ?? FALLBACK_ICON}</span>
                      <span>{cat?.name ?? '—'}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Mobile: vs variable card */}
          <div className="lg:hidden">
            {vsContent && (
              <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px', boxShadow: 'var(--card-shadow)' }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text3)', fontFamily: "'DM Mono', monospace", marginBottom: 12 }}>{t.expenses.fixed.vsVariable}</div>
                {vsContent}
              </div>
            )}
          </div>

          {/* Expense list — upcoming/past split */}
          {fixedExpenses.length === 0 ? (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, boxShadow: 'var(--card-shadow)' }}>
              <span style={{ fontSize: 40, animation: 'float 3s ease-in-out infinite', display: 'block' }}>🔒</span>
              <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{t.expenses.fixed.emptyTitle}</p>
              <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>{t.expenses.fixed.emptySubtitle}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: '32px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--card-shadow)' }}>
              <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>{t.expenses.fixed.filteredEmpty}</p>
            </div>
          ) : (() => {
            const upcomingList = filtered.filter(e => calendarToday === -1 || e.dayOfMonth >= calendarToday).sort((a, b) => a.dayOfMonth - b.dayOfMonth)
            const pastList = calendarToday === -1 ? [] : filtered.filter(e => e.dayOfMonth < calendarToday).sort((a, b) => b.dayOfMonth - a.dayOfMonth)

            const renderCard = (expense: typeof filtered[0], isPast = false) => {
              const cat = getCat(expense.categoryId)
              const icon = cat?.icon ?? FALLBACK_ICON
              const color = cat?.color ?? FALLBACK_COLOR
              const daysUntil = ((expense.dayOfMonth - (calendarToday > 0 ? calendarToday : new Date().getDate()) + 31) % 31)
              const badge = countdownBadge(daysUntil)
              const monthAbbr = MONTHS_SK[month - 1] ?? ''
              return (
                <SwipeableRow key={expense.id} onDelete={() => setDeleteId(expense.id!)} isOpen={openSwipeId === expense.id} onOpen={() => setOpenSwipeId(expense.id!)}>

                  <div
                    className="expense-row"
                    style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 0, padding: '14px 16px', boxShadow: 'var(--card-shadow)', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'border-color 0.15s', opacity: isPast ? 0.65 : 1 }}
                    onClick={() => openEdit(expense)}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border2)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
                  >
                    {/* Date tile */}
                    <div style={{
                      width: 46, height: 46, borderRadius: 12, flexShrink: 0,
                      background: isPast ? 'var(--bg3)' : daysUntil === 0 ? 'rgba(139,92,246,0.14)' : daysUntil <= 3 ? 'rgba(249,115,22,0.12)' : 'var(--bg3)',
                      border: `1px solid ${isPast ? 'var(--border)' : daysUntil === 0 ? 'rgba(139,92,246,0.28)' : daysUntil <= 3 ? 'rgba(249,115,22,0.25)' : 'var(--border)'}`,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                    }}>
                      <span style={{ fontSize: 17, fontWeight: 700, color: isPast ? 'var(--text3)' : daysUntil <= 3 ? badge.color : 'var(--text)', fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{expense.dayOfMonth}</span>
                      <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text3)', fontFamily: "'DM Mono', monospace", letterSpacing: '0.06em', textTransform: 'uppercase' }}>{monthAbbr}</span>
                    </div>
                    {/* Category icon */}
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: catBg(color), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                      {icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: isPast ? 'var(--text2)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{expense.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{cat?.name ?? '—'}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 14, color: isPast ? 'var(--text3)' : 'var(--red)' }}>{formatAmount(expense.amount)}</span>
                      {!isPast && <span style={{ fontSize: 10, fontWeight: 600, color: badge.color, background: badge.bg, padding: '2px 7px', borderRadius: 20 }}>{badge.text}</span>}
                      {isPast && <span style={{ fontSize: 12, fontWeight: 600, color: '#22c55e', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', padding: '2px 8px', borderRadius: 20 }}>✓ Zaplatené</span>}
                    </div>
                    <div className="expense-actions hidden lg:flex" style={{ alignItems: 'center', gap: 2, flexShrink: 0 }} onClick={ev => ev.stopPropagation()}>
                      <button onClick={() => openEdit(expense)} style={{ width: 30, height: 30, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Pencil size={13} /></button>
                      <button onClick={() => setDeleteId(expense.id!)} style={{ width: 30, height: 30, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={13} /></button>
                    </div>
                  </div>
                </SwipeableRow>
              )
            }

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 180 }} onClick={() => setOpenSwipeId(null)}>
                {upcomingList.length > 0 && (
                  <>
                    {calendarToday > 0 && (
                      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text3)', fontFamily: "'DM Mono', monospace", marginBottom: 2, marginTop: 4 }}>
                        Nadchádzajúce
                      </div>
                    )}
                    {upcomingList.map(e => renderCard(e, false))}
                  </>
                )}
                {pastList.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text3)', fontFamily: "'DM Mono', monospace", marginBottom: 2, marginTop: 8 }}>
                      Zaplatené tento mesiac
                    </div>
                    {pastList.map(e => renderCard(e, true))}
                  </>
                )}
              </div>
            )
          })()}


        </div>

        {/* Right panel — desktop only */}
        <div className="hidden lg:flex" style={{ width: 280, borderLeft: '1px solid var(--border)', overflowY: 'auto', padding: 16, flexDirection: 'column', gap: 20, background: 'var(--bg2)' }}>
          {rpSection(t.expenses.fixed.yearly, yearlyContent)}
          {rpSection(t.expenses.fixed.upcoming, upcomingContent)}
          {vsContent && rpSection(t.expenses.fixed.vsVariable, vsContent)}
        </div>

      </div>

      {/* Edit/Add sheet */}
      <BottomSheet
        open={sheetOpen}
        onClose={closeSheet}
        title={editing ? t.expenses.fixed.editTitle : t.expenses.fixed.newTitle}
        onImportCsv={editing ? undefined : () => { closeSheet(); setTimeout(() => setCsvOpen(true), 150) }}
        footer={
          <button
            type="button"
            onClick={handleSave}
            disabled={!label.trim() || !amount}
            style={{
              width: '100%', padding: '15px', borderRadius: 14,
              background: (label.trim() && amount) ? 'linear-gradient(135deg, #8B5CF6, #6D28D9)' : 'rgba(139,92,246,0.3)',
              color: 'white', fontSize: 15, fontWeight: 700,
              border: 'none', cursor: (label.trim() && amount) ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              boxShadow: (label.trim() && amount) ? '0 4px 20px rgba(139,92,246,0.4)' : 'none',
            }}
          >
            {editing ? t.common.save : t.common.add}
          </button>
        }
      >
        <div className="flex flex-col gap-5">
          <div>
            <label className="form-label">{t.expenses.fixed.amountLabel}</label>
            <div className="amount-input-wrap">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={e => {
                  const raw = e.target.value.replace(/[^0-9,]/g, '')
                  if ((raw.match(/,/g) || []).length > 1) return
                  setAmount(raw)
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
              className="input-field"
              placeholder={t.expenses.fixed.namePlaceholder}
              value={label}
              onChange={e => setLabel(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">{t.expenses.fixed.dueDay}</label>
            <input
              className="input-field"
              type="number"
              inputMode="numeric"
              placeholder="1"
              min="1"
              max="28"
              value={dayOfMonth}
              onChange={e => setDayOfMonth(e.target.value)}
            />
          </div>
          {expenseCategories.length > 0 && (
            <div>
              <label className="form-label">{t.expenses.fixed.categoryLabel}</label>
              <select
                className="input-field"
                value={categoryId}
                onChange={e => setCategoryId(e.target.value)}
              >
                <option value="">— Bez kategórie —</option>
                {expenseCategories.map(cat => (
                  <option key={cat.id} value={cat.id ?? ''}>
                    {cat.icon} {cat.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="form-label">
              {t.expenses.fixed.noteLabel}{' '}
              <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{t.common.optional}</span>
            </label>
            <input
              className="input-field"
              placeholder="..."
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>
          {editing && (
            <button
              onClick={() => { closeSheet(); setDeleteId(editing.id!) }}
              style={{ padding: '10px 16px', borderRadius: '12px', background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '14px', fontWeight: 500 }}
            >
              {t.common.delete}
            </button>
          )}
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={deleteId !== null}
        message={t.expenses.fixed.removeMessage}
        onConfirm={async () => { if (deleteId !== null) await handleDelete(deleteId) }}
        onCancel={() => { setDeleteId(null); setOpenSwipeId(null) }}
      />

    </div>
  )
}
