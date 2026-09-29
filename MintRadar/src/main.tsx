import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { router } from '@/App'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { restoreBunkerSession } from '@/core/nostr/client'
import { reloadOnChunkError } from '@/utils/chunkReload'
import './index.css'

// Vite fires this when a lazy chunk or its preloaded deps fail to load (stale
// build after a deploy). If we can reload, swallow the error; otherwise let it
// propagate to the router's errorElement.
window.addEventListener('vite:preloadError', event => {
  if (reloadOnChunkError((event as Event & { payload?: unknown }).payload)) event.preventDefault()
})

void useWatchlistStore.getState().loadFromDb()
void restoreBunkerSession()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
