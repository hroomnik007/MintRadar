// Helpers of the 30 daily uptime bars (components/mint/UptimeBars.tsx).

/** Bar class of one day: fine (>= 99.5 %), degraded (>= 95 %), down (below), or no probe that day. */
export function dayTone(pct: number | null): 'ok' | 'warn' | 'down' | 'none' {
  if (pct === null) return 'none'
  if (pct >= 99.5) return 'ok'
  if (pct >= 95) return 'warn'
  return 'down'
}

/** One sentence for assistive tech: how many of the probed days (or hours, the home cards) were fine and the lowest. */
export function uptimeBarsSummary(days: ReadonlyArray<number | null>, unit: 'day' | 'hour' = 'day'): string {
  const head = unit === 'hour' ? 'Uptime per hour, last 24 hours' : 'Uptime per day, last 30 days'
  const word = unit === 'hour' ? 'hour' : 'day'
  const probed = days.filter((d): d is number => d !== null)
  if (probed.length === 0) return `${head}: no checks yet`
  const fine = probed.filter(d => d >= 99.5).length
  const lowest = Math.min(...probed)
  const rest = probed.length - fine
  return rest === 0
    ? `${head}: every checked ${word} 99.5 % or more`
    : `${head}: ${fine} of ${probed.length} checked ${word}s 99.5 % or more, lowest ${lowest} %`
}

export interface DayOutage { startedAt: string; durationMs: number; ongoing?: boolean }

const DAY_MS = 86_400_000

// One formatter for the whole module (P-A, review 2026-11-27): toLocaleDateString / toLocaleTimeString with options
// build a new Intl.DateTimeFormat on every call, and the readouts of all cards and bars made thousands of them per
// render (about 600 ms of main thread on a phone for the home cards alone).
const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "21 Nov" of a UTC day (the date under the bars uses the same form). */
const dayLabel = (dayStart: number): string => DAY_LABEL.format(dayStart)

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
/** The UTC day of daily bar `i` of `n` (the last bar is today): [start, end) in ms. */
export function utcDayOfBar(i: number, n: number, now: number): { start: number; end: number } {
  const start = Math.floor(now / DAY_MS) * DAY_MS - (n - 1 - i) * DAY_MS
  return { start, end: start + DAY_MS }
}

/** Whether an outage overlaps [start, end) (an ongoing one runs to `now`). */
export function outageOverlaps(o: DayOutage, start: number, end: number, now: number): boolean {
  const s = Date.parse(o.startedAt)
  if (!Number.isFinite(s)) return false
  const e = s + Math.max(0, o.durationMs)
  return Math.min(e, end, now) - Math.max(s, start) > 0
}

/** Per daily bar: whether an outage fell on that UTC day (Mint Detail opens it in the History tab, owner 2026-11-26). */
export function outageDays(n: number, outages: ReadonlyArray<DayOutage> | null | undefined, now: number): boolean[] {
  return Array.from({ length: n }, (_, i) => {
    const { start, end } = utcDayOfBar(i, n, now)
    return (outages ?? []).some(o => outageOverlaps(o, start, end, now))
  })
}

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

const HOUR_MS = 3_600_000

/**
 * The hover / tap readout of each hourly bar on the home cards: the hour (UTC, "14:00-15:00") and its uptime. Oldest
 * first, the last entry is the current hour (the same order as `uptimeHourly24`).
 */
export function uptimeHourReadouts(
  hours: ReadonlyArray<number | null>,
  now: number,
): Array<{ date: string; text: string }> {
  const current = Math.floor(now / HOUR_MS) * HOUR_MS
  const n = hours.length
  // The bars start on whole UTC hours, so "HH:00" is plain arithmetic (no Intl call per bar, see DAY_LABEL).
  const clock = (t: number) => `${String(new Date(t).getUTCHours()).padStart(2, '0')}:00`
  return hours.map((pct, i) => {
    const start = current - (n - 1 - i) * HOUR_MS
    const range = `${clock(start)}\u2013${clock(start + HOUR_MS)} UTC`
    return { date: i === n - 1 ? `Now, ${clock(start)} UTC` : range, text: pct === null ? 'No checks this hour' : `${pct}% uptime` }
  })
}
