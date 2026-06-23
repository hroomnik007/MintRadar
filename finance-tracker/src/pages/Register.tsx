import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useAuth } from '../context/AuthContext'
import { LanguageSwitcher } from '../components/LanguageSwitcher'

interface RegisterPageProps {
  onNavigateLogin: () => void
  onNavigatePrivacyPolicy: () => void
}

export function RegisterPage({ onNavigateLogin, onNavigatePrivacyPolicy }: RegisterPageProps) {
  const { t } = useTranslation()
  const { register } = useAuth()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [gdprConsent, setGdprConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [verificationSent, setVerificationSent] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return (localStorage.getItem('theme_preference') as 'dark' | 'light') ?? 'dark' } catch { return 'dark' }
  })

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('theme_preference', next)
    document.documentElement.setAttribute('data-theme', next)
  }

  const handleRegister = async () => {
    setError(null)
    if (!name.trim() || name.trim().length < 2) { setError(t.auth.nameMin2); return }
    if (!email) { setError(t.auth.enterEmail); return }
    if (password.length < 8) { setError(t.auth.passwordMin8); return }
    if (password !== confirmPassword) { setError(t.settings.passwordMismatch); return }
    if (!gdprConsent) { setError(t.auth.gdprRequired); return }

    setIsLoading(true)
    try {
      await register(email, password, name.trim(), gdprConsent)
      setVerificationSent(true)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? t.auth.registerFailed)
    } finally {
      setIsLoading(false)
    }
  }

  const inp = (name: string, hasRight = false): React.CSSProperties => ({
    width: '100%',
    background: 'var(--bg3)',
    color: 'var(--text)',
    borderRadius: 13,
    padding: hasRight ? '0 44px 0 16px' : '0 16px',
    height: 50,
    fontSize: 15,
    fontFamily: "'DM Sans', sans-serif",
    border: `1.5px solid ${focused === name ? 'var(--violet)' : 'var(--border2)'}`,
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    boxShadow: focused === name ? '0 0 0 3px rgba(139,92,246,0.1)' : 'none',
    boxSizing: 'border-box' as const,
  })

  if (verificationSent) {
    return (
      <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', background: 'var(--bg)' }}>
        <div className="fu" style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16,
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 24, padding: 32,
          boxShadow: 'var(--shadow-elevated)',
        }}>
          <p style={{ fontSize: 48, margin: 0 }}>📧</p>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{t.auth.verifyEmailTitle}</h2>
          <p style={{ fontSize: 14, color: 'var(--text3)', lineHeight: 1.6, maxWidth: 320, margin: 0 }}>{t.auth.verificationSent}</p>
          <button
            type="button"
            onClick={onNavigateLogin}
            style={{ fontSize: 14, fontWeight: 500, color: 'var(--violet)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {t.auth.backToLogin}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>

      {/* Atmospheric blob */}
      <div style={{
        position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)',
        width: 600, height: 400, borderRadius: '50%', pointerEvents: 'none', zIndex: 0,
        background: 'radial-gradient(circle,rgba(139,92,246,0.1) 0%,transparent 70%)',
        filter: 'blur(40px)',
      }} />

      {/* Top controls: language switcher + theme toggle */}
      <div style={{ position: 'fixed', top: 16, right: 16, display: 'flex', alignItems: 'center', gap: 8, zIndex: 100 }}>
        <LanguageSwitcher />
        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? t.auth.switchToLight : t.auth.switchToDark}
          style={{
            width: 38, height: 38, borderRadius: '50%',
            background: 'var(--bg2)', border: '1px solid var(--border)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, flexShrink: 0,
          }}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>

      <div className="fade-up" style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 1 }}>

        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <img src="/logo.svg" alt="Finvu" style={{ width: 72, height: 72, borderRadius: 18 }} />
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.5px' }}>Finvu</div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            {t.nav.appTagline.toUpperCase()}
          </div>
        </div>

        {/* Form card */}
        <div className="fu" style={{
          width: '100%',
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 24,
          padding: 26,
          boxShadow: 'var(--shadow-elevated)',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>

          {error && (
            <div style={{ borderRadius: 12, padding: '12px 16px', fontSize: 14, background: 'rgba(248,113,113,0.12)', color: '#F87171', border: '1px solid rgba(248,113,113,0.3)' }}>
              {error}
            </div>
          )}

          {/* Name */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label className="form-label">MENO</label>
            <input
              type="text"
              placeholder="Vaše meno"
              value={name}
              onChange={e => setName(e.target.value)}
              onFocus={() => setFocused('name')}
              onBlur={() => setFocused(null)}
              style={inp('name')}
            />
          </div>

          {/* Email */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label className="form-label">{t.auth.email}</label>
            <input
              type="email"
              placeholder="vas@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused(null)}
              style={inp('email')}
            />
          </div>

          {/* Password */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label className="form-label">{t.auth.password}</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="min. 8 znakov"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                style={inp('password', true)}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? t.auth.hidePasswordLabel : t.auth.showPasswordLabel}
                style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text3)', display: 'flex', alignItems: 'center', padding: 2,
                }}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          {/* Confirm password */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <label className="form-label">{t.auth.confirmPassword}</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showConfirm ? 'text' : 'password'}
                placeholder="••••••••"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                onFocus={() => setFocused('confirm')}
                onBlur={() => setFocused(null)}
                onKeyDown={e => e.key === 'Enter' && handleRegister()}
                style={inp('confirm', true)}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowConfirm(v => !v)}
                aria-label={showConfirm ? 'Skryť heslo' : 'Zobraziť heslo'}
                style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text3)', display: 'flex', alignItems: 'center', padding: 2,
                }}
              >
                {showConfirm ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          {/* GDPR */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <input
              type="checkbox"
              id="gdpr"
              checked={gdprConsent}
              onChange={e => setGdprConsent(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--violet)', cursor: 'pointer', marginTop: 2, flexShrink: 0 }}
            />
            <label htmlFor="gdpr" style={{ fontSize: 13, color: 'var(--text3)', cursor: 'pointer', lineHeight: 1.5 }}>
              {t.auth.gdprConsent}{' '}
              <button
                type="button"
                onClick={onNavigatePrivacyPolicy}
                style={{ color: 'var(--violet)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0, fontFamily: 'inherit' }}
              >
                ({t.auth.privacyPolicy})
              </button>
            </label>
          </div>

          {/* Register button */}
          <button
            type="button"
            onClick={handleRegister}
            disabled={isLoading || !gdprConsent}
            style={{
              marginTop: 4, height: 50,
              background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
              border: 'none', borderRadius: 13,
              width: '100%', fontSize: 15, fontWeight: 700,
              color: 'white', cursor: (isLoading || !gdprConsent) ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: (isLoading || !gdprConsent) ? 0.55 : 1,
              transition: 'opacity 0.15s',
              boxShadow: (!isLoading && gdprConsent) ? '0 4px 20px rgba(139,92,246,0.4)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {isLoading ? (
              <>
                <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', animation: 'spin 0.7s linear infinite' }} />
                {t.common.saving}
              </>
            ) : t.auth.registerArrow}
          </button>

          {/* Login link */}
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text3)', margin: 0 }}>
            Máte účet?{' '}
            <button
              type="button"
              onClick={onNavigateLogin}
              style={{ color: 'var(--violet)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}
            >
              {t.auth.login} →
            </button>
          </p>

        </div>
      </div>
    </div>
  )
}
