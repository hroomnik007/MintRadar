import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../i18n'

interface ConfirmDialogProps {
  open: boolean
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, message, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center fade-in"
      style={{ zIndex: 210 }}
    >
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        onClick={onCancel}
      />
      <div
        className="relative mx-4 w-full max-w-sm modal-in"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
        }}
      >
        <p style={{ color: 'var(--text)', fontSize: 16, fontWeight: 600, textAlign: 'center', margin: 0 }}>{message}</p>
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button
            onClick={onCancel}
            style={{ flex: 1, background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, minHeight: 44, fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {t.common.cancel}
          </button>
          <button
            onClick={onConfirm}
            style={{ flex: 1, background: '#f52e1d', color: 'white', border: 'none', borderRadius: 8, minHeight: 44, fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {t.common.delete}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
