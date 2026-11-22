import { useEffect, useRef, useState } from 'react'
import { dayTone, uptimeBarsSummary } from '@/utils/uptimeBars'
import './UptimeBars.css'

// 30 bars, one per UTC day, oldest first (2026-11-19 redesign, phase 3): quiet when the day was fine, loud when it was
// not, so a mint's bad days stand out on a page full of healthy ones. Data: /api/mints/known `uptimeDaily30`.
//
// `readouts` (Mint Detail only, owner 2026-11-20): with a mouse, hovering a bar shows that day's date, uptime and time
// down. A visual extra for pointer users only: the whole set keeps its one summary sentence for assistive tech, and the
// day figures are in the History tab. On touch (N1, UI/UX report 2026-11-22; Android has no hover) a tap on a bar shows
// the same readout and a slide along the bars moves it; it goes away after a few seconds or on a tap anywhere else.
// The mouse behaviour is unchanged. The cards have no readouts (they are links), so nothing changes there.

/** How long a readout opened by a tap stays (ms). */
export const TOUCH_READOUT_MS = 4000

export function UptimeBars({ days, variant = 'card', className = '', readouts, unit = 'day' }: {
  days: ReadonlyArray<number | null> | null | undefined
  variant?: 'card' | 'wide'
  className?: string
  readouts?: ReadonlyArray<{ date: string; text: string }>
  /** 'hour': the 24 hourly bars of the home cards (owner 2026-11-22); same colours, same thresholds. */
  unit?: 'day' | 'hour'
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [touchOpen, setTouchOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  // A readout opened by touch closes on a tap outside the bars and after TOUCH_READOUT_MS.
  useEffect(() => {
    if (!touchOpen) return
    const t = window.setTimeout(() => { setTouchOpen(false); setHover(null) }, TOUCH_READOUT_MS)
    const outside = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return
      setTouchOpen(false); setHover(null)
    }
    document.addEventListener('pointerdown', outside)
    return () => { window.clearTimeout(t); document.removeEventListener('pointerdown', outside) }
  }, [touchOpen, hover])
  if (!days || days.length === 0) return null
  const n = days.length
  const dayAt = (el: HTMLElement, clientX: number): number | null => {
    // From the x position, so the gaps and the space above a short bar count as that day too.
    const r = el.getBoundingClientRect()
    if (r.width <= 0) return null
    return Math.min(n - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * n)))
  }
  const tip = hover !== null && readouts?.[hover] ? readouts[hover] : null
  // Near either end the readout is pinned to that edge so it never sticks out of the panel.
  const tipAlign = hover === null ? 'mid' : hover < 3 ? 'start' : hover > n - 4 ? 'end' : 'mid'
  return (
    <div
      className={`uptime-bars uptime-bars-${variant}${readouts ? ' has-readouts' : ''} ${className}`.trim()}
      role="img"
      aria-label={uptimeBarsSummary(days, unit)}
      style={{ ['--n' as string]: n }}
      data-unit={unit}
      data-testid="uptime-bars"
      ref={rootRef}
      onPointerMove={readouts ? e => {
        if (e.pointerType !== 'mouse' && !touchOpen) return
        const i = dayAt(e.currentTarget, e.clientX)
        if (i !== null) setHover(i)
      } : undefined}
      onPointerDown={readouts ? e => {
        if (e.pointerType === 'mouse') return
        const i = dayAt(e.currentTarget, e.clientX)
        if (i === null) return
        setHover(i)
        setTouchOpen(true)
      } : undefined}
      onPointerLeave={readouts ? e => { if (e.pointerType === 'mouse') setHover(null) } : undefined}
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
