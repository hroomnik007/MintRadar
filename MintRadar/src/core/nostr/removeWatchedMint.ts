import { db } from '@/db'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { cancelSubscription, hasNotifyRequestInFlight } from '@/core/nostr/notificationSubscription'

// Removes a mint from the watchlist (star on a watched mint) and, when a server subscription may
// exist for it, cancels that subscription once. The removal itself is purely local and never waits
// for or depends on the request: the mint is gone from the list first, the unsubscribe follows.
// "May exist" = a local flag is on (confirmed, or an unconfirmed legacy flag whose server row the
// old login sync may have created) or a toggle request for the mint is still running. If the mint
// had no notification on, nothing extra happens (no request, no signature prompt).
// A failed cancel (network, 429, signer declined/unavailable) leaves a dismissible notice; the
// server row then lapses on its own within 30 days. Nothing here logs the mint or the error.
export async function removeWatchedMint(url: string, name: string): Promise<void> {
  const entry = await db.watchlist.get(url)
  const mayBeSubscribed = !!entry && (entry.notifyOnDown || entry.notifyOnUp || entry.notifyOnMintMeltIssues || entry.notifyOnVersionOutdated || entry.notifyOnNutLoss)
  const toggleRunning = hasNotifyRequestInFlight(url)

  await useWatchlistStore.getState().removeMint(url)

  if (!mayBeSubscribed && !toggleRunning) return
  void cancelSubscription(url).then(result => {
    if (!result.ok) {
      useWatchlistStore.getState().pushNotice(`Couldn't turn off notifications for ${name}. They stop within 30 days.`)
    }
  })
}
