import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,   // 2 min — data stays fresh without refetch
      gcTime: 10 * 60 * 1000,     // 10 min — keep in cache after unmount
      retry: false,                // axios interceptor handles token refresh; don't retry on auth failure
    },
  },
})
