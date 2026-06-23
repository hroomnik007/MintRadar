import { useState, useEffect } from 'react'
import { useTranslation } from '../i18n'
import { resetPassword } from '../api/auth'

interface ResetPasswordPageProps {
  token: string
  onNavigateLogin: () => void
}

const LABEL_COLOR = '#6b6387'

export function ResetPasswordPage({ token, onNavigateLogin }: ResetPasswordPageProps) {
  const { t } = useTranslation()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [p1Focused, setP1Focused] = useState(false)
  const [p2Focused, setP2Focused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [countdown, setCountdown] = useState(3)

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('theme_preference') as 'dark' | 'light') ?? 'dark' } catch { return 'dark' }
  })

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('theme_preference', next)
    document.documentElement.setAttribute('data-theme', next)
  }

  useEffect(() => {
    if (!success) return
    if (countdown <= 0) { onNavigateLogin(); return }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [success, countdown, onNavigateLogin])

  const handleSubmit = async () => {
    setError(null)
    if (newPassword.length < 8) { setError(t.auth.passwordMin8); return }
    if (newPassword !== confirmPassword) { setError(t.settings.passwordMismatch); return }
    setIsLoading(true)
    try {
      await resetPassword(token, newPassword)
      setSuccess(true)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? t.auth.linkExpired)
    } finally {
      setIsLoading(false)
    }
  }

  const inputStyle = (focused: boolean): React.CSSProperties => ({
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
    boxSizing: 'border-box' as const,
  })

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
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>{t.auth.resetPasswordTitle}</div>
          {!success && (
            <p style={{ fontSize: 14, color: 'var(--text3)', marginTop: 8 }}>
              {t.auth.resetPasswordDesc}
            </p>
          )}
        </div>

        {success ? (
          <div style={{
            width: '100%',
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 8,
            padding: 16,
            color: 'var(--text)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}>
            <p style={{ fontSize: 24, margin: 0 }}>✅</p>
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>{t.auth.resetSuccessMsg}</p>
            <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>{t.auth.redirectingIn.replace('{n}', String(countdown))}</p>
          </div>
        ) : (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && (
              <div style={{
                background: 'rgba(248,113,113,0.12)',
                color: '#F87171',
                border: '1px solid rgba(248,113,113,0.3)',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 14,
              }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={labelStyle}>{t.auth.newPasswordLabel}</label>
              <input
                type="password"
                placeholder={t.auth.minChars}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                onFocus={() => setP1Focused(true)}
                onBlur={() => setP1Focused(false)}
                style={inputStyle(p1Focused)}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={labelStyle}>{t.auth.confirmPassword}</label>
              <input
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                onFocus={() => setP2Focused(true)}
                onBlur={() => setP2Focused(false)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                style={inputStyle(p2Focused)}
              />
            </div>
            <button
              onClick={handleSubmit}
              disabled={isLoading || !newPassword || !confirmPassword}
              style={{
                background: 'linear-gradient(135deg, #7C3AED, #9D4FD6)',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                minHeight: 44,
                width: '100%',
                fontSize: 15,
                fontWeight: 600,
                cursor: (isLoading || !newPassword || !confirmPassword) ? 'not-allowed' : 'pointer',
                opacity: (isLoading || !newPassword || !confirmPassword) ? 0.5 : 1,
                fontFamily: 'inherit',
                transition: 'opacity 0.15s',
              }}
            >
              {isLoading ? t.auth.saving : t.auth.resetPasswordBtn}
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
