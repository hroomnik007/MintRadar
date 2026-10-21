import type { QueryClient } from '@tanstack/react-query'
import { mintProbeQueryOptions } from '@/hooks/useMintProbe'
import { KNOWN_MINTS_QUERY_KEY } from '@/hooks/useKnownMints'

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
      if (!res.ok) throw new Error('Failed to fetch stored reviews')
      return res.json()
    },
    staleTime: NOSTR_REVIEWS_STALE_MS,
  })
}

// Warm the Stats page: the lazy chunk (Recharts, ~380 kB) and the /api/stats
// payload. Triggered on hover/focus/touch of the "Stats" nav tab so both are
// usually done by the time the click lands. queryKey / queryFn / staleTime MUST
// match the useQuery in Stats.tsx exactly (same rule as prefetchMintDetail).
export function prefetchStats(queryClient: QueryClient): void {
  void import('@/pages/Stats')
  void queryClient.prefetchQuery({
    queryKey: ['stats'],
    queryFn: async () => {
      const res = await fetch('/api/stats')
      if (!res.ok) throw new Error('Failed to fetch stats')
      return res.json()
    },
    staleTime: 2 * 60 * 1000,
  })
}

// How long the idle warm-up of the Stats page waits for a mint list that nobody asked for (routes that never read it,
// such as /about) before it starts anyway. A list that is being fetched is always waited for, however long it takes.
export const STATS_WARMUP_FALLBACK_MS = 5000

// The idle warm-up of the Stats page (chunk + Recharts + /api/stats, ~100 kB gzip) used to start at app start and
// competed with the mint list and the icons for bandwidth. It now starts once the mint list has settled (data or
// error), one painted frame later so the cards are in the DOM, then at the next idle moment. Where nothing fetches
// the list (the query does not exist after STATS_WARMUP_FALLBACK_MS) it starts anyway. Returns the cancel function.
// `waitForList: false` is for /stats itself: there the warm-up competes with nothing (the page is loading that very chunk)
// and fetches /api/stats in parallel with the lazy chunk; skipping it there made the Stats LCP ~200 ms later (local
// 150 ms / 1.6 Mbit/s / CPU 4x run). The hover/focus/touch warm-up of the Stats tab is separate and unchanged.
export function scheduleStatsWarmup(queryClient: QueryClient, warm: () => void, waitForList = true): () => void {
  let done = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let raf: number | undefined
  let idle: number | undefined
  const cache = queryClient.getQueryCache()

  const listSettled = (): boolean => {
    const state = queryClient.getQueryState(KNOWN_MINTS_QUERY_KEY)
    return state !== undefined && (state.data !== undefined || state.status === 'error')
  }
  const listFetching = (): boolean => queryClient.getQueryState(KNOWN_MINTS_QUERY_KEY)?.fetchStatus === 'fetching'

  const start = (): void => {
    if (done) return
    done = true
    unsubscribe()
    clearTimeout(timer)
    raf = requestAnimationFrame(() => {
      const ric = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
      if (ric) idle = ric(warm)
      else timer = setTimeout(warm, 2000)
    })
  }
  const check = (): void => { if (listSettled()) start() }

  const unsubscribe = cache.subscribe(check)
  timer = setTimeout(() => { if (!listFetching()) start() }, STATS_WARMUP_FALLBACK_MS)
  if (waitForList) check()
  else start()

  return () => {
    done = true
    unsubscribe()
    clearTimeout(timer)
    if (raf !== undefined) cancelAnimationFrame(raf)
    if (idle !== undefined) (window as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idle)
  }
}
