import { useEffect, useMemo } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { bootstrapUserData } from '@/core/nostr/client'
import { sanitizeUserRelays } from '@/core/nostr/relayHints'

// Reads the logged-in user's NIP-65 (kind:10002) read/write relay lists from the
// auth store. The actual fetch is done once by `bootstrapUserData()` — a single
// subscription that also carries the kind:0 profile lookup — kicked off here the
// first time we hold a pubkey without a cached relay list (fresh login, or a
// reload of a session that predates nip65Relays persistence).
//
// Returns { read, write } — both null while loading or if no relay list is
// found (callers fall back to their own hardcoded relay lists).
export function useUserRelays(): { read: string[] | null; write: string[] | null } {
  const pubkey = useAuthStore(s => s.profile?.pubkey)
  const nip65Relays = useAuthStore(s => s.nip65Relays)

  useEffect(() => {
    if (!pubkey) return
    if (nip65Relays !== null) return  // already cached (shared across all instances / persisted)
    return bootstrapUserData(pubkey)
  }, [pubkey, nip65Relays])

  // Only what we connect to is filtered (public wss:// hosts, max 10 each); the stored list stays as published.
  // Memoised so callers keep a stable array between renders, as they had with the raw store value.
  return useMemo(() => {
    if (!nip65Relays) return { read: null, write: null }
    const read = sanitizeUserRelays(nip65Relays.read)
    const write = sanitizeUserRelays(nip65Relays.write)
    return {
      read: read.length > 0 ? read : null,
      write: write.length > 0 ? write : null,
    }
  }, [nip65Relays])
}
