// Shared watch-toggle star mark — filled = watched, outline = not watched.
// Used by the Dashboard/Watchlist mint card (.card-star) and the Mint Detail
// header watch toggle (.md-watch-star), so both surfaces render the exact
// same icon rather than two independently-drawn stars.
export function IcStar({ filled, size = 16 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M12 2.6l2.85 5.78 6.38.93-4.62 4.5 1.09 6.35L12 17.56 6.3 20.56l1.09-6.35L2.77 9.7l6.38-.93z"/>
    </svg>
  )
}
