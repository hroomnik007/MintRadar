// Outage blocks for /api/mints/outages (Mint Detail, History tab): consecutive offline checks (min 2; a single failed probe
// is ignored as flaky noise) in the window, oldest first. Pure: the route passes the mint_history rows and the clock.
//
// Honest numbers (data audit 2026-10-25):
// - a block still offline at the newest check is ONGOING: its duration runs to `now`, it is the `currentOutage`, and
//   `sinceLastOutageMs` is null (the mint has not recovered, so there is no "since").
// - `avgRecoveryMs` is the mean of RECOVERED outages only (an ongoing one has no recovery time yet); null if none.
// - a block whose first row is the first row of the window started at or before the window start: its real start (and so its
//   duration) is unknown, flagged `truncatedAtWindowStart`.
// `error` stays 'offline' for compatibility (additive changes only); the UI no longer shows it.

export interface OutageRow { online: boolean; checked_at: Date }

export interface Outage {
  startedAt: string
  durationMs: number
  error: 'offline'
  ongoing: boolean
  truncatedAtWindowStart: boolean
}

export interface OutagesSummary {
  sinceLastOutageMs: number | null
  avgRecoveryMs: number | null
  outageCount: number
  recoveredCount: number
  ongoing: boolean
  currentOutage: { startedAt: string; durationMs: number } | null
  outages: Outage[]
}

export const OUTAGES_LIST_MAX = 20

export function summarizeOutages(rows: readonly OutageRow[], now: number = Date.now()): OutagesSummary {
  const outages: Outage[] = []
  let startIdx = -1
  let count = 0
  const close = (endMs: number, ongoing: boolean) => {
    if (count >= 2) {
      const start = rows[startIdx]!.checked_at
      outages.push({
        startedAt: start.toISOString(),
        durationMs: Math.max(0, endMs - start.getTime()),
        error: 'offline',
        ongoing,
        truncatedAtWindowStart: startIdx === 0,
      })
    }
    startIdx = -1
    count = 0
  }
  rows.forEach((row, i) => {
    if (!row.online) {
      if (startIdx === -1) startIdx = i
      count++
    } else if (startIdx !== -1) {
      close(row.checked_at.getTime(), false)
    }
  })
  // Still offline at the newest check: ongoing, the duration runs to now.
  if (startIdx !== -1) close(now, true)

  const recovered = outages.filter(o => !o.ongoing)
  const current = outages.find(o => o.ongoing) ?? null
  const lastRecovered = recovered[recovered.length - 1]
  return {
    sinceLastOutageMs: current || !lastRecovered ? null : now - new Date(lastRecovered.startedAt).getTime() - lastRecovered.durationMs,
    avgRecoveryMs: recovered.length > 0 ? Math.round(recovered.reduce((s, o) => s + o.durationMs, 0) / recovered.length) : null,
    outageCount: outages.length,
    recoveredCount: recovered.length,
    ongoing: current !== null,
    currentOutage: current ? { startedAt: current.startedAt, durationMs: current.durationMs } : null,
    outages: outages.slice(-OUTAGES_LIST_MAX),
  }
}
