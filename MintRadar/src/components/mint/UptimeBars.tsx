import { dayTone, uptimeBarsSummary } from '@/utils/uptimeBars'
import './UptimeBars.css'

// 30 bars, one per UTC day, oldest first (2026-11-19 redesign, phase 3): quiet when the day was fine, loud when it was
// not, so a mint's bad days stand out on a page full of healthy ones. Data: /api/mints/known `uptimeDaily30`.

export function UptimeBars({ days, variant = 'card', className = '' }: {
  days: ReadonlyArray<number | null> | null | undefined
  variant?: 'card' | 'wide'
  className?: string
}) {
  if (!days || days.length === 0) return null
  return (
    <div className={`uptime-bars uptime-bars-${variant} ${className}`.trim()} role="img" aria-label={uptimeBarsSummary(days)} data-testid="uptime-bars">
      {days.map((d, i) => {
        const tone = dayTone(d)
        // A bad day is drawn as tall as its uptime (at least a stub), so a 40 % day reads lower than a 90 % one.
        const h = tone === 'ok' || tone === 'none' ? 100 : Math.max(22, d ?? 0)
        return <i key={i} className={`ub-${tone}`} style={{ height: `${h}%`, ['--d' as string]: i }} />
      })}
    </div>
  )
}
