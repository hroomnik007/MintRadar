import { useQuery } from '@tanstack/react-query'
import { useKnownMints } from '@/hooks/useKnownMints'
import { useNow } from '@/hooks/useNow'
import { auditCzFallbackNeeded } from '@/utils/auditCz'

// audit.cashu.cz data (second audit source), read from OUR backend
// (/api/mints/audit-cz) — the browser never contacts audit.cashu.cz. Display only.
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
}

/**
 * Fetches only while the Audit tab is active AND the audit.8333.space data for this mint is
 * missing or stale (auditCzFallbackNeeded). `wanted` tells the caller whether the fallback applies.
 */
export function useAuditCz(url: string, tabActive: boolean) {
  const { data: knownMints } = useKnownMints()
  const now = useNow()
  const known = knownMints?.find(m => m.url === url)
  const wanted = tabActive && auditCzFallbackNeeded(
    knownMints !== undefined,
    known === undefined ? null : known.auditNMints,
    known?.auditCheckedAt ?? null,
    known?.auditSyncedAt ?? null,
    now,
  )
  const query = useQuery({
    queryKey: ['mint', 'audit-cz', url],
    queryFn: async () => {
      const res = await fetch(`/api/mints/audit-cz?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error('Failed to fetch audit.cashu.cz data')
      return await res.json() as AuditCzData
    },
    enabled: wanted,
    staleTime: 60 * 1000,
  })
  return { wanted, data: query.data }
}
