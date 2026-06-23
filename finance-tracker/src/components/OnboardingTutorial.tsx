import { useState, useEffect } from 'react'
import { X, ChevronRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { usePinLock } from '../hooks/usePinLock'
import { PinSetupModal } from './PinSetupModal'
import { savePin, webauthnRegisterOptions, webauthnRegisterVerify } from '../api/auth'
import { useTranslation } from '../i18n'

const STEP_EMOJIS = ['🎉', '💰', '📊', '🐷', '🏠', '⚙️', '🔐']

export function useOnboarding() {
  const { user, isLoading, isGuest, completeOnboarding: saveOnboarding } = useAuth()
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    if (isLoading) return
    if (isGuest && !user?.isDemo) { setShowOnboarding(false); return }
    if (user && !user.onboardingComplete) setShowOnboarding(true)
    else setShowOnboarding(false)
  }, [user, isLoading, isGuest])

  async function completeOnboarding() {
    setShowOnboarding(false)
    await saveOnboarding()
  }

  return { showOnboarding, completeOnboarding }
}

interface OnboardingTutorialProps {
  onComplete: () => void
}

export function OnboardingTutorial({ onComplete }: OnboardingTutorialProps) {
  const [step, setStep] = useState(0)
  const [exiting, setExiting] = useState(false)
  const { user } = useAuth()
  const { setupPin } = usePinLock()
  const { t } = useTranslation()

  const STEPS = [
    { title: t.onboarding.step0Title, description: t.onboarding.step0Desc, emoji: STEP_EMOJIS[0] },
    { title: t.onboarding.step1Title, description: t.onboarding.step1Desc, emoji: STEP_EMOJIS[1] },
    { title: t.onboarding.step2Title, description: t.onboarding.step2Desc, emoji: STEP_EMOJIS[2] },
    { title: t.onboarding.step3Title, description: t.onboarding.step3Desc, emoji: STEP_EMOJIS[3] },
    { title: t.onboarding.step4Title, description: t.onboarding.step4Desc, emoji: STEP_EMOJIS[4] },
    { title: t.onboarding.step5Title, description: t.onboarding.step5Desc, emoji: STEP_EMOJIS[5] },
    { title: t.onboarding.step6Title, description: t.onboarding.step6Desc, emoji: STEP_EMOJIS[6] },
  ]
  const [pinSetupOpen, setPinSetupOpen] = useState(false)
  const [webauthnDone, setWebauthnDone] = useState(false)
  const [webauthnLoading, setWebauthnLoading] = useState(false)
  const [webauthnError, setWebauthnError] = useState<string | null>(null)
  const [pinDone, setPinDone] = useState(false)

  const isLastStep = step === STEPS.length - 1
  const isLoginMethodStep = step === STEPS.length - 1

  function handleNext() {
    if (isLastStep) {
      handleComplete()
    } else {
      setStep(s => s + 1)
    }
  }

  function handleComplete() {
    setExiting(true)
    setTimeout(onComplete, 300)
  }

  const handleWebAuthnSetup = async () => {
    setWebauthnLoading(true)
    setWebauthnError(null)
    try {
      const { startRegistration } = await import('@simplewebauthn/browser')
      const options = await webauthnRegisterOptions()
      const response = await startRegistration({ optionsJSON: options as any })
      await webauthnRegisterVerify(response as any)
      setWebauthnDone(true)
      if (user?.email) localStorage.setItem(`webauthn_enabled_${user.email}`, '1')
    } catch (e: unknown) {
      setWebauthnError((e as Error)?.message ?? t.auth.registerFailed)
    } finally {
      setWebauthnLoading(false)
    }
  }

  const current = STEPS[step]

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          backgroundColor: 'rgba(13,10,26,0.85)',
          backdropFilter: 'blur(6px)',
          opacity: exiting ? 0 : 1,
          transition: 'opacity 0.3s ease',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '420px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '24px',
            padding: '32px 28px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
            position: 'relative',
          }}
        >
          {/* Close button */}
          <button
            onClick={handleComplete}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              background: 'rgba(255,255,255,0.08)',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#9D84D4',
            }}
          >
            <X size={16} />
          </button>

          {/* Step indicator */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '28px' }}>
            {STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  height: '3px',
                  flex: 1,
                  borderRadius: '2px',
                  backgroundColor: i <= step ? '#7C3AED' : 'var(--border-subtle)',
                  transition: 'background-color 0.3s ease',
                }}
              />
            ))}
          </div>

          {/* Emoji */}
          <div style={{ fontSize: '56px', marginBottom: '20px', textAlign: 'center' }}>
            {current.emoji}
          </div>

          {/* Title */}
          <h2 style={{
            fontSize: '22px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: '12px',
            textAlign: 'center',
          }}>
            {current.title}
          </h2>

          {/* Description */}
          <p style={{
            fontSize: '15px',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            textAlign: 'center',
            marginBottom: '24px',
          }}>
            {current.description}
          </p>

          {/* Login method selection step */}
          {isLoginMethodStep && (
            user?.isDemo ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px', padding: '20px', borderRadius: '16px', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', textAlign: 'center' }}>
                <span style={{ fontSize: 36 }}>🚀</span>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{t.onboarding.demoTitle}</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{t.onboarding.demoDesc}</p>
                <button
                  onClick={() => { window.location.hash = 'register' }}
                  style={{ background: 'linear-gradient(135deg, #7C3AED, #6D28D9)', color: 'white', border: 'none', borderRadius: '12px', padding: '12px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  {t.onboarding.demoBtn}
                </button>
              </div>
            ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
              {/* Email+heslo — already done */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '14px 16px',
                  borderRadius: '16px',
                  background: 'rgba(52,211,153,0.08)',
                  border: '1px solid rgba(52,211,153,0.3)',
                }}
              >
                <span style={{ fontSize: 24 }}>✉️</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{t.onboarding.emailLabel}</p>
                  <p style={{ fontSize: 12, color: '#34d399' }}>{t.onboarding.emailActive}</p>
                </div>
              </div>

              {/* PIN */}
              <button
                onClick={() => { if (!pinDone) setPinSetupOpen(true) }}
                disabled={pinDone}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '14px 16px',
                  borderRadius: '16px',
                  background: pinDone ? 'rgba(52,211,153,0.08)' : 'var(--bg-elevated)',
                  border: pinDone ? '1px solid rgba(52,211,153,0.3)' : '1px solid var(--border-subtle)',
                  cursor: pinDone ? 'default' : 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'all 0.2s ease',
                }}
              >
                <span style={{ fontSize: 24 }}>🔢</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{t.onboarding.pinLabel}</p>
                  <p style={{ fontSize: 12, color: pinDone ? '#34d399' : 'var(--text-muted)' }}>
                    {pinDone ? t.onboarding.pinSetLabel : t.onboarding.pinDesc}
                  </p>
                </div>
                {!pinDone && <span style={{ fontSize: 12, color: '#A78BFA', fontWeight: 600 }}>{t.onboarding.setupBtn}</span>}
              </button>

              {/* WebAuthn */}
              {typeof window !== 'undefined' && !!window.PublicKeyCredential && (
                <button
                  onClick={handleWebAuthnSetup}
                  disabled={webauthnDone || webauthnLoading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 16px',
                    borderRadius: '16px',
                    background: webauthnDone ? 'rgba(52,211,153,0.08)' : 'var(--bg-elevated)',
                    border: webauthnDone ? '1px solid rgba(52,211,153,0.3)' : '1px solid var(--border-subtle)',
                    cursor: webauthnDone || webauthnLoading ? 'default' : 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    opacity: webauthnLoading ? 0.7 : 1,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <span style={{ fontSize: 24 }}>🔐</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{t.onboarding.biometryLabel}</p>
                    <p style={{ fontSize: 12, color: webauthnDone ? '#34d399' : 'var(--text-muted)' }}>
                      {webauthnDone ? t.onboarding.biometrySetLabel : webauthnLoading ? t.onboarding.biometryLoading : t.onboarding.biometryDesc}
                    </p>
                  </div>
                  {!webauthnDone && !webauthnLoading && <span style={{ fontSize: 12, color: '#A78BFA', fontWeight: 600 }}>{t.onboarding.setupBtn}</span>}
                </button>
              )}
              {webauthnError && (
                <p style={{ fontSize: 12, color: '#f87171', textAlign: 'center' }}>{webauthnError}</p>
              )}
            </div>
            )
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleComplete}
              style={{
                flex: 1,
                height: '48px',
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                borderRadius: '14px',
                color: 'var(--text-muted)',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              {t.onboarding.skip}
            </button>
            <button
              onClick={handleNext}
              style={{
                flex: 2,
                height: '48px',
                background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
                border: 'none',
                borderRadius: '14px',
                color: 'white',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              {isLastStep ? t.onboarding.start : t.onboarding.next}
              {!isLastStep && <ChevronRight size={16} />}
            </button>
          </div>
        </div>
      </div>

      <PinSetupModal
        open={pinSetupOpen}
        onClose={() => setPinSetupOpen(false)}
        onSetPin={async (pin) => {
          setupPin(pin)
          try { await savePin(pin) } catch { /* ignore */ }
          if (user?.email) localStorage.setItem(`pin_enabled_${user.email}`, '1')
          setPinDone(true)
          setPinSetupOpen(false)
        }}
      />
    </>
  )
}
