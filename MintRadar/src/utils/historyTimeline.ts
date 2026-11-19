// Mint Detail History tab, 2026-11-19 redesign (phase 4c): the comparison sentences under the period figures and the one
// "What happened" timeline that merges the outages of the last 30 days with the software changes. Pure helpers, no React.
import { formatDuration, type OutageEntry, type OutagesResponse } from '@/utils/mintDetailFacts'

export type HistoryPeriod = '24h' | '7d' | '30d' | '90d'

/** "24 hours", "7 days", "30 days", "90 days": the period as words. */
export const PERIOD_WORDS: Record<HistoryPeriod, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', '90d': '90 days' }

/**
 * The sentence under an average, against the period before: "35 ms faster than the 7 days before", "0.4% lower than the
 * 30 days before", "Same as the 7 days before". Null when there is nothing to compare; "Not enough history to compare
 * yet" when the earlier period is missing because the mint is younger than it.
 */
export function compareSentence(
  kind: 'latency' | 'uptime', curr: number | null, prev: number | null, period: HistoryPeriod, insufficientHistory = false,
): string | null {
  if (curr === null) return null
  if (prev === null) return insufficientHistory ? 'Not enough history to compare yet' : null
  const before = `the ${PERIOD_WORDS[period]} before`
  const diff = curr - prev
  if (kind === 'latency') {
    const ms = Math.round(Math.abs(diff))
    if (ms === 0) return `Same as ${before}`
    return `${ms} ms ${diff < 0 ? 'faster' : 'slower'} than ${before}`
  }
  const pct = Math.round(Math.abs(diff) * 10) / 10
  if (pct === 0) return `Same as ${before}`
  return `${pct}% ${diff > 0 ? 'higher' : 'lower'} than ${before}`
}

export type HistoryEvent =
  | { kind: 'outage'; at: string; durationMs: number; ongoing: boolean; truncated: boolean; error: string | null }
  | { kind: 'software'; at: string; from: string | null; to: string; switched: boolean }

/** "Nutshell/0.20.3" → "Nutshell 0.20.3": a version as a reader writes it. */
export const versionText = (v: string): string => v.replace('/', ' ')
const family = (v: string): string => v.split('/')[0]!.trim().toLowerCase()

/**
 * Outages (the API's 30-day window) and software changes (all of them), newest first. `versions` comes newest first, as
 * the API returns it; each version's "from" is the next (older) entry. A change of the part before "/" (Nutshell to
 * cdk-mintd) is a switch of software, not an update. The stored last error is shown on the ongoing outage only, never a
 * made-up "offline".
 */
export function buildHistoryEvents(
  outages: readonly OutageEntry[] | undefined,
  versions: ReadonlyArray<{ version: string; firstSeenAt: string }> | undefined,
  lastError: string | null,
): HistoryEvent[] {
  const events: HistoryEvent[] = []
  for (const o of outages ?? []) {
    events.push({
      kind: 'outage', at: o.startedAt, durationMs: o.durationMs, ongoing: o.ongoing === true,
      truncated: o.truncatedAtWindowStart === true, error: o.ongoing === true && lastError ? lastError : null,
    })
  }
  const vs = versions ?? []
  vs.forEach((v, i) => {
    const from = vs[i + 1]?.version ?? null
    events.push({ kind: 'software', at: v.firstSeenAt, from, to: v.version, switched: from !== null && family(from) !== family(v.version) })
  })
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** The bold first words of an outage row: "Not answering for 10 min", "Not answering for 2h 5m so far". */
export function outageHeadline(e: Extract<HistoryEvent, { kind: 'outage' }>): string {
  return `Not answering for ${formatDuration(e.durationMs)}${e.ongoing ? ' so far' : ''}`
}

/**
 * The line under the outage count. While an outage is ongoing it says how long the mint has been down and NEVER a time
 * since the last outage (an older API still sent a small sinceLastOutageMs then: the "2m" bug). Otherwise the API's mean
 * time to recover (of recovered outages), the longest one when there were several, and how long ago the last one ended.
 */
export function outageFigureNote(data: OutagesResponse | undefined): string | null {
  if (!data) return null
  if (data.ongoing === true) return data.currentOutage ? `Down for ${formatDuration(data.currentOutage.durationMs)} now` : 'Down now'
  if (!data.outageCount || data.avgRecoveryMs == null) return null
  // The mean hides one long outage among short ones (8 outages, mean 21 h, one of them 6.8 days): name the longest when
  // there is more than one (with one, the mean is that outage).
  const longest = typeof data.longestOutageMs === 'number' && data.longestOutageMs > 0 && data.outageCount > 1 ? ` (longest ${formatDuration(data.longestOutageMs)})` : ''
  const since = data.sinceLastOutageMs != null ? `, the last ${formatDuration(data.sinceLastOutageMs)} ago` : ''
  return `${formatDuration(data.avgRecoveryMs)} to recover on average${longest}${since}`
}
