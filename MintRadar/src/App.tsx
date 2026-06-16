import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import Dashboard from '@/pages/Dashboard'
import Watchlist from '@/pages/Watchlist'
import Stats from '@/pages/Stats'
import NutExplorer from '@/pages/NutExplorer'
import MintDetail from '@/pages/MintDetail'
import MintNaddr from '@/pages/MintNaddr'

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'watchlist', element: <Watchlist /> },
      { path: 'stats', element: <Stats /> },
      { path: 'nuts', element: <NutExplorer /> },
      { path: 'mint/nostr/:naddr', element: <MintNaddr /> },
      { path: 'mint/:url', element: <MintDetail /> },
    ],
  },
])
