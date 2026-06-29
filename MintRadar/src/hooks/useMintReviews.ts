import { useState, useEffect } from 'react'
import { verifyEvent } from 'nostr-tools'
import { sharedPool } from '@/core/nostr/pool'

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

export interface MintReview {
  id: string
  pubkey: string
  rating: number | null
  comment: string
  createdAt: number
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
    }).then(events => {
      const validEvents = events.filter(e => verifyEvent(e))
      const byPubkey = new Map<string, typeof validEvents[0]>()
      for (const e of validEvents) {
        const existing = byPubkey.get(e.pubkey)
        if (!existing || e.created_at > existing.created_at) {
          byPubkey.set(e.pubkey, e)
        }
      }

      const parsed: MintReview[] = []
      for (const e of byPubkey.values()) {
        const ratingTag = e.tags.find((t: string[]) => t[0] === 'rating')
        const commentTag = e.tags.find((t: string[]) => t[0] === 'comment')
        let rating: number | null = ratingTag ? parseInt(ratingTag[1] ?? '', 10) : null
        if (rating !== null && (rating < 1 || rating > 5)) rating = null
        // Fallback: extract rating from content "[X/5] ..." format
        const contentMatch = !rating ? /^\[(\d)\/5\]/.exec(e.content ?? '') : null
        if (contentMatch?.[1]) rating = parseInt(contentMatch[1], 10)
        const rawComment = commentTag ? (commentTag[1] ?? '') : (e.content ?? '')
        const comment = rawComment.replace(/^\[\d\/5\]\s*/, '').trim()
        parsed.push({
          id: e.id,
          pubkey: e.pubkey,
          rating,
          comment,
          createdAt: e.created_at,
        })
      }

      parsed.sort((a, b) => b.createdAt - a.createdAt)
      setReviews(parsed)
    }).catch(() => {}).finally(() => {
      setLoading(false)
    })
  }, [mintUrl])

  return { reviews, loading }
}
