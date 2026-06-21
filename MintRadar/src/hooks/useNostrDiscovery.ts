import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { useQueryClient } from '@tanstack/react-query'
import { sharedPool } from '@/core/nostr/pool'

const DISCOVERY_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://relay.snort.social',
  'wss://relay.primal.net',
  'wss://relay.cashumints.space',
  'wss://relay.azzamo.net',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
]

export function useNostrDiscovery() {
  const profile = useAuthStore(s => s.profile)
  const queryClient = useQueryClient()
  const ranRef = useRef(false)

  useEffect(() => {
    // Only run once per login session, only when logged in
    if (!profile || ranRef.current) return
    ranRef.current = true

    const run = async () => {
      console.log('[nostr-discovery] starting client-side NIP-87 discovery...')
      const discovered: Set<string> = new Set()

      try {
        const events = await Promise.race([
          sharedPool.querySync(DISCOVERY_RELAYS, { kinds: [38172], limit: 500 }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 20_000)
          ),
        ])

        const isValidMintUrl = (rawUrl: string): boolean => {
          try {
            const u = new URL(rawUrl)
            if (u.protocol !== 'https:') return false
            if (u.hostname === 'localhost') return false
            if (u.hostname.endsWith('.onion')) return false
            if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return false
            if (u.hostname.includes('..')) return false
            return true
          } catch { return false }
        }

        for (const event of events) {
          const uTag = event.tags.find((t: string[]) => t[0] === 'u')
          if (!uTag?.[1]) continue
          const url = uTag[1].trim()
          if (!isValidMintUrl(url)) continue
          discovered.add(url)
        }
      } catch (err) {
        console.warn('[nostr-discovery] error:', err)
      }

      if (discovered.size === 0) return

      // After discovering URLs, send all at once
      const urlArray = Array.from(discovered)
      console.log(`[nostr-discovery] found ${urlArray.length} valid mints, sending to backend...`)

      try {
        const res = await fetch('/api/mints/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: urlArray }),
        })
        const data = await res.json() as { added: number; total: number }
        console.log(`[nostr-discovery] added ${data.added} new mints`)
        if (data.added > 0) {
          void queryClient.invalidateQueries({ queryKey: ['mints-known'] })
        }
      } catch (err) {
        console.warn('[nostr-discovery] submit error:', err)
      }
    }

    void run()
  }, [profile, queryClient])
}
