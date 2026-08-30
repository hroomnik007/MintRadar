import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { prefetchMintDetail } from '@/core/mint/prefetch'

// Hover-intent delay before prefetching Mint Detail data. A genuine "I'm about
// to click this" hover lasts well over 150ms; a fast mouse-sweep across a grid
// of cards does not — so this keeps a sweep from firing a burst of prefetches
// (each mint = a live probe + a couple of history queries) that the user never
// actually wanted. Prefetches that DO lead to a click are net-neutral on
// request count: the queryKeys match Mint Detail's own useQuery calls exactly,
// so navigation reuses the primed cache instead of refetching.
const HOVER_INTENT_MS = 150

export function useMintHoverPrefetch(): {
  onMintPointerEnter: (url: string) => void
  onMintPointerLeave: () => void
} {
  const queryClient = useQueryClient()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const onMintPointerEnter = useCallback((url: string) => {
    clear()
    timer.current = setTimeout(() => {
      timer.current = null
      prefetchMintDetail(queryClient, url)
    }, HOVER_INTENT_MS)
  }, [clear, queryClient])

  useEffect(() => clear, [clear])

  return { onMintPointerEnter, onMintPointerLeave: clear }
}
