import { useState, useEffect, useRef } from 'react'
import type { Page } from '../App'
import { useTranslation } from '../i18n'

interface TxnSearchItem {
  id: string
  label: string
  amount: number
  date: string
  type: 'income' | 'expense'
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onNavigate: (page: Page) => void
  onAdd: (type: string) => void
  onToggleTheme: () => void
  transactions?: TxnSearchItem[]
  onTransactionNavigate?: (type: 'income' | 'expense') => void
}

interface PaletteAction {
  kind: 'nav' | 'act'
  id: string
  label: string
  hint: string
  icon: string
  action: () => void
}

interface PaletteItem extends PaletteAction {
  _i: number
}

function formatAmt(amount: number): string {
  const abs = Math.abs(amount)
  const sign = amount >= 0 ? '+' : '-'
  return `${sign}${abs.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

export function CommandPalette({ open, onClose, onNavigate, onAdd, onToggleTheme, transactions = [], onTransactionNavigate }: CommandPaletteProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selIdx, setSelIdx] = useState(0)
  const inpRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelIdx(0)
      setTimeout(() => inpRef.current?.focus(), 50)
    }
  }, [open])

  const actions: PaletteAction[] = [
    { kind: 'nav', id: 'dashboard', label: t.nav.overview, hint: 'Dashboard', icon: '📊', action: () => onNavigate('dashboard') },
    { kind: 'nav', id: 'income', label: t.nav.income, hint: 'Income', icon: '💰', action: () => onNavigate('income') },
    { kind: 'nav', id: 'variable-expenses', label: t.palette.variableExpenses, hint: 'Variable', icon: '🧾', action: () => onNavigate('variable-expenses') },
    { kind: 'nav', id: 'fixed-expenses', label: t.palette.fixedExpenses, hint: 'Fixed', icon: '🔒', action: () => onNavigate('fixed-expenses') },
    { kind: 'nav', id: 'categories', label: t.nav.categories, hint: 'Categories', icon: '🏷️', action: () => onNavigate('categories') },
    { kind: 'nav', id: 'household', label: t.nav.household, hint: 'Household', icon: '🏠', action: () => onNavigate('household') },
    { kind: 'nav', id: 'savings', label: t.nav.savings, hint: 'Savings', icon: '🐷', action: () => onNavigate('savings') },
    { kind: 'nav', id: 'settings', label: t.nav.settings, hint: 'Settings', icon: '⚙️', action: () => onNavigate('settings') },
    { kind: 'act', id: 'add-exp', label: t.expenses.variable.add, hint: 'New expense', icon: '➕', action: () => onAdd('expense') },
    { kind: 'act', id: 'add-inc', label: t.income.add, hint: 'New income', icon: '➕', action: () => onAdd('income') },
    { kind: 'act', id: 'toggle-theme', label: t.palette.toggleTheme, hint: 'Theme', icon: '🌓', action: onToggleTheme },
  ]

  const q = query.toLowerCase().trim()
  const filteredActions = q
    ? actions.filter(a => a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q))
    : actions

  const txnMatches: TxnSearchItem[] = q.length >= 2
    ? transactions.filter(txn => txn.label.toLowerCase().includes(q)).slice(0, 5)
    : []

  const allItems: PaletteItem[] = filteredActions.map((a, i) => ({ ...a, _i: i }))
  const totalItems = allItems.length + txnMatches.length

  const trigger = (item: PaletteItem) => {
    item.action()
    onClose()
  }

  const triggerTxn = (t: TxnSearchItem) => {
    onTransactionNavigate?.(t.type)
    onClose()
  }

  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSelIdx(i => Math.min(i + 1, totalItems - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelIdx(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        if (selIdx < allItems.length) { if (allItems[selIdx]) trigger(allItems[selIdx]) }
        else { const txnItem = txnMatches[selIdx - allItems.length]; if (txnItem) triggerTxn(txnItem) }
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allItems, txnMatches, selIdx])

  if (!open) return null

  const sectionTitle = (label: string) => (
    <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text3)', padding: '10px 16px 4px' }}>{label}</div>
  )

  let curSection: string | null = null
  const rows: React.ReactNode[] = []
  allItems.forEach((item, i) => {
    const section = item.kind === 'nav' ? t.palette.navigation : t.palette.actions
    if (section !== curSection) {
      rows.push(<div key={'s-' + section}>{sectionTitle(section)}</div>)
      curSection = section
    }
    const sel = selIdx === i
    rows.push(
      <div
        key={item.id}
        onClick={() => trigger(item)}
        onMouseEnter={() => setSelIdx(i)}
        style={{
          display: 'flex', alignItems: 'center', gap: 11, padding: '9px 16px', cursor: 'pointer',
          background: sel ? 'rgba(139,92,246,0.13)' : 'transparent',
          borderLeft: sel ? '2px solid var(--violet)' : '2px solid transparent',
          transition: 'background 0.08s',
        }}
      >
        <span style={{ fontSize: 15, width: 22, display: 'flex', justifyContent: 'center' }}>{item.icon}</span>
        <span style={{ flex: 1, fontSize: 13.5, color: 'var(--text)', fontWeight: sel ? 500 : 400 }}>{item.label}</span>
        <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'DM Mono',monospace" }}>{item.hint}</span>
        {sel && <KbdKey label="↵" />}
      </div>
    )
  })

  if (txnMatches.length > 0) {
    rows.push(<div key="s-txn">{sectionTitle(t.palette.transactions)}</div>)
    txnMatches.forEach((txnItem, ti) => {
      const globalIdx = allItems.length + ti
      const sel = selIdx === globalIdx
      const isIncome = txnItem.type === 'income'
      const amtStr = formatAmt(txnItem.amount)
      const dateStr = txnItem.date ? txnItem.date.slice(0, 10).split('-').reverse().join('.') : ''
      rows.push(
        <div
          key={'txn-' + txnItem.id}
          onClick={() => triggerTxn(txnItem)}
          onMouseEnter={() => setSelIdx(globalIdx)}
          style={{
            display: 'flex', alignItems: 'center', gap: 11, padding: '9px 16px', cursor: 'pointer',
            background: sel ? 'rgba(139,92,246,0.13)' : 'transparent',
            borderLeft: sel ? '2px solid var(--violet)' : '2px solid transparent',
            transition: 'background 0.08s',
          }}
        >
          <span style={{ fontSize: 15, width: 22, display: 'flex', justifyContent: 'center' }}>{isIncome ? '💰' : '🧾'}</span>
          <span style={{ flex: 1, fontSize: 13.5, color: 'var(--text)', fontWeight: sel ? 500 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{txnItem.label}</span>
          <span style={{ fontSize: 12, fontFamily: "'DM Mono',monospace", color: 'var(--text3)', flexShrink: 0 }}>{amtStr}</span>
          <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>{dateStr}</span>
          {sel && <KbdKey label="↵" />}
        </div>
      )
    })
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(8,6,14,0.65)', backdropFilter: 'blur(6px)', zIndex: 500, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '15vh' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(580px, 92vw)', background: 'var(--bg2)',
          border: '1px solid var(--border2)', borderRadius: 16,
          boxShadow: '0 24px 64px rgba(0,0,0,0.55)', overflow: 'hidden',
          animation: 'paletteIn 0.18s cubic-bezier(0.34,1.1,0.64,1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inpRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelIdx(0) }}
            placeholder={t.palette.placeholder}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 15, fontFamily: "'DM Sans', sans-serif" }}
          />
          <KbdKey label="esc" />
        </div>
        <div style={{ maxHeight: '50vh', overflowY: 'auto', padding: '4px 0 8px' }}>
          {rows.length > 0 ? rows : (
            <div style={{ padding: '28px 16px', textAlign: 'center' }}>
              <p style={{ fontSize: 24, marginBottom: 8 }}>🔍</p>
              <p style={{ fontSize: 13, color: 'var(--text3)' }}>{t.palette.noResults.replace('{query}', query)}</p>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg)', fontSize: 11, color: 'var(--text3)' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><KbdKey label="↑↓" /> {t.palette.moveHint}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><KbdKey label="↵" /> {t.palette.selectHint}</span>
          </div>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><KbdKey label="⌘K" /> {t.palette.openHint}</span>
        </div>
      </div>
    </div>
  )
}

function KbdKey({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: '1px 5px', borderRadius: 4, fontSize: 10, fontFamily: "'DM Mono', monospace",
      background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text3)',
    }}>{label}</span>
  )
}
