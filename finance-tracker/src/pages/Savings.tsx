import { useState, useCallback, useEffect } from 'react'
import { Plus, PiggyBank } from 'lucide-react'
import { BottomSheet } from '../components/BottomSheet'
import { SavingsDetailModal } from '../components/SavingsDetailModal'
import { SwipeableRow } from '../components/SwipeableRow'
import { useSavings } from '../hooks/useSavings'
import { useFormatters } from '../hooks/useFormatters'
import { useTranslation } from '../i18n'
import { listDeposits, addDeposit, deleteDeposit } from '../api/savings'
import { getSummaryCards } from '../api/transactions'
import type { SavingsGoal, Deposit } from '../types'

const PRESET_COLORS = [
  '#7C3AED', '#A78BFA', '#10B981', '#34D399', '#EF4444', '#F59E0B', '#3B82F6', '#EC4899',
]

const PRESET_ICONS = [
  '🏖️', '🚗', '🏠', '💻', '✈️', '🎓',
  '💍', '🎮', '👶', '💰', '🎁', '🏋️',
]

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg3)',
  color: 'var(--text)',
  fontSize: 14,
  fontFamily: "'DM Sans', sans-serif",
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text2)',
  marginBottom: 6,
  display: 'block',
}

function daysUntil(deadline: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(deadline)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function goalMonthly(goal: SavingsGoal): number {
  if (!goal.deadline) return 0
  const today = new Date()
  const deadline = new Date(goal.deadline)
  const ml = Math.max(1, (deadline.getFullYear() - today.getFullYear()) * 12 + (deadline.getMonth() - today.getMonth()))
  return Math.max(0, goal.targetAmount - goal.savedAmount) / ml
}

export function SavingsPage({ openAddTrigger }: { openAddTrigger?: number }) {
  const { goals, addGoal, updateGoal, deleteGoal, pauseGoal, resumeGoal } = useSavings()
  const { formatAmount } = useFormatters()
  const { t } = useTranslation()

  const [view, setView] = useState<'list' | 'detail' | 'edit'>('list')
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null)
  const [deposits, setDeposits] = useState<Deposit[]>([])
  const [monthlyIncome, setMonthlyIncome] = useState<number | null>(null)

  useEffect(() => {
    const now = new Date()
    getSummaryCards(now.getFullYear(), now.getMonth() + 1)
      .then(({ income }) => setMonthlyIncome(income))
      .catch(() => {})
  }, [])

  const [formName, setFormName] = useState('')
  const [formTarget, setFormTarget] = useState('')
  const [formSaved, setFormSaved] = useState('')
  const [formDeadline, setFormDeadline] = useState('')
  const [formIcon, setFormIcon] = useState('🎯')
  const [formColor, setFormColor] = useState('#7C3AED')
  const [formNote, setFormNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (openAddTrigger) openAdd()
  }, [openAddTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  const [initialGoalId] = useState(() => {
    const params = window.location.hash.split('?')[1] ?? ''
    return new URLSearchParams(params).get('id')
  })

  useEffect(() => {
    if (!initialGoalId || goals.length === 0) return
    const goal = goals.find(g => g.id === initialGoalId)
    if (goal && view === 'list') openDetail(goal)
  }, [goals]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalSaved = goals.reduce((s, g) => s + g.savedAmount, 0)
  const totalTarget = goals.reduce((s, g) => s + g.targetAmount, 0)
  const goalCount = goals.length
  const overallPct = totalTarget > 0 ? Math.round(totalSaved / totalTarget * 100) : 0
  const monthlyAmount = goals.filter(g => !g.paused).reduce((s, g) => s + goalMonthly(g), 0)
  const incomePercent = monthlyIncome && monthlyIncome > 0
    ? Math.round(monthlyAmount / monthlyIncome * 100)
    : null

  function openAdd() {
    setSelectedGoal(null)
    setFormName('')
    setFormTarget('')
    setFormSaved('0')
    setFormDeadline('')
    setFormIcon('🎯')
    setFormColor('#7C3AED')
    setFormNote('')
    setView('edit')
  }

  async function openDetail(goal: SavingsGoal) {
    setSelectedGoal(goal)
    setView('detail')
    if (goal.id) window.location.hash = `savings?id=${goal.id}`
    if (goal.id) {
      try { setDeposits(await listDeposits(goal.id)) } catch { setDeposits([]) }
    }
  }

  async function handleDeposit(amount: number) {
    if (!selectedGoal?.id) return
    const { goal: updated, deposit } = await addDeposit(selectedGoal.id, amount)
    setDeposits(prev => [deposit, ...prev])
    setSelectedGoal(prev => prev ? { ...prev, savedAmount: updated.savedAmount } : null)
  }

  async function handleDeleteDeposit(depositId: string) {
    if (!selectedGoal?.id) return
    const updated = await deleteDeposit(selectedGoal.id, depositId)
    setDeposits(prev => prev.filter(d => d.id !== depositId))
    setSelectedGoal(prev => prev ? { ...prev, savedAmount: updated.savedAmount } : null)
  }

  function openEdit(goal: SavingsGoal) {
    setSelectedGoal(goal)
    setFormName(goal.name)
    setFormTarget(String(goal.targetAmount))
    setFormSaved(String(goal.savedAmount))
    setFormDeadline(goal.deadline ?? '')
    setFormIcon(goal.icon ?? '🎯')
    setFormColor(goal.color ?? '#7C3AED')
    setFormNote(goal.note ?? '')
    setView('edit')
  }

  function closeEdit() {
    if (selectedGoal) {
      setView('detail')
    } else {
      setView('list')
    }
  }

  function closeDetail() {
    setSelectedGoal(null)
    setView('list')
    window.location.hash = 'savings'
  }

  const handleSave = useCallback(async () => {
    const targetNum = parseFloat(formTarget)
    if (!formName.trim() || isNaN(targetNum) || targetNum <= 0) return
    const savedNum = parseFloat(formSaved) || 0
    setSaving(true)
    try {
      const payload: Omit<SavingsGoal, 'id'> = {
        name: formName.trim(),
        targetAmount: targetNum,
        savedAmount: Math.max(0, savedNum),
        deadline: formDeadline || null,
        icon: formIcon,
        color: formColor,
        note: formNote.trim() || undefined,
      }
      if (selectedGoal?.id) {
        await updateGoal(selectedGoal.id, payload)
        setSelectedGoal({ ...selectedGoal, ...payload })
        setView('detail')
      } else {
        await addGoal(payload)
        setView('list')
      }
    } finally {
      setSaving(false)
    }
  }, [formName, formTarget, formSaved, formDeadline, formIcon, formColor, formNote, selectedGoal, addGoal, updateGoal])

  const handleDelete = useCallback(async (goal: SavingsGoal) => {
    if (!goal.id) return
    if (!window.confirm(t.savings.deleteConfirm)) return
    await deleteGoal(goal.id)
  }, [deleteGoal, t.savings.deleteConfirm])

  const handlePause = useCallback(async () => {
    if (!selectedGoal?.id) return
    await pauseGoal(selectedGoal.id)
    setSelectedGoal(prev => prev ? { ...prev, paused: true } : null)
  }, [selectedGoal, pauseGoal])

  const handleResume = useCallback(async () => {
    if (!selectedGoal?.id) return
    await resumeGoal(selectedGoal.id)
    setSelectedGoal(prev => prev ? { ...prev, paused: false } : null)
  }, [selectedGoal, resumeGoal])

  const form = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 0 8px' }}>
      {/* Icon row */}
      <div>
        <label style={labelStyle}>{t.savings.iconLabel}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESET_ICONS.map(icon => (
            <button
              key={icon}
              onClick={() => setFormIcon(icon)}
              style={{
                width: 36, height: 36, borderRadius: 8, fontSize: 18,
                border: formIcon === icon ? '2px solid var(--violet)' : '1px solid var(--border)',
                background: formIcon === icon ? 'rgba(124,58,237,0.12)' : 'var(--bg3)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>

      {/* Name */}
      <div>
        <label style={labelStyle}>{t.savings.nameLabel}</label>
        <input
          style={inputStyle}
          value={formName}
          onChange={e => setFormName(e.target.value)}
          placeholder={t.savings.namePlaceholder}
          maxLength={100}
        />
      </div>

      {/* Target + Saved amounts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle}>{t.savings.targetAmount} (€)</label>
          <input
            style={inputStyle}
            type="number"
            min="0.01"
            step="0.01"
            value={formTarget}
            onChange={e => setFormTarget(e.target.value)}
            placeholder="1000"
          />
        </div>
        <div>
          <label style={labelStyle}>{t.savings.savedAmount} (€)</label>
          <input
            style={inputStyle}
            type="number"
            min="0"
            step="0.01"
            value={formSaved}
            onChange={e => setFormSaved(e.target.value)}
            placeholder="0"
          />
        </div>
      </div>

      {/* Deadline */}
      <div>
        <label style={labelStyle}>{t.savings.deadline} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{t.savings.deadlineOptional}</span></label>
        <input
          style={inputStyle}
          type="date"
          value={formDeadline}
          onChange={e => setFormDeadline(e.target.value)}
        />
      </div>

      {/* Color */}
      <div>
        <label style={labelStyle}>{t.savings.colorLabel}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              onClick={() => setFormColor(c)}
              style={{
                width: 28, height: 28, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                outline: formColor === c ? `2px solid var(--text)` : 'none',
                outlineOffset: 2,
              }}
            />
          ))}
        </div>
      </div>

      {/* Note */}
      <div>
        <label style={labelStyle}>{t.savings.noteLabel} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{t.savings.noteOptional}</span></label>
        <textarea
          style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
          value={formNote}
          onChange={e => setFormNote(e.target.value)}
          placeholder=""
          maxLength={500}
        />
      </div>
    </div>
  )

  const footer = (
    <button
      onClick={handleSave}
      disabled={saving || !formName.trim() || !formTarget || parseFloat(formTarget) <= 0}
      style={{
        width: '100%', padding: '13px 0', borderRadius: 12,
        background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
        color: 'white', fontSize: 15, fontWeight: 600, border: 'none',
        cursor: saving ? 'not-allowed' : 'pointer',
        opacity: saving ? 0.7 : 1,
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {selectedGoal ? t.savings.saveChanges : t.savings.add}
    </button>
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 'calc(100px + env(safe-area-inset-bottom, 0px))' }}>
      <div style={{ padding: 20, minHeight: '100%' }}>

        {/* Hero wallet card */}
        <div style={{
          background: 'linear-gradient(135deg,#082626 0%,#0d4d4d 45%,#082626 100%)',
          borderRadius: 24, padding: '24px 26px 20px', position: 'relative', overflow: 'hidden', color: 'white',
          boxShadow: '0 18px 50px -16px rgba(13,77,77,0.42),0 0 0 1px rgba(20,184,166,0.22)',
          flexShrink: 0, marginBottom: 20,
        }}>
          <div style={{position:'absolute',top:-90,right:-50,width:240,height:240,borderRadius:'50%',background:'radial-gradient(circle,rgba(20,184,166,0.35),transparent 65%)',filter:'blur(40px)',pointerEvents:'none'}}/>
          <div style={{position:'absolute',inset:0,background:'linear-gradient(115deg,transparent 30%,rgba(255,255,255,0.05) 50%,transparent 70%)',pointerEvents:'none'}}/>
          <div style={{position:'absolute',top:22,right:22,width:38,height:38,borderRadius:11,background:'rgba(20,184,166,0.18)',border:'1px solid rgba(20,184,166,0.3)',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <PiggyBank size={18} color="#5eead4"/>
          </div>
          <div style={{position:'relative'}}>
            <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:14}}>
              <span style={{fontSize:11,fontWeight:700,letterSpacing:'0.15em',color:'rgba(255,255,255,0.9)'}}>SPORENIE</span>
              <span style={{width:3,height:3,borderRadius:'50%',background:'rgba(255,255,255,0.35)'}}/>
              <span style={{fontSize:11,letterSpacing:'0.05em',color:'rgba(255,255,255,0.55)'}}>{goalCount} aktívnych cieľov</span>
            </div>
            <p style={{fontSize:10.5,color:'rgba(255,255,255,0.55)',fontWeight:600,marginBottom:6,letterSpacing:'0.12em',textTransform:'uppercase' as const}}>{t.savings.totalSavingsLabel.toUpperCase()}</p>
            <div style={{display:'flex',alignItems:'baseline',gap:2,marginBottom:14,flexWrap:'wrap'}}>
              <span style={{fontSize:46,fontWeight:300,color:'white',letterSpacing:'-1.8px',lineHeight:1}}>{Math.floor(totalSaved).toLocaleString('sk-SK')}</span>
              <span style={{fontSize:22,fontWeight:300,color:'rgba(255,255,255,0.78)',letterSpacing:'-0.4px',marginLeft:1}}>,{String(Math.round((totalSaved%1)*100)).padStart(2,'0')}</span>
              <span style={{fontSize:22,fontWeight:400,color:'rgba(255,255,255,0.55)',marginLeft:6}}>€</span>
              {totalTarget > 0 && (
                <span style={{marginLeft:'auto',fontSize:11,fontWeight:600,padding:'3px 9px',borderRadius:99,background:'rgba(20,184,166,0.18)',color:'#5eead4',border:'1px solid rgba(20,184,166,0.3)'}}>
                  {overallPct}% z {Math.round(totalTarget)} €
                </span>
              )}
            </div>
            {totalTarget > 0 && (
              <div style={{height:8,borderRadius:99,background:'rgba(255,255,255,0.1)',overflow:'hidden',marginBottom:12}}>
                <div style={{height:'100%',width:`${Math.min(overallPct,100)}%`,background:'linear-gradient(90deg,#5eead4,#34d399)',borderRadius:99,transition:'width 1s cubic-bezier(0.4,0,0.2,1)',boxShadow:'0 0 12px rgba(94,234,212,0.5)'}}/>
              </div>
            )}
            <div style={{display:'flex',gap:0,paddingTop:14,borderTop:'1px solid rgba(255,255,255,0.10)'}}>
              <div style={{flex:1}}>
                <p style={{fontSize:9,color:'rgba(255,255,255,0.5)',fontWeight:600,textTransform:'uppercase' as const,letterSpacing:'0.07em',marginBottom:3}}>{t.savings.monthlyLabel.toUpperCase()}</p>
                <p style={{fontFamily:"'DM Mono',monospace",fontWeight:600,fontSize:13,color:'#5eead4'}}>+{formatAmount(monthlyAmount)}</p>
              </div>
              <div style={{width:1,background:'rgba(255,255,255,0.12)'}}/>
              <div style={{flex:1,paddingLeft:10}}>
                <p style={{fontSize:9,color:'rgba(255,255,255,0.5)',fontWeight:600,textTransform:'uppercase' as const,letterSpacing:'0.07em',marginBottom:3}}>{t.savings.remainingTotal.toUpperCase()}</p>
                <p style={{fontFamily:"'DM Mono',monospace",fontWeight:600,fontSize:13,color:'white'}}>{formatAmount(Math.max(0, totalTarget - totalSaved))}</p>
              </div>
              <div style={{width:1,background:'rgba(255,255,255,0.12)'}}/>
              <div style={{flex:1,paddingLeft:10}}>
                <p style={{fontSize:9,color:'rgba(255,255,255,0.5)',fontWeight:600,textTransform:'uppercase' as const,letterSpacing:'0.07em',marginBottom:3}}>% Z PRÍJMOV</p>
                <p style={{fontFamily:"'DM Mono',monospace",fontWeight:600,fontSize:13,color:'#a78bfa'}}>
                  {incomePercent !== null ? `${incomePercent}%` : '—'}
                </p>
              </div>
            </div>
          </div>
        </div>



        {/* Goals grid */}
        {goals.length === 0 ? (
          <div style={{
            background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 20,
            padding: '48px 24px', textAlign: 'center',
          }}>
            <p style={{ fontSize: 40, marginBottom: 12, animation: 'float 3s ease-in-out infinite' }}>🐷</p>
            <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px' }}>{t.savings.noGoals}</p>
            <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>{t.savings.noGoalsSubtitle}</p>
          </div>
        ) : (
          <>
            {/* Mobile: vertical list with swipe-to-delete */}
            <div className="flex flex-col gap-4 lg:hidden">
              {goals.map(goal => (
                <SwipeableRow key={goal.id} onDelete={() => deleteGoal(goal.id!)}>
                  <GoalCard
                    goal={goal}
                    formatAmount={formatAmount}
                    t={t.savings}
                    onClick={() => openDetail(goal)}
                  />
                </SwipeableRow>
              ))}
            </div>
            {/* Desktop: horizontal scroll row */}
            <div className="hidden lg:flex overflow-x-auto gap-4 pb-2" style={{ scrollbarWidth: 'none' }}>
              {goals.map(goal => (
                <div key={goal.id} style={{ width: 300, flexShrink: 0 }}>
                  <GoalCard
                    goal={goal}
                    formatAmount={formatAmount}
                    t={t.savings}
                    onClick={() => openDetail(goal)}
                    desktop
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      </div>

      {/* FAB — mobile only */}
      {view !== 'edit' && (
        <button
          onClick={openAdd}
          className="lg:hidden flex items-center justify-center"
          style={{ position: 'fixed', bottom: 'calc(88px + env(safe-area-inset-bottom, 16px))', right: 20, width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg, #7C3AED, #6D28D9)', color: 'white', border: 'none', cursor: 'pointer', zIndex: 50, boxShadow: '0 4px 20px rgba(124,58,237,0.5)' }}
        >
          <Plus size={24} strokeWidth={2.5} />
        </button>
      )}

      <SavingsDetailModal
        goal={view === 'detail' ? selectedGoal : null}
        deposits={deposits}
        onClose={closeDetail}
        onEdit={() => { if (selectedGoal) openEdit(selectedGoal) }}
        onDelete={selectedGoal ? async () => { await handleDelete(selectedGoal); closeDetail() } : undefined}
        onDeposit={handleDeposit}
        onDeleteDeposit={handleDeleteDeposit}
        onPause={handlePause}
        onResume={handleResume}
        formatAmount={formatAmount}
      />

      <BottomSheet
        open={view === 'edit'}
        onClose={closeEdit}
        title={selectedGoal ? t.savings.editTitle : t.savings.addTitle}
        footer={footer}
      >
        {form}
      </BottomSheet>
    </div>
  )
}


function MiniRing({ pct, color, size, accent, label }: {
  pct: number; color: string; size: number; accent: string; label: string
}) {
  const sw = 3
  const r = (size - sw * 2) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.min(pct, 100) / 100)
  const c = size / 2
  const trackColor = pct === 0 ? `${accent}33` : 'var(--bg4)'
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke={trackColor} strokeWidth={sw} />
      <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={`${circ} ${circ}`} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${c} ${c})`} />
      <text x={c} y={c} textAnchor="middle" dominantBaseline="central"
        fill="var(--text)" fontSize={11} fontWeight={600} fontFamily="'DM Mono', monospace">
        {label}
      </text>
    </svg>
  )
}

function GoalCard({
  goal, formatAmount, t, onClick, desktop = false,
}: {
  goal: SavingsGoal
  formatAmount: (n: number) => string
  t: { of: string; completed: string; daysLeft: string; overdue: string; remaining: string; pausedBadge: string }
  onClick: () => void
  desktop?: boolean
}) {
  const [active, setActive] = useState(false)
  const rawPct = goal.targetAmount > 0 ? (goal.savedAmount / goal.targetAmount) * 100 : 0
  const pct = Math.min(100, rawPct)
  const isCompleted = pct >= 100
  const accent = goal.color ?? '#7C3AED'
  const barColor = isCompleted ? 'var(--green)' : accent
  const monthly = goalMonthly(goal)

  const pctFixed = pct.toFixed(1)
  const pctLabel = pct === 0 ? '0%' : pctFixed === '0.0' ? '< 0.1%' : pctFixed + '%'
  const ringSize = desktop ? 56 : 52

  let deadlineEl: React.ReactNode = null
  if (goal.deadline && !isCompleted) {
    const days = daysUntil(goal.deadline)
    if (days < 0) {
      deadlineEl = (
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 12%, transparent)', padding: '2px 6px', borderRadius: 20 }}>
          {t.overdue}
        </span>
      )
    } else {
      deadlineEl = <span style={{ fontSize: 12, color: 'var(--text3)' }}>do {goal.deadline}</span>
    }
  }

  return (
    <div
      onClick={onClick}
      onPointerDown={() => setActive(true)}
      onPointerUp={() => setActive(false)}
      onPointerLeave={() => setActive(false)}
      style={{
        background: 'var(--bg2)',
        border: active ? `1px solid ${accent}` : '1px solid var(--border)',
        borderRadius: 16,
        padding: '12px 16px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxSizing: 'border-box',
        transition: 'border-color 0.12s',
        ...(desktop ? { height: '100%' } : {}),
      }}
    >
      {/* Top row: icon + name/deadline + ring */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
            background: `${accent}26`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
          }}>
            {goal.icon ?? '🎯'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{goal.name}</p>
              {goal.paused && (
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: 'rgba(251,146,60,0.15)', border: '1px solid rgba(251,146,60,0.35)', color: '#fb923c', letterSpacing: '0.05em', flexShrink: 0 }}>{t.pausedBadge}</span>
              )}
            </div>
            {isCompleted ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>{t.completed}</span>
            ) : deadlineEl}
          </div>
        </div>
        <MiniRing pct={pct} color={barColor} size={ringSize} accent={accent} label={pctLabel} />
      </div>

      {/* Amounts */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.5px' }}>
            {formatAmount(goal.savedAmount)}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text3)' }}>/ {formatAmount(goal.targetAmount)}</span>
        </div>
        {!isCompleted && (
          <p style={{ fontSize: 12, color: 'var(--text3)', margin: '2px 0 0' }}>
            {t.remaining} {formatAmount(Math.max(0, goal.targetAmount - goal.savedAmount))}
            {monthly > 0 && ` · auto +${formatAmount(monthly)}/mes.`}
          </p>
        )}
      </div>
    </div>
  )
}
