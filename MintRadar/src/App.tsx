import { Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import RouteError from '@/components/RouteError'
import Dashboard from '@/pages/Dashboard'
import Watchlist from '@/pages/Watchlist'
import NutExplorer from '@/pages/NutExplorer'
import MintNaddr from '@/pages/MintNaddr'
import Learn from '@/pages/Learn'
import LearnModule from '@/pages/LearnModule'
import Wallets from '@/pages/Wallets'
import NotFound from '@/pages/NotFound'
// Moved into their own module (routerLazy.tsx) so this file's only export is
// `router` — a file mixing component exports with a non-component export
// breaks react-refresh's fast-refresh detection (react-refresh/only-export-components).
import { Stats, MintDetail, Tools, About, Methodology, ForWallets } from '@/routerLazy'

const lazyFallback = (
  <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
)

// The fallback of the long lazy routes (Stats, Tools, Mint Detail) is as tall as the viewport, so the footer is already
// below the fold when the first frame is painted and does not jump out of view when the page arrives
// (docs/claude/stats-dashboard-watchlist-ui.md, "Layout shift rule").
const viewportFallback = (
  <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text2)', minHeight: '100vh' }}>Loading…</div>
)

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'watchlist', element: <Watchlist /> },
      { path: 'stats', element: <Suspense fallback={viewportFallback}><Stats /></Suspense> },
      { path: 'tools', element: <Suspense fallback={viewportFallback}><Tools /></Suspense> },
      { path: 'about', element: <Suspense fallback={lazyFallback}><About /></Suspense> },
      { path: 'methodology', element: <Suspense fallback={lazyFallback}><Methodology /></Suspense> },
      { path: 'for-wallets', element: <Suspense fallback={lazyFallback}><ForWallets /></Suspense> },
      { path: 'wallets', element: <Wallets /> },
      { path: 'learn', element: <Learn /> },
      { path: 'learn/:moduleId', element: <LearnModule /> },
      { path: 'nuts', element: <NutExplorer /> },
      { path: 'mint/nostr/:naddr', element: <MintNaddr /> },
      { path: 'mint/:url', element: <Suspense fallback={viewportFallback}><MintDetail /></Suspense> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
