import { useState, useEffect } from 'react'
import { X, Delete, Check } from 'lucide-react'
import { useTranslation } from '../i18n'

interface PinSetupModalProps {
  open: boolean
  onClose: () => void
  onSetPin: (pin: string) => Promise<void>
}

const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫']

export function PinSetupModal({ open, onClose, onSetPin }: PinSetupModalProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<'enter' | 'confirm' | 'success'>('enter')
  const [first, setFirst] = useState('')
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)
  const [saving, setSaving] = useState(false)

  // Keyboard input — must be before any conditional return
  useEffect(() => {
    if (!open || step === 'success') return
    const onKey = (e: KeyboardEvent) => {
      if (saving) return
      if (e.key >= '0' && e.key <= '9') {
        setPin(prev => prev.length >= 4 ? prev : prev + e.key)
      } else if (e.key === 'Backspace') {
        setPin(p => p.slice(0, -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, step, saving])

  // Pin completion logic — must be before any conditional return
  useEffect(() => {
    if (pin.length !== 4 || saving || step === 'success') return
    if (step === 'enter') {
      setFirst(pin)
      setTimeout(() => { setStep('confirm'); setPin('') }, 150)
    } else {
      if (pin !== first) {
        setShake(true)
        setTimeout(() => { setShake(false); setPin('') }, 600)
      } else {
        setSaving(true)
        onSetPin(pin).then(() => {
          setSaving(false)
          setStep('success')
          setTimeout(() => {
            setStep('enter'); setFirst(''); setPin('')
            onClose()
          }, 1500)
        })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  if (!open) return null

  function handleClose() {
    setStep('enter'); setFirst(''); setPin('')
    onClose()
  }

  if (step === 'success') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} />
        <div style={{
          position: 'relative', width: '100%', maxWidth: 340,
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 24, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
        }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(52,211,153,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Check size={28} color="#34d399" />
          </div>
          <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', textAlign: 'center' }}>{t.pin.pinSet}</p>
          <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center' }}>{t.pin.pinSetDesc}</p>
        </div>
      </div>
    )
  }

  const title = step === 'enter' ? t.pin.enterNew : t.pin.confirm
  const sub = step === 'enter' ? t.pin.choose : t.pin.confirmDesc

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }} onClick={handleClose} />
      <div style={{
        position: 'relative', width: '100%', maxWidth: 340,
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 24, overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{title}</h2>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4 }}><X size={18} /></button>
        </div>

        <div style={{ padding: '32px 24px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32 }}>
          <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center' }}>{sub}</p>

          <div style={{ display: 'flex', gap: 16 }} className={shake ? 'pin-shake' : ''}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{
                width: 16, height: 16, borderRadius: '50%',
                background: pin.length > i ? 'var(--violet)' : 'transparent',
                border: '2px solid ' + (pin.length > i ? 'var(--violet)' : 'var(--border2)'),
                transition: 'all 0.15s',
              }} />
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 64px)', gap: 10 }}>
            {KEYS.map((k, i) => (
              k === '' ? <div key={i} /> : (
                <button
                  key={i}
                  onClick={() => {
                    if (saving) return
                    if (k === '⌫') { setPin(p => p.slice(0, -1)); return }
                    if (pin.length < 4) setPin(p => p + k)
                  }}
                  style={{
                    width: 64, height: 64, borderRadius: '50%',
                    background: k === '⌫' ? 'transparent' : 'var(--bg3)',
                    border: k === '⌫' ? 'none' : '1px solid var(--border2)',
                    color: 'var(--text)', fontSize: k === '⌫' ? 18 : 20, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: saving ? 0.5 : 1,
                  }}
                  onPointerDown={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.15)')}
                  onPointerUp={e => (e.currentTarget.style.background = k === '⌫' ? 'transparent' : 'var(--bg3)')}
                >
                  {k === '⌫' ? <Delete size={18} /> : k}
                </button>
              )
            ))}
          </div>
        </div>

        <style>{`
          .pin-shake { animation: pinShake 0.5s ease-in-out; }
          @keyframes pinShake {
            0%,100% { transform: translateX(0); }
            20% { transform: translateX(-8px); }
            40% { transform: translateX(8px); }
            60% { transform: translateX(-8px); }
            80% { transform: translateX(8px); }
          }
        `}</style>
      </div>
    </div>
  )
}
