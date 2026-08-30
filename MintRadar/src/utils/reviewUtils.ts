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
// Rating precedence: valid `rating` tag (1-5) > "[X/5]" content marker.
// Events with neither rating nor non-empty comment are excluded downstream.
export function parseReviewEvent(e: ReviewEvent): ParsedReview {
  const ratingTag = e.tags.find(t => t[0] === 'rating')
  const commentTag = e.tags.find(t => t[0] === 'comment')
  let rating: number | null = ratingTag ? parseInt(ratingTag[1] ?? '', 10) : null
  if (rating !== null && (rating < 1 || rating > 5)) rating = null
  // Fallback: extract rating from content "[X/5] ..." format
  const contentMatch = !rating ? /^\[(\d)\/5\]/.exec(e.content ?? '') : null
  if (contentMatch?.[1]) rating = parseInt(contentMatch[1], 10)
  const rawComment = commentTag ? (commentTag[1] ?? '') : (e.content ?? '')
  const comment = rawComment.replace(/^\[\d\/5\]\s*/, '').trim()
  return { id: e.id, pubkey: e.pubkey, rating, comment, createdAt: e.created_at }
}

// Sort newest-first. Rating-less / comment-less events are kept: a bare kind:38000
// event pointing at a mint is still an endorsement and is counted as a review
// (matches how cashumints.space counts). The average-rating calculation excludes
// them separately (see MintDetail.tsx) — they never carried a score to begin with.
export function sortReviewsByNewest(parsed: ParsedReview[]): ParsedReview[] {
  return [...parsed].sort((a, b) => b.createdAt - a.createdAt)
}

// Convenience: run the full dedup → parse → sort pipeline.
export function processReviewEvents(events: ReviewEvent[]): ParsedReview[] {
  const deduped = deduplicateByPubkey(events)
  const parsed = deduped.map(parseReviewEvent)
  return sortReviewsByNewest(parsed)
}
