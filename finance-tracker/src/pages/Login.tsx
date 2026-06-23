import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useAuth } from '../context/AuthContext'
import { useGoogleLogin } from '@react-oauth/google'
import { getAuthMethods } from '../api/auth'
import { LanguageSwitcher } from '../components/LanguageSwitcher'

interface LoginPageProps {
  onNavigateRegister: () => void
  onNavigateForgotPassword: () => void
}

export function LoginPage({ onNavigateRegister, onNavigateForgotPassword }: LoginPageProps) {
  const { t } = useTranslation()
  const { login, loginDemo, loginWithGoogle, loginWithPin } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [focused, setFocused] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)

  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [pinValue, setPinValue] = useState('')
  const [pinLoading, setPinLoading] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)

  const [authMethods, setAuthMethods] = useState({ pin: false, google: false, password: false })

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('theme_preference') as 'dark' | 'light') ?? 'dark' } catch { return 'dark' }
  })

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('demo') !== 'true') return
    setEmail('demo@finvu.sk')
    setPassword('demo123')
  }, [])

  useEffect(() => {
    if (!email.includes('@')) {
      setAuthMethods({ pin: false, google: false, password: false })
      return
    }
    const timer = setTimeout(async () => {
      try {
        const methods = await getAuthMethods(email)
        setAuthMethods(methods)
      } catch {
        setAuthMethods({ pin: false, google: false, password: false })
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [email])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('theme_preference', next)
    document.documentElement.setAttribute('data-theme', next)
  }

  const googleLogin = useGoogleLogin({
    onSuccess: async tokenResponse => {
      setIsGoogleLoading(true)
      setError(null)
      try {
        await loginWithGoogle(tokenResponse.access_token)
      } catch {
        setError(t.auth.googleError)
      } finally {
        setIsGoogleLoading(false)
      }
    },
    onError: () => setError(t.auth.googleError),
  })

  const handleLogin = async () => {
    if (!email || !password) return
    setError(null)
    setIsLoading(true)
    try {
      if (email === 'demo@finvu.sk') {
        await loginDemo()
      } else {
        await login(email, password)
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? t.auth.loginFailed)
    } finally {
      setIsLoading(false)
    }
  }

  const handlePinLogin = useCallback(async (pin: string) => {
    if (!email || pin.length !== 4) return
    setPinError(null)
    setPinLoading(true)
    try {
      await loginWithPin(email, pin)
      setPinModalOpen(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setPinError(msg ?? t.auth.wrongPin)
      setPinValue('')
    } finally {
      setPinLoading(false)
    }
  }, [email, loginWithPin])

  useEffect(() => {
    if (!pinModalOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        if (pinValue.length < 4) {
          const next = pinValue + e.key
          setPinValue(next)
          if (next.length === 4) setTimeout(() => handlePinLogin(next), 100)
        }
      } else if (e.key === 'Backspace') {
        setPinValue(v => v.slice(0, -1))
        setPinError(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pinModalOpen, pinValue, handlePinLogin])

  const inp = (name: string): React.CSSProperties => ({
    width: '100%',
    background: 'var(--bg3)',
    color: 'var(--text)',
    borderRadius: 13,
    padding: name === 'password' ? '0 44px 0 16px' : '0 16px',
    height: 50,
    fontSize: 15,
    fontFamily: "'DM Sans', sans-serif",
    border: `1.5px solid ${focused === name ? 'var(--violet)' : 'var(--border2)'}`,
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    boxShadow: focused === name ? '0 0 0 3px rgba(139,92,246,0.1)' : 'none',
    boxSizing: 'border-box' as const,
  })

  const labelStyle: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: 'var(--text3)',
  }

  return (
    <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>

      {/* Atmospheric blob */}
      <div style={{ position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle,rgba(139,92,246,0.12) 0%,transparent 70%)', pointerEvents: 'none' }} />

      {/* Top controls: language switcher + theme toggle */}
      <div style={{ position: 'fixed', top: 16, right: 16, display: 'flex', alignItems: 'center', gap: 8, zIndex: 100 }}>
        <LanguageSwitcher />
        <button
          onClick={toggleTheme}
          style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--bg2)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}
          title={theme === 'dark' ? t.auth.lightMode : t.auth.darkMode}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>

      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 24, position: 'relative' }}>

        {/* Logo + title */}
        <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <img src="/logo.svg" alt="Finvu" style={{ width: 72, height: 72, borderRadius: 18 }} />
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', lineHeight: 1, margin: 0 }}>{t.nav.appName}</h1>
            <p style={{ fontSize: 12, marginTop: 5, marginBottom: 0, color: 'var(--text3)', fontFamily: "'DM Mono', monospace", letterSpacing: '0.04em' }}>{t.nav.appTagline.toUpperCase()}</p>
          </div>
        </div>

        {/* Form card */}
        <div className="fu" style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 24, padding: 26, boxShadow: 'var(--shadow-elevated)', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {error && (
            <div style={{ borderRadius: 11, padding: '10px 14px', fontSize: 13, background: 'rgba(248,113,113,0.12)', color: 'var(--red)', border: '1px solid rgba(248,113,113,0.3)' }}>
              {error}
            </div>
          )}

          {/* Email */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={labelStyle}>{t.auth.email}</label>
            <input
              type="email"
              placeholder="vas@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused(null)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              style={inp('email')}
            />
          </div>

          {/* Password */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={labelStyle}>{t.auth.password}</label>
              <button
                type="button"
                onClick={onNavigateForgotPassword}
                style={{ fontSize: 12, color: 'var(--violet)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
              >
                Zabudnuté heslo?
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                style={inp('password')}
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                tabIndex={-1}
                style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', display: 'flex', alignItems: 'center', padding: 2 }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Login button */}
          <button
            onClick={handleLogin}
            disabled={isLoading || !email || !password}
            style={{
              height: 50, width: '100%',
              background: 'linear-gradient(135deg,#8B5CF6 0%,#6D28D9 100%)',
              color: 'white', border: 'none', borderRadius: 14,
              fontSize: 15, fontWeight: 700, cursor: isLoading || !email || !password ? 'not-allowed' : 'pointer',
              boxShadow: isLoading || !email || !password ? 'none' : '0 4px 20px rgba(139,92,246,0.4)',
              opacity: isLoading || !email || !password ? 0.6 : 1,
              transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontFamily: 'inherit',
            }}
          >
            {isLoading ? (
              <>
                <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid white', animation: 'spin 0.7s linear infinite' }} />
                {t.auth.loggingInDots}
              </>
            ) : t.auth.loginArrow}
          </button>

          {/* PIN login */}
          {authMethods.pin && (
            <button
              type="button"
              onClick={() => { setPinModalOpen(true); setPinValue(''); setPinError(null) }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg4)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg3)')}
              style={{
                height: 46, width: '100%',
                background: 'var(--bg3)', border: '1.5px solid rgba(139,92,246,0.35)',
                borderRadius: 14, fontSize: 14, fontWeight: 600, color: 'var(--violet)',
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background 0.15s',
              }}
            >
              {t.auth.loginWithPin}
            </button>
          )}

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>alebo</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          {/* Google button */}
          <button
            type="button"
            onClick={() => googleLogin()}
            disabled={isGoogleLoading}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg4)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg3)')}
            style={{
              height: 46, width: '100%',
              background: 'var(--bg3)', border: '1px solid var(--border2)',
              borderRadius: 14, fontSize: 14, fontWeight: 500, color: 'var(--text)',
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              opacity: isGoogleLoading ? 0.6 : 1, transition: 'background 0.15s',
            }}
          >
            {isGoogleLoading ? (
              <span>{t.auth.loggingIn}</span>
            ) : (
              <>
                <svg width="17" height="17" viewBox="0 0 18 18">
                  <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                  <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                  <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                  <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
                </svg>
                Pokračovať cez Google
              </>
            )}
          </button>

          {/* Register link */}
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text3)', margin: 0 }}>
            Nemáte účet?{' '}
            <button
              type="button"
              onClick={onNavigateRegister}
              style={{ color: 'var(--violet)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}
            >
              Registrovať sa →
            </button>
          </p>

        </div>
      </div>

      {/* PIN modal */}
      {pinModalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.6)', zIndex: 200 }}
          onClick={() => setPinModalOpen(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 320, padding: 24, borderRadius: 24, background: 'var(--bg2)', border: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', gap: 20 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: 40 }}>🔢</span>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 8, marginBottom: 0, color: 'var(--text)' }}>{t.auth.enterPinTitle}</h2>
              <p style={{ fontSize: 13, marginTop: 4, marginBottom: 0, color: 'var(--text3)' }}>{t.auth.pin4Digit}</p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
              {[0,1,2,3].map(i => (
                <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: i < pinValue.length ? 'var(--violet)' : 'var(--border2)', transition: 'background 0.15s' }} />
              ))}
            </div>

            {pinError && <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--red)', margin: 0 }}>{pinError}</p>}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((k, idx) => (
                <button
                  key={idx}
                  disabled={k === ''}
                  onClick={() => {
                    if (k === '⌫') { setPinValue(v => v.slice(0, -1)); setPinError(null) }
                    else if (k !== '' && pinValue.length < 4) {
                      const next = pinValue + String(k)
                      setPinValue(next)
                      if (next.length === 4) setTimeout(() => handlePinLogin(next), 100)
                    }
                  }}
                  style={{
                    height: 52, borderRadius: 12,
                    background: k === '' ? 'transparent' : 'var(--bg3)',
                    color: 'var(--text)', fontSize: 18, fontWeight: 600,
                    border: k === '' ? 'none' : '1px solid var(--border2)',
                    cursor: k === '' ? 'default' : 'pointer',
                    opacity: pinLoading || k === '' ? (k === '' ? 0 : 0.6) : 1,
                    fontFamily: 'inherit',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (k !== '') (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg4)' }}
                  onMouseLeave={e => { if (k !== '') (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg3)' }}
                >
                  {k}
                </button>
              ))}
            </div>

            <button
              onClick={() => setPinModalOpen(false)}
              style={{ fontSize: 13, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'center', fontFamily: 'inherit' }}
            >
              Zrušiť
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
