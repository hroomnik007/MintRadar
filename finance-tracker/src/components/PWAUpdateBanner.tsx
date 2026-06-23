import { useRegisterSW } from 'virtual:pwa-register/react'
import { useTranslation } from '../i18n'

export function PWAUpdateBanner() {
  const { t } = useTranslation()
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
      background: 'var(--violet)', color: 'white',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '10px 16px', fontSize: 14, fontWeight: 500,
    }}>
      <span>{t.common.updateAvailable}</span>
      <button
        onClick={() => updateServiceWorker(true)}
        style={{
          background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
          color: 'white', borderRadius: 8, padding: '4px 12px',
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}
      >
        {t.common.updateBtn}
      </button>
    </div>
  )
}
