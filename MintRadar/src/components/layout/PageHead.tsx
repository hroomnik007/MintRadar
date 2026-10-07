import type { ReactNode } from 'react'
import './PageHead.css'

// One page header for every page: h1, one plain line, and a small radar motif on the right
// (same chrome width and gutters as the navbar and the card grids below it).
export function PageHead({ title, srTitle, description, className = '', titleClassName = '', descriptionClassName = '' }: {
  title: string
  /** Extra text for assistive tech and search engines, appended to the visible title. */
  srTitle?: string
  description: ReactNode
  className?: string
  titleClassName?: string
  descriptionClassName?: string
}) {
  return (
    <div className={`page-head ${className}`.trim()}>
      <div className="page-head-text">
        <h1 className={`page-head-title ${titleClassName}`.trim()}>
          {title}
          {srTitle && <span className="sr-only"> — {srTitle}</span>}
        </h1>
        <p className={`page-head-desc ${descriptionClassName}`.trim()}>{description}</p>
      </div>
      <svg className="page-head-radar" viewBox="0 0 120 56" fill="none" aria-hidden="true" focusable="false">
        <circle cx="60" cy="28" r="24" stroke="var(--green)" opacity=".25" />
        <circle cx="60" cy="28" r="14" stroke="var(--green)" opacity=".4" />
        <circle cx="60" cy="28" r="3" fill="var(--green-bright)" />
        <path d="M5 40l30-14 25 2 30 12 25-8" stroke="var(--green)" opacity=".35" />
      </svg>
    </div>
  )
}
