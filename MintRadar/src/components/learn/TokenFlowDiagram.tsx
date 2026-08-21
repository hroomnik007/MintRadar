import { Fragment } from 'react'
import './LearnDiagrams.css'

// Module 1 — the four stages a sat passes through in Cashu. Laid out as
// styled step boxes with SVG glyphs rather than one wide SVG so the labels
// stay at real CSS font sizes and the row can reflow to a column on mobile.

function IcBolt() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13 3 7 13h4l-1 8 6-10h-4l1-8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

// Solid coin behind a dashed ring — the mint signs what it cannot see.
function IcBlindSignature() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.6" stroke="currentColor" strokeWidth="1" strokeDasharray="2.4 2.6" opacity="0.55" />
      <circle cx="12" cy="12" r="6.4" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1" opacity="0.45" />
    </svg>
  )
}

function IcToken() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.8" y="6.6" width="18.4" height="10.8" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.1" opacity="0.6" />
      <path d="M6.2 9.8v4.4M17.8 9.8v4.4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.35" />
    </svg>
  )
}

function IcShare() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6.2" cy="12" r="2.7" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="17.6" cy="6.4" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="17.6" cy="17.6" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8.6 10.8l6.8-3.3M8.6 13.2l6.8 3.3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}

function FlowArrow() {
  return (
    <div className="flow-arrow" aria-hidden="true">
      <svg viewBox="0 0 24 12" fill="none">
        <path d="M2 6h18" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M16.4 2.4 20 6l-3.6 3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

const STEPS = [
  { icon: <IcBolt />, label: 'You send BTC', tone: 'green' },
  { icon: <IcBlindSignature />, label: 'Mint issues blind signature', tone: 'copper' },
  { icon: <IcToken />, label: 'You hold ecash token', tone: 'green' },
  { icon: <IcShare />, label: 'Send to anyone', tone: 'green' },
] as const

export function TokenFlowDiagram() {
  return (
    <div className="learn-diagram flow-diagram" role="img" aria-label="Token flow: you send BTC, the mint issues a blind signature, you hold an ecash token, and you can send it to anyone.">
      {STEPS.map((step, i) => (
        <Fragment key={step.label}>
          <div className="flow-step">
            <span className={`flow-step-icon flow-tone-${step.tone}`}>{step.icon}</span>
            <span className="flow-step-label">{step.label}</span>
          </div>
          {i < STEPS.length - 1 && <FlowArrow />}
        </Fragment>
      ))}
    </div>
  )
}
