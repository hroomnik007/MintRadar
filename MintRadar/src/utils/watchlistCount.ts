// The Watchlist's "Showing X of Y" footer only appears when the list is cut
// short (X < Y); a complete list says nothing. The Watchlist has no filter or
// search, so today that means "more than one page, not scrolled to the end".
export function showWatchlistCount(shown: number, total: number): boolean {
  return total > 0 && shown < total
}
