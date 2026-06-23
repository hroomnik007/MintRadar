import { useState, useEffect, useRef } from 'react'
import type { Page } from '../App'
import { getCategories } from '../api/categories'
import { getTransactions } from '../api/transactions'
import { getSavingsGoals } from '../api/savings'
import { getDismissedNotifications, dismissNotification as dismissNotifApi } from '../api/notifications'
import { useFormatters } from '../hooks/useFormatters'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from '../i18n'

interface Notification {
  id: string
  icon: string
  title: string
  body: string
  time: string
  read: boolean
  color: string
  amount?: string
  target?: Page
}

const NOTIF_READ_KEY = 'finvu_read_notifications'

function saveReadIdsLocal(ids: string[]) {
  try { localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(ids)) } catch { /* ignore */ }
}

interface NotificationCenterProps {
  onNavigate?: (page: Page) => void
}

export function NotificationCenter({ onNavigate }: NotificationCenterProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const generated = useRef(false)
  const ref = useRef<HTMLDivElement>(null)
  const { isAuthenticated } = useAuth()
  const { formatAmount } = useFormatters()
  const unreadCount = notifications.filter(n => !n.read).length

  useEffect(() => {
    if (!isAuthenticated || generated.current) return
    generated.current = true
    generateNotifications()
  }, [isAuthenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function generateNotifications() {
    setLoading(true)
    try {
      // Fetch dismissed keys first — DB is source of truth, no fallback to empty
      const dismissedRes = await getDismissedNotifications()
      const dismissedIds = new Set(dismissedRes.data)
      saveReadIdsLocal(dismissedRes.data)

      const now = new Date()
      const todayDay = now.getDate()
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

      const [catsRes, varRes, fixedRes, incomeRes, savingsRes] = await Promise.all([
        getCategories(),
        getTransactions({ type: 'expense', isFixed: false, month: monthStr, limit: 200 }),
        getTransactions({ type: 'expense', isFixed: true, limit: 200 }),
        getTransactions({ type: 'income', limit: 3 }),
        getSavingsGoals(),
      ])

      const ns: Notification[] = []

      // Budget warnings (≥ 80%)
      const spentByCategory: Record<string, number> = {}
      for (const tx of varRes.data) {
        if (tx.categoryId) spentByCategory[tx.categoryId] = (spentByCategory[tx.categoryId] ?? 0) + tx.amount
      }
      for (const cat of catsRes.data) {
        const limit = cat.budgetLimit
        if (!limit || limit <= 0) continue
        const spent = spentByCategory[cat.id] ?? 0
        const pct = (spent / limit) * 100
        if (pct < 80) continue
        ns.push({
          id: `budget-${cat.id}`,
          icon: pct >= 100 ? '🚨' : '⚠️',
          title: `Limit ${cat.name} ${Math.round(pct)}%`,
          body: t.notifications.spentOf.replace('{spent}', formatAmount(spent)).replace('{limit}', formatAmount(limit)),
          time: t.notifications.today,
          read: false,
          color: pct >= 100 ? '#f87171' : '#FB923C',
          amount: `${Math.round(spent)} / ${Math.round(limit)} €`,
          target: 'variable-expenses',
        })
      }

      // Upcoming fixed expenses (next 7 days, max 2)
      let fixedAdded = 0
      for (const tx of fixedRes.data) {
        if (fixedAdded >= 2) break
        let dayOfMonth = tx.date ? new Date(tx.date + 'T12:00:00').getDate() : 1
        let label = tx.description ?? ''
        try {
          const obj = JSON.parse(tx.description ?? '')
          if (obj && typeof obj.d === 'number') {
            dayOfMonth = obj.d
            label = String(obj.l ?? label)
          }
        } catch { /* plain text description */ }
        const diff = dayOfMonth >= todayDay ? dayOfMonth - todayDay : daysInMonth - todayDay + dayOfMonth
        if (diff > 7) continue
        const timeStr = diff === 0 ? t.notifications.today : diff === 1 ? t.notifications.tomorrow : t.notifications.inDays.replace('{n}', String(diff))
        ns.push({
          id: `fixed-${tx.id}`,
          icon: '📅',
          title: `${label} ${timeStr}`,
          body: t.notifications.dueDay.replace('{n}', String(dayOfMonth)),
          time: timeStr,
          read: false,
          color: '#f87171',
          amount: formatAmount(tx.amount),
          target: 'fixed-expenses',
        })
        fixedAdded++
      }

      // Latest income
      if (incomeRes.data.length > 0) {
        const latest = incomeRes.data[0]
        const dayDiff = Math.max(0, Math.floor(
          (now.getTime() - new Date(latest.date + 'T12:00:00').getTime()) / 86400000
        ))
        const timeStr = dayDiff === 0 ? t.notifications.today : dayDiff === 1 ? t.notifications.yesterday : t.notifications.daysAgo.replace('{n}', String(dayDiff))
        ns.push({
          id: `income-${latest.id}`,
          icon: '💰',
          title: t.notifications.incomeReceived,
          body: `${latest.description ?? t.notifications.incomeDefault} — ${formatAmount(latest.amount)}`,
          time: timeStr,
          read: dayDiff > 0,
          color: '#34d399',
          amount: `+${formatAmount(latest.amount)}`,
          target: 'income',
        })
      }

      // Savings goal near completion (80–99%)
      for (const goal of savingsRes.data) {
        if (!goal.targetAmount) continue
        const pct = (goal.savedAmount / goal.targetAmount) * 100
        if (pct < 80 || pct >= 100) continue
        ns.push({
          id: `savings-${goal.id}`,
          icon: goal.icon ?? '🎯',
          title: `${goal.name} ${Math.round(pct)}%`,
          body: t.notifications.goalRemaining.replace('{amount}', formatAmount(Math.max(0, goal.targetAmount - goal.savedAmount))),
          time: t.notifications.currentTime,
          read: true,
          color: '#8B5CF6',
          amount: `${formatAmount(goal.savedAmount)} / ${formatAmount(goal.targetAmount)}`,
          target: 'savings',
        })
        break
      }

      setNotifications(ns.filter(n => !dismissedIds.has(n.id)))
    } catch { /* silently ignore fetch errors */ }
    setLoading(false)
  }

  function markAllRead() {
    setNotifications(ns => {
      const toMark = ns.filter(n => !n.read)
      const updated = ns.map(n => ({ ...n, read: true }))
      toMark.forEach(n => dismissNotifApi(n.id).catch(() => {}))
      saveReadIdsLocal(updated.map(n => n.id))
      return updated
    })
  }

  async function clearAll() {
    await Promise.all(notifications.map(n => dismissNotifApi(n.id).catch(() => {})))
    saveReadIdsLocal([])
    setNotifications([])
  }

  function handleItemClick(n: Notification) {
    setNotifications(ns => {
      const updated = ns.map(x => x.id === n.id ? { ...x, read: true } : x)
      if (!n.read) {
        dismissNotifApi(n.id).catch(() => {})
        saveReadIdsLocal(updated.filter(x => x.read).map(x => x.id))
      }
      return updated
    })
    if (n.target && onNavigate) {
      onNavigate(n.target)
      setOpen(false)
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-label={t.notifications.ariaLabel}
        style={{
          width: 34, height: 34, borderRadius: '50%',
          background: open ? 'var(--bg3)' : 'transparent',
          border: '1px solid var(--border)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text2)', flexShrink: 0, position: 'relative',
          transition: 'background 0.15s',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -2, right: -2,
            minWidth: 16, height: 16, borderRadius: 99,
            background: '#f87171', border: '2px solid var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 700, color: 'white',
            fontFamily: "'DM Mono', monospace",
            animation: 'pulseRing 2s ease-in-out infinite',
          }}>
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 360, background: 'var(--bg2)',
          border: '1px solid var(--border2)', borderRadius: 16,
          boxShadow: 'var(--shadow-elevated)', zIndex: 200,
          animation: 'fadeUp 0.18s ease both', overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{t.notifications.title}</span>
              {unreadCount > 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'rgba(139,92,246,0.16)', color: 'var(--violet)', fontFamily: "'DM Mono', monospace" }}>
                  {unreadCount} {t.notifications.newBadge}
                </span>
              )}
            </div>
            {notifications.length > 0 && (
              unreadCount > 0
                ? <button onClick={markAllRead} style={{ fontSize: 11.5, color: 'var(--violet)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>{t.notifications.markAll}</button>
                : <button onClick={clearAll} style={{ fontSize: 11.5, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>{t.notifications.clear}</button>
            )}
          </div>

          {/* List */}
          {loading ? (
            <div style={{ padding: '32px 16px', textAlign: 'center' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--violet)', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t.notifications.loading}</div>
            </div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.7 }}>✅</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t.notifications.emptyTitle}</div>
            </div>
          ) : (
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {notifications.map((n, i) => (
                <div
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 11,
                    padding: '13px 16px',
                    borderBottom: i < notifications.length - 1 ? '1px solid var(--border)' : 'none',
                    background: n.read ? 'transparent' : 'rgba(139,92,246,0.05)',
                    cursor: n.target ? 'pointer' : 'default',
                    transition: 'background 0.1s',
                    position: 'relative',
                    opacity: n.read ? 0.75 : 1,
                  }}
                  onMouseEnter={e => { if (n.target) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg3)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = n.read ? 'transparent' : 'rgba(139,92,246,0.05)' }}
                >
                  {/* 3px left accent bar for unread */}
                  {!n.read && (
                    <div style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: '0 3px 3px 0', background: n.color }} />
                  )}
                  {/* Icon tile */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 11, flexShrink: 0,
                    background: n.color + '1c',
                    border: '1px solid ' + n.color + '33',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15,
                  }}>
                    {n.icon}
                  </div>
                  {/* Text */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                      <p style={{ fontSize: 13, fontWeight: n.read ? 500 : 700, color: 'var(--text)', letterSpacing: '-0.1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{n.title}</p>
                      <p style={{ fontSize: 10, color: 'var(--text3)', fontFamily: "'DM Mono', monospace", flexShrink: 0, whiteSpace: 'nowrap' }}>{n.time}</p>
                    </div>
                    <p style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.45, marginBottom: n.amount ? 4 : 0 }}>{n.body}</p>
                    {n.amount && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11.5, fontWeight: 700, color: n.color }}>{n.amount}</span>
                        {n.target && <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>· {t.notifications.openLink}</span>}
                      </div>
                    )}
                    {!n.amount && n.target && (
                      <p style={{ fontSize: 10.5, color: 'var(--violet)', fontWeight: 600, marginTop: 4 }}>{t.notifications.openLink}</p>
                    )}
                  </div>
                  {/* Unread dot */}
                  {!n.read && (
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: n.color, flexShrink: 0, marginTop: 6, boxShadow: `0 0 0 3px ${n.color}26` }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
