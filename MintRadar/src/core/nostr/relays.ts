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
]

// Discovery relays plus relay.minibits.cash (a Cashu-wallet-specific relay that tends to
// carry kind:38000 mint reviews) — used when READING reviews for a mint.
export const REVIEW_RELAYS: string[] = [
  ...DISCOVERY_RELAYS,
  'wss://relay.minibits.cash',
]

// Broader relay set for PUBLISHING a review — casts a wider net than REVIEW_RELAYS so the
// signed event propagates further across the network.
export const REVIEW_PUBLISH_RELAYS: string[] = [
  ...REVIEW_RELAYS,
  'wss://nostr.bitcoiner.social',
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
]
