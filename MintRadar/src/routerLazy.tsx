import { lazy } from 'react'

// Stats and MintDetail are the only pages that pull in Recharts (~380 kB chunk),
// so they load lazily — the chart vendor bundle is fetched only when first visited.
export const Stats = lazy(() => import('@/pages/Stats'))
export const MintDetail = lazy(() => import('@/pages/MintDetail'))
// Tools is the only page that pulls in @cashu/cashu-ts (~13 kB gzip, Token
// Inspector) — same reasoning, it must not sit in the initial payload.
export const Tools = lazy(() => import('@/pages/Tools'))
// About is a long static text page: no reason to put it in the initial payload.
export const About = lazy(() => import('@/pages/About'))
// Methodology is a long static text page (the Reliability Score reference): not in the initial payload.
export const Methodology = lazy(() => import('@/pages/Methodology'))
// For wallets is a long static text page (the API quick start): not in the initial payload.
export const ForWallets = lazy(() => import('@/pages/ForWallets'))
// Watchlist (relay sync, Nostr follow recommendations) and the Nostr-announced mint page (MintNaddr) are the pages that
// import nostr-tools directly; lazy, so the Nostr vendor bundle is not in the initial payload (src/core/nostr/lazy.ts).
export const Watchlist = lazy(() => import('@/pages/Watchlist'))
export const MintNaddr = lazy(() => import('@/pages/MintNaddr'))
