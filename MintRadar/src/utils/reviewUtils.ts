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

// Filter events with neither rating nor comment, then sort newest-first.
export function filterAndSortReviews(parsed: ParsedReview[]): ParsedReview[] {
  return parsed
    .filter(r => r.rating !== null || r.comment.length > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
}

// Convenience: run the full dedup → parse → filter+sort pipeline.
export function processReviewEvents(events: ReviewEvent[]): ParsedReview[] {
  const deduped = deduplicateByPubkey(events)
  const parsed = deduped.map(parseReviewEvent)
  return filterAndSortReviews(parsed)
}
