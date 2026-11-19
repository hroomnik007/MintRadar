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
