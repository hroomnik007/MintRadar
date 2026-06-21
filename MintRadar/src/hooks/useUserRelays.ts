import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { SimplePool } from 'nostr-tools/pool'

const BOOTSTRAP_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
]

// Fetches the logged-in user's NIP-65 kind:10002 relay list and returns their
// read relays. Returns null while loading or if no relay list is found (caller
// should fall back to their own hardcoded relay list).
export function useUserRelays(): string[] | null {
  const pubkey = useAuthStore(s => s.profile?.pubkey)
  const [readRelays, setReadRelays] = useState<string[] | null>(null)

  useEffect(() => {
    if (!pubkey) { setReadRelays(null); return }

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
        const relays = event.tags
          .filter((t: string[]) => t[0] === 'r' && (!t[2] || t[2] === 'read'))
          .map((t: string[]) => t[1])
          .filter((r): r is string => Boolean(r))
        if (relays.length > 0) setReadRelays(relays)
      })
      .catch(() => { /* timeout or relay error — fall back to hardcoded list */ })
      .finally(() => pool.destroy())

    return () => { cancelled = true }
  }, [pubkey])

  return readRelays
}
