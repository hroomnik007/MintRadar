import { describe, it, expect, vi, beforeEach } from 'vitest'

// Drift tripwire, not a cross-package sync mechanism. The relay list now lives
// in backend/src/reviewsSync.ts as REVIEW_SYNC_RELAYS (the 6h background review
// sync uses it); backend/src/index.ts re-exports it as NOSTR_REVIEWS_RELAYS for
// this test. It is a manually-maintained mirror of what the frontend historically
// called REVIEW_RELAYS (src/core/nostr/relays.ts). The two npm packages have no
// shared workspace, so nothing here catches a frontend-only edit — but pinning
// the exact array forces a deliberate edit to this test on any future change,
// rather than silent drift. NOTE: the frontend's CLIENT-SIDE read path uses a
// deliberately smaller, curated REVIEW_READ_RELAYS (fast-path) that is NOT
// mirrored here on purpose — see the comment on REVIEW_READ_RELAYS.

vi.mock('../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))

let NOSTR_REVIEWS_RELAYS: string[]

beforeEach(async () => {
  vi.resetModules()
  ;({ NOSTR_REVIEWS_RELAYS } = await import('../index.js'))
})

describe('NOSTR_REVIEWS_RELAYS (= reviewsSync REVIEW_SYNC_RELAYS, backend mirror of frontend REVIEW_RELAYS)', () => {
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
