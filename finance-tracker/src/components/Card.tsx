import type { CSSProperties, ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  style?: CSSProperties
  className?: string
  onClick?: () => void
}

export function Card({ children, style, className, onClick }: CardProps) {
  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        boxShadow: 'var(--card-shadow)',
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
