import type { ReactNode } from 'react'
import './KeyTakeaway.css'

// Shared "Key takeaway" callout used by Learn modules that have one
// (Module 1, 2, 4 as of the initial content draft). Renders its children as
// a blockquote inside a copper-accented box, consistent with the app's
// patina/copper design tokens.
export function KeyTakeaway({ children }: { children: ReactNode }) {
  return (
    <div className="key-takeaway">
      <div className="key-takeaway-label">Key takeaway</div>
      <blockquote className="key-takeaway-quote">{children}</blockquote>
    </div>
  )
}
