// Dashboard list view: which column a phone shows besides Mint, status and Uptime 24h.
export type ListMobileColumn = 'latency' | 'reliability' | 'rating'

/**
 * The column that explains the current order. The list used to hide Latency, Reliability and NUTs on a phone, the
 * default sort key (Reliability Score) included, so the order could not be read off the rows.
 */
export function listMobileColumn(sortBy: string): ListMobileColumn {
  if (sortBy === 'latency') return 'latency'
  if (sortBy === 'rating' || sortBy === 'reviewCount') return 'rating'
  return 'reliability'
}
