import { lazy } from 'react'

// Stats and MintDetail are the only pages that pull in Recharts (~380 kB chunk),
// so they load lazily — the chart vendor bundle is fetched only when first visited.
export const Stats = lazy(() => import('@/pages/Stats'))
export const MintDetail = lazy(() => import('@/pages/MintDetail'))
// Tools is the only page that pulls in @cashu/cashu-ts (~13 kB gzip, Token
// Inspector) — same reasoning, it must not sit in the initial payload.
export const Tools = lazy(() => import('@/pages/Tools'))
