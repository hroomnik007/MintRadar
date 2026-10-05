import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { operatorPubkeys } from '../shared/operatorPubkeys.js'

const HEX = 'ab'.repeat(32)
const HEX2 = 'cd'.repeat(32)

describe('operatorPubkeys (backend)', () => {
  it('reads an npub contact', () => {
    expect([...operatorPubkeys({ contact: [{ method: 'nostr', info: nip19.npubEncode(HEX) }] })]).toEqual([HEX])
  })
  it('reads an nprofile contact', () => {
    const np = nip19.nprofileEncode({ pubkey: HEX, relays: ['wss://relay.example'] })
    expect([...operatorPubkeys({ contact: [{ method: 'nostr', info: np }] })]).toEqual([HEX])
  })
  it('reads a 64-character hex contact (any case) and an optional nostr: prefix', () => {
    expect([...operatorPubkeys({ contact: [{ method: 'nostr', info: HEX.toUpperCase() }] })]).toEqual([HEX])
    expect([...operatorPubkeys({ contact: [{ method: 'nostr', info: `nostr:${nip19.npubEncode(HEX)}` }] })]).toEqual([HEX])
  })
  it('ignores invalid entries, NIP-05 names, other methods and non-strings', () => {
    const ops = operatorPubkeys({ contact: [
      { method: 'nostr', info: 'npub1notvalid' },
      { method: 'nostr', info: 'alice@example.com' },
      { method: 'nostr', info: 'ab'.repeat(31) },
      { method: 'email', info: nip19.npubEncode(HEX) },
      { method: 'nostr', info: 42 },
      { method: 'nostr', info: nip19.nsecEncode(new Uint8Array(32).fill(1)) },
    ] })
    expect(ops.size).toBe(0)
  })
  it('adds the announcement author', () => {
    expect([...operatorPubkeys({ announcePubkey: HEX2.toUpperCase() })]).toEqual([HEX2])
    expect(operatorPubkeys({ announcePubkey: 'nope' }).size).toBe(0)
  })
  it('unions contact and announcement keys without duplicates', () => {
    const ops = operatorPubkeys({ contact: [{ method: 'nostr', info: HEX }], announcePubkey: HEX })
    expect(ops.size).toBe(1)
    expect(operatorPubkeys({ contact: [{ method: 'nostr', info: HEX }], announcePubkey: HEX2 }).size).toBe(2)
  })
  it('returns an empty set without data and is bounded for hostile input', () => {
    expect(operatorPubkeys({}).size).toBe(0)
    expect(operatorPubkeys({ contact: null, announcePubkey: null }).size).toBe(0)
    const many = Array.from({ length: 1000 }, (_, i) => ({ method: 'nostr', info: (i.toString(16).padStart(2, '0')).repeat(32).slice(0, 64) }))
    expect(operatorPubkeys({ contact: many }).size).toBeLessThanOrEqual(3)
    expect(operatorPubkeys({ contact: [{ method: 'nostr', info: 'x'.repeat(100_000) }] }).size).toBe(0)
  })
})
