import { useState, useEffect } from 'react'
import { verifyEvent } from 'nostr-tools'
import { sharedPool } from '@/core/nostr/pool'
import { REVIEW_READ_RELAYS, PROFILE_RELAYS } from '@/core/nostr/relays'
import { deduplicateByPubkey, parseReviewEvent, sortReviewsByNewest } from '@/utils/reviewUtils'

export interface MintReview {
  id: string
  pubkey: string
  rating: number | null
  comment: string
  createdAt: number
  profile?: { name?: string; picture?: string }
}

export function useMintReviews(mintUrl: string) {
  // Reviews are keyed by the URL they were fetched for, so switching mints
  // never shows stale data and loading state is derived instead of set in the effect.
  const [result, setResult] = useState<{ url: string; reviews: MintReview[] }>({ url: '', reviews: [] })

  useEffect(() => {
    if (!mintUrl) return
    let cancelled = false

    // maxWait caps how long querySync waits for slow/stalled relays before
    // resolving with whatever arrived — without it, nostr-tools falls back to a
    // 4400ms per-relay EOSE ceiling, which was the bulk of the client-side
    // review-load delay. This is only the fast first paint; the authoritative
    // count/rating comes from the DB-backed endpoints. 2000ms is comfortably
    // above the measured connect+EOSE time of every REVIEW_READ_RELAYS entry.
    sharedPool.querySync(REVIEW_READ_RELAYS, {
      kinds: [38000],
      '#u': [mintUrl],
      limit: 500,
    }, { maxWait: 2000 }).then(async events => {
      if (cancelled) return
      const validEvents = events.filter(e => verifyEvent(e))
      const parsed = sortReviewsByNewest(
        deduplicateByPubkey(validEvents).map(parseReviewEvent)
      )
      // Show reviews immediately without waiting for profiles
      setResult({ url: mintUrl, reviews: parsed })

      if (parsed.length === 0) return

      // Fetch profiles non-blocking — update reviews when profiles arrive
      const pubkeys = [...new Set(parsed.map(r => r.pubkey))]
      sharedPool.querySync(PROFILE_RELAYS, { kinds: [0], authors: pubkeys }, { maxWait: 2000 })
        .then(profileEvents => {
          if (cancelled) return
          const profileMap: Record<string, { name?: string; picture?: string }> = {}
          for (const e of profileEvents) {
            try {
              const meta = JSON.parse(e.content) as { name?: string; picture?: string }
              const p: { name?: string; picture?: string } = {}
              if (meta.name) p.name = meta.name
              if (meta.picture) p.picture = meta.picture
              if (p.name || p.picture) profileMap[e.pubkey] = p
            } catch { /* invalid profile JSON — skip */ }
          }
          if (Object.keys(profileMap).length > 0) {
            setResult(prev => prev.url !== mintUrl ? prev : {
              url: prev.url,
              reviews: prev.reviews.map(r => {
                const p = profileMap[r.pubkey]
                return p ? { ...r, profile: p } : r
              }),
            })
          }
        })
        .catch(() => {})
    }).catch(() => {
      if (!cancelled) setResult({ url: mintUrl, reviews: [] })
    })

    return () => { cancelled = true }
  }, [mintUrl])

  const isCurrent = result.url === mintUrl
  return { reviews: isCurrent ? result.reviews : [], loading: !isCurrent }
}
