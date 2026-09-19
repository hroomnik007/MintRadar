import { describe, it, expect, vi, beforeEach } from 'vitest'
// Frontend's relays.ts has zero runtime dependencies (plain exported string arrays), so it's
// safe to import directly across the package boundary in a test even though the two packages
// share no workspace — this is what makes the DISCOVERY_RELAYS cross-check below a real drift
// tripwire instead of a second hand-copied snapshot that could silently diverge from it.
import { DISCOVERY_RELAYS as FRONTEND_DISCOVERY_RELAYS } from '../../../src/core/nostr/relays.ts'

// Drift tripwires, not a cross-package sync mechanism. Both relay lists below are
// manually-maintained backend mirrors of frontend arrays in src/core/nostr/relays.ts
// (no shared workspace between the two npm packages, so nothing catches a
// frontend-only edit automatically at the TYPE level) — but DISCOVERY_RELAYS itself
// is now cross-checked directly against the frontend's own array (import above),
// so an edit to one side without the other fails this test immediately instead of
// only being caught by pinning a hand-copied snapshot. REVIEW_SYNC_RELAYS is NOT a
// straight mirror of DISCOVERY_RELAYS (it deliberately adds minibits.cash/mom/eden/
// nostr21 on top — see reviewsSync.ts's comment), so it still uses the snapshot-pin
// approach. NOTE: the frontend's CLIENT-SIDE read path uses a deliberately smaller,
// curated REVIEW_READ_RELAYS (fast-path) that is NOT mirrored here on purpose — see
// the comment on REVIEW_READ_RELAYS.

vi.mock('../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))

let NOSTR_REVIEWS_RELAYS: string[]
let BACKEND_DISCOVERY_RELAYS: string[]

beforeEach(async () => {
  vi.resetModules()
  ;({ NOSTR_REVIEWS_RELAYS } = await import('../index.js'))
  ;({ DISCOVERY_RELAYS: BACKEND_DISCOVERY_RELAYS } = await import('../discovery.js'))
})

describe('DISCOVERY_RELAYS (frontend src/core/nostr/relays.ts vs. backend discovery.ts)', () => {
  it('the two manually-synced mirrors are byte-for-byte identical', () => {
    expect(BACKEND_DISCOVERY_RELAYS).toEqual(FRONTEND_DISCOVERY_RELAYS)
  })

  it('matches the exact, currently-expected relay list (2026-09-19 live-audit result)', () => {
    expect(BACKEND_DISCOVERY_RELAYS).toEqual([
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
    ])
  })
})

describe('NOSTR_REVIEWS_RELAYS (= reviewsSync REVIEW_SYNC_RELAYS, backend-only broad review-sync set)', () => {
  it('matches the exact, currently-expected relay list (2026-09-19 live-audit result)', () => {
    expect(NOSTR_REVIEWS_RELAYS).toEqual([
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
      'wss://relay.minibits.cash',
      'wss://nostr.mom',
      'wss://eden.nostr.land',
      'wss://nostr21.com',
    ])
  })

  it('has no duplicate entries', () => {
    expect(new Set(NOSTR_REVIEWS_RELAYS).size).toBe(NOSTR_REVIEWS_RELAYS.length)
  })

  it('every entry is a wss:// URL', () => {
    for (const relay of NOSTR_REVIEWS_RELAYS) {
      expect(relay.startsWith('wss://')).toBe(true)
    }
  })
})
