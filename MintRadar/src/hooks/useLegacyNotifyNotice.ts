import { useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db'
import { hasLegacyUnconfirmedFlag } from '@/utils/notifyState'

export const LEGACY_NOTIFY_NOTICE_TEXT =
  'Notifications are now confirmed with the server before they show as on. The ones you had turned on before are shown as off. Turn them on again for the mints you want.'

// Dismissal is stored per account in Dexie `meta` (next to `watchlistOwner` and the watchlist rows it
// describes), so it survives reloads and logout and never comes back for the same account.
const dismissedKey = (pubkey: string) => `legacyNotifyNoticeDismissed:${pubkey}`

// One-time Watchlist notice for users whose old unconfirmed "on" flags now show as off. Purely local:
// reads IndexedDB, makes no request, asks no signer, logs nothing. Visible only while some watched mint
// still has an unconfirmed legacy flag and the account has not dismissed it.
export function useLegacyNotifyNotice(pubkey: string | undefined): { visible: boolean; dismiss: () => void } {
  const state = useLiveQuery(async () => {
    const entries = await db.watchlist.toArray()
    const dismissed = pubkey ? await db.meta.get(dismissedKey(pubkey)) : undefined
    return { legacy: hasLegacyUnconfirmedFlag(entries), dismissed: !!dismissed }
  }, [pubkey])
  const dismiss = useCallback(() => {
    if (pubkey) void db.meta.put({ key: dismissedKey(pubkey), value: '1' })
  }, [pubkey])
  return { visible: !!pubkey && state !== undefined && state.legacy && !state.dismissed, dismiss }
}
