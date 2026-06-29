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

export interface NostrProfile {
  name?: string
  picture?: string
}

const profileCache = new Map<string, NostrProfile>()

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
        // Skip events with neither rating nor comment text
        if (rating === null && comment.length === 0) continue
        parsed.push({ id: e.id, pubkey: e.pubkey, rating, comment, createdAt: e.created_at })
      }

      parsed.sort((a, b) => b.createdAt - a.createdAt)
      setReviews(parsed)
    }).catch(() => {}).finally(() => {
      setLoading(false)
    })
  }, [mintUrl])

  return { reviews, loading }
}

export function useNostrProfiles(pubkeys: string[]): Map<string, NostrProfile> {
  const [profiles, setProfiles] = useState<Map<string, NostrProfile>>(() => new Map(profileCache))

  useEffect(() => {
    if (pubkeys.length === 0) return
    const missing = pubkeys.filter(pk => !profileCache.has(pk))
    if (missing.length === 0) {
      setProfiles(new Map(profileCache))
      return
    }
    sharedPool.querySync(REVIEW_RELAYS, { kinds: [0], authors: missing, limit: missing.length + 5 })
      .then(events => {
        const byPubkey = new Map<string, typeof events[0]>()
        for (const e of events) {
          const ex = byPubkey.get(e.pubkey)
          if (!ex || e.created_at > ex.created_at) byPubkey.set(e.pubkey, e)
        }
        for (const [pk, e] of byPubkey) {
          try {
            const meta = JSON.parse(e.content) as { name?: string; picture?: string }
            const profile: NostrProfile = {}
            if (meta.name) profile.name = meta.name
            if (meta.picture) profile.picture = meta.picture
            profileCache.set(pk, profile)
          } catch {
            profileCache.set(pk, {})
          }
        }
        for (const pk of missing) {
          if (!profileCache.has(pk)) profileCache.set(pk, {})
        }
        setProfiles(new Map(profileCache))
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkeys.join(',')])

  return profiles
}
