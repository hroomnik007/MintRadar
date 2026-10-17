// Title, description and canonical path of the static documentation pages whose link previews matter. ONE source
// for both users of this text: the pages themselves (src/pages/Methodology.tsx, ForWallets.tsx, through
// useDocumentMeta) and the bot HTML of GET /api/og/page (backend/src/og.ts), which nginx serves to social
// crawlers for exactly these paths (deploy/nginx.conf). This file has no imports, so this frontend copy is
// byte-identical to backend/src/shared/pageMeta.ts (code, comments aside); src/__tests__/sharedModules.test.ts
// fails when they drift and src/__tests__/pageMeta.test.tsx checks that the pages set exactly these values.
// SOURCE OF TRUTH is the backend file: change it there first and mirror the change here.
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

// The strict allowlist of GET /api/og/page?p=<slug>: slug -> path. Anything else is a 404; nothing the caller
// sends is ever copied into the response.
export const OG_PAGE_SLUGS = {
  methodology: '/methodology',
  'for-wallets': '/for-wallets',
} as const satisfies Record<string, PageMetaPath>
