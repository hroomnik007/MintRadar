import { useQuery } from '@tanstack/react-query'
import { useKnownMints } from '@/hooks/useKnownMints'

// cashu.info data (second audit source), read from OUR backend
// (/api/mints/audit-cz) — the browser never contacts cashu.info. Display only.
export interface AuditCzData {
  source: string
  sourceUrl: string | null
  fetchedAt: string | null
  covered: boolean
  mint: {
    state: string
    uptime24h: number | null
    uptime7d: number | null
    uptime30d: number | null
    attributedFailures: number | null
    minted: number | null
    melted: number | null
    lastCheck: string | null
  } | null
  swaps: Array<{
    id: string
    at: string
    status: string
    stage: string | null
    error: string | null
    amount: number | null
    fee: number | null
    durationMs: number | null
    direction: 'from' | 'to'
    otherMintUrl: string | null
    otherMintName: string | null
  }>
  /** Counted by MintRadar over the swaps it stored (not published by cashu.info). */
  stats7d: {
    windowDays: 7
    collectedSince: string | null
    melts: AuditCzDirectionStats
    mints: AuditCzDirectionStats
    avgDurationMsPaid: number | null
    swapsCounted: number
  } | null
  /** null / absent when the detail could not be fetched: the tile then falls back to the stored swaps. */
  detail7d?: AuditCzDetail7d | null
}

/** cashu.info's own 7-day swap counts for this mint (our backend caches them up to 10 min). */
export interface AuditCzDetail7d {
  total: number
  success: number
  failed: number
  /** Failures the auditor attributes to this mint. */
  errorsBlamed: number
  /** asDest.success / asSource.success (null when the source omits them). */
  minted: number | null
  melted: number | null
}

export interface AuditCzDirectionStats {
  paid: number
  failed: number
  pending: number
  amountPaid: number
  feesPaid: number
}

/** Fetches only while the Audit tab is active and the known-mints list has loaded. */
export function useAuditCz(url: string, tabActive: boolean) {
  const { data: knownMints } = useKnownMints()
  const wanted = tabActive && knownMints !== undefined
  const query = useQuery({
    queryKey: ['mint', 'audit-cz', url],
    queryFn: async () => {
      const res = await fetch(`/api/mints/audit-cz?url=${encodeURIComponent(url)}&limit=100&direction=from`)
      if (!res.ok) throw new Error('Failed to fetch cashu.info data')
      return await res.json() as AuditCzData
    },
    enabled: wanted,
    staleTime: 60 * 1000,
  })
  return { data: query.data, loading: wanted && query.isLoading }
}
