// Review-list formatting shared by the Mint Detail page (Overview tile, review modal) and its Reviews tab
// (src/pages/mintDetail/ReviewsTab.tsx). Moved verbatim from MintDetail.tsx; only `export` was added.

// The one short npub form lives in src/utils/npub.ts; re-exported for the Mint Detail imports.
export { shortNpub } from '@/utils/npub'
export function formatReviewDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/** A five-character ★/☆ string for a rating, rounded to whole stars. */
export function starString(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)))
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}
export interface MergedReviewCandidate {
  id: string
  pubkey: string
  rating: number | null
  comment: string
  createdAt: number
  source: 'mintradar' | 'nostr'
  profile?: { name?: string; nip05?: string; picture?: string; fromServer?: boolean }
}
