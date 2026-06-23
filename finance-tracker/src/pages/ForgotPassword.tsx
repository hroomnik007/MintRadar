import { useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { useTranslation } from '../i18n'
import { forgotPassword } from '../api/auth'

interface ForgotPasswordPageProps {
  onNavigateLogin: () => void
}

const LABEL_COLOR = '#6b6387'

export function ForgotPasswordPage({ onNavigateLogin }: ForgotPasswordPageProps) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [focused, setFocused] = useState(false)
  const [sent, setSent] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('theme_preference') as 'dark' | 'light') ?? 'dark' } catch { return 'dark' }
  })

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('theme_preference', next)
    document.documentElement.setAttribute('data-theme', next)
  }

  const handleSubmit = async () => {
    if (!email) return
    setIsLoading(true)
    try {
      await forgotPassword(email)
      setSent(true)
    } finally {
      setIsLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: theme === 'light' ? '#f0ebff' : 'var(--bg)',
    border: `1px solid ${focused ? '#7C3AED' : (theme === 'light' ? '#c4b5fd' : 'var(--border)')}`,
    borderRadius: 8,
    padding: '12px 16px',
    color: theme === 'light' ? '#1a0a3e' : 'var(--text)',
    fontSize: 15,
    width: '100%',
    outline: 'none',
    transition: 'border-color 0.15s',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: LABEL_COLOR,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  }

  return (
    <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', background: 'var(--bg)' }}>
      <button
        onClick={toggleTheme}
        style={{
          position: 'fixed', top: 16, right: 16,
          width: 38, height: 38, borderRadius: '50%',
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 16, zIndex: 100,
        }}
        title={theme === 'dark' ? 'Svetlý režim' : 'Tmavý režim'}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>

      <div style={{
        width: '100%',
        maxWidth: 400,
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 32,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
      }}>
        <img src="/logo.svg" alt="Finvu" style={{ width: 80, height: 80, borderRadius: 20 }} />

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>{t.auth.forgotPasswordTitle}</div>
          {!sent && (
            <p style={{ fontSize: 14, color: 'var(--text3)', marginTop: 8 }}>
              Zadaj email a pošleme ti odkaz na obnovu hesla.
            </p>
          )}
        </div>

        {sent ? (
          <div style={{
            width: '100%',
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 16,
            color: 'var(--text)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}>
            <CheckCircle size={40} color="#0090E6" />
            <p style={{ fontSize: 14, lineHeight: 1.6 }}>{t.auth.resetLinkSent}</p>
          </div>
        ) : (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={labelStyle}>{t.auth.email}</label>
              <input
                type="email"
                placeholder="vas@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                style={inputStyle}
              />
            </div>
            <button
              onClick={handleSubmit}
              disabled={isLoading || !email}
              style={{
                background: 'linear-gradient(135deg, #7C3AED, #9D4FD6)',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                minHeight: 44,
                width: '100%',
                fontSize: 15,
                fontWeight: 600,
                cursor: (isLoading || !email) ? 'not-allowed' : 'pointer',
                opacity: (isLoading || !email) ? 0.5 : 1,
                fontFamily: 'inherit',
                transition: 'opacity 0.15s',
              }}
            >
              {isLoading ? 'Odosielam...' : t.auth.sendResetLink}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onNavigateLogin}
          style={{
            fontSize: 14,
            color: 'var(--text3)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text3)')}
        >
          ← {t.auth.backToLogin}
        </button>
      </div>
    </div>
  )
}
