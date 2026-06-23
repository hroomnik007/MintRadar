import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AppNav } from './components/AppNav'
import { BottomNav } from './components/BottomNav'
import { Topbar } from './components/Topbar'
import { GlobalFAB } from './components/GlobalFAB'
import { ToastContainer } from './components/ToastContainer'
import { Dashboard } from './pages/Dashboard'
import { IncomePage } from './pages/Income'
import { VariableExpensesPage } from './pages/VariableExpenses'
import { FixedExpensesPage } from './pages/FixedExpenses'
import { CategoriesPage } from './pages/Categories'
import { SettingsPage } from './pages/Settings'
import { ProfileModal } from './pages/Profile'
import { AdminPage } from './pages/Admin'
import { SharedReportPage } from './pages/SharedReport'
import { LoginPage } from './pages/Login'
import { RegisterPage } from './pages/Register'
import { ForgotPasswordPage } from './pages/ForgotPassword'
import { ResetPasswordPage } from './pages/ResetPassword'
import { VerifyEmailPage } from './pages/VerifyEmail'
import { PrivacyPolicyPage } from './pages/PrivacyPolicy'
import { OnboardingTutorial, useOnboarding } from './components/OnboardingTutorial'
import { BudgetTemplateModal, useBudgetTemplate } from './components/BudgetTemplateModal'
import { PinLock } from './components/PinLock'
import { PinLockProvider, usePinLockContext } from './context/PinLockContext'
import { useToast } from './hooks/useToast'
import { useAuth } from './context/AuthContext'
import { useSettingsContext } from './context/SettingsContext'
import { useVariableExpenses } from './hooks/useVariableExpenses'
import { useIncomes } from './hooks/useIncomes'
import { fetchIncomes, incomeQueryKey } from './hooks/useIncomes'
import { fetchVariableExpenses, variableExpenseQueryKey } from './hooks/useVariableExpenses'
import { fetchFixedExpenses, fixedExpenseQueryKey } from './hooks/useFixedExpenses'
import { fetchCategoriesData } from './hooks/useCategories'
import { fetchSavingsData } from './hooks/useSavings'
import { fetchHouseholdData, householdQueryKey } from './hooks/useHousehold'
import { HouseholdPage } from './pages/Household'
import { SavingsPage } from './pages/Savings'
import { PWAUpdateBanner } from './components/PWAUpdateBanner'
import { TrackingDateOnboarding } from './components/TrackingDateOnboarding'
import { CommandPalette } from './components/CommandPalette'
import { updateUserSettings, sessionCheck } from './api/auth'

// Initialize appearance preferences from localStorage before first render
;(() => {
  try {
    const html = document.documentElement
    const accent = JSON.parse(localStorage.getItem('accent_color') ?? 'null') as string | null
    const isMobile = window.innerWidth < 768
    const compactKey = isMobile ? 'finvu_compact_mobile' : 'finvu_compact_desktop'
    const compactDefault = isMobile ? 'true' : 'false'
    const compact = JSON.parse(localStorage.getItem(compactKey) ?? compactDefault) as boolean
    const theme = localStorage.getItem('theme_preference') ?? 'dark'
    const resolvedTheme = theme === 'system' ? 'dark' : theme
    if (accent) html.style.setProperty('--accent-color', accent)
    html.classList.toggle('compact', compact)
    html.setAttribute('data-theme', resolvedTheme)
    html.classList.add(resolvedTheme)
  } catch { /* ignore */ }
})()

export type Page =
  | 'dashboard'
  | 'income'
  | 'variable-expenses'
  | 'fixed-expenses'
  | 'categories'
  | 'settings'
  | 'household'
  | 'savings'

const VALID_PAGES: Page[] = ['dashboard', 'income', 'variable-expenses', 'fixed-expenses', 'categories', 'settings', 'household', 'savings']

function getPageFromHash(): Page {
  const hash = window.location.hash.slice(1).split('?')[0] as Page
  return VALID_PAGES.includes(hash) ? hash : 'dashboard'
}

