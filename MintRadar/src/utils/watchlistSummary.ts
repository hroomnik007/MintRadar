// The one summary line above the Watchlist cards: how many mints are watched and how many of them are online,
// degraded, offline or archived. Facts only, no new data: it reads the watched URLs and the known-mints list the page
// already has, and the status of every mint comes from the one status rule (utils/mintStatus.ts).
//
// Count rule: every watched URL is one card on the page, so `total` is the number of URLs. A URL that is not in the
// known list (the card is then built from a fallback object, with no probe data) is counted in `total` and in
// `untracked` and in none of the four status counts, so online + degraded + offline + archived + untracked === total.
import { mintStatus, type MintStatus, type MintStatusFlags } from '@/utils/mintStatus'
import { mintStatusLabel } from '@/utils/mintFormatting'
import { pluralize } from '@/utils/plural'

export interface WatchlistSummary {
  total: number
  online: number
  degraded: number
  offline: number
  archived: number
  untracked: number
}

/** Status segments in the order of the line. */
const ORDER: MintStatus[] = ['online', 'degraded', 'offline', 'archived']

export function watchlistSummary(urls: readonly string[], known: readonly (MintStatusFlags & { url: string })[]): WatchlistSummary {
  const byUrl = new Map(known.map(m => [m.url, m] as const))
  const s: WatchlistSummary = { total: urls.length, online: 0, degraded: 0, offline: 0, archived: 0, untracked: 0 }
  for (const url of urls) {
    const m = byUrl.get(url)
    if (m === undefined) s.untracked++
    else s[mintStatus(m)]++
  }
  return s
}

/** "5 mints watched · 4 online · 1 offline": only the statuses that have a mint, "n not tracked" last. */
export function watchlistSummaryText(s: WatchlistSummary): string {
  const parts = [`${pluralize(s.total, 'mint')} watched`]
  for (const status of ORDER) if (s[status] > 0) parts.push(`${s[status]} ${mintStatusLabel(status).toLowerCase()}`)
  if (s.untracked > 0) parts.push(`${s.untracked} not tracked`)
  return parts.join(' · ')
}
