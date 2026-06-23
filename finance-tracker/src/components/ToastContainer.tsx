import type { Toast } from '../hooks/useToast'

interface ToastContainerProps {
  toasts: Toast[]
}

export function ToastContainer({ toasts }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] flex flex-col gap-2 w-full max-w-[390px] px-4 lg:left-[calc(50%+120px)]">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="px-4 py-3 text-sm text-white shadow-xl fade-in"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-medium)',
            borderRadius: '16px',
            boxShadow: 'var(--shadow-elevated)',
          }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  )
}
