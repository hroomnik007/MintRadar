import { useState, useEffect, useMemo } from 'react'
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

type ProfileMap = Record<string, { name?: string; picture?: string }>

// extraPubkeys lets a caller fold in pubkeys it knows about from another
// review source (e.g. MintDetail's DB-backed nostrOnly reviews) so they get
// the same kind:0 profile lookup as the live-fetched reviews, instead of
// only ever enriching pubkeys this hook found itself.
export function useMintReviews(mintUrl: string, extraPubkeys: string[] = []) {
  // Reviews are keyed by the URL they were fetched for, so switching mints
  // never shows stale data and loading state is derived instead of set in the effect.
  const [result, setResult] = useState<{ url: string; reviews: MintReview[] }>({ url: '', reviews: [] })
  const [profilesState, setProfilesState] = useState<{ url: string; profiles: ProfileMap }>({ url: '', profiles: {} })

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
    }).catch(() => {
      if (!cancelled) setResult({ url: mintUrl, reviews: [] })
    })

    return () => { cancelled = true }
  }, [mintUrl])

  // extraPubkeys can be a fresh array reference on every render (e.g. derived
  // from a react-query result), so key the effect below off its actual content
  // rather than its identity.
  const extraKey = useMemo(() => [...new Set(extraPubkeys)].sort().join(','), [extraPubkeys])

  useEffect(() => {
    if (!mintUrl || result.url !== mintUrl) return
    const pubkeys = [...new Set([...result.reviews.map(r => r.pubkey), ...extraPubkeys])]
    if (pubkeys.length === 0) return
    let cancelled = false

    // Fetch profiles non-blocking, for the union of this hook's own live
    // reviews AND any extra pubkeys the caller passed in — update once they arrive.
    sharedPool.querySync(PROFILE_RELAYS, { kinds: [0], authors: pubkeys }, { maxWait: 2000 })
      .then(profileEvents => {
        if (cancelled) return
        const profileMap: ProfileMap = {}
        // querySync returns events in relay-arrival order, not by created_at — sort
        // newest-first (same idiom nostr-tools' own SimplePool.get() uses internally)
        // so a slower relay serving a stale cached kind:0 can't clobber a newer one.
        const sorted = [...profileEvents].sort((a, b) => b.created_at - a.created_at)
        for (const e of sorted) {
          if (profileMap[e.pubkey]) continue
          try {
            const meta = JSON.parse(e.content) as { name?: string; picture?: string }
            const p: { name?: string; picture?: string } = {}
            if (meta.name) p.name = meta.name
            if (meta.picture) p.picture = meta.picture
            if (p.name || p.picture) profileMap[e.pubkey] = p
          } catch { /* invalid profile JSON — skip */ }
        }
        if (Object.keys(profileMap).length > 0) setProfilesState({ url: mintUrl, profiles: profileMap })
      })
      .catch(() => {})

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- extraKey is the stable proxy for extraPubkeys' content
  }, [mintUrl, result.url, result.reviews, extraKey])

  const profiles = useMemo(
    () => (profilesState.url === mintUrl ? profilesState.profiles : {}),
    [profilesState, mintUrl],
  )

  const reviewsWithProfiles = useMemo(
    () => result.reviews.map(r => {
      const profile = profiles[r.pubkey]
      return profile ? { ...r, profile } : r
    }),
    [result.reviews, profiles],
  )

  const isCurrent = result.url === mintUrl
  return { reviews: isCurrent ? reviewsWithProfiles : [], loading: !isCurrent, profiles }
}