function App() {
  const { isAuthenticated, isLoading, logout, user } = useAuth()
  const { settings } = useSettingsContext()
  const queryClient = useQueryClient()
  const now = new Date()
  const { variableExpenses: allVariableExpenses } = useVariableExpenses(now.getMonth() + 1, now.getFullYear())
  const { incomes: allIncomes } = useIncomes(now.getMonth() + 1, now.getFullYear())
  const [page, setPage] = useState<Page>(getPageFromHash)
  type AuthPage = 'login' | 'register' | 'forgot-password' | 'reset-password' | 'verify-email' | 'privacy-policy'

  function getAuthPageFromHash(): AuthPage {
    const hash = window.location.hash
    if (hash === '#register') return 'register'
    if (hash.startsWith('#verify-email')) return 'verify-email'
    if (hash.startsWith('#reset-password')) return 'reset-password'
    return 'login'
  }

  const [authPage, setAuthPage] = useState<AuthPage>(getAuthPageFromHash)
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [dashView, setDashView] = useState<'personal' | 'family'>(() =>
    (localStorage.getItem('finvu_dashboard_view') as 'personal' | 'family') || 'family'
  )
  const { toasts, showToast } = useToast()
  const { locked, verifyPin } = usePinLockContext()
  const { showOnboarding, completeOnboarding } = useOnboarding()
  const needsBudgetTemplate = useBudgetTemplate()
  const [showBudgetTemplate, setShowBudgetTemplate] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const [showTrackingOnboarding, setShowTrackingOnboarding] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024)
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false)
  const [fabTrigger, setFabTrigger] = useState(0)
  const [savingsFabTrigger, setSavingsFabTrigger] = useState(0)

  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 1024)
    let resizeTimer: ReturnType<typeof setTimeout>
    const debouncedHandler = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(handler, 150)
    }
    window.addEventListener('resize', debouncedHandler)
    return () => {
      window.removeEventListener('resize', debouncedHandler)
      clearTimeout(resizeTimer)
    }
  }, [])

  // Global ripple effect for .btn-primary and .ripple-btn
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const btn = (e.target as Element).closest('.btn-primary, .ripple-btn')
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      const ripple = document.createElement('span')
      ripple.className = 'ripple'
      const size = Math.max(rect.width, rect.height) * 2
      ripple.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px;`
      btn.appendChild(ripple)
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [])

  const hasNavigated = useRef(false)

  useEffect(() => {
    if (isAuthenticated && !isLoading && !hasNavigated.current) {
      if (sessionStorage.getItem('just_logged_in') === 'true') {
        sessionStorage.removeItem('just_logged_in')
        hasNavigated.current = true

        const m = now.getMonth() + 1
        const y = now.getFullYear()
        const trackingStart = user?.tracking_start_date ?? null
        let cancelled = false

        const doNavigate = () => {
          if (cancelled) return
          const target = (user?.defaultPage ?? settings.defaultPage ?? 'dashboard') as Page
          const dest = VALID_PAGES.includes(target) ? target : 'dashboard'
          setPage(dest)
          window.location.hash = dest
        }

        const runPrefetch = async () => {
          // Flush pre-auth empty cache before anything else so stale [] responses are gone
          queryClient.invalidateQueries()

          // Verify session cookie is established before prefetching
          try {
            const { valid } = await sessionCheck()
            if (!valid) { doNavigate(); return }
          } catch {
            doNavigate()
            return
          }

          const prefetches = [
            queryClient.prefetchQuery({ queryKey: incomeQueryKey(m, y, trackingStart), queryFn: () => fetchIncomes(m, y, trackingStart) }),
            queryClient.prefetchQuery({ queryKey: variableExpenseQueryKey(m, y), queryFn: () => fetchVariableExpenses(m, y) }),
            queryClient.prefetchQuery({ queryKey: fixedExpenseQueryKey(m, y, trackingStart), queryFn: () => fetchFixedExpenses(m, y, trackingStart) }),
            queryClient.prefetchQuery({ queryKey: ['categories'], queryFn: fetchCategoriesData }),
            queryClient.prefetchQuery({ queryKey: ['savings'], queryFn: fetchSavingsData }),
            ...(user?.household_enabled && user?.household_id
              ? [queryClient.prefetchQuery({ queryKey: householdQueryKey(), queryFn: fetchHouseholdData })]
              : []),
          ]

          await Promise.all(prefetches.map(p => p.catch(() => {})))
          doNavigate()
        }

        runPrefetch()
        return () => { cancelled = true }
      }
    }
  }, [isAuthenticated, isLoading, user, settings, queryClient])

  useEffect(() => {
    if (isAuthenticated) window.location.hash = page
  }, [page, isAuthenticated])

  useEffect(() => {
    if (isAuthenticated && !isLoading && user) {
      const needsTracking = !user.tracking_start_date && !user.onboarding_banner_dismissed
      if (needsTracking && !localStorage.getItem('finvu_tracking_onboarding_shown')) {
        localStorage.setItem('finvu_tracking_onboarding_shown', 'true')
        setShowTrackingOnboarding(true)
        return
      }
      if (needsBudgetTemplate) {
        setShowBudgetTemplate(true)
      } else if (showOnboarding) {
        setShowTutorial(true)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isLoading, user])

  useEffect(() => {
    const handler = () => {
      setPage(getPageFromHash())
      if (!isAuthenticated) setAuthPage(getAuthPageFromHash())
    }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === 'true' } catch { return false }
  })

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('sidebar_collapsed', String(next)) } catch { /* ignore */ }
      return next
    })
  }

  const collapseSidebar = () => {
    setSidebarCollapsed(true)
    try { localStorage.setItem('sidebar_collapsed', 'true') } catch { /* ignore */ }
  }

  const expandSidebar = () => {
    setSidebarCollapsed(false)
    try { localStorage.setItem('sidebar_collapsed', 'false') } catch { /* ignore */ }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowLeft') collapseSidebar()
      if (e.key === 'ArrowRight') expandSidebar()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdPaletteOpen(open => !open)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const handleMonthChange = (m: number, y: number) => {
    setMonth(m)
    setYear(y)
  }

  const householdEnabled = user?.household_enabled ?? false

  useEffect(() => {
    if (!isLoading && user && !householdEnabled && dashView === 'family') {
      setDashView('personal')
      localStorage.removeItem('finvu_dashboard_view')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdEnabled, isLoading, user])

  useEffect(() => {
    if (!isLoading && user && householdEnabled && !localStorage.getItem('finvu_dashboard_view')) {
      setDashView('family')
    }
  }, [householdEnabled, isLoading, user])

  const handleDashViewChange = (v: 'personal' | 'family') => {
    setDashView(v)
    localStorage.setItem('finvu_dashboard_view', v)
  }

  const handleToggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme') as 'dark' | 'light'
    const next = current === 'dark' ? 'light' : 'dark'
    localStorage.setItem('theme_preference', next)
    document.documentElement.setAttribute('data-theme', next)
    updateUserSettings({ theme: next }).catch(() => {})
  }

  const handleLogout = async () => {
    hasNavigated.current = false
    setPage('dashboard')
    setIsProfileOpen(false)
    window.location.hash = ''
    await logout()
    setAuthPage('login')
  }

  if (isLoading) {
    return (
      <div style={{ minHeight: '100svh', backgroundColor: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--violet)', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  const getTokenFromHash = () => {
    const query = window.location.hash.split('?')[1] ?? ''
    return new URLSearchParams(query).get('token') ?? ''
  }

  function goAuthPage(p: AuthPage) {
    setAuthPage(p)
    if (p === 'login') window.location.hash = 'login'
    else if (p === 'register') window.location.hash = 'register'
  }

  if (!isAuthenticated) {
    return (
      <>
        <ToastContainer toasts={toasts} />
        {authPage === 'register' && (
          <RegisterPage
            onNavigateLogin={() => goAuthPage('login')}
            onNavigatePrivacyPolicy={() => setAuthPage('privacy-policy')}
          />
        )}
        {authPage === 'forgot-password' && (
          <ForgotPasswordPage onNavigateLogin={() => goAuthPage('login')} />
        )}
        {authPage === 'reset-password' && (
          <ResetPasswordPage
            token={getTokenFromHash()}
            onNavigateLogin={() => goAuthPage('login')}
          />
        )}
        {authPage === 'verify-email' && (
          <VerifyEmailPage
            token={getTokenFromHash()}
            onNavigateLogin={() => goAuthPage('login')}
          />
        )}
        {authPage === 'privacy-policy' && <PrivacyPolicyPage />}
        {authPage === 'login' && (
          <LoginPage
            onNavigateRegister={() => goAuthPage('register')}
            onNavigateForgotPassword={() => setAuthPage('forgot-password')}
          />
        )}
      </>
    )
  }

  return (
    <div style={{
      display: 'flex',
      height: '100svh',
      width: '100vw',
      overflow: 'hidden',
      background: 'var(--bg)',
    }}>
      <PWAUpdateBanner />
      {locked && isAuthenticated && (
        <PinLock
          onVerify={verifyPin}
          onFallbackToLogin={handleLogout}
        />
      )}
      <ToastContainer toasts={toasts} />

      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        onNavigate={(p) => { setPage(p); setCmdPaletteOpen(false) }}
        onAdd={(type) => { setPage(type === 'income' ? 'income' : 'variable-expenses'); setCmdPaletteOpen(false) }}
        onToggleTheme={() => { handleToggleTheme(); setCmdPaletteOpen(false) }}
        transactions={[
          ...allVariableExpenses.map(t => ({ id: t.id ?? '', label: t.note || '—', amount: -t.amount, date: t.date, type: 'expense' as const })),
          ...allIncomes.map(i => ({ id: i.id ?? '', label: i.label, amount: i.amount, date: i.date, type: 'income' as const })),
        ]}
        onTransactionNavigate={(type) => { setPage(type === 'income' ? 'income' : 'variable-expenses'); setCmdPaletteOpen(false) }}
      />

      {/* Sidebar — desktop only */}
      {isDesktop && (
        <AppNav
          current={page}
          onChange={setPage}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          onOpenProfile={() => setIsProfileOpen(true)}
        />
      )}

      {/* Physical gap between sidebar and main */}
      {isDesktop && (
        <div style={{ width: '12px', flexShrink: 0, background: 'var(--bg)' }} />
      )}

      {/* Main content column */}
      <main style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg)',
      }}>
        <Topbar
          page={page}
          month={month}
          year={year}
          onMonthChange={handleMonthChange}
          dashView={dashView}
          onDashViewChange={handleDashViewChange}
          onOpenProfile={() => setIsProfileOpen(true)}
          onOpenAdd={() => { if (page === 'savings') setSavingsFabTrigger(v => v + 1); else setFabTrigger(v => v + 1) }}
          onNavigate={setPage}
        />
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {page === 'dashboard' && (
            <Dashboard month={month} year={year} onNavigate={setPage} dashView={dashView} />
          )}
          {page === 'income' && (
            <IncomePage month={month} year={year} />
          )}
          {page === 'variable-expenses' && (
            <VariableExpensesPage month={month} year={year} showToast={showToast} />
          )}
          {page === 'fixed-expenses' && (
            <FixedExpensesPage month={month} year={year} />
          )}
          {page === 'categories' && <CategoriesPage />}
          {(page === 'settings' || page === 'household') && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ padding: '20px', minHeight: '100%' }}>
                {page === 'settings' && <SettingsPage />}
                {page === 'household' && <HouseholdPage />}
              </div>
            </div>
          )}
          {page === 'savings' && <SavingsPage openAddTrigger={savingsFabTrigger} />}
        </div>
      </main>

      {/* Global FAB — mobile circle button + shared add modal */}
      <GlobalFAB
        month={month}
        year={year}
        showToast={showToast}
        currentPage={page}
        openTrigger={fabTrigger}
      />

      {/* Mobile bottom nav */}
      {!isDesktop && <BottomNav current={page} onChange={setPage} />}

      {showBudgetTemplate && (
        <BudgetTemplateModal
          onComplete={() => {
            setShowBudgetTemplate(false)
            if (showOnboarding) setShowTutorial(true)
          }}
        />
      )}
      {showTutorial && !showBudgetTemplate && (
        <OnboardingTutorial onComplete={() => { completeOnboarding(); setShowTutorial(false) }} />
      )}

      {isProfileOpen && <ProfileModal onClose={() => setIsProfileOpen(false)} onLogout={handleLogout} />}
      {showTrackingOnboarding && (
        <TrackingDateOnboarding onDone={() => setShowTrackingOnboarding(false)} />
      )}

    </div>
  )
}

function getReportToken(): string | null {
  const hash = window.location.hash
  if (hash.startsWith('#report/')) return hash.slice('#report/'.length) || null
  return null
}

function Root() {
  const [routeKey, setRouteKey] = useState(() => window.location.hash)

  useEffect(() => {
    const handler = () => setRouteKey(window.location.hash)
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  if (routeKey.startsWith('#admin')) return <AdminPage />
  const reportToken = getReportToken()
  if (reportToken) return <SharedReportPage token={reportToken} />
  return <PinLockProvider><App /></PinLockProvider>
}

export default Root
