import { useState } from 'react'
import { updateUserSettings } from '../api/auth'
import { useAuth } from '../context/AuthContext'
import { useTranslation } from '../i18n'

interface Props {
  onDone: () => void
}

export function TrackingDateOnboarding({ onDone }: Props) {
  const { t } = useTranslation()
  const { refreshUser } = useAuth()
  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d.toISOString().split('T')[0]
  })
  const [saving, setSaving] = useState(false)

  async function handleContinue() {
    setSaving(true)
    try {
      await updateUserSettings({ trackingStartDate: date })
      await refreshUser()
    } catch { /* non-critical */ }
    finally {
      setSaving(false)
      onDone()
    }
  }

  function handleSkip() {
    onDone()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px 20px',
    }}>
      <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>

        <img src="/logo.svg" alt="Finvu" style={{ width: 72, height: 72, borderRadius: 18 }} />

        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '0 0 10px' }}>
            {t.onboarding.trackingTitle}
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text2)', margin: 0, lineHeight: 1.6 }}>
            {t.onboarding.trackingSubtitle}
          </p>
        </div>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {t.onboarding.trackingLabel}
          </label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '14px 16px',
              fontSize: 15,
              color: 'var(--text)',
              width: '100%',
              outline: 'none',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
              colorScheme: 'dark',
            }}
          />
          <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>
            {t.onboarding.trackingNote}
          </p>
        </div>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={handleContinue}
            disabled={saving || !date}
            style={{
              width: '100%',
              padding: '15px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
              color: 'white',
              fontSize: 15,
              fontWeight: 600,
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: (saving || !date) ? 0.6 : 1,
              boxShadow: '0 4px 16px rgba(124,58,237,0.4)',
            }}
          >
            {saving ? t.common.saving : t.common.continueArrow}
          </button>
          <button
            onClick={handleSkip}
            disabled={saving}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: 12,
              background: 'transparent',
              color: 'var(--text3)',
              fontSize: 14,
              fontWeight: 500,
              border: '1px solid var(--border)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t.onboarding.skip}
          </button>
        </div>
      </div>
    </div>
  )
}
