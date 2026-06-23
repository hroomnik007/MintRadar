import { useQuery } from '@tanstack/react-query'
import { fetchNostrMints, type NostrMintEvent } from '@core/nostr/mintDiscovery'

export function useNostrMints(): { mints: NostrMintEvent[]; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useQuery({
    queryKey: ['nostr', 'mints'],
    queryFn: () => fetchNostrMints(),
    staleTime: 10 * 60 * 1000,
    retry: 1,
    initialData: [] as NostrMintEvent[],
  })

  return { mints: data, isLoading, error }
}
