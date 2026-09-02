import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { bootstrapUserData } from '@/core/nostr/client'

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

  if (!nip65Relays) return { read: null, write: null }
  return {
    read: nip65Relays.read.length > 0 ? nip65Relays.read : null,
    write: nip65Relays.write.length > 0 ? nip65Relays.write : null,
  }
}
