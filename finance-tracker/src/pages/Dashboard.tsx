import { useState, useEffect, useMemo } from 'react'
import {
  PieChart, Pie, Cell, Sector, ResponsiveContainer,
} from 'recharts'
import { ExpenseHeatmap } from '../components/ExpenseHeatmap'
import { useIncomes } from '../hooks/useIncomes'
import { useFixedExpenses } from '../hooks/useFixedExpenses'
import { useVariableExpenses } from '../hooks/useVariableExpenses'
import { useCategories } from '../hooks/useCategories'
import { useFormatters } from '../hooks/useFormatters'
import { useTranslation } from '../i18n'
import { useSettingsContext } from '../context/SettingsContext'
import { useAuth } from '../context/AuthContext'
import { getSummary, getSummaryCards } from '../api/transactions'
import { updateUserSettings } from '../api/auth'
import { useBudgetStatus } from '../hooks/useBudgetStatus'
import { useSavings } from '../hooks/useSavings'
import { useCountUp } from '../hooks/useCountUp'
import type { Page } from '../App'
import type { ApiSummary } from '../types'
import type { Translations } from '../i18n/sk'

function getLast6Months(monthsShort: string[]) {
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
    return {
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      label: monthsShort[d.getMonth()],
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    }
  })
}

function getGreeting(name: string, t: Translations): { text: string; emoji: string } {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return { text: `${t.dashboard.greetingMorning}${name ? `, ${name}` : ''}`, emoji: '☀️' }
  if (hour >= 12 && hour < 18) return { text: `${t.dashboard.greetingDay}${name ? `, ${name}` : ''}`, emoji: '👋' }
  if (hour >= 18 && hour < 22) return { text: `${t.dashboard.greetingEvening}${name ? `, ${name}` : ''}`, emoji: '🌙' }
  return { text: `${t.dashboard.greetingNight}${name ? `, ${name}` : ''}`, emoji: '😴' }
}


// ─────────────────────────────────────────────────────────────────────────────

interface DashboardProps {
  month: number
  year: number
  onNavigate: (page: Page) => void
  dashView: 'personal' | 'family'
}

