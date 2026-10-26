// Title, description and canonical path of the static documentation pages whose link previews matter. ONE source
// for both users of this text: the pages themselves (src/pages/Methodology.tsx, ForWallets.tsx, through
// useDocumentMeta) and the bot HTML of GET /api/og/page (backend/src/og.ts), which nginx serves to social
// crawlers for exactly these paths (deploy/nginx.conf). This file has no imports, so the frontend copy
// src/utils/pageMeta.ts is byte-identical (code, comments aside); src/__tests__/sharedModules.test.ts fails when
// they drift and src/__tests__/pageMeta.test.tsx checks that the pages set exactly these values.
//
// A new static page that needs a correct preview: add it to PAGE_META and OG_PAGE_SLUGS here (and in the frontend
// copy), and add its fixed `location = /path` bot rule to deploy/nginx.conf (docs/claude/deploy-and-infra.md).

export interface PageMeta {
  title: string
  description: string
  // The path of the canonical URL (https://mintradar.org + canonicalPath); equals the key it is stored under.
  canonicalPath: string
}

export const PAGE_META = {
  '/methodology': {
    title: 'How the Reliability Score is computed | MintRadar',
    description: 'The exact, versioned description of the MintRadar Reliability Score: five components, weights, data sources, caps and the change log of the formula.',
    canonicalPath: '/methodology',
  },
  '/for-wallets': {
    title: 'MintRadar for wallets | Cashu mint health API',
    description: 'Free, stable JSON API for Cashu mint health: score, status, uptime, software and audit. CORS enabled, cached, versioned.',
    canonicalPath: '/for-wallets',
  },
} as const satisfies Record<string, PageMeta>

export type PageMetaPath = keyof typeof PAGE_META

// The one site description: index.html (description, og:description, twitter:description) and the Dashboard
// (the root route) carry exactly this text; src/__tests__/siteDescription.test.ts keeps them equal.
export const SITE_DESCRIPTION =
  'Find Cashu mints and see how well they run: uptime, latency, supported NUTs and a Reliability Score. Open source, privacy first.'

export interface RouteMeta {
  title: string
  description: string
  // Watchlist: a per-visitor page with nothing worth indexing ("noindex, follow").
  noindex?: boolean
}

// Title and description of every static route of the app (src/App.tsx), keyed by the route path. The pages pass
// exactly these values to useDocumentMeta, and the backend (spaHtml.ts) writes the same values into the head of
// index.html for a request without JavaScript (crawlers, link previews), so the two can never disagree.
export const ROUTE_META_BY_PATH = {
  '/': { title: 'MintRadar - Cashu Mints Directory & Reliability Score Monitor', description: SITE_DESCRIPTION },
  '/stats': {
    title: 'Cashu Mints Network Stats - MintRadar',
    description: 'Live network-wide stats for Cashu mints: uptime, average Reliability Score, latency, NUT adoption and the Network Health Index.',
  },
  '/tools': {
    title: 'Cashu Mint Tools - Token Inspector & Best Mint Finder | MintRadar',
    description: 'Inspect a Cashu token before redeeming it, or find the best Cashu mint for you with the Best Mint wizard.',
  },
  '/learn': {
    title: 'Learn Cashu - MintRadar',
    description: 'A short course on how Cashu works, what can go wrong, and how to choose a safe Cashu mint.',
  },
  '/wallets': {
    title: 'Cashu Wallets - MintRadar',
    description: 'Wallets that work with Cashu mints, plus how to run your own mint. A plain list, no ranking or reviews.',
  },
  '/about': {
    title: 'About and privacy | MintRadar',
    description: 'What MintRadar is, how it measures Cashu mints, what data it keeps about you and the rules of using it.',
  },
  '/nuts': {
    title: 'Cashu NUT Explorer - MintRadar',
    description: 'Cashu protocol NUT adoption across online mints: which NUT specifications each tracked mint supports.',
  },
  '/watchlist': {
    title: 'My Watchlist - MintRadar',
    description: 'Track your favorite Cashu mints and optionally get a Nostr DM when one goes offline or comes back online.',
    noindex: true,
  },
  '/methodology': { title: PAGE_META['/methodology'].title, description: PAGE_META['/methodology'].description },
  '/for-wallets': { title: PAGE_META['/for-wallets'].title, description: PAGE_META['/for-wallets'].description },
} as const satisfies Record<string, RouteMeta>

export type RouteMetaPath = keyof typeof ROUTE_META_BY_PATH

// The catch-all 404 route (src/pages/NotFound.tsx).
export const NOT_FOUND_TITLE = 'Page not found | MintRadar'

// A Learn module page (src/pages/LearnModule.tsx): its title, and the title of an unknown module id.
export function learnModuleTitle(moduleTitle: string): string {
  return `${moduleTitle} - MintRadar Learn`
}
export const LEARN_MODULE_NOT_FOUND_TITLE = 'Module not found - MintRadar Learn'

// The Mint Detail page (src/pages/MintDetail.tsx). `known` is the tracked row (null while it is not known):
// operational data only (status and the Reliability Score as a number), never a verdict on the mint.
export function mintDetailMeta(
  displayName: string,
  host: string,
  known: { online?: boolean | null; reliabilityScore?: number | null } | null,
): { title: string; description: string } {
  return {
    title: `${displayName} - Cashu Mint Reliability Score & Uptime | MintRadar`,
    description: known
      ? `${displayName} (${host}) is ${known.online ? 'online' : 'offline'} with a Reliability Score of ${known.reliabilityScore ?? '\u2014'}/100. See live uptime, latency, NUT support and reviews on MintRadar.`
      : `Live Reliability Score, uptime, latency and NUT support for the Cashu mint ${host} on MintRadar.`,
  }
}

// Server-side only (backend/src/spaHtml.ts): the head of a /mint/ address that is not a tracked mint, or not a
// valid mint address at all. The page itself renders its own "not tracked" / "invalid" state in the browser.
export const MINT_NOT_FOUND_TITLE = 'Mint not found | MintRadar'

// The strict allowlist of GET /api/og/page?p=<slug>: slug -> path. Anything else is a 404; nothing the caller
// sends is ever copied into the response.
export const OG_PAGE_SLUGS = {
  methodology: '/methodology',
  'for-wallets': '/for-wallets',
} as const satisfies Record<string, PageMetaPath>
