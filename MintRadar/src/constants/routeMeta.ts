// Title + description for routes whose page component has no copy of its own. Pages that already
// pass text to useDocumentMeta (Dashboard, Learn, Wallets, Stats, Tools, Watchlist, About, Mint Detail)
// keep it there; add a route here only when its page did not call the hook.
export const ROUTE_META = {
  nuts: {
    title: 'Cashu NUT Explorer - MintRadar',
    description: 'Cashu protocol NUT adoption across online mints: which NUT specifications each tracked mint supports.',
  },
} as const
