// Canonical Nostr relay sets for Cashu-mint discovery and reviews.
//
// DISCOVERY_RELAYS mirrors backend/src/discovery.ts's DISCOVERY_RELAYS — the frontend and
// backend are separate npm packages (no workspace set up between them), so this list can't
// be imported by the backend directly. Keep the two arrays in sync manually when editing.

// Relay list updated 2026-09-19 following a live WS REQ audit (NIP-11 + kind:38172/38000
// probes against every relay in the set, 3 measurement cycles) — see the audit report for
// the full measured table. Dropped: purplepag.es (0/5 events both kinds — it's a kind:0/
// 10002/51 directory, not a NIP-87/38000 host; stays in PROFILE_RELAYS), relay.snort.social
// (only 1/5 kind:38172 events across 3 cycles, 0/5 kind:38000 — too thin to justify), nostr.wine
// (403 on anon REQ, confirmed all 3 cycles), relay.8333.space (still EHOSTUNREACH), relay.nostr.net
// (NIP-11 still HTTP 500, confirmed live — was already excluded from REVIEW_READ_RELAYS for this;
// now dropped from discovery entirely while it stays broken), eden.nostr.land and nostr21.com
// (paid relays with real yield — 3/5+5/5 and 0/5+5/5 respectively — moved to
// backend REVIEW_SYNC_RELAYS instead, since that's a read-only cron and doesn't need general
// discovery/write access). Added back: nostr-pub.wellorder.net — measured 0/5 kind:38172 but a
// consistent 5/5 kind:38000 across all 3 cycles, a genuine revival per the "soft cuts return on
// breakdown > 0" rule (it was previously dropped 2026-08-15 for being unreachable, which no
// longer reproduces). nostr.oxtr.dev could not be reached from the auditing sandbox (TCP-level
// connect failure to its IP) but was independently re-verified live from the production VPS:
// 37ms connect, 5/5 + 5/5 events, EOSE <60ms — genuinely healthy, kept. wss://relay.nostr.band
// (the one new candidate proposed for this audit) failed NIP-11 and WS connect from BOTH the
// sandbox and the production VPS — confirmed down, not added anywhere.
//
// wss://nostr.mintradar.org (2026-09-25) — MintRadar's own strfry backup relay, additive
// alongside every relay above (nothing removed/deprioritized). Whitelist-only write policy
// (kind 38172/38000 from the public, any kind from one privileged operator key), so it never
// competes on discovery breadth — it's a durable, MintRadar-operated store for exactly the
// two kinds this array exists to discover. See MintRadar/deploy/strfry/ for the relay setup.
export const DISCOVERY_RELAYS: string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.cashumints.space',
  'wss://relay.azzamo.net',
  'wss://nostr.oxtr.dev',
  'wss://offchain.pub',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.cypherpunk.today',
  'wss://nostr-pub.wellorder.net',
  'wss://nostr.mintradar.org',
]

// Discovery relays plus relay.minibits.cash (a Cashu-wallet-specific relay that tends to
// carry kind:38000 mint reviews). Used as the base for REVIEW_PUBLISH_RELAYS (propagation
// reach on write). NOT used for the client-side read path anymore — see REVIEW_READ_RELAYS.
export const REVIEW_RELAYS: string[] = [
  ...DISCOVERY_RELAYS,
  'wss://relay.minibits.cash',
]

// Curated fast-path list for READING reviews client-side (useMintReviews.ts). Deliberately
// small and only relays measured to connect + EOSE reliably in <600ms, because
// `sharedPool.querySync` resolves only once EVERY listed relay has EOSE'd or hit the
// per-relay timeout — one dead relay stalls the whole read. `relay.nostr.net` was removed
// 2026-09-19 (NIP-11 still returns HTTP 500, confirmed live — same finding as the discovery
// audit above) rather than replaced; the remaining 6 already covered the actual kind:38000
// yield (all measured 4-5/5 events on a generic REQ during that audit; relay.minibits.cash's
// own generic-REQ count doesn't reflect its real yield here, since production queries filter
// by `#u` tag — kept on its established track record). Excluded from the full REVIEW_RELAYS
// set here and why: relay.8333.space (EHOSTUNREACH), relay.snort.social (thin/inconsistent
// yield), nostr.wine (403 on anon REQ, paid relay), azzamo/eden/oxtr/nostr21/wellorder/
// offchain/bitcoiner/cypherpunk/purplepag.es — not measured to add read-latency value on
// this specific fast-path (several of them yield well on the broader/slower paths instead,
// see DISCOVERY_RELAYS' and backend REVIEW_SYNC_RELAYS' own comments). This is the client's
// fast first paint; the authoritative count/rating comes from the DB-backed
// /api/mints/known + /api/mints/nostr-reviews (populated by the 6h backend sync, which uses
// a much broader relay set — see backend/src/reviewsSync.ts).
export const REVIEW_READ_RELAYS: string[] = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nostr.oxtr.dev',
  'wss://relay.cashumints.space',
  'wss://relay.minibits.cash',
]

// Broader relay set for PUBLISHING a review — casts a wider net than REVIEW_RELAYS so the
// signed event propagates further across the network. `pyramid.fiatjaf.com` (NIP-11
// restricted_writes: true) and `nostr.lopp.social` (measured 0/5 events on both kinds across
// 3 audit cycles — no revival) were dropped 2026-09-19; the rest of REVIEW_RELAYS + the 3
// extras below all measured real yield during the same audit (see DISCOVERY_RELAYS' comment).
export const REVIEW_PUBLISH_RELAYS: string[] = [
  ...REVIEW_RELAYS,
  'wss://nostr.mom',
  'wss://relay.mostr.pub/',
  'wss://relay.noswhere.com/',
]

// Small relay set for looking up kind:0 profile metadata (review author name/avatar).
// `relay.nostr.net` removed 2026-09-19 (NIP-11 still HTTP 500, confirmed live — see
// DISCOVERY_RELAYS' comment); not measured for kind:0 specifically but broken at the
// transport level either way. The rest of this list is untouched by the 2026-09-19 audit
// (it targeted kind:38172/38000 yield, not profile-lookup latency) — no evidence to justify
// dropping eden/nostr21/snort/bitcoiner/cypherpunk from here.
export const PROFILE_RELAYS: string[] = [
  'wss://eden.nostr.land',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://purplepag.es',
  'wss://relay.damus.io',
  'wss://nostr.oxtr.dev',
  'wss://nostr21.com',
  'wss://relay.snort.social',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.cypherpunk.today',
]
