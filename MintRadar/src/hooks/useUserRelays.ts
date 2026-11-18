import { useEffect, useMemo } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { loadNostrClient } from '@/core/nostr/lazy'
import { deriveUserRelays, type UserRelays } from '@/core/nostr/userRelayLists'

// Reads the logged-in user's NIP-65 (kind:10002) read/write relay lists and NIP-17 (kind:10050) DM relays from the
// auth store. The actual fetch is done once by `bootstrapUserData()` — a single subscription that also carries the
// kind:0 profile lookup — kicked off here the first time we hold a pubkey without a cached 10002 or 10050 result
// (fresh login, or a reload of a session that predates that persistence).
//
// Returns { read, write, dm } — each null while loading or if no list is found (callers fall back to their own
// hardcoded relay lists).
export function useUserRelays(): UserRelays {
  const pubkey = useAuthStore(s => s.profile?.pubkey)
  const nip65Relays = useAuthStore(s => s.nip65Relays)
  const dmRelays = useAuthStore(s => s.dmRelays)

  // The effect must depend on this boolean, not on the list values: bootstrapUserData() writes the NIP-65 list as a
  // NEW object while the kind:10050 event is still on its way, and a re-run on that change would run the cleanup,
  // which closes the subscription (finish(false) never writes dmRelays) and restarts it, so dmRelays never lands.
  const needsBootstrap = nip65Relays === null || dmRelays === null

  useEffect(() => {
    if (!pubkey) return
    if (!needsBootstrap) return  // already cached (shared across all instances / persisted)
    // The client module is loaded lazily (lazy.ts); a cleanup before it lands cancels the bootstrap.
    let cancelled = false
    let stop: (() => void) | undefined
    void loadNostrClient().then(m => {
      if (!cancelled) stop = m.bootstrapUserData(pubkey)
    }).catch(() => {})
    return () => {
      cancelled = true
      stop?.()
    }
  }, [pubkey, needsBootstrap])

  // Memoised so callers keep a stable array between renders, as they had with the raw store value.
  return useMemo(() => deriveUserRelays(nip65Relays, dmRelays), [nip65Relays, dmRelays])
}
