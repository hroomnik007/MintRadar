// Title + description for routes whose page component has no copy of its own. Pages that already
// pass text to useDocumentMeta (Dashboard, Learn, Wallets, Stats, Tools, Watchlist, About, Mint Detail)
// keep it there; add a route here only when its page did not call the hook.
// The one site description: index.html (description, og:description, twitter:description) and the Dashboard
// (the root route) carry exactly this text; src/__tests__/siteDescription.test.ts keeps them equal.
export const SITE_DESCRIPTION =
  'Find Cashu mints and see how well they run: uptime, latency, supported NUTs and a Reliability Score. Open source, privacy first.'

export const ROUTE_META = {
  nuts: {
    title: 'Cashu NUT Explorer - MintRadar',
    description: 'Cashu protocol NUT adoption across online mints: which NUT specifications each tracked mint supports.',
  },
} as const
