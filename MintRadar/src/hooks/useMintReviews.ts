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
        // Skip events with neither rating nor comment text
        if (rating === null && comment.length === 0) continue
        parsed.push({ id: e.id, pubkey: e.pubkey, rating, comment, createdAt: e.created_at })
      }

      parsed.sort((a, b) => b.createdAt - a.createdAt)

      if (parsed.length === 0) {
        setReviews(parsed)
        return
      }

      const pubkeys = [...new Set(parsed.map(r => r.pubkey))]
      const profileEvents = await sharedPool.querySync(PROFILE_RELAYS, {
        kinds: [0],
        authors: pubkeys,
      })
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
      console.log('[profileMap] keys:', Object.keys(profileMap).map(k => k.slice(0, 8)))
      console.log('[profileMap] first review pubkey:', parsed[0]?.pubkey?.slice(0, 8))
      console.log('[profileMap] match:', parsed[0] ? !!profileMap[parsed[0].pubkey] : false)
      setReviews(parsed.map(r => {
        const p = profileMap[r.pubkey]
        return p ? { ...r, profile: p } : r
      }))
    }).catch(() => {}).finally(() => {
      setLoading(false)
    })
  }, [mintUrl])

  return { reviews, loading }
}
