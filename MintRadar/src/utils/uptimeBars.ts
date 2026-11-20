// Helpers of the 30 daily uptime bars (components/mint/UptimeBars.tsx).

/** Bar class of one day: fine (>= 99.5 %), degraded (>= 95 %), down (below), or no probe that day. */
export function dayTone(pct: number | null): 'ok' | 'warn' | 'down' | 'none' {
  if (pct === null) return 'none'
  if (pct >= 99.5) return 'ok'
  if (pct >= 95) return 'warn'
  return 'down'
}

/** One sentence for assistive tech: how many of the probed days were fine and the lowest day. */
export function uptimeBarsSummary(days: ReadonlyArray<number | null>): string {
  const probed = days.filter((d): d is number => d !== null)
  if (probed.length === 0) return 'Uptime per day, last 30 days: no checks yet'
  const fine = probed.filter(d => d >= 99.5).length
  const lowest = Math.min(...probed)
  const rest = probed.length - fine
  return rest === 0
    ? `Uptime per day, last 30 days: every checked day 99.5 % or more`
    : `Uptime per day, last 30 days: ${fine} of ${probed.length} checked days 99.5 % or more, lowest ${lowest} %`
}

export interface DayOutage { startedAt: string; durationMs: number; ongoing?: boolean }

const DAY_MS = 86_400_000

/** "21 Nov" of a UTC day (the date under the bars uses the same form). */
const dayLabel = (dayStart: number): string =>
  new Date(dayStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "45 min", "3h 20m": time down within one day (never more than 24 h). */
function downText(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/**
 * The hover readout of each daily bar on Mint Detail (owner, 2026-11-20): the date and the day's uptime, plus how long
 * the mint was down that day when an outage (two failed checks in a row or more, /api/mints/outages) fell on it. The
 * outages are cut at midnight UTC, so one that ran over two days counts on each day for its own part. Oldest first, the
 * last entry is today (the same order as `uptimeDaily30`).
 */
export function uptimeDayReadouts(
  days: ReadonlyArray<number | null>,
  outages: ReadonlyArray<DayOutage> | null | undefined,
  now: number,
): Array<{ date: string; text: string }> {
  const today = Math.floor(now / DAY_MS) * DAY_MS
  const n = days.length
  return days.map((pct, i) => {
    const start = today - (n - 1 - i) * DAY_MS
    const end = start + DAY_MS
    let down = 0, count = 0, ongoing = false
    for (const o of outages ?? []) {
      const s = Date.parse(o.startedAt)
      if (!Number.isFinite(s)) continue
      const e = s + Math.max(0, o.durationMs)
      const overlap = Math.min(e, end, now) - Math.max(s, start)
      if (overlap <= 0) continue
      down += overlap
      count++
      if (o.ongoing && e >= Math.min(end, now) - 60_000) ongoing = true
    }
    const date = i === n - 1 ? `Today, ${dayLabel(start)}` : dayLabel(start)
    if (pct === null) return { date, text: 'No checks this day' }
    let text = `${pct}% uptime`
    if (down > 0) {
      text += `, down ${downText(down)}`
      if (count > 1) text += ` in ${count} outages`
      if (ongoing) text += ', still down'
    }
    return { date, text }
  })
}
