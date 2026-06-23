import { useState } from 'react'
import { Home, TrendingUp, Settings, Receipt, Lock, Tag, PiggyBank, MoreHorizontal } from 'lucide-react'
import type { Page } from '../App'
import { useTranslation } from '../i18n'
import { useAuth } from '../context/AuthContext'

interface BottomNavProps {
  current: Page
  onChange: (page: Page) => void
}

const EXPENSE_PAGES: Page[] = ['variable-expenses', 'fixed-expenses', 'categories']
const VIAC_PAGES: Page[] = ['savings', 'household']

export function BottomNav({ current, onChange }: BottomNavProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const expensesActive = EXPENSE_PAGES.includes(current)
  const householdEnabled = user?.household_enabled ?? false
  const savingsEnabled = user?.savings_enabled ?? false
  const showViac = savingsEnabled && householdEnabled
  const showOnlySavings = savingsEnabled && !householdEnabled
  const showOnlyHousehold = householdEnabled && !savingsEnabled
  const viacActive = VIAC_PAGES.includes(current)

  const [showExpenseMenu, setShowExpenseMenu] = useState(false)
  const [showViacSheet, setShowViacSheet] = useState(false)

  function handleExpenseNav(page: Page) {
    onChange(page)
    setShowExpenseMenu(false)
  }

  function handleViacNav(page: Page) {
    onChange(page)
    setShowViacSheet(false)
  }

  return (
    <>
      {/* Expense submenu popup */}
      {showExpenseMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 98 }}
            onClick={() => setShowExpenseMenu(false)}
          />
          <div
            style={{
              position: 'fixed',
              bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
              left: '8px',
              right: '8px',
              background: 'var(--bg3)',
              border: '1px solid var(--border2)',
              borderRadius: '16px',
              padding: '8px',
              zIndex: 99,
              boxShadow: 'var(--card-shadow)',
            }}
          >
            {([
              { icon: <Receipt size={16} />, label: t.nav.variable, page: 'variable-expenses' as Page },
              { icon: <Lock size={16} />, label: t.nav.fixed, page: 'fixed-expenses' as Page },
              { icon: <Tag size={16} />, label: t.nav.categories, page: 'categories' as Page },
            ] as const).map(item => (
              <button
                key={item.page}
                onClick={() => handleExpenseNav(item.page)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  padding: '12px 16px',
                  background: current === item.page ? 'rgba(139,92,246,0.12)' : 'transparent',
                  border: 'none',
                  borderRadius: '12px',
                  color: current === item.page ? 'var(--violet)' : 'var(--text2)',
                  fontSize: '14px',
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: current === item.page ? 600 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Viac popup */}
      {showViacSheet && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 98 }}
            onClick={() => setShowViacSheet(false)}
          />
          <div
            style={{
              position: 'fixed',
              bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
              left: '8px',
              right: '8px',
              background: 'var(--bg3)',
              border: '1px solid var(--border2)',
              borderRadius: '16px',
              padding: '8px',
              zIndex: 99,
              boxShadow: 'var(--card-shadow)',
            }}
          >
            {savingsEnabled && (
              <button
                onClick={() => handleViacNav('savings')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  padding: '12px 16px',
                  background: current === 'savings' ? 'rgba(139,92,246,0.12)' : 'transparent',
                  border: 'none',
                  borderRadius: '12px',
                  color: current === 'savings' ? 'var(--violet)' : 'var(--text2)',
                  fontSize: '14px',
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: current === 'savings' ? 600 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <PiggyBank size={16} />
                {t.nav.savings}
              </button>
            )}
            {householdEnabled && (
              <button
                onClick={() => handleViacNav('household')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  padding: '12px 16px',
                  background: current === 'household' ? 'rgba(139,92,246,0.12)' : 'transparent',
                  border: 'none',
                  borderRadius: '12px',
                  color: current === 'household' ? 'var(--violet)' : 'var(--text2)',
                  fontSize: '14px',
                  fontFamily: "'DM Sans', sans-serif",
                  fontWeight: current === 'household' ? 600 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
                {t.nav.household}
              </button>
            )}
          </div>
        </>
      )}

      <nav
        className="bottom-nav-bar"
        style={{
          display: 'flex',
          background: 'var(--bg2)',
          borderTop: '1px solid var(--border)',
          padding: '8px 0',
          paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
        }}
      >
        <NavTab
          active={current === 'dashboard'}
          icon={<Home size={20} />}
          label={t.nav.overview}
          onClick={() => { setShowExpenseMenu(false); onChange('dashboard') }}
        />
        <NavTab
          active={current === 'income'}
          icon={<TrendingUp size={20} />}
          label={t.nav.income}
          onClick={() => { setShowExpenseMenu(false); onChange('income') }}
        />
        <NavTab
          active={expensesActive || showExpenseMenu}
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2"/>
              <line x1="2" y1="10" x2="22" y2="10"/>
            </svg>
          }
          label={t.nav.expenses}
          onClick={() => { setShowViacSheet(false); setShowExpenseMenu(s => !s) }}
        />
        <NavTab
          active={current === 'settings'}
          icon={<Settings size={20} />}
          label={t.nav.settings}
          onClick={() => { setShowExpenseMenu(false); setShowViacSheet(false); onChange('settings') }}
        />
        {showViac && (
          <NavTab
            active={viacActive || showViacSheet}
            icon={<MoreHorizontal size={20} />}
            label={t.nav.more}
            onClick={() => { setShowExpenseMenu(false); setShowViacSheet(s => !s) }}
          />
        )}
        {showOnlySavings && (
          <NavTab
            active={current === 'savings'}
            icon={<PiggyBank size={20} />}
            label={t.nav.savings}
            onClick={() => { setShowExpenseMenu(false); onChange('savings') }}
          />
        )}
        {showOnlyHousehold && (
          <NavTab
            active={current === 'household'}
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            }
            label={t.nav.household}
            onClick={() => { setShowExpenseMenu(false); onChange('household') }}
          />
        )}
      </nav>
    </>
  )
}

function NavTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        padding: '4px 0',
        fontSize: 10,
        fontWeight: 500,
        color: active ? 'var(--violet)' : 'var(--text3)',
        cursor: 'pointer',
        fontFamily: "'DM Sans', sans-serif",
        background: 'none',
        border: 'none',
      }}
    >
      <div style={{
        width: 32, height: 32,
        borderRadius: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? 'rgba(139,92,246,0.12)' : 'transparent',
        transition: 'background 0.15s',
      }}>
        {icon}
      </div>
      <span>{label}</span>
    </button>
  )
}
