import { Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import Dashboard from '@/pages/Dashboard'
import Watchlist from '@/pages/Watchlist'
import NutExplorer from '@/pages/NutExplorer'
import MintNaddr from '@/pages/MintNaddr'
import Learn from '@/pages/Learn'
import LearnModule from '@/pages/LearnModule'
import Wallets from '@/pages/Wallets'
// Moved into their own module (routerLazy.tsx) so this file's only export is
// `router` — a file mixing component exports with a non-component export
// breaks react-refresh's fast-refresh detection (react-refresh/only-export-components).
import { Stats, MintDetail, Tools } from '@/routerLazy'

const lazyFallback = (
  <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
)

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'watchlist', element: <Watchlist /> },
      { path: 'stats', element: <Suspense fallback={lazyFallback}><Stats /></Suspense> },
      { path: 'tools', element: <Suspense fallback={lazyFallback}><Tools /></Suspense> },
      { path: 'wallets', element: <Wallets /> },
      { path: 'learn', element: <Learn /> },
      { path: 'learn/:moduleId', element: <LearnModule /> },
      { path: 'nuts', element: <NutExplorer /> },
      { path: 'mint/nostr/:naddr', element: <MintNaddr /> },
      { path: 'mint/:url', element: <Suspense fallback={lazyFallback}><MintDetail /></Suspense> },
    ],
  },
])
