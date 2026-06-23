import { useState, useEffect } from 'react'
import { X, Pencil, Pause, Play, Plus, Trash2 } from 'lucide-react'
import type { SavingsGoal, Deposit } from '../types'
import { useTranslation } from '../i18n'

interface SavingsDetailModalProps {
  goal: SavingsGoal | null
  deposits?: Deposit[]
  onClose: () => void
  onEdit: () => void
  onDelete?: () => void
  onDeposit: (amount: number) => Promise<void>
  onDeleteDeposit?: (depositId: string) => Promise<void>
  onPause?: () => Promise<void>
  onResume?: () => Promise<void>
  formatAmount: (n: number) => string
}

function calcMonthly(goal: SavingsGoal): number {
  if (!goal.deadline) return 0
  const today = new Date()
  const deadline = new Date(goal.deadline)
  const ml = Math.max(1, (deadline.getFullYear() - today.getFullYear()) * 12 + (deadline.getMonth() - today.getMonth()))
  return Math.max(0, goal.targetAmount - goal.savedAmount) / ml
}

function calcMonthsLeft(deadline: string | null | undefined): number {
  if (!deadline) return 0
  const today = new Date()
  const d = new Date(deadline)
  return Math.max(0, (d.getFullYear() - today.getFullYear()) * 12 + (d.getMonth() - today.getMonth()))
}

// Mobile ring: 120px rendered, stroke 6px
const M_SIZE = 120, M_SW = 6, M_R = (M_SIZE - M_SW * 2) / 2, M_CIRC = 2 * Math.PI * M_R
// Desktop ring: 150px rendered, stroke 6px
const D_SIZE = 150, D_SW = 6, D_R = (D_SIZE - D_SW * 2) / 2, D_CIRC = 2 * Math.PI * D_R

