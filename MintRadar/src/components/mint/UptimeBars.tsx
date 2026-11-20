import { useState } from 'react'
import { dayTone, uptimeBarsSummary } from '@/utils/uptimeBars'
import './UptimeBars.css'

// 30 bars, one per UTC day, oldest first (2026-11-19 redesign, phase 3): quiet when the day was fine, loud when it was
// not, so a mint's bad days stand out on a page full of healthy ones. Data: /api/mints/known `uptimeDaily30`.
//
// `readouts` (Mint Detail only, owner 2026-11-20): with a mouse, hovering a bar shows that day's date, uptime and time
// down. A visual extra for pointer users only (touch has no hover, the cards are links): the whole set keeps its one
// summary sentence for assistive tech, and the day figures are in the History tab.

export function UptimeBars({ days, variant = 'card', className = '', readouts }: {
  days: ReadonlyArray<number | null> | null | undefined
  variant?: 'card' | 'wide'
  className?: string
  readouts?: ReadonlyArray<{ date: string; text: string }>
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (!days || days.length === 0) return null
  const n = days.length
  const tip = hover !== null && readouts?.[hover] ? readouts[hover] : null
  // Near either end the readout is pinned to that edge so it never sticks out of the panel.
  const tipAlign = hover === null ? 'mid' : hover < 3 ? 'start' : hover > n - 4 ? 'end' : 'mid'
  return (
    <div
      className={`uptime-bars uptime-bars-${variant}${readouts ? ' has-readouts' : ''} ${className}`.trim()}
      role="img"
      aria-label={uptimeBarsSummary(days)}
      data-testid="uptime-bars"
      onPointerMove={readouts ? e => {
        if (e.pointerType !== 'mouse') return
        // From the x position, so the gaps and the space above a short bar count as that day too.
        const r = e.currentTarget.getBoundingClientRect()
        if (r.width <= 0) return
        setHover(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))))
      } : undefined}
      onPointerLeave={readouts ? () => setHover(null) : undefined}
    >
      {days.map((d, i) => {
        const tone = dayTone(d)
        // A bad day is drawn as tall as its uptime (at least a stub), so a 40 % day reads lower than a 90 % one.
        const h = tone === 'ok' || tone === 'none' ? 100 : Math.max(22, d ?? 0)
        return (
          <i
            key={i}
            className={`ub-${tone}${hover === i ? ' is-hover' : ''}`}
            style={{ height: `${h}%`, ['--d' as string]: i }}
          />
        )
      })}
      {tip && hover !== null && (
        <div
          className={`ub-tip ub-tip-${tipAlign}`}
          style={{ ['--x' as string]: `${((hover + 0.5) / n) * 100}%` }}
          aria-hidden="true"
          data-testid="uptime-day-readout"
        >
          <span className="ub-tip-date">{tip.date}</span>
          <span className="ub-tip-text">{tip.text}</span>
        </div>
      )}
    </div>
  )
}
