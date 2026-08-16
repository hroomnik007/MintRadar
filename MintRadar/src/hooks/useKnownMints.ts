import { useQuery } from '@tanstack/react-query'

export interface KnownMint {
  url: string
  name: string | null
  iconUrl: string | null
  degraded: boolean
  online: boolean | null
  latencyMs: number | null
  version: string | null
  nutCount: number | null
  tosUrl: string | null
  descriptionLong: string | null
  nutsLimits: Record<string, unknown> | null
  units?: string[] | null
  mintMethods?: { method: string; unit: string; [key: string]: unknown }[] | null
  meltMethods?: { method: string; unit: string; [key: string]: unknown }[] | null
  auditNMints?: number | null
  auditNMelts?: number | null
  auditNErrors?: number | null
  auditCheckedAt?: string | null
  auditRecentTotal?: number | null
  auditRecentErrors?: number | null
  discoveredAt?: string | null
  trustScore?: number | null
  lastError?: string | null
  uptimePct24h?: number | null
  serverLocation?: string | null
  lastCheckedAt?: string | null
}

async function fetchKnownMints(): Promise<KnownMint[]> {
  const res = await fetch('/api/mints/known')
  if (!res.ok) throw new Error('Failed to fetch known mints')
  const data = await res.json() as KnownMint[]
  return data
}

export function useKnownMints() {
  return useQuery({
    queryKey: ['mints-known'],
    queryFn: fetchKnownMints,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 2,
  })
}
