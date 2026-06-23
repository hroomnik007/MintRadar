import { useEffect, useRef, useState } from 'react'
import { FileUp } from 'lucide-react'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  onImportCsv?: () => void
}

export function BottomSheet({ open, onClose, title, children, footer, onImportCsv }: BottomSheetProps) {
  const [translateY, setTranslateY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startYRef = useRef(0)
  const currentYRef = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) setTranslateY(0)
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleTouchStart = (e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY
    currentYRef.current = e.touches[0].clientY
    setIsDragging(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return
    const delta = e.touches[0].clientY - startYRef.current
    currentYRef.current = e.touches[0].clientY
    if (delta > 0) {
      setTranslateY(delta)
    }
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
    const delta = currentYRef.current - startYRef.current
    if (delta > 80) {
      setTranslateY(window.innerHeight)
      setTimeout(() => {
        onClose()
        setTranslateY(0)
      }, 250)
    } else {
      setTranslateY(0)
    }
  }

  const [isMobile] = useState(() => window.innerWidth < 768)

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        className={isMobile ? 'slide-up' : 'modal-in'}
        style={{
          background: 'var(--bg2)',
          border: '1px solid rgba(139,92,246,0.2)',
          borderRadius: isMobile ? '24px 24px 0 0' : 20,
          width: isMobile ? '100%' : 440,
          maxHeight: '90svh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 -8px 60px rgba(139,92,246,0.15)',
          transform: `translateY(${translateY}px)`,
          transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          touchAction: 'none',
        }}
      >
        {/* Drag handle — mobile only, touch area */}
        {isMobile && (
          <div
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{ padding: '12px 0 4px', cursor: 'grab', flexShrink: 0 }}
          >
            <div style={{
              width: 36, height: 4,
              background: 'var(--border)',
              borderRadius: 2,
              margin: '0 auto',
            }} />
          </div>
        )}

        {/* Header */}
        <div
          onTouchStart={isMobile ? handleTouchStart : undefined}
          onTouchMove={isMobile ? handleTouchMove : undefined}
          onTouchEnd={isMobile ? handleTouchEnd : undefined}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
            cursor: isMobile ? 'grab' : 'default',
          }}
        >
          <h2 style={{
            fontSize: 17, fontWeight: 700, color: 'var(--text)',
            fontFamily: "'DM Sans', sans-serif", margin: 0,
          }}>{title}</h2>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onImportCsv && isMobile && (
              <button
                type="button"
                onClick={onImportCsv}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 36, height: 36, borderRadius: 10,
                  background: 'rgba(139,92,246,0.1)',
                  border: '1px solid rgba(139,92,246,0.3)',
                  color: 'var(--violet)', cursor: 'pointer',
                }}
                title="Import CSV"
              >
                <FileUp size={17} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Zavrieť"
              style={{
                width: 30, height: 30, borderRadius: '50%',
                background: 'var(--bg3)', border: 'none',
                color: 'var(--text2)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14,
              }}
            >✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div style={{
            padding: '16px 24px',
            paddingBottom: isMobile
              ? 'calc(24px + env(safe-area-inset-bottom, 0px))'
              : '24px',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
