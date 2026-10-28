import { Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import RouteError from '@/components/RouteError'
import Dashboard from '@/pages/Dashboard'
// Watchlist.css and MintDetail.css stay in the initial (render-blocking) CSS although their pages are lazy: Dashboard,
// the compare picker / comparison modal, the login modal and the cards rely on rules in them (.cmp-overlay, .cmp-modal,
// .rv-modal*, .rv-btn-*, .md-watch-star, the .sk-* skeletons) and on their cascade position. Imported here, where the
// eager Watchlist / MintNaddr imports used to put them, so the bundled CSS order is unchanged
// (docs/claude/deploy-and-infra.md, "Code splitting & bundle layout").
import '@/pages/Watchlist.css'
import '@/pages/MintDetail.css'
import Learn from '@/pages/Learn'
import LearnModule from '@/pages/LearnModule'
import Wallets from '@/pages/Wallets'
import NotFound from '@/pages/NotFound'
// Moved into their own module (routerLazy.tsx) so this file's only export is
// `router` — a file mixing component exports with a non-component export
// breaks react-refresh's fast-refresh detection (react-refresh/only-export-components).
import { StatsPageHead } from '@/components/stats/StatsPageHead'
import { Stats, MintDetail, Tools, About, Methodology, ForWallets, Watchlist, MintNaddr } from '@/routerLazy'

const lazyFallback = (
  <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
)

// The fallback of the long lazy routes (Stats, Tools, Mint Detail, Watchlist, Nostr mint page) is as tall as the viewport, so the footer is already
// below the fold when the first frame is painted and does not jump out of view when the page arrives
// (docs/claude/stats-dashboard-watchlist-ui.md, "Layout shift rule").
const viewportFallback = (
  <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text2)', minHeight: '100vh' }}>Loading…</div>
)

// The /stats fallback paints the page header (no data, not lazy) so the title and the description do not wait for the Stats
// chunk. The waiting note below it has the box of Stats' own `.stats-loading` (Stats.css is in the lazy chunk and is not
// loaded yet), and the whole fallback is as tall as the viewport for the same footer reason as viewportFallback.
const statsFallback = (
  <div style={{ minHeight: '100vh' }}>
    <StatsPageHead />
    <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 13, maxWidth: 'var(--dash-chrome-max)', marginInline: 'auto', width: '100%', boxSizing: 'content-box' }}>Loading…</div>
  </div>
)

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'watchlist', element: <Suspense fallback={viewportFallback}><Watchlist /></Suspense> },
      { path: 'stats', element: <Suspense fallback={statsFallback}><Stats /></Suspense> },
      { path: 'tools', element: <Suspense fallback={viewportFallback}><Tools /></Suspense> },
      { path: 'about', element: <Suspense fallback={lazyFallback}><About /></Suspense> },
      { path: 'methodology', element: <Suspense fallback={lazyFallback}><Methodology /></Suspense> },
      { path: 'for-wallets', element: <Suspense fallback={lazyFallback}><ForWallets /></Suspense> },
      { path: 'wallets', element: <Wallets /> },
      { path: 'learn', element: <Learn /> },
      { path: 'learn/:moduleId', element: <LearnModule /> },
      { path: 'mint/nostr/:naddr', element: <Suspense fallback={viewportFallback}><MintNaddr /></Suspense> },
      { path: 'mint/:url', element: <Suspense fallback={viewportFallback}><MintDetail /></Suspense> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
