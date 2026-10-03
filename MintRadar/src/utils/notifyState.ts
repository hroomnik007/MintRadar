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
