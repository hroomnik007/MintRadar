import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { SimplePool } from 'nostr-tools/pool'
import { fetchNostrProfile } from '@/core/nostr/client'

const BOOTSTRAP_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
]

// Module-level in-flight guard — prevents duplicate kind:10002 fetches when
// multiple hook instances mount simultaneously (e.g. Dashboard + useWatchlistSync).
let inFlightPubkey: string | null = null

// Fetches the logged-in user's NIP-65 kind:10002 relay list, stores results
// in auth store (shared across all hook instances), and triggers a background
// profile refresh from the user's read relays. Returns { read, write } — both
// null while loading or if no relay list is found (callers fall back to their
// own hardcoded relay lists).
export function useUserRelays(): { read: string[] | null; write: string[] | null } {
  const pubkey = useAuthStore(s => s.profile?.pubkey)
  const nip65Relays = useAuthStore(s => s.nip65Relays)
  const setNip65Relays = useAuthStore(s => s.setNip65Relays)
  const updateProfileMeta = useAuthStore(s => s.updateProfileMeta)

  useEffect(() => {
    if (!pubkey) return
    if (nip65Relays !== null) return      // already fetched — shared across all instances
    if (inFlightPubkey === pubkey) return  // fetch in progress in another instance

    inFlightPubkey = pubkey
    const pool = new SimplePool()
    let cancelled = false

    Promise.race([
      pool.querySync(BOOTSTRAP_RELAYS, {
        kinds: [10002],
        authors: [pubkey],
        limit: 1,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ])
      .then(events => {
        if (cancelled) return
        const event = (events as { tags: string[][] }[])[0]
        if (!event) return

        // NIP-65: unmarked r-tags = both read+write, t[2]==='read' = read only,
        // t[2]==='write' = write only
        const read = event.tags
          .filter((t: string[]) => t[0] === 'r' && (!t[2] || t[2] === 'read'))
          .map((t: string[]) => t[1])
          .filter((r): r is string => Boolean(r))

        const write = event.tags
          .filter((t: string[]) => t[0] === 'r' && (!t[2] || t[2] === 'write'))
          .map((t: string[]) => t[1])
          .filter((r): r is string => Boolean(r))

        if (read.length > 0 || write.length > 0) {
          setNip65Relays({ read, write })

          // Background profile refresh from user's own read relays (Task 2).
          // Non-blocking — failure is silently ignored, initial profile remains.
          if (read.length > 0) {
            void fetchNostrProfile(pubkey, read).then(meta => {
              if (!cancelled && (meta.name !== undefined || meta.picture !== undefined)) {
                updateProfileMeta(pubkey, meta)
              }
            })
          }
        }
      })
      .catch(() => { /* timeout or relay error — callers fall back to hardcoded lists */ })
      .finally(() => {
        pool.destroy()
        if (inFlightPubkey === pubkey) inFlightPubkey = null
      })

    return () => { cancelled = true }
  }, [pubkey, nip65Relays, setNip65Relays, updateProfileMeta])

  if (!nip65Relays) return { read: null, write: null }
  return { read: nip65Relays.read.length > 0 ? nip65Relays.read : null,
           write: nip65Relays.write.length > 0 ? nip65Relays.write : null }
}
