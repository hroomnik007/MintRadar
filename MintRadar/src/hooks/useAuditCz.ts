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
  /** The validated subset of cashu.info's per-mint detail (stored by our 30-minute job) plus when it was stored. null / absent: none stored yet. */
  detail?: AuditCzDetail | null
}

export interface AuditCzDirectionCounts { total?: number; success?: number; failed?: number; avgMs?: number }

/** Every field is optional: the backend drops a malformed field instead of the record. Strings are untrusted text. */
export interface AuditCzDetail {
  swaps7d?: {
    all?: AuditCzDirectionCounts
    asSource?: AuditCzDirectionCounts
    asDest?: AuditCzDirectionCounts
    errorsBlamed?: number
    dleq?: { valid?: number; invalid?: number; missing?: number }
  }
  integrity?: {
    proof_state?: { checked?: number; spent?: number; pending?: number }
  }
  network?: { asn?: number; asName?: string; country?: string }
  onion?: boolean
  fetchedAt: string | null
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
      const res = await fetch(`/api/mints/audit-cz?url=${encodeURIComponent(url)}&limit=100&direction=both`)
      if (!res.ok) throw new Error('Failed to fetch cashu.info data')
      return await res.json() as AuditCzData
    },
    enabled: wanted,
    staleTime: 60 * 1000,
  })
  return { data: query.data, loading: wanted && query.isLoading }
}
