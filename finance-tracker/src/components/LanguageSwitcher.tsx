import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { useSettingsContext } from '../context/SettingsContext'

const LANGS = [
  { code: 'sk', flag: '🇸🇰', label: 'SK', name: 'Slovenčina' },
  { code: 'cs', flag: '🇨🇿', label: 'CS', name: 'Čeština' },
  { code: 'pl', flag: '🇵🇱', label: 'PL', name: 'Poľština' },
  { code: 'hu', flag: '🇭🇺', label: 'HU', name: 'Maďarčina' },
  { code: 'en', flag: '🇬🇧', label: 'EN', name: 'Angličtina' },
] as const

interface LanguageSwitcherProps {
  onLanguageChange?: (lang: string) => void
  variant?: 'compact' | 'full'
}

export function LanguageSwitcher({ onLanguageChange, variant = 'compact' }: LanguageSwitcherProps) {
  const { settings, updateSettings } = useSettingsContext()
  const current = settings.language || 'sk'
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [dropPos, setDropPos] = useState<{ top: number; left?: number; right?: number; width: number } | null>(null)

  const currentLang = LANGS.find(l => l.code === current) ?? LANGS[0]
  const isCompact = variant === 'compact'

  function openDropdown() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      if (isCompact) {
        setDropPos({ top: r.bottom + 6, right: window.innerWidth - r.right, width: 170 })
      } else {
        setDropPos({ top: r.bottom + 6, left: r.left, width: r.width })
      }
    }
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function handleChange(code: string) {
    updateSettings({ language: code })
    onLanguageChange?.(code)
    setOpen(false)
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: isCompact ? 'inline-block' : 'block', width: isCompact ? undefined : 200 }}>
      <button
        ref={btnRef}
        type="button"
        onClick={openDropdown}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          width: '100%',
          padding: isCompact ? '6px 10px' : '0 12px',
          borderRadius: 8,
          height: isCompact ? undefined : 36,
          cursor: 'pointer',
          background: isCompact ? 'rgba(255,255,255,0.08)' : 'var(--bg3)',
          border: `1px solid ${isCompact ? 'rgba(255,255,255,0.15)' : 'var(--border2)'}`,
          color: isCompact ? 'rgba(255,255,255,0.85)' : 'var(--text)',
          fontSize: isCompact ? 12 : 13,
          fontWeight: isCompact ? 600 : 500,
          fontFamily: "'DM Sans', sans-serif",
          letterSpacing: isCompact ? '0.04em' : 'normal',
          transition: 'background 0.15s',
        }}
      >
        <span style={{ fontSize: isCompact ? 14 : 16 }}>{currentLang.flag}</span>
        <span style={{ flex: 1, textAlign: 'left' }}>{isCompact ? currentLang.label : currentLang.name}</span>
        <ChevronDown
          size={13}
          style={{ opacity: 0.55, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}
        />
      </button>

      {open && dropPos && (
        <div style={{
          position: 'fixed',
          top: dropPos.top,
          left: dropPos.left,
          right: dropPos.right,
          width: dropPos.width,
          background: 'var(--bg2)',
          border: '1px solid var(--border2)',
          borderRadius: 10,
          boxShadow: '0 8px 28px rgba(0,0,0,0.38)',
          overflow: 'hidden',
          zIndex: 9000,
          padding: '4px 0',
        }}>
          {LANGS.map(({ code, flag, name }) => {
            const active = current === code
            return (
              <button
                key={code}
                type="button"
                onClick={() => handleChange(code)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 14px', border: 'none', cursor: 'pointer',
                  background: active ? 'rgba(124,58,237,0.15)' : 'transparent',
                  color: active ? 'var(--violet)' : 'var(--text)',
                  fontSize: 13, fontWeight: active ? 600 : 400,
                  fontFamily: "'DM Sans', sans-serif",
                  transition: 'background 0.1s',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 16 }}>{flag}</span>
                <span>{name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
