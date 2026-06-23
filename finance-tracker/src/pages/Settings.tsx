import { useState, useEffect, useRef } from 'react'
import { X, Upload, Palette, Bell, Shield, Database, Info, User, Monitor, Laptop, Smartphone, Tablet, ExternalLink } from 'lucide-react'
import { CsvImportModal } from '../components/CsvImportModal'
import { getNotificationsEnabled, setNotificationsEnabled } from '../hooks/useFixedExpenseNotifications'
import { updateWeeklyEmail, updateUserSettings, changePassword, savePin, getSessions, deleteSessionById, deactivateAccount as apiDeactivateAccount } from '../api/auth'
import { getTransactions, deleteTransaction } from '../api/transactions'
import type { TransactionParams } from '../api/transactions'
import { getCategories } from '../api/categories'
import { createHousehold, joinHousehold, toggleHousehold } from '../api/households'
import { useSettingsContext } from '../context/SettingsContext'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { useTranslation } from '../i18n'
import { useAuth } from '../context/AuthContext'
import { usePinLockContext } from '../context/PinLockContext'
import { PinSetupModal } from '../components/PinSetupModal'
import type { ApiTransaction, UserSession } from '../types'

// ── Constants ─────────────────────────────────────────────────────────────────

const CURRENCIES = [
  { value: 'EUR', label: '€ Euro' },
  { value: 'USD', label: '$ US Dollar' },
  { value: 'GBP', label: '£ Libra' },
  { value: 'CZK', label: 'Kč Česká koruna' },
  { value: 'HUF', label: 'Ft Forint' },
  { value: 'PLN', label: 'zł Złoty' },
]

const DATE_FORMATS = [
  { value: 'DD.MM.YYYY', label: 'DD.MM.YYYY' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
]

const ACCENT_COLORS = [
  { name: 'Violet', value: '#7C3AED' },
  { name: 'Modrá', value: '#3B82F6' },
  { name: 'Zelená', value: '#10B981' },
  { name: 'Oranžová', value: '#F59E0B' },
  { name: 'Ružová', value: '#EC4899' },
  { name: 'Červená', value: '#EF4444' },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--card-shadow)' }}>
      {children}
    </div>
  )
}

function SectionHeader({ emoji, label }: { emoji: string; label: string }) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '14px 20px' }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text3)', fontFamily: "'DM Mono', monospace", fontWeight: 600, margin: 0 }}>
        {emoji} {label}
      </p>
    </div>
  )
}

