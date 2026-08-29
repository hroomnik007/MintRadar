import { describe, it, expect, vi, beforeEach } from 'vitest'

// Drift tripwire, not a cross-package sync mechanism: NOSTR_REVIEWS_RELAYS
// (backend/src/index.ts) is a manually-maintained copy of the frontend's
// REVIEW_RELAYS (src/core/nostr/relays.ts) — the two npm packages have no
// shared workspace, so nothing here can automatically catch a frontend-only
// edit. What this test DOES do: pin the exact expected array, so any future
// change to NOSTR_REVIEWS_RELAYS forces a deliberate edit to this test too,
// rather than drifting silently. If you're updating this list because
// REVIEW_RELAYS changed, update both files and this test together.

vi.mock('../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))

let NOSTR_REVIEWS_RELAYS: string[]

beforeEach(async () => {
  vi.resetModules()
  ;({ NOSTR_REVIEWS_RELAYS } = await import('../index.js'))
})

describe('NOSTR_REVIEWS_RELAYS (backend copy of frontend REVIEW_RELAYS)', () => {
  it('matches the exact, currently-expected relay list', () => {
    expect(NOSTR_REVIEWS_RELAYS).toEqual([
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
      'wss://relay.minibits.cash',
      'wss://nostr.oxtr.dev',
      'wss://relay.nostr.net',
      'wss://nostr21.com',
      'wss://nostr.bitcoiner.social',
      'wss://nostr.cypherpunk.today',
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