export function Dashboard({ month, year, onNavigate, dashView }: DashboardProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [legendHoverIndex, setLegendHoverIndex] = useState<number | null>(null)
  const [clickedIndex, setClickedIndex] = useState<number | null>(null)
  const [showAllPie, setShowAllPie] = useState(false)
  const [chartData, setChartData] = useState<{ label: string; income: number; expenses: number }[]>([])
  const [summaryCards, setSummaryCards] = useState<{ balance: number; income: number; expenses: number; savingsRate: number } | null>(null)
  const [showTrackingModal, setShowTrackingModal] = useState(false)
  const [trackingDate, setTrackingDate] = useState(() => new Date().toISOString().split('T')[0])
  const [trackingSaving, setTrackingSaving] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const { incomes: allIncomes } = useIncomes(month, year)
  const { fixedExpenses } = useFixedExpenses(month, year)
  const { variableExpenses: allVariableExpenses } = useVariableExpenses(month, year)
  const { categories } = useCategories()
  const budgetStatuses = useBudgetStatus({ categories, variableExpenses: allVariableExpenses, fixedExpenses })
  const sortedBudgetStatuses = useMemo(() =>
    budgetStatuses
      .filter(b => b.limit > 0)
      .map(b => ({ ...b, txCount: allVariableExpenses.filter(e => e.categoryId === b.categoryId).length }))
      .sort((a, b) => b.txCount - a.txCount || b.spent - a.spent)
      .slice(0, 5),
    [budgetStatuses, allVariableExpenses]
  )
  const { goals: savingsGoals } = useSavings()
  const { formatAmount } = useFormatters()
  const { t } = useTranslation()
  const { profileName } = useSettingsContext()
  const { user, refreshUser } = useAuth()
  const displayName = user?.name || profileName
  const householdEnabled = user?.household_enabled ?? false
  const greeting = getGreeting(displayName, t)

  const incomes = useMemo(() =>
    householdEnabled && dashView === 'personal'
      ? allIncomes.filter(i => i.created_by === user?.id || !i.created_by)
      : allIncomes,
  [householdEnabled, dashView, allIncomes, user?.id])

  const variableExpenses = useMemo(() =>
    householdEnabled && dashView === 'personal'
      ? allVariableExpenses.filter(e => e.created_by === user?.id || !e.created_by)
      : allVariableExpenses,
  [householdEnabled, dashView, allVariableExpenses, user?.id])

  const totalIncome = useMemo(() => incomes.reduce((s, i) => s + i.amount, 0), [incomes])
  const totalFixed = useMemo(() => fixedExpenses.reduce((s, f) => s + f.amount, 0), [fixedExpenses])
  const totalVariable = useMemo(() => variableExpenses.reduce((s, v) => s + v.amount, 0), [variableExpenses])
  const totalExpenses = totalFixed + totalVariable
  const balance = totalIncome - totalExpenses

  const pieData = useMemo(() =>
    categories
      .map(cat => ({
        name: cat.name,
        icon: cat.icon,
        value:
          variableExpenses.filter(e => e.categoryId === cat.id).reduce((s, e) => s + e.amount, 0) +
          fixedExpenses.filter(f => f.categoryId === cat.id).reduce((s, f) => s + f.amount, 0),
        color: cat.color,
      }))
      .filter(d => d.value > 0)
  , [categories, variableExpenses, fixedExpenses])

  const sortedPieData = [...pieData].sort((a, b) => b.value - a.value)
  const remainingPieCount = sortedPieData.length > 5 ? sortedPieData.length - 5 : 0

  useEffect(() => {
    const src = user?.tracking_start_date ?? user?.createdAt
    const minYear = src ? new Date(src).getFullYear() : 0
    const minMonth = src ? new Date(src).getMonth() + 1 : 0
    const months = getLast6Months(t.monthsShort).filter(m =>
      m.year > minYear || (m.year === minYear && m.month >= minMonth)
    )
    Promise.all(months.map(m => getSummary(m.key).catch(() => null)))
      .then(results => {
        setChartData(
          months.map((m, i) => {
            const s: ApiSummary | null = results[i]
            return {
              label: m.label,
              income: s?.totalIncome ?? 0,
              expenses: s?.totalExpenses ?? 0,
            }
          })
        )
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, year, user?.tracking_start_date, user?.createdAt])

  useEffect(() => {
    getSummaryCards(year, month).then(d => setSummaryCards(d)).catch(() => {})
  }, [year, month])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderPieShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, index } = props as {
      cx: number; cy: number; innerRadius: number; outerRadius: number
      startAngle: number; endAngle: number; fill: string; index: number
    }
    return (
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={index === activeIndex ? outerRadius + 6 : outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
    )
  }

  const todayStr = new Date().toLocaleDateString('sk-SK', { day: 'numeric', month: 'long', year: 'numeric' })

  const now = new Date()
  const daysInMonth = new Date(year, month, 0).getDate()
  const dayOfMonth = (month === now.getMonth() + 1 && year === now.getFullYear()) ? now.getDate() : daysInMonth
  const dailyAvgExpense = dayOfMonth > 0 ? totalExpenses / dayOfMonth : 0

  const prevMonthData = chartData[chartData.length - 2]
  const monthChallengeTarget = prevMonthData?.expenses ?? 0
  const challengeProgress = monthChallengeTarget > 0 ? Math.min(totalExpenses / monthChallengeTarget, 1) : 0
const upcomingFixed = useMemo(() => {
    const today = new Date().getDate()
    const daysInMo = new Date(year, month, 0).getDate()
    return fixedExpenses
      .map(fe => {
        let daysUntil = fe.dayOfMonth - today
        if (daysUntil < 0) daysUntil += daysInMo
        return { ...fe, daysUntil }
      })
      .sort((a, b) => a.daysUntil - b.daysUntil)
      .slice(0, 5)
  }, [fixedExpenses, month, year])

  const motivationalMsg = (() => {
    if (balance > 0 && balance > totalIncome * 0.3) {
      const savingsPct = totalIncome > 0 ? Math.floor((balance / totalIncome) * 100 / 5) * 5 : 30
      const pct = Math.max(savingsPct, 30)
      return { msg: t.dashboard.motivationalGood.replace('{pct}', String(pct)), color: '#34D399' }
    }
    if (balance < 0) return { msg: t.dashboard.motivationalBad, color: '#F87171' }
    if (totalExpenses > 0 && dailyAvgExpense < 20) return { msg: t.dashboard.motivationalAvg, color: '#A78BFA' }
    return null
  })()

  async function handleDismissBanner() {
    try {
      await updateUserSettings({ onboardingBannerDismissed: true })
      await refreshUser()
    } catch { /* non-critical */ }
  }

  async function handleSaveTrackingDate() {
    if (!trackingDate) return
    setTrackingSaving(true)
    try {
      await updateUserSettings({ trackingStartDate: trackingDate })
      await refreshUser()
      setShowTrackingModal(false)
    } catch { /* non-critical */ }
    finally { setTrackingSaving(false) }
  }

  const showTrackingBanner = !user?.tracking_start_date && !user?.onboarding_banner_dismissed

  // ── Shared JSX blocks ──────────────────────────────────────────────────────

  const greetingDesktop = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(167,139,250,0.06))', border: '1px solid rgba(139,92,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
          {greeting.emoji}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 26, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.5px', lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{greeting.text}</span>
          {(user?.currentStreak ?? 0) > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: 'linear-gradient(135deg,rgba(251,146,60,0.18),rgba(248,113,113,0.15))', border: '1px solid rgba(251,146,60,0.3)', color: '#FB923C', fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap', flexShrink: 0 }}>
              <span style={{ display: 'inline-block', animation: 'flame 1.4s ease-in-out infinite', transformOrigin: 'bottom center' }}>🔥</span>
              {user!.currentStreak}
            </span>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <p className="t-label" style={{ marginBottom: 4 }}>{t.dashboard.today}</p>
        <p style={{ fontSize: 13, color: 'var(--text2)', fontFamily: "'DM Mono', monospace", letterSpacing: '-0.2px', margin: 0 }}>{todayStr}</p>
      </div>
    </div>
  )

  const greetingRow = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(167,139,250,0.06))', border: '1px solid rgba(139,92,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
          {greeting.emoji}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{greeting.text}</span>
          {(user?.currentStreak ?? 0) > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: 'linear-gradient(135deg,rgba(251,146,60,0.18),rgba(248,113,113,0.15))', border: '1px solid rgba(251,146,60,0.3)', color: '#FB923C', fontFamily: "'DM Mono', monospace", whiteSpace: 'nowrap', flexShrink: 0 }}>
              <span style={{ display: 'inline-block', animation: 'flame 1.4s ease-in-out infinite', transformOrigin: 'bottom center' }}>🔥</span>
              {user!.currentStreak}
            </span>
          )}
        </div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0, whiteSpace: 'nowrap' }}>{todayStr}</span>
    </div>
  )

  // Hero section — wallet card style
  const heroBalance = summaryCards?.balance ?? balance
  const heroIncome = summaryCards?.income ?? totalIncome
  const heroExpenses = summaryCards?.expenses ?? totalExpenses
  const savRate = heroIncome > 0 ? Math.round((heroBalance / heroIncome) * 100) : 0
  const animatedBalance = useCountUp(heroBalance, 800)
  const animatedIncome = useCountUp(heroIncome, 800)
  const animatedExpenses = useCountUp(heroExpenses, 800)
  const incomeChangePct = (prevMonthData?.income ?? 0) > 0
    ? ((heroIncome - prevMonthData!.income) / prevMonthData!.income * 100)
    : null
  const expChangePct = (prevMonthData?.expenses ?? 0) > 0
    ? ((heroExpenses - prevMonthData!.expenses) / prevMonthData!.expenses * 100)
    : null
  const heroSection = (
    <div style={{
      background: 'linear-gradient(135deg,#1a0d2e 0%,#3d1f82 50%,#1a0d2e 100%)',
      borderRadius: 24, padding: '24px 26px 20px', position: 'relative', overflow: 'hidden', color: 'white',
      boxShadow: '0 18px 50px -16px rgba(80,40,180,0.35),0 0 0 1px rgba(139,92,246,0.18)',
      flexShrink: 0,
    }}>
      {/* Atmospheric blobs */}
      <div style={{ position: 'absolute', top: -90, right: -50, width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle,rgba(167,139,250,0.35),transparent 65%)', filter: 'blur(40px)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -60, left: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(99,102,241,0.25),transparent 65%)', filter: 'blur(30px)', pointerEvents: 'none' }} />
      {/* Shimmer */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg,transparent 30%,rgba(255,255,255,0.05) 50%,transparent 70%)', pointerEvents: 'none' }} />
      {/* Gold EMV chip ornament */}
      <div style={{ position: 'absolute', top: 24, right: 24, width: 38, height: 28, borderRadius: 6, background: 'linear-gradient(135deg,#FFD89F 0%,#C9A35F 100%)', boxShadow: 'inset 0 -2px 4px rgba(0,0,0,0.2)', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', inset: '30% 22%', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 2, opacity: 0.55 }}>
          <div style={{ background: '#705425' }} /><div style={{ background: '#705425' }} />
          <div style={{ background: '#705425' }} /><div style={{ background: '#705425' }} />
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        {/* Label row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.85)' }}>ZOSTATOK</span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.35)' }} />
          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, letterSpacing: '0.05em', color: 'rgba(255,255,255,0.5)' }}>{t.months[month - 1].toUpperCase()} {year}</span>
        </div>

        {/* Balance — editorial large typography */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 14, flexWrap: 'wrap' as const }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: heroBalance >= 0 ? '#86efac' : '#fca5a5', marginRight: 6, alignSelf: 'center' }}>{heroBalance >= 0 ? '+' : '−'}</span>
          <span style={{ fontSize: 46, fontWeight: 300, color: 'white', letterSpacing: '-1.8px', lineHeight: 1 }}>{Math.floor(Math.abs(animatedBalance)).toLocaleString('sk-SK')}</span>
          <span style={{ fontSize: 22, fontWeight: 300, color: 'rgba(255,255,255,0.75)', letterSpacing: '-0.4px', marginLeft: 1 }}>,{String(Math.round((Math.abs(animatedBalance) % 1) * 100)).padStart(2, '0')}</span>
          <span style={{ fontSize: 22, fontWeight: 400, color: 'rgba(255,255,255,0.45)', marginLeft: 8 }}>€</span>
          {heroIncome > 0 && (
            <span style={{
              marginLeft: 'auto', alignSelf: 'center',
              fontSize: 13, fontWeight: 700, padding: '8px 16px', borderRadius: 99, flexShrink: 0,
              background: savRate >= 0 ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)',
              color: savRate >= 0 ? '#34d399' : '#fca5a5',
              border: `1px solid ${savRate >= 0 ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)'}`,
            }}>
              {savRate >= 0 ? `↑ ${savRate} % úspora` : '↓ v mínuse'}
            </span>
          )}
        </div>

        {/* Transaction count pill */}
        <button
          onClick={() => onNavigate('variable-expenses')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '7px 12px 7px 8px', borderRadius: 99, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'white', cursor: 'pointer', transition: 'background 0.15s', fontFamily: 'inherit', marginBottom: 16 }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.10)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
        >
          <span style={{ width: 22, height: 22, borderRadius: 7, background: 'rgba(167,139,250,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="2.4" strokeLinecap="round">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </span>
          <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, fontSize: 12.5, color: 'white', letterSpacing: '-0.2px' }}>{variableExpenses.length}</span>
          <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>transakcií tento mesiac</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2.4" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', marginBottom: 14 }} />

        {/* PRÍJMY / VÝDAVKY 2-col grid inside hero */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.55)', margin: 0 }}>PRÍJMY</p>
              {incomeChangePct !== null && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 99, background: incomeChangePct >= 0 ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)', color: incomeChangePct >= 0 ? '#6ee7b7' : '#fca5a5' }}>
                  {incomeChangePct >= 0 ? '↑' : '↓'} {Math.abs(incomeChangePct).toFixed(1).replace('.', ',')}%
                </span>
              )}
            </div>
            <p style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, fontSize: 16, color: '#86efac', margin: 0, letterSpacing: '-0.3px' }}>{formatAmount(animatedIncome)}</p>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.55)', margin: 0 }}>VÝDAVKY</p>
              {expChangePct !== null && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 99, background: expChangePct <= 0 ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)', color: expChangePct <= 0 ? '#6ee7b7' : '#fca5a5' }}>
                  {expChangePct >= 0 ? '↑' : '↓'} {Math.abs(expChangePct).toFixed(1).replace('.', ',')}%
                </span>
              )}
            </div>
            <p style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, fontSize: 16, color: '#fca5a5', margin: 0, letterSpacing: '-0.3px' }}>{formatAmount(animatedExpenses)}</p>
          </div>
        </div>
      </div>
    </div>
  )

  // Effective active index: clicked (locked) > legend hover > pie hover
  const pieDisplayIndex = clickedIndex ?? legendHoverIndex ?? activeIndex

  const pieChartCard = (
    <div
      style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 20, padding: 20, position: 'relative', zIndex: clickedIndex !== null ? 11 : 'auto' }}
      onClick={() => { setClickedIndex(null); setLegendHoverIndex(null) }}
    >
      <h3 style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', margin: '0 0 12px', textAlign: 'center' }} className="lg:text-left">{t.dashboard.expensesByCategory}</h3>
      {pieData.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'relative', width: 190, height: 190, minHeight: 190 }}>
            {mounted && (
              <ResponsiveContainer width={190} height={190}>
                <PieChart>
                  <Pie
                    data={[{ value: 1 }]}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    dataKey="value"
                    startAngle={90}
                    endAngle={-270}
                    isAnimationActive={false}
                  >
                    <Cell fill="var(--bg3)" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0, textAlign: 'center' }}>{t.dashboard.noExpenses}</p>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Legend */}
          <div className="grid grid-cols-1 md:grid-cols-2" style={{ flex: 1, minWidth: 0, rowGap: 6, columnGap: 12, alignContent: 'center' }}>
            {sortedPieData.map((item, i) => {
              const itemPieIdx = pieData.findIndex(d => d.name === item.name)
              const isSelected = clickedIndex !== null && clickedIndex === itemPieIdx
              const isHighlighted = pieDisplayIndex !== null && pieDisplayIndex === itemPieIdx
              const row = (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, cursor: 'pointer',
                    padding: '3px 6px', borderRadius: 6, margin: '0 -6px',
                    background: isSelected ? 'rgba(139,92,246,0.12)' : 'transparent',
                    border: isSelected ? '1px solid rgba(139,92,246,0.2)' : '1px solid transparent',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={() => { if (itemPieIdx !== -1) setLegendHoverIndex(itemPieIdx) }}
                  onMouseLeave={() => setLegendHoverIndex(null)}
                  onClick={e => {
                    e.stopPropagation()
                    if (itemPieIdx !== -1) setClickedIndex(prev => prev === itemPieIdx ? null : itemPieIdx)
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: item.color }} />
                  <span style={{
                    fontSize: 12,
                    color: isHighlighted ? 'var(--text)' : 'var(--text2)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: isHighlighted ? 700 : 400,
                    transition: 'font-weight 0.1s, color 0.1s',
                  }}>{item.name}</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{totalExpenses > 0 ? Math.round((item.value / totalExpenses) * 100) : 0}%</span>
                </div>
              )
              if (i < 5) return row
              return (
                <div key={i} className={!showAllPie ? 'hidden md:block' : undefined}>
                  {row}
                </div>
              )
            })}
            {remainingPieCount > 0 && (
              <button
                className="md:hidden"
                onClick={() => setShowAllPie(p => !p)}
                style={{ fontSize: 12, color: 'var(--violet)', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0, textAlign: 'left', fontFamily: 'inherit' }}
              >
                {showAllPie ? t.dashboard.showLess : t.dashboard.moreItems.replace('{n}', String(remainingPieCount))}
              </button>
            )}
          </div>
          {/* Donut */}
          <div
            style={{ position: 'relative', flexShrink: 0, width: 190, height: 190, minHeight: 190 }}
            onClick={e => e.stopPropagation()}
          >
            {mounted && <ResponsiveContainer width={190} height={190}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                  startAngle={90}
                  endAngle={-270}
                  {...(pieDisplayIndex !== null ? { activeIndex: pieDisplayIndex } : {})}
                  activeShape={renderPieShape}
                  onMouseEnter={(_: unknown, index: number) => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  onClick={(_: unknown, index: number) => {
                    setClickedIndex(prev => prev === index ? null : index)
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {pieData.map((_, i) => <Cell key={i} fill={pieData[i].color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>}
            {/* Center label */}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              {pieDisplayIndex !== null && pieData[pieDisplayIndex] ? (() => {
                const slice = pieData[pieDisplayIndex]
                return (
                  <>
                    <span style={{ fontSize: 18, marginBottom: 2 }}>{slice.icon}</span>
                    <p style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 500, textAlign: 'center', padding: '0 4px', margin: 0 }}>{slice.name}</p>
                    <p style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 12, color: 'var(--text)', lineHeight: 1.2, margin: '2px 0 0' }}>{formatAmount(slice.value)}</p>
                    <p style={{ fontSize: 10, color: 'var(--text3)', margin: 0 }}>{totalExpenses > 0 ? Math.round((slice.value / totalExpenses) * 100) : 0}%</p>
                  </>
                )
              })() : (
                <>
                  <p style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 14, color: 'var(--text)', lineHeight: 1.2, margin: 0 }}>{formatAmount(totalExpenses)}</p>
                  <p style={{ fontSize: 10, color: 'var(--text3)', margin: '2px 0 0' }}>{t.dashboard.total}</p>
                </>
              )}
            </div>
            {/* Invisible click target to deselect */}
            {clickedIndex !== null && (
              <div
                style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 80, height: 80, borderRadius: '50%', cursor: 'pointer', zIndex: 2 }}
                onClick={() => setClickedIndex(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )

  const heatmapCard = (
    <ExpenseHeatmap
      expenses={variableExpenses}
      month={month}
      year={year}
      categories={categories}
      onNavigate={onNavigate}
    />
  )

  const rightPanelCards = (
    <>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', margin: '0 0 12px' }}>{t.dashboard.upcomingPayments}</p>
        {upcomingFixed.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {upcomingFixed.map(fe => (
              <div key={fe.id ?? fe.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '0 0 2px' }}>{fe.label}</p>
                  <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>
                    {fe.daysUntil === 0 ? t.dashboard.today : fe.daysUntil === 1 ? t.dashboard.tomorrow : t.dashboard.inDays.replace('{n}', String(fe.daysUntil))}
                  </p>
                </div>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 600, color: '#F87171', flexShrink: 0, marginLeft: 12 }}>
                  -{formatAmount(fe.amount)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>{t.dashboard.noUpcomingPayments}</p>
        )}
      </div>

      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', margin: '0 0 12px' }}>{t.dashboard.budget}</p>
        {sortedBudgetStatuses.map(b => {
          const bCat = categories.find(c => c.id === b.categoryId)
          const barColor = (bCat?.autoLimit) ? '#22c55e' : b.percentage >= 100 ? '#ef4444' : b.percentage >= 70 ? '#FBBF24' : '#34D399'
          return (
            <div key={b.categoryId} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>{b.categoryIcon}</span> {b.categoryName}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: barColor }}>{Math.round(b.percentage)}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--bg4)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 99, width: `${Math.min(b.percentage, 100)}%`, background: barColor }} />
              </div>
            </div>
          )
        })}
        {sortedBudgetStatuses.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>{t.dashboard.noLimits}</p>
            <button
              onClick={() => onNavigate('categories')}
              style={{ fontSize: 12, color: 'var(--violet)', background: 'var(--violet-glow)', border: '1px solid rgba(139,92,246,0.2)', padding: '4px 8px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {t.dashboard.setLimits}
            </button>
          </div>
        )}
        {sortedBudgetStatuses.length > 0 && (
          <button
            onClick={() => onNavigate('categories')}
            style={{ marginTop: 4, fontSize: 12, color: 'var(--violet)', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', display: 'block' }}
          >
            {t.dashboard.showMore}
          </button>
        )}
      </div>

      {motivationalMsg && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderLeft: `3px solid ${motivationalMsg.color}`, borderRadius: 16, padding: 16 }}>
          <p style={{ fontSize: 14, color: motivationalMsg.color, margin: 0 }}>{motivationalMsg.msg}</p>
        </div>
      )}

      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
        <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', margin: '0 0 12px' }}>{t.dashboard.monthComparison}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{t.dashboard.thisMonth}</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, fontWeight: 600, color: '#F87171' }}>-{formatAmount(totalExpenses)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{t.dashboard.lastMonth}</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: 'var(--text)' }}>-{formatAmount(prevMonthData?.expenses ?? 0)}</span>
          </div>
          {(prevMonthData?.expenses ?? 0) > 0 && (() => {
            const diff = ((totalExpenses - (prevMonthData?.expenses ?? 0)) / (prevMonthData?.expenses ?? 0) * 100).toFixed(1)
            const isUp = totalExpenses > (prevMonthData?.expenses ?? 0)
            return (
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color: isUp ? '#F87171' : '#34D399' }}>
                {isUp ? '↑' : '↓'} {Math.abs(Number(diff))}% {t.dashboard.vsLastMonth}
              </div>
            )
          })()}
        </div>
      </div>

      {monthChallengeTarget > 0 && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
          <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', margin: '0 0 8px' }}>{t.dashboard.monthlyChallenge}</p>
          <p style={{ fontSize: 14, color: 'var(--text)', margin: '0 0 8px' }}>{t.dashboard.spendLessThan} {formatAmount(monthChallengeTarget)}</p>
          <div style={{ height: 8, borderRadius: 99, background: 'var(--bg4)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%', borderRadius: 99,
                width: `${Math.round(challengeProgress * 100)}%`,
                background: challengeProgress < 0.8 ? '#34D399' : challengeProgress < 1 ? '#F59E0B' : '#F87171',
                transition: 'width 0.4s',
              }}
            />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text3)', margin: '6px 0 0' }}>
            {formatAmount(totalExpenses)} / {formatAmount(monthChallengeTarget)} ({Math.round(challengeProgress * 100)}%)
          </p>
        </div>
      )}

      {(user?.savings_enabled && savingsGoals.length > 0) && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', margin: 0 }}>{t.savings.dashboardTitle}</p>
            <button
              onClick={() => onNavigate('savings')}
              style={{ fontSize: 12, color: 'var(--text3)', cursor: 'pointer', background: 'transparent', border: 'none', fontFamily: 'inherit' }}
            >
              {t.savings.viewAll} →
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {savingsGoals.slice(0, 3).map(goal => {
              const pct = goal.targetAmount > 0 ? Math.min((goal.savedAmount / goal.targetAmount) * 100, 100) : 0
              const pctFixed = pct.toFixed(1)
              const pctLabel = pct === 0 ? '0%' : pctFixed === '0.0' ? '< 0.1%' : pctFixed + '%'
              return (
                <div key={goal.id}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {goal.icon && <span>{goal.icon}</span>}
                      {goal.name}
                    </span>
                    <span style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: 'var(--text3)', flexShrink: 0, marginLeft: 8 }}>{pctLabel}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 99, background: 'var(--bg4)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, width: `${pct}%`, background: goal.color ?? 'var(--violet)', transition: 'width 0.4s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

    </>
  )

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
    <div style={{ padding: '20px' }} className="flex flex-col gap-4 lg:gap-0 pb-4 w-full">

      {/* Tracking start date banner */}
      {showTrackingBanner && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '12px 16px',
          background: 'rgba(124,58,237,0.1)',
          border: '1px solid rgba(124,58,237,0.3)',
          borderRadius: 14,
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>📅</span>
            <span style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.4 }}>
              Nastav počiatočný dátum sledovania financií
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => setShowTrackingModal(true)}
              style={{
                padding: '6px 14px', borderRadius: 10,
                background: 'var(--violet)', color: 'white',
                fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Nastaviť
            </button>
            <button
              onClick={handleDismissBanner}
              style={{
                width: 28, height: 28, borderRadius: 8,
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--text3)', fontSize: 14, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'inherit', flexShrink: 0,
              }}
              title="Zavrieť natrvalo"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Tracking date modal */}
      {showTrackingModal && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setShowTrackingModal(false) }}
        >
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 20, padding: 24, width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>{t.dashboard.trackingFromTitle}</h3>
              <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>{t.dashboard.trackingFromNote}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t.onboarding.trackingLabel}</label>
              <input
                type="date"
                value={trackingDate}
                onChange={e => setTrackingDate(e.target.value)}
                style={{
                  background: 'var(--bg3)', border: '1px solid var(--border)',
                  borderRadius: 10, padding: '12px 14px', fontSize: 14,
                  color: 'var(--text)', width: '100%', outline: 'none',
                  fontFamily: 'inherit', boxSizing: 'border-box', colorScheme: 'dark',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowTrackingModal(false)}
                style={{
                  flex: 1, padding: '12px', borderRadius: 10,
                  background: 'var(--bg3)', border: '1px solid var(--border)',
                  color: 'var(--text2)', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Zrušiť
              </button>
              <button
                onClick={handleSaveTrackingDate}
                disabled={trackingSaving || !trackingDate}
                style={{
                  flex: 1, padding: '12px', borderRadius: 10,
                  background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
                  color: 'white', fontSize: 14, fontWeight: 600, border: 'none',
                  cursor: trackingSaving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  opacity: (trackingSaving || !trackingDate) ? 0.6 : 1,
                }}
              >
                {trackingSaving ? t.common.saving : t.common.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          MOBILE LAYOUT
      ════════════════════════════════════════ */}
      <div className="flex flex-col gap-4 lg:hidden" style={{ paddingBottom: 'calc(140px + env(safe-area-inset-bottom, 0px))' }}>
        <div>{greetingRow}</div>
        {heroSection}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {pieChartCard}
          {heatmapCard}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {rightPanelCards}
        </div>
      </div>

      {/* ════════════════════════════════════════
          DESKTOP LAYOUT
      ════════════════════════════════════════ */}
      <div className="hidden lg:grid gap-6 items-start w-full" style={{ gridTemplateColumns: 'minmax(0, 1fr) 280px', marginTop: 24 }}>

        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0, overflowX: 'hidden' }}>
          {greetingDesktop}
          {heroSection}
          <div className="grid grid-cols-2 items-stretch" style={{ gap: 16 }}>
            {heatmapCard}
            {pieChartCard}
          </div>
        </div>

        {/* RIGHT panel */}
        <div
          style={{
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            padding: '16px 12px',
            overflowX: 'hidden',
            overflowY: 'auto',
            height: 'calc(100vh - 64px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            position: 'sticky',
            top: 0,
            alignSelf: 'flex-start',
          }}
        >
          {rightPanelCards}
        </div>

      </div>

    </div>
    {clickedIndex !== null && (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 10 }}
        onClick={() => { setClickedIndex(null); setLegendHoverIndex(null) }}
      />
    )}
    </div>
  )
}
