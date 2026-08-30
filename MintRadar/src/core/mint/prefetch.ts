import type { QueryClient } from '@tanstack/react-query'
import { mintProbeQueryOptions } from '@/hooks/useMintProbe'

// Warm the caches Mint Detail reads, triggered on hover/pointer-enter of a mint
// card (MintCard.tsx). By the time the user finishes the click + the lazy
// MintDetail chunk loads, the slow requests (the live probe especially) are
// already done or in-flight, so the page paints its live data seconds sooner.
//
// Every queryKey / queryFn here MUST match the corresponding useQuery in
// MintDetail.tsx exactly, or the prefetch primes a different cache slot and
// does nothing. `prefetchQuery` is a no-op when a fresh (non-stale) entry
// already exists, so repeated hovers are cheap.
//
// Deliberately NOT prefetched: the chart-history query only for the *default*
// 7d interval + the 24h header query. Other intervals (24h/30d/90d) are
// user-triggered on the page itself and not worth the hover cost.

const HISTORY_STALE_MS = 5 * 60 * 1000
const VERSION_HISTORY_STALE_MS = 10 * 60 * 1000
const NOSTR_REVIEWS_STALE_MS = 2 * 60 * 1000

export function prefetchMintDetail(queryClient: QueryClient, url: string): void {
  if (!url) return

  void queryClient.prefetchQuery(mintProbeQueryOptions(url))

  void queryClient.prefetchQuery({
    queryKey: ['mint', 'chart-history', url, '7d'],
    queryFn: async () => {
      const res = await fetch(`/api/mints/history?url=${encodeURIComponent(url)}&period=7d`)
      if (!res.ok) throw new Error('Failed to fetch chart history')
      return res.json()
    },
    staleTime: HISTORY_STALE_MS,
  })

  void queryClient.prefetchQuery({
    queryKey: ['mint', 'history-api', url, '24h'],
    queryFn: async () => {
      const res = await fetch(`/api/mints/history?url=${encodeURIComponent(url)}&period=24h`)
      if (!res.ok) throw new Error('Failed to fetch history')
      return res.json()
    },
    staleTime: HISTORY_STALE_MS,
  })

  void queryClient.prefetchQuery({
    queryKey: ['mint', 'version-history', url],
    queryFn: async () => {
      const res = await fetch(`/api/mints/version-history?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error('Failed to fetch version history')
      return res.json()
    },
    staleTime: VERSION_HISTORY_STALE_MS,
  })

  void queryClient.prefetchQuery({
    queryKey: ['mint', 'nostr-reviews', url],
    queryFn: async () => {
      const res = await fetch(`/api/mints/nostr-reviews?url=${encodeURIComponent(url)}`)
      if (!res.ok) return []
      return res.json()
    },
    staleTime: NOSTR_REVIEWS_STALE_MS,
  })
}
