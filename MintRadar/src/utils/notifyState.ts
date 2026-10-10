import type { WatchlistEntry } from '@/db'

// The truthful notification state of a watched mint: the local flags count ONLY when the server
// confirmed them (`notifyConfirmedAt`). Unconfirmed flags — legacy "on, on" defaults, or anything
// the server never acknowledged — are off. The server has no read route, so this is the only
// confirmation the client can hold.
export interface NotifyState { down: boolean; up: boolean }

export function confirmedNotify(entry: Pick<WatchlistEntry, 'notifyOnDown' | 'notifyOnUp' | 'notifyConfirmedAt'> | undefined | null): NotifyState {
  if (!entry || !entry.notifyConfirmedAt) return { down: false, up: false }
  return { down: entry.notifyOnDown === true, up: entry.notifyOnUp === true }
}

// The three "More alerts" flags, with the same rule: on only when the server confirmed them.
export interface MoreNotifyState { mintMelt: boolean; versionOutdated: boolean; nutLoss: boolean }

export function confirmedMoreNotify(entry: Pick<WatchlistEntry, 'notifyConfirmedAt' | 'notifyOnMintMeltIssues' | 'notifyOnVersionOutdated' | 'notifyOnNutLoss'> | undefined | null): MoreNotifyState {
  if (!entry || !entry.notifyConfirmedAt) return { mintMelt: false, versionOutdated: false, nutLoss: false }
  return {
    mintMelt: entry.notifyOnMintMeltIssues === true,
    versionOutdated: entry.notifyOnVersionOutdated === true,
    nutLoss: entry.notifyOnNutLoss === true,
  }
}

// Rows from before notifications were confirmed by the server: a flag is on locally but the server never
// confirmed it. Nothing creates such a row any more (addMint / sync default to off, setNotifyFlag writes the
// flags and notifyConfirmedAt together), so this is only the legacy population — and it empties as the user
// re-enables (confirms) or removes those mints.
export function hasLegacyUnconfirmedFlag(entries: readonly Pick<WatchlistEntry, 'notifyOnDown' | 'notifyOnUp' | 'notifyConfirmedAt'>[]): boolean {
  return entries.some(e => (e.notifyOnDown || e.notifyOnUp) && !e.notifyConfirmedAt)
}
