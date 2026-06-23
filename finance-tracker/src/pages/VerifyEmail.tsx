import { useEffect, useState } from 'react'
import { useTranslation } from '../i18n'
import { verifyEmail } from '../api/auth'

interface VerifyEmailPageProps {
  token: string
  onNavigateLogin: () => void
}

export function VerifyEmailPage({ token, onNavigateLogin }: VerifyEmailPageProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')

  useEffect(() => {
    verifyEmail(token)
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'))
  }, [token])

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div className="w-full flex flex-col items-center gap-6 text-center" style={{ maxWidth: '400px' }}>
        <img src="/logo.svg" alt="Finvu" className="w-16 h-16" />
        <h1 className="text-2xl font-bold text-[#E2D9F3]">{t.auth.verifyEmailTitle}</h1>

        {status === 'loading' && (
          <p className="text-[#9D84D4]">{t.auth.verifyingEmail}</p>
        )}
        {status === 'success' && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-4xl">✅</p>
            <p className="text-sm text-[#B8A3E8] leading-relaxed">{t.auth.verifyEmailSuccess}</p>
            <button
              onClick={onNavigateLogin}
              className="font-semibold text-[15px] text-white rounded-2xl transition-opacity hover:opacity-90 px-8"
              style={{ height: '48px', background: 'linear-gradient(135deg, #7C3AED, #6D28D9)', border: 'none', cursor: 'pointer' }}
            >
              {t.auth.login}
            </button>
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-col items-center gap-4">
            <p className="text-4xl">❌</p>
            <p className="text-sm text-[#F87171] leading-relaxed">{t.auth.verifyEmailError}</p>
            <button
              type="button"
              onClick={onNavigateLogin}
              className="text-[13px] text-[#A78BFA] hover:text-[#C4B5FD] transition-colors"
            >
              ← {t.auth.backToLogin}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
