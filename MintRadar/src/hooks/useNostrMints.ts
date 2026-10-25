import { useQuery } from '@tanstack/react-query'
import type { NostrMintEvent } from '@core/nostr/mintDiscovery'

export function useNostrMints(): { mints: NostrMintEvent[]; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useQuery({
    queryKey: ['nostr', 'mints'],
    // Loaded with the query, not with the page (nostr-tools stays out of the initial bundle; lazy.ts).
    queryFn: () => import('@core/nostr/mintDiscovery').then(m => m.fetchNostrMints()),
    staleTime: 10 * 60 * 1000,
    retry: 1,
    initialData: [] as NostrMintEvent[],
  })

  return { mints: data, isLoading, error }
}
