import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import Dashboard from '@/pages/Dashboard'
import Watchlist from '@/pages/Watchlist'
import NutExplorer from '@/pages/NutExplorer'
import MintNaddr from '@/pages/MintNaddr'
import Learn from '@/pages/Learn'
import LearnModule from '@/pages/LearnModule'

// Stats and MintDetail are the only pages that pull in Recharts (~380 kB chunk),
// so they load lazily — the chart vendor bundle is fetched only when first visited.
const Stats = lazy(() => import('@/pages/Stats'))
const MintDetail = lazy(() => import('@/pages/MintDetail'))
// Tools is the only page that pulls in @cashu/cashu-ts (~13 kB gzip, Token
// Inspector) — same reasoning, it must not sit in the initial payload.
const Tools = lazy(() => import('@/pages/Tools'))

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
      { path: 'learn', element: <Learn /> },
      { path: 'learn/:moduleId', element: <LearnModule /> },
      { path: 'nuts', element: <NutExplorer /> },
      { path: 'mint/nostr/:naddr', element: <MintNaddr /> },
      { path: 'mint/:url', element: <Suspense fallback={lazyFallback}><MintDetail /></Suspense> },
    ],
  },
])
