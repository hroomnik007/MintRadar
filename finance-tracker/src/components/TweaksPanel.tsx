import { useState, useEffect } from 'react'
import { Palette } from 'lucide-react'
import { updateUserSettings } from '../api/auth'

interface TweaksPanelProps {
  sidebarCollapsed: boolean
  onSidebarToggle: () => void
}

const ACCENT_OPTIONS = [
  '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B',
  '#EC4899', '#06B6D4', '#EF4444', '#A78BFA',
]

interface TweaksData {
  theme: 'dark' | 'light'
  accentColor: string
  sidebarCollapsed: boolean
}

const DEFAULTS: TweaksData = {
  theme: 'dark',
  accentColor: '#8B5CF6',
  sidebarCollapsed: false,
}

function loadTweaks(): TweaksData {
  try {
    const raw = JSON.parse(localStorage.getItem('__tweaks_v1') || '{}')
    return {
      theme: raw.theme === 'light' ? 'light' : 'dark',
      accentColor: typeof raw.accentColor === 'string' ? raw.accentColor : DEFAULTS.accentColor,
      sidebarCollapsed: typeof raw.sidebarCollapsed === 'boolean' ? raw.sidebarCollapsed : DEFAULTS.sidebarCollapsed,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveTweak<K extends keyof TweaksData>(key: K, value: TweaksData[K]) {
  try {
    const raw = JSON.parse(localStorage.getItem('__tweaks_v1') || '{}')
    localStorage.setItem('__tweaks_v1', JSON.stringify({ ...raw, [key]: value }))
  } catch {}
}

function TweakSection({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px',
      color: 'var(--text3)', fontFamily: "'DM Mono',monospace",
      padding: '14px 20px 6px',
    }}>{label}</div>
  )
}

export function TweaksPanel({ sidebarCollapsed, onSidebarToggle }: TweaksPanelProps) {
  const [open, setOpen] = useState(false)

  const [accentColor, setAccentColorState] = useState<string>(() =>
    localStorage.getItem('accent_color') || DEFAULTS.accentColor
  )
  const [theme, setThemeState] = useState<'dark' | 'light'>(() => {
    const saved = loadTweaks().theme
    return saved
  })

  // Sync accent from __tweaks_v1 on mount
  useEffect(() => {
    const t = loadTweaks()
    setAccentColorState(t.accentColor)
    setThemeState(t.theme)
  }, [])

  function handleAccentChange(color: string) {
    setAccentColorState(color)
    saveTweak('accentColor', color)
    localStorage.setItem('accent_color', color)
    document.documentElement.style.setProperty('--accent-color', color)
  }

  function handleThemeChange(next: 'dark' | 'light') {
    setThemeState(next)
    saveTweak('theme', next)
    localStorage.setItem('theme_preference', next)
    document.documentElement.setAttribute('data-theme', next)
    updateUserSettings({ theme: next }).catch(() => {})
  }

  function handleSidebarToggle() {
    saveTweak('sidebarCollapsed', !sidebarCollapsed)
    onSidebarToggle()
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px', gap: 12,
  }

  return (
    <>
      {/* Trigger button — desktop only */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Tweaks"
        style={{
          position: 'fixed',
          right: open ? 272 : 20,
          bottom: 24,
          zIndex: 1100,
          width: 38, height: 38, borderRadius: 11,
          background: open ? 'var(--violet)' : 'var(--bg2)',
          border: open ? 'none' : '1px solid var(--border)',
          color: open ? 'white' : 'var(--text3)',
          boxShadow: open ? '0 4px 20px rgba(139,92,246,0.4)' : 'var(--card-shadow)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
        }}
        className="hidden md:flex"
      >
        <Palette size={17} />
      </button>

      {/* Panel */}
      <div
        className="hidden md:flex"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: 260,
          background: 'var(--bg2)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.35)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
          zIndex: 1050,
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Palette size={16} color="var(--violet)" />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Tweaks</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            style={{
              width: 28, height: 28, borderRadius: 8,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text3)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
            }}
          >✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* ── Farebná schéma ── */}
          <TweakSection label="Farebná schéma" />

          {/* Accent color swatches */}
          <div style={{ padding: '4px 20px 10px' }}>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8, fontWeight: 500 }}>Hlavná farba</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ACCENT_OPTIONS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleAccentChange(c)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', background: c,
                    border: 'none', cursor: 'pointer',
                    transition: 'transform 0.15s',
                    transform: accentColor === c ? 'scale(1.15)' : 'scale(1)',
                    boxShadow: accentColor === c ? `0 0 0 2px var(--bg2), 0 0 0 4px ${c}` : 'none',
                    position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                  title={c}
                >
                  {accentColor === c && (
                    <span style={{ color: 'white', fontSize: 12, fontWeight: 700 }}>✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Theme */}
          <div style={rowStyle}>
            <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>Téma</span>
            <div style={{ display: 'flex', gap: 4, background: 'var(--bg3)', borderRadius: 10, padding: 3 }}>
              {([['dark', '🌙'], ['light', '☀️']] as const).map(([id, icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleThemeChange(id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
                    background: theme === id ? 'var(--bg2)' : 'transparent',
                    color: theme === id ? 'var(--violet)' : 'var(--text3)',
                    boxShadow: theme === id ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
                  }}
                >
                  <span>{icon}</span>
                  <span style={{ textTransform: 'capitalize' }}>{id === 'dark' ? 'Dark' : 'Light'}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Navigácia ── */}
          <TweakSection label="Navigácia" />

          {/* Sidebar collapsed */}
          <div style={rowStyle}>
            <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>Sidebar zbalený</span>
            <button
              type="button"
              onClick={handleSidebarToggle}
              style={{
                width: 44, height: 24, borderRadius: 99, cursor: 'pointer', flexShrink: 0, position: 'relative',
                background: sidebarCollapsed ? 'var(--violet)' : 'var(--bg4)',
                border: 'none', transition: 'background 0.2s',
              }}
            >
              <div style={{
                position: 'absolute', top: 2, left: sidebarCollapsed ? 22 : 2,
                width: 20, height: 20, borderRadius: '50%', background: 'white',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>

        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--border)', flexShrink: 0,
          fontSize: 11, color: 'var(--text3)', textAlign: 'center',
          fontFamily: "'DM Mono',monospace",
        }}>
          localStorage: __tweaks_v1
        </div>
      </div>
    </>
  )
}
