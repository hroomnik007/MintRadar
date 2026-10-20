import { useState, useEffect } from 'react'
import { sharedPool } from '@/core/nostr/pool'
import { PROFILE_RELAYS } from '@/core/nostr/relays'
import { pickNewestProfileEvents } from '@/core/nostr/profileEvents'

// Informational only: reads the `nip05` field straight from the mint operator's kind:0
// profile metadata (fetched over Nostr relays, same source/pattern as reviewer profiles
// in useMintReviews.ts). Deliberately NOT verified against
// https://<domain>/.well-known/nostr.json — an automatic verification fetch would leak
// the visitor's IP to a domain the mint operator controls on every Mint Detail page view,
// the same tracking-beacon class of issue that led to proxying mint icon_url server-side
// (see MintFavicon.tsx / backend/src/mintIcon.ts). Live verification would need the same
// backend-proxy treatment to stay safe; out of scope here — this only ever surfaces the
// unverified value.
export function useMintOperatorNip05(pubkey: string | null | undefined): string | null {
  const [result, setResult] = useState<{ pubkey: string; nip05: string | null } | null>(null)

  useEffect(() => {
    if (!pubkey) return
    let cancelled = false

    sharedPool.querySync(PROFILE_RELAYS, { kinds: [0], authors: [pubkey], limit: 1 }, { maxWait: 2000 })
      .then(events => {
        if (cancelled) return
        const newest = pickNewestProfileEvents(events, new Set([pubkey])).get(pubkey)
        let nip05: string | null = null
        if (newest) {
          try {
            const meta = JSON.parse(newest.content) as { nip05?: string }
            if (typeof meta.nip05 === 'string' && meta.nip05.trim()) nip05 = meta.nip05.trim()
          } catch { /* invalid profile JSON — skip */ }
        }
        setResult({ pubkey, nip05 })
      })
      .catch(() => { if (!cancelled) setResult({ pubkey, nip05: null }) })

    return () => { cancelled = true }
  }, [pubkey])

  if (!pubkey) return null
  return result?.pubkey === pubkey ? result.nip05 : null
}
