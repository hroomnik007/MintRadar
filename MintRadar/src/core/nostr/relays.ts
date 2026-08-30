// Canonical Nostr relay sets for Cashu-mint discovery and reviews.
//
// DISCOVERY_RELAYS mirrors backend/src/discovery.ts's DISCOVERY_RELAYS — the frontend and
// backend are separate npm packages (no workspace set up between them), so this list can't
// be imported by the backend directly. Keep the two arrays in sync manually when editing.

export const DISCOVERY_RELAYS: string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://relay.snort.social',
  'wss://relay.primal.net',
  'wss://relay.cashumints.space',
  'wss://relay.azzamo.net',
  'wss://eden.nostr.land',
  'wss://nostr.wine',
  'wss://nostr-pub.wellorder.net',
  'wss://offchain.pub',
  'wss://relay.8333.space',
  'wss://nostr.oxtr.dev',
  'wss://relay.nostr.net',
  'wss://nostr21.com',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.cypherpunk.today',
]

// Discovery relays plus relay.minibits.cash (a Cashu-wallet-specific relay that tends to
// carry kind:38000 mint reviews). Used as the base for REVIEW_PUBLISH_RELAYS (propagation
// reach on write). NOT used for the client-side read path anymore — see REVIEW_READ_RELAYS.
export const REVIEW_RELAYS: string[] = [
  ...DISCOVERY_RELAYS,
  'wss://relay.minibits.cash',
]

// Curated fast-path list for READING reviews client-side (useMintReviews.ts). Deliberately
// small and only relays measured to connect + EOSE reliably in <600ms as of 2026-08-30,
// because `sharedPool.querySync` resolves only once EVERY listed relay has EOSE'd or hit
// the per-relay timeout — one dead relay stalls the whole read. Excluded from the full
// REVIEW_RELAYS set here and why:
//   relay.8333.space   — EHOSTUNREACH (down since 2026-08, cost ~3s of dead wait)
//   relay.snort.social — persistent Cloudflare 503 on anon REQ
//   nostr.wine         — 403 on anon REQ (paid relay)
//   azzamo/eden/oxtr/nostr21/wellorder/offchain/bitcoiner/cypherpunk/purplepag.es
//                      — slower connect and/or negligible kind:38000 yield for this path
// This is the client's fast first paint; the authoritative count/rating comes from the
// DB-backed /api/mints/known + /api/mints/nostr-reviews (populated by the 6h backend sync,
// which uses a much broader relay set — see backend/src/reviewsSync.ts).
export const REVIEW_READ_RELAYS: string[] = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://relay.nostr.net',
  'wss://nostr.oxtr.dev',
  'wss://relay.cashumints.space',
  'wss://relay.minibits.cash',
]

// Broader relay set for PUBLISHING a review — casts a wider net than REVIEW_RELAYS so the
// signed event propagates further across the network.
export const REVIEW_PUBLISH_RELAYS: string[] = [
  ...REVIEW_RELAYS,
  'wss://nostr.mom',
  'wss://relay.mostr.pub/',
  'wss://relay.noswhere.com/',
  'wss://pyramid.fiatjaf.com/',
  'wss://nostr.lopp.social/',
]

// Small relay set for looking up kind:0 profile metadata (review author name/avatar).
export const PROFILE_RELAYS: string[] = [
  'wss://eden.nostr.land',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://purplepag.es',
  'wss://relay.damus.io',
  'wss://nostr.oxtr.dev',
  'wss://relay.nostr.net',
  'wss://nostr21.com',
  'wss://relay.snort.social',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.cypherpunk.today',
]
