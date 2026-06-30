// Pure NIP-87 (kind:38000) review rating/comment parsing used by
// GET /api/mints/nostr-reviews.
//
// Precedence:
//   1. A `rating` tag wins if present AND in range 1-5; out-of-range tag
//      ratings are discarded (treated as no rating).
//   2. Otherwise fall back to a leading "[X/5]" marker in the content. NOTE:
//      the content fallback is NOT range-checked, so "[6/5]" yields rating 6
//      and "[0/5]" yields rating 0 — only single digits 0-9 match the regex.
//   3. The comment is the `comment` tag value if present, else the content,
//      with any leading "[X/5] " marker stripped.
//
// Extracted from index.ts so the parsing is unit-testable without starting
// the Express server. Behaviour mirrors the inline logic exactly.
export interface ParsedReview {
  rating: number | null
  comment: string
}

export function parseReviewRatingAndComment(
  tags: string[][],
  content: string
): ParsedReview {
  const ratingTag = tags.find(t => t[0] === 'rating')
  const commentTag = tags.find(t => t[0] === 'comment')
  let rating: number | null = ratingTag ? parseInt(ratingTag[1] ?? '', 10) : null
  if (rating !== null && (rating < 1 || rating > 5)) rating = null
  // Fallback: extract rating from content "[X/5] ..." format
  const contentMatch = !rating ? /^\[(\d)\/5\]/.exec(content ?? '') : null
  if (contentMatch) rating = parseInt(contentMatch[1]!, 10)
  const rawComment = commentTag ? (commentTag[1] ?? '') : (content ?? '')
  const comment = rawComment.replace(/^\[\d\/5\]\s*/, '').trim()
  return { rating, comment }
}
