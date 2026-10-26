// Review-list formatting shared by the Mint Detail page (Overview tile, review modal) and its Reviews tab
// (src/pages/mintDetail/ReviewsTab.tsx). Moved verbatim from MintDetail.tsx; only `export` was added.

export function shortNpub(npub: string): string {
  return npub.slice(0, 10) + '...' + npub.slice(-4)
}
export function formatReviewDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/** A five-character ★/☆ string for a rating, rounded to whole stars. */
export function starString(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)))
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}
/** Page numbers to show in a pager, collapsing long runs to '…'. */
export function reviewPageList(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) out.push('…')
  for (let i = start; i <= end; i++) out.push(i)
  if (end < total - 1) out.push('…')
  out.push(total)
  return out
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
