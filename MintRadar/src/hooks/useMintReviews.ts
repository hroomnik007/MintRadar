import { useState, useEffect } from 'react'
import { verifyEvent } from 'nostr-tools'
import { sharedPool } from '@/core/nostr/pool'
import { deduplicateByPubkey, parseReviewEvent, filterAndSortReviews } from '@/utils/reviewUtils'

const REVIEW_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.cashumints.space',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
  'wss://relay.nostr.band',
  'wss://relay.minibits.cash',
]

const PROFILE_RELAYS = [
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://purplepag.es',
  'wss://relay.damus.io',
]

export interface MintReview {
  id: string
  pubkey: string
  rating: number | null
  comment: string
  createdAt: number
  profile?: { name?: string; picture?: string }
}

export function useMintReviews(mintUrl: string) {
  const [reviews, setReviews] = useState<MintReview[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!mintUrl) return
    setLoading(true)

    sharedPool.querySync(REVIEW_RELAYS, {
      kinds: [38000],
      '#u': [mintUrl],
      limit: 50,
    }).then(async events => {
      const validEvents = events.filter(e => verifyEvent(e))
      const parsed = filterAndSortReviews(
        deduplicateByPubkey(validEvents).map(parseReviewEvent)
      )
      // Show reviews immediately without waiting for profiles
      setReviews(parsed)

      if (parsed.length === 0) return

      // Fetch profiles non-blocking — update reviews when profiles arrive
      const pubkeys = [...new Set(parsed.map(r => r.pubkey))]
      sharedPool.querySync(PROFILE_RELAYS, { kinds: [0], authors: pubkeys })
        .then(profileEvents => {
          const profileMap: Record<string, { name?: string; picture?: string }> = {}
          for (const e of profileEvents) {
            try {
              const meta = JSON.parse(e.content) as { name?: string; picture?: string }
              const p: { name?: string; picture?: string } = {}
              if (meta.name) p.name = meta.name
              if (meta.picture) p.picture = meta.picture
              if (p.name || p.picture) profileMap[e.pubkey] = p
            } catch {}
          }
          if (Object.keys(profileMap).length > 0) {
            setReviews(prev => prev.map(r => {
              const p = profileMap[r.pubkey]
              return p ? { ...r, profile: p } : r
            }))
          }
        })
        .catch(() => {})
    }).catch(() => {}).finally(() => {
      setLoading(false)
    })
  }, [mintUrl])

  return { reviews, loading }
}
