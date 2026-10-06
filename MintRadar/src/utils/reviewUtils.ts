// Pure review processing helpers extracted from useMintReviews.ts.
// No React or Nostr I/O — all functions are side-effect free.

export interface ReviewEvent {
  id: string
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

export interface ParsedReview {
  id: string
  pubkey: string
  rating: number | null
  comment: string
  createdAt: number
}

// Keep only the most-recent event per pubkey (deduplication rule from NIP-87).
export function deduplicateByPubkey(events: ReviewEvent[]): ReviewEvent[] {
  const byPubkey = new Map<string, ReviewEvent>()
  for (const e of events) {
    const existing = byPubkey.get(e.pubkey)
    if (!existing || e.created_at > existing.created_at) {
      byPubkey.set(e.pubkey, e)
    }
  }
  return [...byPubkey.values()]
}

// Extract rating + comment from a single event.
// Rating precedence: valid `rating` tag (1-5) > "[X/5]" content marker (also
// clamped to 1-5 — an out-of-range marker like "[9/5]" yields rating null).
// Events with neither rating nor non-empty comment are excluded downstream.
export function parseReviewEvent(e: ReviewEvent): ParsedReview {
  const ratingTag = e.tags.find(t => t[0] === 'rating')
  const commentTag = e.tags.find(t => t[0] === 'comment')
  let rating: number | null = ratingTag ? parseInt(ratingTag[1] ?? '', 10) : null
  if (rating !== null && (rating < 1 || rating > 5)) rating = null
  const contentMatch = !rating ? /^\[(\d)\/5\]/.exec(e.content ?? '') : null
  if (contentMatch?.[1]) {
    rating = parseInt(contentMatch[1], 10)
    if (rating < 1 || rating > 5) rating = null
  }
  const rawComment = commentTag ? (commentTag[1] ?? '') : (e.content ?? '')
  const comment = rawComment.replace(/^\[\d\/5\]\s*/, '').trim()
  return { id: e.id, pubkey: e.pubkey, rating, comment, createdAt: e.created_at }
}

// Sort newest-first. Empty events (no rating and no comment) are dropped by
// processReviewEvents / visibleReviews — they are not reviews.
export function sortReviewsByNewest(parsed: ParsedReview[]): ParsedReview[] {
  return [...parsed].sort((a, b) => b.createdAt - a.createdAt)
}

// The mint card's number is the stored set: one row per pubkey. The detail
// page must use that same set. A live event updates a stored reviewer only
// when it is newer. A live event from anyone else is not added — that is what
// made the detail say 5 while the card said 4. The one exception is the
// viewer who just published, so their own review shows before the next sync.
export function mergeStoredAndLiveReviews<T extends { pubkey: string; createdAt: number }>(
  stored: T[],
  live: T[],
  viewerPubkey: string | null,
): T[] {
  const byPubkey = new Map<string, T>()
  for (const review of stored) {
    const prev = byPubkey.get(review.pubkey)
    if (!prev || review.createdAt > prev.createdAt) byPubkey.set(review.pubkey, review)
  }
  for (const review of live) {
    const prev = byPubkey.get(review.pubkey)
    if (prev) {
      if (review.createdAt > prev.createdAt) byPubkey.set(review.pubkey, review)
    } else if (viewerPubkey !== null && review.pubkey === viewerPubkey) {
      byPubkey.set(review.pubkey, review)
    }
  }
  return [...byPubkey.values()].sort((a, b) => b.createdAt - a.createdAt)
}

// Convenience: run the full dedup → parse → sort pipeline.
export function processReviewEvents(events: ReviewEvent[]): ParsedReview[] {
  const deduped = deduplicateByPubkey(events)
  const parsed = deduped.map(parseReviewEvent)
  return sortReviewsByNewest(visibleReviews(parsed))
}

// True when there is no rating and no (non-whitespace) text.
export function isEmptyReview(r: { rating: number | null; comment?: string | null }): boolean {
  return r.rating === null && (r.comment ?? '').trim() === ''
}

// Reviews shown in the tab / counted on the card: rating or non-empty comment.
export function visibleReviews<T extends { rating: number | null; comment?: string | null }>(reviews: T[]): T[] {
  return reviews.filter(r => !isEmptyReview(r))
}

// Order-preserving split into reviews to show and "empty" ones to collapse.
export function splitEmptyReviews<T extends { rating: number | null; comment?: string | null }>(
  reviews: T[],
): { visible: T[]; empty: T[] } {
  const visible: T[] = []
  const empty: T[] = []
  for (const r of reviews) (isEmptyReview(r) ? empty : visible).push(r)
  return { visible, empty }
}

// Profile of a review author as the review list renders it. `fromServer` marks a name that came from the
// server-side profile index (GET /api/mints/nostr-reviews authorName), not from the visitor's own relay lookup.
export interface ReviewAuthorProfile {
  name?: string
  nip05?: string
  picture?: string
  fromServer?: boolean
}

export interface ServerAuthorProfile {
  authorName?: string
  authorNip05?: string
}

// The browser's own result wins: a profile that already has a name is never touched. Only when the browser
// found no name does the server's authorName fill in (plus its NIP-05 claim, unless the browser had one).
// Display text only, never an input to a rating, the operator rule or any score.
export function withServerProfileFallback<T extends { pubkey: string; profile?: ReviewAuthorProfile }>(
  reviews: T[],
  server: ReadonlyMap<string, ServerAuthorProfile>,
): T[] {
  return reviews.map(r => {
    if (r.profile?.name) return r
    const s = server.get(r.pubkey)
    const name = typeof s?.authorName === 'string' ? s.authorName.trim() : ''
    if (name === '') return r
    const nip05 = r.profile?.nip05 ?? (typeof s?.authorNip05 === 'string' && s.authorNip05.trim() !== '' ? s.authorNip05.trim() : undefined)
    return { ...r, profile: { ...r.profile, name, ...(nip05 ? { nip05 } : {}), fromServer: true } }
  })
}