function SettingRow({ label, sublabel, children }: { label: string; sublabel?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '13px 20px' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', margin: 0 }}>{label}</p>
        {sublabel && <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{sublabel}</p>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={`w-12 h-[26px] rounded-full transition-all duration-200 relative flex-shrink-0 ${
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      }`}
      style={{
        background: checked ? 'var(--accent-color)' : 'var(--toggle-inactive)',
      }}
    >
      <div
        className={`absolute top-[3px] left-[3px] w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-[22px]' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function fetchAllTransactions(params: Omit<TransactionParams, 'limit' | 'offset'>): Promise<ApiTransaction[]> {
  const all: ApiTransaction[] = []
  let offset = 0
  while (true) {
    const { data } = await getTransactions({ ...params, limit: 200, offset })
    all.push(...data)
    if (data.length < 200) break
    offset += 200
  }
  return all
}

function loadLocalPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function saveLocalPref(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
}

type DangerAction = 'transactions' | 'reset'

type SettingsSection = 'appearance' | 'finance' | 'notifications' | 'security' | 'data' | 'about'

const SECTIONS = [
  { id: 'appearance' as SettingsSection, label: 'Vzhľad', icon: Palette },
  { id: 'finance' as SettingsSection, label: 'Financie', icon: User },
  { id: 'notifications' as SettingsSection, label: 'Notifikácie', icon: Bell },
  { id: 'security' as SettingsSection, label: 'Bezpečnosť', icon: Shield },
  { id: 'data' as SettingsSection, label: 'Dáta', icon: Database },
  { id: 'about' as SettingsSection, label: 'O aplikácii', icon: Info },
] as const

// ── Main component ────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { settings, updateSettings } = useSettingsContext()
  const { t } = useTranslation()
  const { deleteAccount, user, updateMonthlyEmail, refreshUser, logout } = useAuth()
  const { setupPin, hasPin, removePin, verifyPin: verifyLockPin } = usePinLockContext()

  const compactStorageKey = window.innerWidth < 768 ? 'finvu_compact_mobile' : 'finvu_compact_desktop'
  const compactDefault = window.innerWidth < 768

  const securityRef = useRef<HTMLDivElement>(null)
  const dataRef = useRef<HTMLDivElement>(null)

  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')

  // Apply saved appearance preferences on mount + navigate to section
  useEffect(() => {
    const savedAccent = loadLocalPref<string>('accent_color', '#7C3AED')
    const savedCompact = loadLocalPref<boolean>(compactStorageKey, compactDefault)
    const html = document.documentElement
    html.style.setProperty('--accent-color', savedAccent)
    html.classList.toggle('compact', savedCompact)

    const section = localStorage.getItem('settings_open_section')
    if (section) {
      localStorage.removeItem('settings_open_section')
      if (section === 'security') setActiveSection('security')
      else if (section === 'data') setActiveSection('data')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Section 2: Appearance ─────────────────────────────────────────────────
  const [theme, setThemeState] = useState<'dark' | 'light' | 'system'>(() =>
    loadLocalPref<'dark' | 'light' | 'system'>('theme_preference', 'dark')
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const current = document.documentElement.getAttribute('data-theme') as 'dark' | 'light' | 'system'
      if (current) setThemeState(current)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const [accentColor, setAccentColorState] = useState<string>(() =>
    loadLocalPref<string>('accent_color', '#7C3AED')
  )
  const [compactMode, setCompactModeState] = useState<boolean>(() =>
    loadLocalPref<boolean>(compactStorageKey, compactDefault)
  )

  function handleThemeChange(next: 'dark' | 'light' | 'system') {
    setThemeState(next)
    saveLocalPref('theme_preference', next)
    const html = document.documentElement
    html.setAttribute('data-theme', next !== 'system' ? next : 'dark')
    updateUserSettings({ theme: next }).catch(() => { /* non-critical */ })
  }

  function handleAccentChange(color: string) {
    setAccentColorState(color)
    saveLocalPref('accent_color', color)
    document.documentElement.style.setProperty('--accent-color', color)
  }

  function handleCompactToggle() {
    const next = !compactMode
    setCompactModeState(next)
    saveLocalPref(compactStorageKey, next)
    document.documentElement.classList.toggle('compact', next)
  }

  // ── Security section ─────────────────────────────────────────────────────
  const [pinSetupOpen, setPinSetupOpen] = useState(false)
  const [pinRemoveOpen, setPinRemoveOpen] = useState(false)
  const [pinRemoveInput, setPinRemoveInput] = useState('')
  const [pinRemoveError, setPinRemoveError] = useState<string | null>(null)
  const [pinRemoveLoading, setPinRemoveLoading] = useState(false)
  const [pinRemoveShake, setPinRemoveShake] = useState(false)
  const [changePwOpen, setChangePwOpen] = useState(false)
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [changePwLoading, setChangePwLoading] = useState(false)
  const [changePwError, setChangePwError] = useState<string | null>(null)
  const [changePwOk, setChangePwOk] = useState(false)

  // Auto lock
  const [autoLockMinutes, setAutoLockMinutes] = useState<number | null>(() => user?.auto_lock_minutes ?? null)
  const [autoLockSaving, setAutoLockSaving] = useState(false)

  async function handleAutoLockChange(val: number | null) {
    setAutoLockMinutes(val)
    setAutoLockSaving(true)
    try {
      await updateUserSettings({ autoLockMinutes: val })
      localStorage.setItem('auto_lock_minutes', String(val))
      await refreshUser()
    } finally {
      setAutoLockSaving(false)
    }
  }

  // Sessions
  const [sessions, setSessions] = useState<UserSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionDeletingId, setSessionDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (activeSection !== 'security') return
    setSessionsLoading(true)
    getSessions().then(setSessions).catch(() => {}).finally(() => setSessionsLoading(false))
  }, [activeSection])

  async function handleDeleteSession(id: string) {
    setSessionDeletingId(id)
    try {
      await deleteSessionById(id)
      setSessions(prev => prev.filter(s => s.id !== id))
    } catch { /* ignore */ }
    finally { setSessionDeletingId(null) }
  }

  // Deactivate account
  const [deactivateConfirm, setDeactivateConfirm] = useState('')
  const [deactivateError, setDeactivateError] = useState<string | null>(null)
  const [isDeactivating, setIsDeactivating] = useState(false)

  async function handleChangePassword() {
    setChangePwError(null)
    if (!currentPw || !newPw || !confirmPw) { setChangePwError(t.profile.fillAllFields); return }
    if (newPw.length < 8) { setChangePwError(t.profile.passwordMin8); return }
    if (newPw !== confirmPw) { setChangePwError(t.settings.passwordMismatch); return }
    setChangePwLoading(true)
    try {
      await changePassword(currentPw, newPw)
      setChangePwOk(true)
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setTimeout(() => { setChangePwOk(false); setChangePwOpen(false) }, 2000)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setChangePwError(msg ?? t.profile.changePwFailed)
    } finally {
      setChangePwLoading(false)
    }
  }

  async function handlePinRemoveKey(k: string) {
    if (pinRemoveLoading) return
    if (k === '⌫') { setPinRemoveInput(p => p.slice(0, -1)); return }
    if (pinRemoveInput.length >= 4) return
    const next = pinRemoveInput + k
    setPinRemoveInput(next)
    if (next.length === 4) {
      setPinRemoveLoading(true)
      const ok = await verifyLockPin(next)
      if (!ok) {
        setPinRemoveShake(true)
        setPinRemoveError(t.profile.incorrectPin)
        setTimeout(() => { setPinRemoveShake(false); setPinRemoveInput(''); setPinRemoveLoading(false) }, 600)
      } else {
        await removePin()
        setPinRemoveOpen(false)
        setPinRemoveInput('')
        setPinRemoveError(null)
        setPinRemoveLoading(false)
      }
    }
  }

  // ── Section 3: Notifications ──────────────────────────────────────────────
  const [notificationsEnabled, setNotificationsEnabledState] = useState(getNotificationsEnabled)
  const [weeklyEmail, setWeeklyEmail] = useState(user?.weeklyEmailEnabled ?? false)
  const [weeklyEmailSaving, setWeeklyEmailSaving] = useState(false)
  const [monthlyEmail, setMonthlyEmail] = useState(user?.monthlyEmailEnabled ?? false)
  const [monthlyEmailSaving, setMonthlyEmailSaving] = useState(false)
  const [budgetWarnings, setBudgetWarningsState] = useState(() => loadLocalPref<boolean>('budget_warnings_enabled', true))
  const [savingsGoalReminder, setSavingsGoalReminderState] = useState(() => loadLocalPref<boolean>('savings_goal_reminder_enabled', false))

  // Data section
  const [csvImportOpen, setCsvImportOpen] = useState(false)

  // Deactivation modals
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  function handleNotificationsToggle() {
    const next = !notificationsEnabled
    setNotificationsEnabledState(next)
    setNotificationsEnabled(next)
    if (next && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }

  async function handleWeeklyEmailToggle() {
    setWeeklyEmailSaving(true)
    const next = !weeklyEmail
    try {
      await updateWeeklyEmail(next)
      setWeeklyEmail(next)
    } finally {
      setWeeklyEmailSaving(false)
    }
  }

  async function handleMonthlyEmailToggle() {
    setMonthlyEmailSaving(true)
    const next = !monthlyEmail
    try {
      await updateMonthlyEmail(next)
      setMonthlyEmail(next)
    } finally {
      setMonthlyEmailSaving(false)
    }
  }

  // ── Section 4: Export ─────────────────────────────────────────────────────
  const [exportError, setExportError] = useState<string | null>(null)


  async function handleExportJSON() {
    try {
      setExportError(null)
      const [transactions, { data: categories }] = await Promise.all([
        fetchAllTransactions({}),
        getCategories(),
      ])
      const payload = {
        version: '2',
        exportedAt: new Date().toISOString(),
        transactions,
        categories,
        settings,
      }
      downloadBlob(
        new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
        `finvu-export-${new Date().toISOString().split('T')[0]}.json`
      )
    } catch {
      setExportError('Export zlyhal. Skúste znova.')
    }
  }

  async function handleExportCSV() {
    try {
      setExportError(null)
      const transactions = await fetchAllTransactions({})
      const rows = transactions.map(t =>
        `${t.date},${t.type},"${(t.categoryName ?? '').replace(/"/g, "'")}","${(t.description ?? '').replace(/"/g, "'")}",${t.amount}`
      )
      downloadBlob(
        new Blob([['Dátum,Typ,Kategória,Poznámka,Suma', ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' }),
        `finvu-export-${new Date().toISOString().split('T')[0]}.csv`
      )
    } catch {
      setExportError('Export zlyhal. Skúste znova.')
    }
  }

  function handleExportPDF() {
    window.print()
  }


  // ── Section 5: Danger Zone ────────────────────────────────────────────────
  const [dangerAction, setDangerAction] = useState<DangerAction | null>(null)
  const [dangerConfirmText, setDangerConfirmText] = useState('')
  const [dangerLoading, setDangerLoading] = useState(false)

  async function executeDangerAction() {
    if (!dangerAction) return
    setDangerLoading(true)
    try {
      if (dangerAction === 'transactions') {
        while (true) {
          const { data } = await getTransactions({ limit: 200 })
          if (data.length === 0) break
          await Promise.all(data.map(t => deleteTransaction(t.id)))
        }
      } else if (dangerAction === 'reset') {
        while (true) {
          const { data } = await getTransactions({ limit: 200 })
          if (data.length === 0) break
          await Promise.all(data.map(t => deleteTransaction(t.id)))
        }
        try { localStorage.removeItem('app_settings') } catch { /* ignore */ }
      }
      setDangerAction(null)
      setDangerConfirmText('')
    } catch { /* fail silently */ }
    finally { setDangerLoading(false) }
  }

  // ── Delete account ────────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)


  const buildDate = import.meta.env.VITE_BUILD_DATE as string | undefined

  // ── Savings toggle ────────────────────────────────────────────────────────
  const savingsEnabled = user?.savings_enabled ?? false
  const [savingsToggling, setSavingsToggling] = useState(false)

  async function handleSavingsToggle() {
    setSavingsToggling(true)
    try {
      await updateUserSettings({ savingsEnabled: !savingsEnabled })
      await refreshUser()
    } finally {
      setSavingsToggling(false)
    }
  }

  // ── Household ─────────────────────────────────────────────────────────────
  const householdEnabled = user?.household_enabled ?? false
  const householdId = user?.household_id ?? null
  const [householdToggling, setHouseholdToggling] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  async function handleHouseholdToggle() {
    setHouseholdToggling(true)
    try {
      await toggleHousehold(!householdEnabled)
      await refreshUser()
      if (householdEnabled) {
        localStorage.removeItem('finvu_dashboard_view')
      }
    } finally {
      setHouseholdToggling(false)
    }
  }

  async function handleCreateHousehold() {
    if (!createName.trim()) return
    setCreateLoading(true)
    try {
      await createHousehold(createName.trim())
      await refreshUser()
      setCreateName('')
    } finally {
      setCreateLoading(false)
    }
  }

  async function handleJoinHousehold() {
    if (!joinCode.trim()) return
    setJoinLoading(true)
    setJoinError(null)
    try {
      await joinHousehold(joinCode.trim().toUpperCase())
      await refreshUser()
      setJoinCode('')
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) setJoinError(t.settings.householdJoinErrorNotFound)
      else if (status === 409) setJoinError(t.settings.householdJoinErrorMember)
      else setJoinError(t.settings.householdJoinErrorFailed)
    } finally {
      setJoinLoading(false)
    }
  }


  // ── Tracking start date ───────────────────────────────────────────────────
  const [trackingDate, setTrackingDate] = useState(() => user?.tracking_start_date ?? '')
  const [trackingSaving, setTrackingSaving] = useState(false)
  const [trackingOk, setTrackingOk] = useState(false)

  async function handleSaveTrackingDate() {
    setTrackingSaving(true)
    setTrackingOk(false)
    try {
      await updateUserSettings({ trackingStartDate: trackingDate || null })
      await refreshUser()
      setTrackingOk(true)
      setTimeout(() => setTrackingOk(false), 2500)
    } catch { /* non-critical */ }
    finally { setTrackingSaving(false) }
  }

  async function handleClearTrackingDate() {
    setTrackingSaving(true)
    try {
      await updateUserSettings({ trackingStartDate: null })
      await refreshUser()
      setTrackingDate('')
    } catch { /* non-critical */ }
    finally { setTrackingSaving(false) }
  }

  const sectionLabels: Record<SettingsSection, string> = {
    appearance: t.settings.sectionAppearance,
    finance: t.settings.sectionFinance,
    notifications: t.settings.sectionNotifications,
    security: t.settings.sectionSecurity,
    data: t.settings.sectionData,
    about: t.settings.sectionAbout,
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full" style={{ paddingBottom: 'calc(100px + env(safe-area-inset-bottom, 20px))' }}>

      {/* Settings page header */}
      <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <p className="t-label" style={{ marginBottom: 6 }}>{t.settings.title}</p>
        <p style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.3px', margin: 0 }}>{t.settings.subtitle}</p>
      </div>

      {/* 2-col grid: left nav + right content */}
      <div className="grid gap-5 items-start lg:grid-cols-[200px_1fr]">

        {/* Left nav — desktop only */}
        <div className="hidden lg:block" style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', position: 'sticky', top: 20 }}>
          {SECTIONS.map(s => {
            const Icon = s.icon
            const isActive = activeSection === s.id
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '13px 16px',
                  background: isActive ? 'rgba(139,92,246,0.1)' : 'transparent',
                  border: 'none', borderLeft: isActive ? '3px solid var(--violet)' : '3px solid transparent',
                  color: isActive ? 'var(--violet)' : 'var(--text2)',
                  fontSize: 14, fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s', textAlign: 'left',
                }}
              >
                <Icon size={16} strokeWidth={isActive ? 2 : 1.8} />
                {sectionLabels[s.id]}
              </button>
            )
          })}
        </div>

        {/* Mobile: horizontal scroll chips */}
        <div className="flex lg:hidden" style={{ gap: 8, overflowX: 'auto', paddingBottom: 4, gridColumn: '1 / -1' }}>
          {SECTIONS.map(s => {
            const isActive = activeSection === s.id
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 99, flexShrink: 0,
                  background: isActive ? 'rgba(139,92,246,0.12)' : 'var(--bg3)',
                  border: isActive ? '1px solid rgba(139,92,246,0.3)' : '1px solid var(--border)',
                  color: isActive ? 'var(--violet)' : 'var(--text2)',
                  fontSize: 13, fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {sectionLabels[s.id]}
              </button>
            )
          })}
        </div>

        {/* Right content */}
        <div className="settings-content" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── APPEARANCE SECTION ── */}
          {activeSection === 'appearance' && (
            <>
              {/* Card 1: Téma */}
              <SectionCard>
                <SectionHeader emoji="🎨" label={t.settings.theme} />
                <div className="divide-y divide-white/[0.04]">
                  <SettingRow label={t.settings.theme} sublabel={t.settings.themeSubtitle}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {([
                        { id: 'dark', icon: '🌙', label: 'Dark' },
                        { id: 'light', icon: '☀️', label: 'Light' },
                        { id: 'system', icon: '⚙️', label: 'System' },
                      ] as const).map(({ id, icon, label }) => (
                        <button
                          key={id}
                          onClick={() => handleThemeChange(id)}
                          style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                            padding: '8px 12px', borderRadius: 12, cursor: 'pointer',
                            border: theme === id ? '2px solid var(--violet)' : '1px solid var(--border)',
                            background: theme === id ? 'rgba(124,58,237,0.12)' : 'var(--bg3)',
                            color: theme === id ? 'var(--violet)' : 'var(--text2)',
                            minWidth: 56, transition: 'all 0.15s',
                          }}
                        >
                          <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
                          <span style={{ fontSize: 11, fontWeight: theme === id ? 600 : 400 }}>{label}</span>
                        </button>
                      ))}
                    </div>
                  </SettingRow>
                  <SettingRow label={t.settings.compactMode} sublabel={t.settings.compactModeSubtitle}>
                    <Toggle checked={compactMode} onChange={handleCompactToggle} />
                  </SettingRow>
                </div>
              </SectionCard>

              {/* Card 2: Akcentová farba */}
              <SectionCard>
                <SectionHeader emoji="🎨" label={t.settings.accentColor} />
                <div style={{ padding: '12px 20px 16px' }}>
                  <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14, marginTop: 0 }}>Použije sa pre tlačidlá, ikony a grafy</p>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {ACCENT_COLORS.map(c => (
                      <button
                        key={c.value}
                        onClick={() => handleAccentChange(c.value)}
                        title={c.name}
                        style={{
                          width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
                          border: 'none', backgroundColor: c.value, flexShrink: 0,
                          outline: accentColor === c.value ? `3px solid ${c.value}` : 'none',
                          outlineOffset: 3, transition: 'transform 0.15s',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                        className="hover:scale-110"
                      >
                        {accentColor === c.value && (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </SectionCard>
            </>
          )}

          {/* ── FINANCE SECTION ── */}
          {activeSection === 'finance' && (
            <>
              {/* Section 1: Všeobecné */}
              <div className="settings-general-compact">
              <SectionCard>
                <SectionHeader emoji="👤" label={t.settings.generalSection} />
                <div className="divide-y divide-white/[0.04]">
                  <SettingRow label={t.settings.currency}>
                    <select
                      value={settings.currency}
                      onChange={e => updateSettings({ currency: e.target.value })}
                      className="select-field"
                    >
                      {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </SettingRow>

                  <SettingRow label={t.settings.language} sublabel={t.settings.languageNote}>
                    <LanguageSwitcher
                      variant="full"
                      onLanguageChange={lang => {
                        updateUserSettings({ language: lang }).catch(() => { /* non-critical */ })
                      }}
                    />
                  </SettingRow>

                  <SettingRow label={t.settings.dateFormat}>
                    <select
                      value={settings.dateFormat}
                      onChange={e => updateSettings({ dateFormat: e.target.value })}
                      className="select-field"
                    >
                      {DATE_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </SettingRow>

                  <SettingRow label={t.settings.firstDayOfWeek}>
                    <div style={{ display: 'flex', background: 'var(--bg3)', borderRadius: 8, padding: 3, border: '1px solid var(--border)' }}>
                      {(['monday', 'sunday'] as const).map((day, i) => (
                        <button
                          key={day}
                          onClick={() => updateSettings({ firstDayOfWeek: day })}
                          style={{
                            padding: '5px 16px', borderRadius: 6, fontSize: 13,
                            fontWeight: settings.firstDayOfWeek === day ? 600 : 400,
                            background: settings.firstDayOfWeek === day ? 'var(--accent-color)' : 'transparent',
                            color: settings.firstDayOfWeek === day ? 'white' : 'var(--text2)',
                            border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                          }}
                        >
                          {i === 0 ? t.daysShort[0] : t.daysShort[6]}
                        </button>
                      ))}
                    </div>
                  </SettingRow>

                </div>
              </SectionCard>
              </div>

              {/* Section: Sledovanie od dátumu */}
              <SectionCard>
                <SectionHeader emoji="📅" label="Sledovanie od dátumu" />
                <div style={{ padding: '4px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0, lineHeight: 1.5 }}>
                    Nastav dátum, od ktorého chceš sledovať financie. Príjmy a výdavky pred týmto dátumom sa nebudú zobrazovať v histórii.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      Sledovanie od
                    </label>
                    <input
                      type="date"
                      value={trackingDate}
                      onChange={e => setTrackingDate(e.target.value)}
                      style={{
                        background: 'var(--bg3)', border: '1px solid var(--border)',
                        borderRadius: 10, padding: '11px 14px', fontSize: 14,
                        color: 'var(--text)', width: '100%', outline: 'none',
                        fontFamily: 'inherit', boxSizing: 'border-box', colorScheme: 'dark',
                      }}
                    />
                  </div>
                  {trackingOk && (
                    <p style={{ fontSize: 12, color: '#34D399', margin: 0 }}>✓ Dátum bol uložený</p>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={handleSaveTrackingDate}
                      disabled={trackingSaving}
                      className="btn-primary py-2 text-sm"
                      style={{ opacity: trackingSaving ? 0.6 : 1 }}
                    >
                      {trackingSaving ? 'Ukladám...' : 'Uložiť'}
                    </button>
                    {(user?.tracking_start_date) && (
                      <button
                        onClick={handleClearTrackingDate}
                        disabled={trackingSaving}
                        className="btn-secondary py-2 text-sm"
                        style={{ opacity: trackingSaving ? 0.6 : 1 }}
                      >
                        Vymazať
                      </button>
                    )}
                  </div>
                </div>
              </SectionCard>

              {/* Section: Rodinné financie */}
              <SectionCard>
                <SectionHeader emoji="👨‍👩‍👧" label={t.settings.householdTitle} />
                <div className="divide-y divide-white/[0.04]">
                  <SettingRow label={t.settings.householdTitle} sublabel={householdId ? t.settings.householdSubtitleJoined : t.settings.householdSubtitleNew}>
                    <Toggle checked={householdEnabled} onChange={householdId ? () => {} : handleHouseholdToggle} disabled={householdToggling || !!householdId} />
                  </SettingRow>
                </div>

                {householdEnabled && !householdId && (
                  <div className="p-5 flex flex-col gap-4 border-t border-white/[0.06]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Vytvor domácnosť */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                        <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text3)]">{t.settings.householdCreate}</p>
                        <input
                          type="text"
                          placeholder={t.settings.householdCreatePlaceholder}
                          value={createName}
                          onChange={e => setCreateName(e.target.value)}
                          style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', padding: '12px 14px', fontSize: 14, outline: 'none', width: '100%', fontFamily: 'inherit' }}
                        />
                        <button
                          onClick={handleCreateHousehold}
                          disabled={createLoading || !createName.trim()}
                          style={{ background: 'var(--violet)', color: 'white', border: 'none', borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%', fontFamily: 'inherit', opacity: (createLoading || !createName.trim()) ? 0.4 : 1 }}
                        >
                          {createLoading ? t.settings.householdCreating : t.settings.householdCreateBtn}
                        </button>
                      </div>

                      {/* Pripoj sa */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                        <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text3)]">{t.settings.householdJoin}</p>
                        <input
                          type="text"
                          placeholder={t.settings.householdJoinPlaceholder}
                          value={joinCode}
                          onChange={e => { setJoinCode(e.target.value.toUpperCase()); setJoinError(null) }}
                          style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', padding: '12px 14px', fontSize: 14, outline: 'none', width: '100%', fontFamily: 'inherit' }}
                        />
                        {joinError && <p className="text-xs text-red-400">{joinError}</p>}
                        <button
                          onClick={handleJoinHousehold}
                          disabled={joinLoading || !joinCode.trim()}
                          style={{ background: 'var(--violet)', color: 'white', border: 'none', borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%', fontFamily: 'inherit', opacity: (joinLoading || !joinCode.trim()) ? 0.4 : 1 }}
                        >
                          {joinLoading ? t.settings.householdJoining : t.settings.householdJoinBtn}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </SectionCard>

              {/* Section: Sporenie */}
              <SectionCard>
                <SectionHeader emoji="🐷" label={t.settings.savingsTitle} />
                <div className="divide-y divide-white/[0.04]">
                  <SettingRow label={t.settings.savingsTitle} sublabel={t.settings.savingsSubtitle}>
                    <Toggle checked={savingsEnabled} onChange={handleSavingsToggle} disabled={savingsToggling} />
                  </SettingRow>
                </div>
              </SectionCard>
            </>
          )}

          {/* ── NOTIFICATIONS SECTION ── */}
          {activeSection === 'notifications' && (
            <>
              <SectionCard>
                <SectionHeader emoji="🔔" label={t.settings.notificationsSection} />
                <div className="divide-y divide-white/[0.04]">
                  <SettingRow label={t.settings.fixedReminders} sublabel={t.settings.fixedRemindersSubtitle}>
                    <Toggle checked={notificationsEnabled} onChange={handleNotificationsToggle} />
                  </SettingRow>

                  <SettingRow label={t.settings.budgetWarnings} sublabel={t.settings.budgetWarningsSubtitle}>
                    <Toggle
                      checked={budgetWarnings}
                      onChange={() => {
                        const next = !budgetWarnings
                        setBudgetWarningsState(next)
                        saveLocalPref('budget_warnings_enabled', next)
                      }}
                    />
                  </SettingRow>

                  <SettingRow label={t.settings.savingsGoalReminder} sublabel={t.settings.savingsGoalReminderSubtitle}>
                    <Toggle
                      checked={savingsGoalReminder}
                      onChange={() => {
                        const next = !savingsGoalReminder
                        setSavingsGoalReminderState(next)
                        saveLocalPref('savings_goal_reminder_enabled', next)
                      }}
                    />
                  </SettingRow>

                  <SettingRow label={t.settings.weeklyEmailLabel} sublabel={t.settings.weeklyEmailSubtitle}>
                    <Toggle checked={weeklyEmail} onChange={handleWeeklyEmailToggle} disabled={weeklyEmailSaving} />
                  </SettingRow>

                  <SettingRow label={t.settings.monthlyEmailLabel} sublabel={t.settings.monthlyEmailSubtitle}>
                    <Toggle checked={monthlyEmail} onChange={handleMonthlyEmailToggle} disabled={monthlyEmailSaving} />
                  </SettingRow>
                </div>
                <div className="border-t border-white/[0.04]" style={{ padding: '10px var(--card-padding, 20px)' }}>
                  <p className="text-xs text-[color:var(--text3)]">{t.settings.notificationsNote}</p>
                </div>
              </SectionCard>
            </>
          )}

          {/* ── SECURITY SECTION ── */}
          {activeSection === 'security' && (
            <>
              <div ref={securityRef} id="bezpecnost-section">
              <SectionCard>
                <SectionHeader emoji="🔐" label={t.settings.sectionSecurity} />
                <div className="divide-y divide-white/[0.04]">

                  {/* Zmeniť heslo */}
                  <div>
                    <SettingRow label="Zmeniť heslo" sublabel="Aktualizovať prihlasovacie heslo">
                      <button
                        onClick={() => { setChangePwOpen(o => !o); setChangePwError(null) }}
                        className="btn-settings"
                      >
                        {changePwOpen ? 'Zavrieť' : 'Zmeniť'}
                      </button>
                    </SettingRow>
                    {changePwOpen && (
                      <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {changePwError && <p style={{ fontSize: 12, color: '#F87171', margin: 0 }}>{changePwError}</p>}
                        {changePwOk && <p style={{ fontSize: 12, color: '#34D399', margin: 0 }}>✓ Heslo zmenené</p>}
                        <input type="password" placeholder="Aktuálne heslo" value={currentPw} onChange={e => setCurrentPw(e.target.value)} className="input-field text-sm" />
                        <input type="password" placeholder="Nové heslo (min. 8 znakov)" value={newPw} onChange={e => setNewPw(e.target.value)} className="input-field text-sm" />
                        <input type="password" placeholder="Potvrď nové heslo" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChangePassword()} className="input-field text-sm" />
                        <button onClick={handleChangePassword} disabled={changePwLoading} className="btn-primary py-2 text-sm justify-center disabled:opacity-40">
                          {changePwLoading ? 'Ukladám...' : 'Uložiť heslo'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* PIN */}
                  <SettingRow
                    label={t.settings.pinCodeLabel}
                    sublabel={hasPin ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>{t.settings.pinIsActive}</span> : t.settings.pinAppLock}
                  >
                    {hasPin ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setPinSetupOpen(true)} className="btn-settings">{t.settings.change}</button>
                        <button onClick={() => { setPinRemoveOpen(true); setPinRemoveInput(''); setPinRemoveError(null) }} className="btn-settings-danger">{t.common.remove}</button>
                      </div>
                    ) : (
                      <button onClick={() => setPinSetupOpen(true)} className="btn-settings">{t.settings.setup}</button>
                    )}
                  </SettingRow>

                  {/* Automatické uzamknutie */}
                  <SettingRow label={t.settings.autoLock} sublabel={t.settings.autoLockSubtitle}>
                    <select
                      value={autoLockMinutes ?? 'never'}
                      onChange={e => handleAutoLockChange(e.target.value === 'never' ? null : Number(e.target.value))}
                      disabled={autoLockSaving || !hasPin}
                      className="select-field"
                      style={{ opacity: (!hasPin) ? 0.4 : 1 }}
                    >
                      <option value="never">{t.settings.autoLockNever}</option>
                      <option value="0">Ihneď</option>
                      <option value="1">{t.settings.autoLock1min}</option>
                      <option value="5">{t.settings.autoLock5min}</option>
                      <option value="15">{t.settings.autoLock15min}</option>
                    </select>
                  </SettingRow>

                </div>
              </SectionCard>
              </div>

              {/* Aktívne relácie */}
              <SectionCard>
                <SectionHeader emoji="🖥️" label={t.settings.activeSessions} />
                <div style={{ padding: '4px 0 8px' }}>
                  {sessionsLoading ? (
                    <p style={{ fontSize: 13, color: 'var(--text3)', padding: '12px 20px' }}>Načítavam...</p>
                  ) : sessions.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--text3)', padding: '12px 20px' }}>{t.settings.activeSessionsSubtitle}</p>
                  ) : (
                    <div className="divide-y divide-white/[0.04]">
                      {sessions.map(session => {
                        const isCurrent = session.id === (typeof window !== 'undefined' ? localStorage.getItem('finvu_session_id') : null)
                        const DeviceIcon = /iPhone|iPad/i.test(session.deviceName ?? '') ? Smartphone
                          : /Android Phone/i.test(session.deviceName ?? '') ? Smartphone
                          : /Tablet/i.test(session.deviceName ?? '') ? Tablet
                          : /Mac|Windows|Linux/i.test(session.deviceName ?? '') ? Laptop
                          : Monitor
                        return (
                          <div key={session.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px' }}>
                            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <DeviceIcon size={18} strokeWidth={1.5} color="var(--text2)" />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', margin: 0 }}>{session.deviceName ?? 'Neznáme zariadenie'}</p>
                                {isCurrent && (
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: 'rgba(52,211,153,0.15)', color: '#34D399', fontFamily: "'DM Mono',monospace", letterSpacing: '0.05em' }}>
                                    {t.settings.currentSessionBadge}
                                  </span>
                                )}
                              </div>
                              <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>
                                {session.browser ?? ''}{session.location ? ` · ${session.location}` : ''}{session.ip ? ` · ${session.ip}` : ''}
                              </p>
                              <p style={{ fontSize: 11, color: 'var(--text3)', margin: 0, fontFamily: "'DM Mono',monospace" }}>
                                {new Date(session.createdAt).toLocaleDateString('sk-SK', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </p>
                            </div>
                            {!isCurrent && (
                              <button
                                onClick={() => handleDeleteSession(session.id)}
                                disabled={sessionDeletingId === session.id}
                                className="btn-settings-danger"
                                style={{ flexShrink: 0 }}
                              >
                                {t.settings.logoutSession}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </SectionCard>

              {/* DEAKTIVÁCIA */}
              <SectionCard>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                  <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text3)', fontFamily: "'DM Mono', monospace", fontWeight: 600, margin: 0 }}>
                    ⚠️ {t.settings.deactivationSection}
                  </p>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  <SettingRow label="Vymazať všetky transakcie" sublabel="Nevratná operácia — všetky tx budú odstránené">
                    <button onClick={() => { setDangerAction('transactions'); setDangerConfirmText('') }} className="btn-settings-danger">Vymazať</button>
                  </SettingRow>
                  <SettingRow label="Resetovať aplikáciu" sublabel="Vymaže všetky dáta a nastavenia">
                    <button onClick={() => { setDangerAction('reset'); setDangerConfirmText('') }} className="btn-settings-danger">Reset</button>
                  </SettingRow>
                  <SettingRow label="Deaktivovať účet" sublabel="Účet bude skrytý, dáta zostanú 30 dní">
                    <button onClick={() => { setDeactivateOpen(true); setDeactivateConfirm(''); setDeactivateError(null) }} className="btn-settings-danger">Deaktivovať</button>
                  </SettingRow>
                  <SettingRow label="Zmazať účet" sublabel="Trvale odstráni účet a všetky dáta — táto akcia je nezvratná">
                    <button
                      onClick={() => { setDeleteOpen(true); setDeleteConfirm(''); setDeleteError(null) }}
                      style={{ background: '#DC2626', border: 'none', color: 'white', borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Zmazať účet
                    </button>
                  </SettingRow>
                </div>
              </SectionCard>
            </>
          )}

          {/* ── DATA SECTION ── */}
          {activeSection === 'data' && (
            <>
              <div ref={dataRef} id="data-section">
              <SectionCard>
                <SectionHeader emoji="💾" label="Export a import" />
                <div className="divide-y divide-white/[0.04]">
                  <SettingRow label="Exportovať dáta" sublabel="Stiahnuť všetky transakcie a kategórie">
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={handleExportJSON} className="btn-settings" style={{ padding: '5px 12px', fontSize: 12 }}>JSON</button>
                      <button onClick={handleExportCSV} className="btn-settings" style={{ padding: '5px 12px', fontSize: 12 }}>CSV</button>
                      <button onClick={handleExportPDF} className="btn-settings" style={{ padding: '5px 12px', fontSize: 12 }}>PDF</button>
                    </div>
                  </SettingRow>
                  <SettingRow label="Importovať CSV" sublabel="Z banky: Revolut, Tatra, ČSOB, SLSP">
                    <button onClick={() => setCsvImportOpen(true)} className="btn-settings">
                      <Upload size={13} />
                      Vybrať súbor
                    </button>
                  </SettingRow>
                </div>
                <div style={{ borderTop: '1px solid var(--border)', padding: '10px 20px' }}>
                  <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>{t.settings.dataNote}</p>
                </div>
                {exportError && <p style={{ fontSize: 12, color: '#F87171', padding: '0 20px 12px', margin: 0 }}>{exportError}</p>}
              </SectionCard>
              </div>
            </>
          )}

          {/* ── ABOUT SECTION ── */}
          {activeSection === 'about' && (
            <>
              <SectionCard>
                {/* App header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img
                      src="/logo.svg"
                      alt="Finvu"
                      style={{ width: 48, height: 48, borderRadius: 12 }}
                      onError={e => {
                        const el = e.currentTarget as HTMLImageElement
                        el.style.display = 'none'
                        const fallback = el.nextElementSibling as HTMLElement | null
                        if (fallback) fallback.style.display = 'flex'
                      }}
                    />
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--accent-color)', display: 'none', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: 'white', fontWeight: 700, fontSize: 22 }}>F</span>
                    </div>
                  </div>
                  <div>
                    <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Finvu</p>
                    <p style={{ fontSize: 12, color: 'var(--text3)', fontFamily: "'DM Mono',monospace", margin: '3px 0 0' }}>
                      v1.1.0{buildDate ? ` · build ${buildDate}` : ''}
                    </p>
                  </div>
                </div>
                {/* Links */}
                <div className="divide-y divide-white/[0.04]">
                  <SettingRow label="Webová stránka">
                    <a
                      href="https://finvu.pedani.eu"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--violet)', textDecoration: 'none', fontWeight: 500 }}
                    >
                      finvu.pedani.eu <ExternalLink size={12} />
                    </a>
                  </SettingRow>
                  <SettingRow label="Zásady ochrany">
                    <span style={{ fontSize: 13, color: 'var(--text3)' }}>Otvoriť →</span>
                  </SettingRow>
                  <SettingRow label="Podmienky používania">
                    <span style={{ fontSize: 13, color: 'var(--text3)' }}>Otvoriť →</span>
                  </SettingRow>
                  <SettingRow label="Licencie a poďakovania">
                    <span style={{ fontSize: 13, color: 'var(--text3)' }}>Otvoriť →</span>
                  </SettingRow>
                </div>
                <div style={{ borderTop: '1px solid var(--border)', padding: '10px 20px' }}>
                  <p style={{ fontSize: 11, color: 'var(--text3)', margin: 0, textAlign: 'center' }}>© 2024–2026 Finvu · pedani.eu</p>
                </div>
              </SectionCard>

              {/* Changelog — static grouped by version */}
              <SectionCard>
                <SectionHeader emoji="📋" label="Changelog" />
                <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {[
                    {
                      version: 'v1.1.0',
                      date: 'Máj 2026',
                      items: [
                        'Podpora 5 jazykov — SK, CS, PL, HU, EN',
                        'Aktívne relácie zariadení s deduplication',
                        'Pozastavenie sporiacich cieľov',
                        'Automatický limit kategórií z fixných výdavkov',
                      ],
                    },
                    {
                      version: 'v1.0.0',
                      date: 'Apríl 2026',
                      items: [
                        'Dashboard, príjmy, výdavky, sporenie',
                        'Domácnosť, PWA, push notifikácie',
                      ],
                    },
                  ].map((release, ri) => (
                    <div key={release.version} style={ri > 0 ? { marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--border)' } : {}}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'rgba(139,92,246,0.15)', color: 'var(--violet)' }}>
                          {release.version}
                        </span>
                        <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: 'var(--text3)' }}>{release.date}</span>
                      </div>
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {release.items.map(item => (
                          <li key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text2)' }}>
                            <span style={{ color: 'var(--violet)', flexShrink: 0, marginTop: 1 }}>·</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </>
          )}

        </div>
      </div>

      {/* ── PIN REMOVE MODAL ── */}
      {pinRemoveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 fade-in">
          <div
            style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 340 }}
            className="modal-in"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{t.profile.removePin}</h2>
              <button onClick={() => setPinRemoveOpen(false)} className="btn-icon"><X size={16} /></button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>{t.settings.removePinConfirm}</p>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
              <div style={{ display: 'flex', gap: 14 }} className={pinRemoveShake ? 'pin-lock-shake' : ''}>
                {[0,1,2,3].map(i => (
                  <div key={i} style={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: pinRemoveInput.length > i ? '#7C3AED' : 'transparent',
                    border: '2px solid ' + (pinRemoveInput.length > i ? '#7C3AED' : '#4C3A8A'),
                    transition: 'all 0.15s',
                  }} />
                ))}
              </div>
              {pinRemoveError && (
                <p style={{ fontSize: 12, color: 'var(--red)', margin: 0 }}>{pinRemoveError}</p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 60px)', gap: 8 }}>
                {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
                  k === '' ? <div key={i} /> : (
                    <button
                      key={i}
                      onClick={() => handlePinRemoveKey(k)}
                      style={{
                        width: 60, height: 60, borderRadius: '50%',
                        background: k === '⌫' ? 'transparent' : 'rgba(255,255,255,0.04)',
                        border: k === '⌫' ? 'none' : '1px solid rgba(255,255,255,0.08)',
                        color: 'var(--text)', fontSize: k === '⌫' ? 16 : 20, fontWeight: 600,
                        cursor: pinRemoveLoading ? 'wait' : 'pointer', fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: pinRemoveLoading ? 0.5 : 1,
                      }}
                    >
                      {k === '⌫' ? '⌫' : k}
                    </button>
                  )
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── DANGER CONFIRM MODAL ── */}
      {dangerAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 fade-in">
          <div style={{ background: 'var(--bg2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 384 }} className="modal-in">
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                {dangerAction === 'transactions' ? 'Vymazať všetky transakcie' : t.settings.dangerResetTitle}
              </h2>
              <button onClick={() => setDangerAction(null)} className="btn-icon">
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-[color:var(--text3)] mb-5">
              {dangerAction === 'reset' ? t.settings.dangerResetDesc : t.settings.dangerDeleteDesc}
            </p>
            {dangerAction === 'reset' && (
              <div className="mb-4">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-red-400 mb-2 block">
                  {t.settings.dangerResetConfirmLabel}
                </label>
                <input
                  type="text"
                  placeholder="VYMAZAŤ"
                  value={dangerConfirmText}
                  onChange={e => setDangerConfirmText(e.target.value)}
                  className="input-field"
                />
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setDangerAction(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-[color:var(--text3)] hover:bg-white/10 transition-colors cursor-pointer"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={executeDangerAction}
                disabled={dangerLoading || (dangerAction === 'reset' && dangerConfirmText !== 'VYMAZAŤ')}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {dangerLoading ? t.settings.dangerDeleting : t.settings.dangerDeleteBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DEACTIVATE ACCOUNT MODAL ── */}
      {deactivateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 fade-in">
          <div style={{ background: 'var(--bg2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 384 }} className="modal-in">
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{t.settings.deactivateAccount}</h2>
              <button onClick={() => setDeactivateOpen(false)} className="btn-icon"><X size={16} /></button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>{t.settings.deactivateAccountDesc}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--red)' }}>
                {t.settings.deactivateAccountConfirmLabel}
              </label>
              <input
                type="text"
                placeholder="DEAKTIVOVAŤ"
                value={deactivateConfirm}
                onChange={e => { setDeactivateConfirm(e.target.value); setDeactivateError(null) }}
                className="input-field"
              />
            </div>
            {deactivateError && <p style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{deactivateError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setDeactivateOpen(false)} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-[color:var(--text3)] hover:bg-white/10 transition-colors cursor-pointer">
                {t.common.cancel}
              </button>
              <button
                disabled={deactivateConfirm !== 'DEAKTIVOVAŤ' || isDeactivating}
                onClick={async () => {
                  setIsDeactivating(true)
                  try {
                    await apiDeactivateAccount()
                    await logout()
                  } catch {
                    setDeactivateError('Nepodarilo sa deaktivovať účet. Skúste znova.')
                    setIsDeactivating(false)
                  }
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isDeactivating ? t.settings.deactivating : t.settings.deactivateAccountConfirmBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE ACCOUNT MODAL ── */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 fade-in">
          <div style={{ background: 'var(--bg2)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 384 }} className="modal-in">
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{t.settings.deleteAccount}</h2>
              <button onClick={() => setDeleteOpen(false)} className="btn-icon"><X size={16} /></button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>{t.settings.deleteAccountDesc}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--red)' }}>
                {t.settings.deleteAccountConfirmLabel}
              </label>
              <input
                type="text"
                placeholder="ZMAZAŤ"
                value={deleteConfirm}
                onChange={e => { setDeleteConfirm(e.target.value); setDeleteError(null) }}
                className="input-field"
              />
            </div>
            {deleteError && <p style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{deleteError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setDeleteOpen(false)} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-[color:var(--text3)] hover:bg-white/10 transition-colors cursor-pointer">
                {t.common.cancel}
              </button>
              <button
                disabled={deleteConfirm !== 'ZMAZAŤ' || isDeleting}
                onClick={async () => {
                  setIsDeleting(true)
                  try {
                    await deleteAccount()
                  } catch (err: unknown) {
                    const status = (err as { response?: { status?: number } })?.response?.status
                    if (status === 502 || status === 501 || status === 404) {
                      setDeleteError(t.settings.deleteAccountUnavailable)
                    } else {
                      setDeleteError('Nepodarilo sa zmazať účet. Skúste znova.')
                    }
                    setIsDeleting(false)
                  }
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: deleteConfirm === 'ZMAZAŤ' ? '#DC2626' : undefined }}
              >
                {isDeleting ? 'Mažem...' : t.settings.deleteAccountConfirmBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CSV IMPORT MODAL ── */}
      <CsvImportModal open={csvImportOpen} onClose={() => setCsvImportOpen(false)} />

      <PinSetupModal
        open={pinSetupOpen}
        onClose={() => setPinSetupOpen(false)}
        onSetPin={async (pin) => {
          setupPin(pin)
          try { await savePin(pin) } catch { /* local PIN is set */ }
          if (user?.email) localStorage.setItem(`pin_enabled_${user.email}`, '1')
        }}
      />

    </div>
  )
}
