import { useState, useEffect, useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { Page } from '../App'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useAuth } from '../context/AuthContext'
import { updateUserSettings } from '../api/auth'
import { NotificationCenter } from './NotificationCenter'

const MONTH_PAGES: Page[] = ['dashboard', 'income', 'variable-expenses', 'fixed-expenses']

interface TopbarProps {
  page: Page
  month: number
  year: number
  onMonthChange: (month: number, year: number) => void
  dashView: 'personal' | 'family'
  onDashViewChange: (v: 'personal' | 'family') => void
  onOpenProfile: () => void
  onOpenAdd?: () => void
  onNavigate?: (page: Page) => void
}

function isPhotoUrl(url: string | null | undefined): url is string {
  return !!(url && (url.startsWith('data:') || url.startsWith('http')))
}

export function Topbar({ page, month, year, onMonthChange, dashView, onDashViewChange, onOpenProfile, onOpenAdd, onNavigate }: TopbarProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('theme_preference') as 'dark' | 'light') ?? 'dark' } catch { return 'dark' }
  })

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const current = document.documentElement.getAttribute('data-theme') as 'dark' | 'light'
      if (current === 'dark' || current === 'light') setTheme(current)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('theme_preference', next)
    document.documentElement.setAttribute('data-theme', next)
    updateUserSettings({ theme: next }).catch(() => {})
  }

  const now = new Date()
  const householdEnabled = user?.household_enabled ?? false
  const showMonth = MONTH_PAGES.includes(page)
  const showToggle = householdEnabled && page === 'dashboard'
  const showAdd = !(['household', 'settings'] as string[]).includes(page)

  const dayName = new Intl.DateTimeFormat('sk-SK', { weekday: 'long' }).format(now)
  const dayNameLower = dayName.charAt(0).toLowerCase() + dayName.slice(1)
  const day = now.getDate()
  const monthNum = now.getMonth() + 1
  const yearNum = now.getFullYear()
  const dateStr = `${dayNameLower} ${day}.${monthNum}.${yearNum}`

  const minDate = useMemo(() => {
    const src = user?.tracking_start_date ?? user?.createdAt
    if (src) {
      const d = new Date(src)
      return { year: d.getFullYear(), month: d.getMonth() + 1 }
    }
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  }, [user])

  const canGoPrev = year > minDate.year || (year === minDate.year && month > minDate.month)

  const prevMonth = () => {
    if (!canGoPrev) return
    if (month === 1) onMonthChange(12, year - 1)
    else onMonthChange(month - 1, year)
  }
  const nextMonth = () => {
    if (month === 12) onMonthChange(1, year + 1)
    else onMonthChange(month + 1, year)
  }

  const divider = (
    <div style={{ width: 1, height: 24, background: 'var(--border)', flexShrink: 0 }} />
  )

  const monthNav = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 11, padding: 3, flexShrink: 0 }}>
      <button
        onClick={prevMonth}
        disabled={!canGoPrev}
        style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: canGoPrev ? 'pointer' : 'default', color: canGoPrev ? 'var(--text2)' : 'var(--border2)', borderRadius: 7 }}
        onMouseEnter={e => { if (canGoPrev) (e.currentTarget as HTMLElement).style.background = 'var(--bg4)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        <ChevronLeft size={14} />
      </button>
      <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text)', fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap', padding: '0 8px', minWidth: 96, textAlign: 'center' }}>
        {t.months[month - 1]} {year}
      </span>
      <button onClick={nextMonth} style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text2)', borderRadius: 7 }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg4)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )

  const familyToggle = (
    <div style={{ display: 'flex', borderRadius: 20, background: 'var(--bg3)', border: '1px solid var(--border)', padding: 2, gap: 2 }}>
      {(['personal', 'family'] as const).map(v => (
        <button
          key={v}
          onClick={() => onDashViewChange(v)}
          style={{ height: 26, padding: '0 10px', borderRadius: 18, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: dashView === v ? 'var(--violet)' : 'transparent', color: dashView === v ? 'white' : 'var(--text2)', transition: 'all 0.15s' }}
        >
          {v === 'personal' ? t.dashboard.viewPersonal : t.dashboard.viewFamily}
        </button>
      ))}
    </div>
  )

  const avatarEl = (size: number) => (
    <button
      onClick={onOpenProfile}
      style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: isPhotoUrl(user?.avatarUrl) ? 'transparent' : 'var(--violet)', border: 'none', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 2px rgba(139,92,246,0.3)' }}
    >
      {isPhotoUrl(user?.avatarUrl) ? (
        <img src={user!.avatarUrl!} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : user?.avatarUrl ? (
        <span style={{ fontSize: size * 0.5, lineHeight: 1 }}>{user.avatarUrl}</span>
      ) : (
        <span style={{ color: 'white', fontSize: size * 0.38, fontWeight: 700 }}>
          {user?.name?.[0]?.toUpperCase() ?? '?'}
        </span>
      )}
    </button>
  )

  const themeToggleBtn = (
    <button
      onClick={toggleTheme}
      style={{
        width: 32, height: 32, borderRadius: '50%',
        background: 'var(--bg3)',
        border: '1px solid var(--border)',
        cursor: 'pointer', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: 14, flexShrink: 0,
      }}
      title={theme === 'dark' ? 'Svetlý režim' : 'Tmavý režim'}
      aria-label={theme === 'dark' ? 'Prepnúť na svetlý režim' : 'Prepnúť na tmavý režim'}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )

  const barStyle: CSSProperties = {
    background: 'var(--bg2)',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  }

  return (
    <div style={barStyle}>
      {/* ── Desktop: streak (dashboard) | spacer | right controls ── */}
      <div
        className="hidden md:flex items-center"
        style={{ height: 64, padding: '0 20px', gap: 14 }}
      >
        <div style={{ flex: 1 }} />

        {/* Right: toggle + month nav + divider + add + theme + notifications + avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {showToggle && familyToggle}
          {showMonth && monthNav}
          {divider}
          {showAdd && onOpenAdd && (
            <button
              onClick={onOpenAdd}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 13px', borderRadius: 10,
                background: 'var(--violet)', color: 'white',
                border: 'none', fontSize: 13, fontWeight: 600,
                boxShadow: '0 3px 12px rgba(139,92,246,0.35)',
                cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.transform = 'translateY(-1px)' }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Pridať
            </button>
          )}
          {themeToggleBtn}
          <NotificationCenter onNavigate={onNavigate} />
          {avatarEl(34)}
        </div>
      </div>

      {/* ── Mobile: row 1 always + row 2 conditionally ── */}
      <div className="md:hidden" style={{ paddingTop: 'max(20px, env(safe-area-inset-top))' }}>
        {/* Row 1 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 52, padding: '0 14px' }}>
          <img
            src="/logo.svg"
            alt="Finvu"
            style={{ width: 30, height: 30, flexShrink: 0, cursor: 'pointer' }}
            onClick={() => { window.location.hash = 'dashboard' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
              <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.name?.split(' ')[0] ?? ''}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text3)', fontFamily: "'DM Mono', monospace", marginTop: 1 }}>
              {dateStr}
            </div>
          </div>
          {themeToggleBtn}
          <NotificationCenter />
          {avatarEl(32)}
        </div>

        {/* Row 2: month nav + toggle — only on relevant pages */}
        {showMonth && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 14px 8px', gap: 8 }}>
            {monthNav}
            {showToggle && familyToggle}
          </div>
        )}
      </div>
    </div>
  )
}
