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
    melts: AuditCzDirectionStats
    mints: AuditCzDirectionStats
    avgDurationMsPaid: number | null
    swapsCounted: number
  } | null
  /** The validated subset of cashu.info's per-mint detail (stored by our 30-minute job) plus when it was stored. null / absent: none stored yet. */
  detail?: AuditCzDetail | null
  /** MintRadar's own count of the stored swaps per UTC day, last 7 days, oldest first. */
  daily7d?: Array<{ day: string; ok: number; failed: number; other: number }>
  /** The long window of the score (up to 28 days); null while only 7 days are stored. */
  long?: { windowDays: number; swaps: number; attributedFailures: number } | null
  /** Every stored 7-day total that does not overlap, added up. */
  since?: { day: string; swaps: number; attributedFailures: number } | null
  /** Non-overlapping 7-day snapshots, oldest first. Absent when not covered. */
  weeks?: AuditCzWeek[]
  /** Sums of `weeks` for the 7-day, 28-day and all-history views. Absent when not covered. */
  totals?: AuditCzTotals
  /** Official 7-day and 30-day views for the Audit tab (display only). Absent when not covered. */
  periods?: AuditCzPeriods
  /** Oldest stored swap for this mint (ISO). Null when none. Absent when not covered. */
  swapsSince?: string | null
}

export interface AuditCzWeekDirection {
  total: number | null
  success: number | null
  failed: number | null
  avgMs: number | null
  amount: number | null
  fees: number | null
}

export interface AuditCzWeek {
  start: string
  end: string
  swaps: number
  attributedFailures: number
  failed: number | null
  succeeded: number | null
  failedElsewhere: number | null
  avgMs: number | null
  amount: number | null
  fees: number | null
  deposits: AuditCzWeekDirection | null
  withdrawals: AuditCzWeekDirection | null
}

export interface AuditCzPeriodTotal {
  days: number
  weeks: number
  start: string
  end: string
  swaps: number
  attributedFailures: number
  outcomes: { since: string; swaps: number; succeeded: number; failedElsewhere: number; attributedFailures: number } | null
  directions: { since: string; deposits: { total: number; success: number; failed: number }; withdrawals: { total: number; success: number; failed: number } } | null
}

export interface AuditCzTotals { d7: AuditCzPeriodTotal | null; d28: AuditCzPeriodTotal | null; all: AuditCzPeriodTotal | null }

export interface AuditCzPeriodSplit { success: number; total: number; failed: number }

/** One official cashu.info window for the Audit tab. Success rate is succeeded / swaps. */
export interface AuditCzPeriodView {
  days: 7 | 30
  swaps: number
  succeeded: number
  failedElsewhere: number
  attributedFailures: number
  avgMs: number | null
  amount?: number | null
  deposits: AuditCzPeriodSplit | null
  withdrawals: AuditCzPeriodSplit | null
  fetchedAt: string | null
}

export interface AuditCzPeriods { d7: AuditCzPeriodView | null; d30: AuditCzPeriodView | null }


export interface AuditCzDirectionCounts { total?: number; success?: number; failed?: number; avgMs?: number; amount?: number; fees?: number }

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
      const res = await fetch(`/api/mints/audit-cz?url=${encodeURIComponent(url)}&days=30&limit=500&direction=both`)
      if (!res.ok) throw new Error('Failed to fetch cashu.info data')
      return await res.json() as AuditCzData
    },
    enabled: wanted,
    staleTime: 60 * 1000,
  })
  return { data: query.data, loading: wanted && query.isLoading }
}