export function SavingsDetailModal({ goal, deposits = [], onClose, onEdit, onDelete, onDeposit, onDeleteDeposit, onPause, onResume, formatAmount }: SavingsDetailModalProps) {
  const { t } = useTranslation()
  const [depositMode, setDepositMode] = useState(false)
  const [depositInput, setDepositInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [pauseLoading, setPauseLoading] = useState(false)
  const [animated, setAnimated] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!goal) { setAnimated(false); return }
    setAnimated(false)
    const timer = setTimeout(() => setAnimated(true), 60)
    return () => clearTimeout(timer)
  }, [goal?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!goal) return null

  const rawPct = goal.targetAmount > 0 ? (goal.savedAmount / goal.targetAmount) * 100 : 0
  const pct = Math.min(100, rawPct)
  const isCompleted = pct >= 100
  const color = isCompleted ? '#34D399' : (goal.color ?? '#7C3AED')

  const pctFixed = pct.toFixed(1)
  const pctStr = pct === 0 ? '0%' : pctFixed === '0.0' ? '< 0.1%' : pctFixed + '%'

  const displayPct = animated ? pct : 0
  const mOffset = M_CIRC * (1 - displayPct / 100)
  const dOffset = D_CIRC * (1 - displayPct / 100)

  const monthly = calcMonthly(goal)
  const monthsLeft = calcMonthsLeft(goal.deadline)
  const remaining = Math.max(0, goal.targetAmount - goal.savedAmount)
  const glowId = goal.id ?? 'g'

  const stats = [
    { label: t.savings.monthlyLabel.toUpperCase(), value: monthly > 0 ? formatAmount(monthly) : '—' },
    { label: t.savings.monthsLabel.toUpperCase(), value: monthsLeft > 0 ? String(monthsLeft) : '—' },
    { label: t.savings.deadlineLabel.toUpperCase(), value: goal.deadline ? new Date(goal.deadline).toLocaleDateString('sk-SK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
    { label: t.savings.remainingLabel.toUpperCase(), value: formatAmount(remaining) },
  ]

  async function handleDeposit() {
    const amount = parseFloat(depositInput.replace(',', '.'))
    if (!amount || amount <= 0) return
    setSaving(true)
    try {
      await onDeposit(amount)
      setDepositInput('')
      setDepositMode(false)
    } finally {
      setSaving(false)
    }
  }

  async function handlePause() {
    if (!onPause) return
    setPauseLoading(true)
    try { await onPause() } finally { setPauseLoading(false) }
  }

  async function handleResume() {
    if (!onResume) return
    setPauseLoading(true)
    try { await onResume() } finally { setPauseLoading(false) }
  }

  const pausedBadge = { fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'rgba(251,146,60,0.15)', border: '1px solid rgba(251,146,60,0.35)', color: '#fb923c', letterSpacing: '0.05em', flexShrink: 0 } as const

  const depositInputEl = (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        type="number" min="0.01" step="0.01" placeholder={t.savings.depositPlaceholder}
        value={depositInput} onChange={e => setDepositInput(e.target.value)} autoFocus
        onKeyDown={e => { if (e.key === 'Enter') handleDeposit() }}
        style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 14, fontFamily: "'DM Sans',sans-serif", outline: 'none' }}
      />
      <button onClick={handleDeposit} disabled={saving || !depositInput || parseFloat(depositInput) <= 0}
        style={{ padding: '10px 18px', borderRadius: 10, background: 'linear-gradient(135deg,#10B981,#059669)', color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: saving ? 0.7 : 1 }}>
        {saving ? '...' : t.common.save}
      </button>
      <button onClick={() => { setDepositMode(false); setDepositInput('') }}
        style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
        ✕
      </button>
    </div>
  )

  const autoRulesRows = [
    { icon: '📅', label: t.savings.monthlyTransfer, sub: t.savings.firstOfMonth, val: monthly > 0 ? formatAmount(monthly) : '—', accent: '#a78bfa' },
    { icon: '🎯', label: t.savings.goalAmount, sub: `${t.savings.remainingLabel} ${formatAmount(remaining)}`, val: formatAmount(goal.targetAmount), accent: '#60a5fa' },
    { icon: '🔔', label: t.savings.reminder, sub: t.savings.reminderSub, val: '—', accent: '#fb923c' },
  ]

  const depositsEl = deposits.length === 0 ? (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 14, padding: '24px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 28, opacity: 0.5 }}>🐷</span>
      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text3)', margin: 0 }}>{t.savings.noDeposits}</p>
    </div>
  ) : (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
      {deposits.slice(0, 10).map((d, i) => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)', flex: 1 }}>
            {new Date(d.date).toLocaleDateString('sk-SK', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          {confirmDeleteId === d.id ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Zmazať {formatAmount(d.amount)} €?</span>
              <button onClick={async () => { if (!onDeleteDeposit) return; setDeleting(true); try { await onDeleteDeposit(d.id) } finally { setDeleting(false); setConfirmDeleteId(null) } }} disabled={deleting}
                style={{ fontSize: 11, fontWeight: 600, color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit', opacity: deleting ? 0.6 : 1 }}>
                Áno
              </button>
              <button onClick={() => setConfirmDeleteId(null)}
                style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>
                Nie
              </button>
            </div>
          ) : (
            <>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 600, color: '#34D399' }}>+{formatAmount(d.amount)}</span>
              {onDeleteDeposit && (
                <button onClick={() => setConfirmDeleteId(d.id)}
                  style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  title="Zmazať vklad">
                  <Trash2 size={13} />
                </button>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  )

  return (
    <div
      className="fixed inset-0 flex items-end md:items-center justify-center p-0 md:p-6"
      style={{ background: 'rgba(0,0,0,0.65)', zIndex: 60 }}
      onClick={onClose}
    >
      {/* ── MOBILE LAYOUT (< 768px) ── */}
      <div
        className="md:hidden"
        style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: '24px 24px 0 0', width: '100%', maxHeight: '90svh',
          overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          boxShadow: '0 -12px 48px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 20px 0' }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, flexShrink: 0, background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
            {goal.icon ?? '🎯'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{goal.name}</p>
              {goal.paused && <span style={pausedBadge}>{t.savings.pausedBadge}</span>}
            </div>
            {goal.note ? (
              <p style={{ fontSize: 12, color: 'var(--text3)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{goal.note}</p>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text3)', margin: '2px 0 0' }}>{pctStr} {t.savings.filled}</p>
            )}
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text3)', flexShrink: 0 }}>
            <X size={15} />
          </button>
        </div>

        {/* Ring + stats */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px 0', gap: 16, flexWrap: 'wrap' }}>
          <svg width={M_SIZE} height={M_SIZE} style={{ flexShrink: 0 }}>
            <defs>
              <filter id={`mglow-${glowId}`} x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={color} floodOpacity="0.4" />
              </filter>
            </defs>
            <circle cx={M_SIZE / 2} cy={M_SIZE / 2} r={M_R} fill="none" stroke="var(--bg4)" strokeWidth={M_SW} />
            <circle cx={M_SIZE / 2} cy={M_SIZE / 2} r={M_R} fill="none" stroke={color} strokeWidth={M_SW}
              strokeLinecap="round" strokeDasharray={`${M_CIRC}`} strokeDashoffset={`${mOffset}`}
              transform={`rotate(-90 ${M_SIZE / 2} ${M_SIZE / 2})`}
              style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)', filter: `url(#mglow-${glowId})` }}
            />
            <text x={M_SIZE / 2} y={M_SIZE / 2 - 7} textAnchor="middle" dominantBaseline="middle"
              fill={color} fontSize={28} fontWeight={700} fontFamily="'DM Mono',monospace">
              {pctStr}
            </text>
            <text x={M_SIZE / 2} y={M_SIZE / 2 + 15} textAnchor="middle"
              fill="var(--text3)" fontSize={12} fontFamily="'DM Sans',sans-serif">
              {t.savings.filled}
            </text>
          </svg>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, flex: 1, minWidth: 160 }}>
            {stats.map(s => (
              <div key={s.label} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.12em', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Amount summary */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8, padding: '12px 20px 0' }}>
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 26, fontWeight: 700, color }}>{formatAmount(goal.savedAmount)}</span>
          <span style={{ fontSize: 13, color: 'var(--text3)' }}>{t.savings.of} {formatAmount(goal.targetAmount)}</span>
          {isCompleted && <span style={{ fontSize: 14, fontWeight: 700, color: '#34D399', marginLeft: 4 }}>🎉 {t.savings.completed}</span>}
        </div>

        {/* Deposit input or action buttons */}
        <div style={{ padding: '14px 20px 0' }}>
          {depositMode ? depositInputEl : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setDepositMode(true)}
                style={{ flex: 2, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#10B981,#059669)', color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: '0 4px 14px rgba(16,185,129,0.35)' }}>
                <Plus size={15} strokeWidth={2.5} /> {t.savings.depositBtn}
              </button>
              <button onClick={onEdit}
                style={{ flex: 1, height: 44, borderRadius: 12, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <Pencil size={13} /> {t.common.edit}
              </button>
              {goal.paused ? (
                <button onClick={handleResume} disabled={pauseLoading || !onResume}
                  style={{ flex: 1, height: 44, borderRadius: 12, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.35)', color: '#34d399', fontSize: 13, fontWeight: 600, cursor: pauseLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: pauseLoading ? 0.7 : 1 }}>
                  <Play size={13} strokeWidth={2.5} /> {t.savings.resumeBtn}
                </button>
              ) : (
                <button onClick={handlePause} disabled={pauseLoading || !onPause}
                  style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: pauseLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: pauseLoading ? 0.7 : 1 }}
                  title={t.savings.pauseBtn}>
                  <Pause size={14} />
                </button>
              )}
              {onDelete && (
                <button onClick={onDelete}
                  style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--red)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title={t.common.delete}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Auto-rules */}
        <div style={{ padding: '18px 20px 0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.12em', marginBottom: 10 }}>{t.savings.autoRules.toUpperCase()}</div>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
            {autoRulesRows.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: r.accent + '18', border: '1px solid ' + r.accent + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{r.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{r.sub}</div>
                </div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 600, color: 'var(--text2)', flexShrink: 0 }}>{r.val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent deposits */}
        <div style={{ padding: '14px 20px', paddingBottom: 'max(40px, calc(24px + env(safe-area-inset-bottom, 0px)))' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.12em', marginBottom: 10 }}>{t.savings.latestDeposits.toUpperCase()}</div>
          {depositsEl}
        </div>
      </div>

      {/* ── DESKTOP LAYOUT (768px+) ── */}
      <div
        className="hidden md:flex flex-col"
        style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 24, width: '100%', maxWidth: 880,
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
          padding: '24px 28px', gap: 20,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top card: left info + right ring */}
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 20, padding: '24px 28px', display: 'flex', gap: 28, alignItems: 'flex-start' }}>

          {/* Left: label + name + stats + buttons */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.12em', marginBottom: 10 }}>
              {t.savings.selectedGoal.toUpperCase()}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
                {goal.icon ?? '🎯'}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{goal.name}</span>
                  {goal.paused && <span style={pausedBadge}>{t.savings.pausedBadge}</span>}
                </div>
                {goal.note && <p style={{ fontSize: 12, color: 'var(--text3)', margin: '3px 0 0' }}>{goal.note}</p>}
              </div>
            </div>

            {/* 2x2 stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
              {stats.map(s => (
                <div key={s.label} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.12em', marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Action row */}
            {depositMode ? depositInputEl : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => setDepositMode(true)}
                  style={{ flex: 1, minWidth: 120, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#10B981,#059669)', color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: '0 4px 14px rgba(16,185,129,0.3)' }}>
                  <Plus size={15} strokeWidth={2.5} /> {t.savings.depositBtn}
                </button>
                <button onClick={onEdit}
                  style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title={t.common.edit}>
                  <Pencil size={15} />
                </button>
                {goal.paused ? (
                  <button onClick={handleResume} disabled={pauseLoading || !onResume}
                    style={{ height: 44, padding: '0 16px', borderRadius: 12, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.35)', color: '#34d399', fontSize: 13, fontWeight: 600, cursor: pauseLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, opacity: pauseLoading ? 0.7 : 1 }}>
                    <Play size={13} strokeWidth={2.5} /> {t.savings.resumeBtn}
                  </button>
                ) : (
                  <button onClick={handlePause} disabled={pauseLoading || !onPause}
                    style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text2)', cursor: pauseLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: pauseLoading ? 0.7 : 1 }}
                    title={t.savings.pauseBtn}>
                    <Pause size={14} />
                  </button>
                )}
                {onDelete && (
                  <button onClick={onDelete}
                    style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--red)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title={t.common.delete}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Right: large ring + amount + close */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, flexShrink: 0, position: 'relative' }}>
            <button onClick={onClose}
              style={{ position: 'absolute', top: -12, right: -16, width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text3)' }}>
              <X size={15} />
            </button>
            <svg width={D_SIZE} height={D_SIZE}>
              <defs>
                <filter id={`dglow-${glowId}`} x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor={color} floodOpacity="0.45" />
                </filter>
              </defs>
              <circle cx={D_SIZE / 2} cy={D_SIZE / 2} r={D_R} fill="none" stroke="var(--bg4)" strokeWidth={D_SW} />
              <circle cx={D_SIZE / 2} cy={D_SIZE / 2} r={D_R} fill="none" stroke={color} strokeWidth={D_SW}
                strokeLinecap="round" strokeDasharray={`${D_CIRC}`} strokeDashoffset={`${dOffset}`}
                transform={`rotate(-90 ${D_SIZE / 2} ${D_SIZE / 2})`}
                style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)', filter: `url(#dglow-${glowId})` }}
              />
              <text x={D_SIZE / 2} y={D_SIZE / 2 - 8} textAnchor="middle" dominantBaseline="middle"
                fill={color} fontSize={28} fontWeight={700} fontFamily="'DM Mono',monospace">
                {pctStr}
              </text>
              <text x={D_SIZE / 2} y={D_SIZE / 2 + 16} textAnchor="middle"
                fill="var(--text3)" fontSize={12} fontFamily="'DM Sans',sans-serif">
                {t.savings.filled}
              </text>
            </svg>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 22, fontWeight: 700, color }}>{formatAmount(goal.savedAmount)}</span>
              <span style={{ fontSize: 13, color: 'var(--text3)', marginLeft: 6 }}>{t.savings.of} {formatAmount(goal.targetAmount)}</span>
            </div>
            {isCompleted && <span style={{ fontSize: 13, fontWeight: 700, color: '#34D399' }}>🎉 {t.savings.completed}</span>}
          </div>
        </div>

        {/* Bottom 2 columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, paddingBottom: 8 }}>
          {/* Auto-rules */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.12em', marginBottom: 10 }}>{t.savings.autoRules.toUpperCase()}</div>
            <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
              {autoRulesRows.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: r.accent + '18', border: '1px solid ' + r.accent + '30', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>{r.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{r.sub}</div>
                  </div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 600, color: 'var(--text2)', flexShrink: 0 }}>{r.val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Deposits */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.12em', marginBottom: 10 }}>{t.savings.latestDeposits.toUpperCase()}</div>
            {depositsEl}
          </div>
        </div>
      </div>
    </div>
  )
}
