import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

// D5 (UI/UX report 2026-11-22): one "back" link for the whole site, a chevron and the label ("‹ All mints", "‹ All
// modules"); they used to differ ("‹" chevron on Mint Detail, "←" arrow in Learn, no icon on the not-tracked page on
// phones). The page keeps its own class for the layout around it (md-back on Mint Detail, learn-back-link in Learn).
export function BackLink({ to, label, className }: { to: string; label: string; className: string }) {
  return (
    // aria-label: on phones the label is hidden and the chevron alone stayed without a name (M-B, review 2026-11-27,
    // axe link-name on /learn/*). It is the visible label itself, so the name and the text never disagree.
    <Link className={`back-link ${className}`} to={to} aria-label={label}>
      <ChevronLeft size={16} aria-hidden="true" className="back-link-icon" />
      <span className="back-link-label md-back-label">{label}</span>
    </Link>
  )
}
