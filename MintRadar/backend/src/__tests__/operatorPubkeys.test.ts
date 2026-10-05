import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { operatorPubkeys } from '../shared/operatorPubkeys.js'

const HEX = 'ab'.repeat(32)
const HEX2 = 'cd'.repeat(32)

// A key is the operator only when it is BOTH a nostr contact of the mint AND the author of its announcement.
describe('operatorPubkeys (backend): contact and announcement must agree', () => {
  it('contact only gives an empty set', () => {
    expect(operatorPubkeys({ contact: [{ method: 'nostr', info: nip19.npubEncode(HEX) }] }).size).toBe(0)
    expect(operatorPubkeys({ contact: [{ method: 'nostr', info: HEX }], announcePubkey: null }).size).toBe(0)
  })
  it('announcement author only gives an empty set', () => {
    expect(operatorPubkeys({ announcePubkey: HEX2 }).size).toBe(0)
    expect(operatorPubkeys({ contact: [], announcePubkey: HEX2 }).size).toBe(0)
    expect(operatorPubkeys({ contact: null, announcePubkey: HEX2 }).size).toBe(0)
  })
  it('a contact key that differs from the announcement author gives an empty set (critic listed as contact)', () => {
    expect(operatorPubkeys({ contact: [{ method: 'nostr', info: HEX }], announcePubkey: HEX2 }).size).toBe(0)
  })
  it('both agree: the key is the operator (npub contact)', () => {
    expect([...operatorPubkeys({ contact: [{ method: 'nostr', info: nip19.npubEncode(HEX) }], announcePubkey: HEX })]).toEqual([HEX])
  })
  it('both agree with an nprofile contact', () => {
    const np = nip19.nprofileEncode({ pubkey: HEX, relays: ['wss://relay.example'] })
    expect([...operatorPubkeys({ contact: [{ method: 'nostr', info: np }], announcePubkey: HEX })]).toEqual([HEX])
  })
  it('both agree with a hex contact (any case), an optional nostr: prefix and an upper-case author', () => {
    expect([...operatorPubkeys({ contact: [{ method: 'nostr', info: HEX.toUpperCase() }], announcePubkey: HEX })]).toEqual([HEX])
    expect([...operatorPubkeys({ contact: [{ method: 'nostr', info: `nostr:${nip19.npubEncode(HEX)}` }], announcePubkey: HEX })]).toEqual([HEX])
    expect([...operatorPubkeys({ contact: [{ method: 'nostr', info: HEX }], announcePubkey: HEX.toUpperCase() })]).toEqual([HEX])
  })
  it('only the contact key that is also the author is returned when several are listed', () => {
    const contact = [{ method: 'nostr', info: HEX2 }, { method: 'nostr', info: nip19.npubEncode(HEX) }]
    expect([...operatorPubkeys({ contact, announcePubkey: HEX })]).toEqual([HEX])
  })
  it('keeps the cap of 3 contact keys: a 4th listed key never matches, even when it is the author', () => {
    const k = (n: number) => n.toString(16).padStart(2, '0').repeat(32)
    const contact = [1, 2, 3, 4].map(n => ({ method: 'nostr', info: k(n) }))
    expect([...operatorPubkeys({ contact, announcePubkey: k(3) })]).toEqual([k(3)])
    expect(operatorPubkeys({ contact, announcePubkey: k(4) }).size).toBe(0)
  })
  it('ignores invalid entries, NIP-05 names, other methods and non-strings', () => {
    const ops = operatorPubkeys({
      contact: [
        { method: 'nostr', info: 'npub1notvalid' },
        { method: 'nostr', info: 'alice@example.com' },
        { method: 'nostr', info: 'ab'.repeat(31) },
        { method: 'email', info: nip19.npubEncode(HEX) },
        { method: 'nostr', info: 42 },
        { method: 'nostr', info: nip19.nsecEncode(new Uint8Array(32).fill(1)) },
      ],
      announcePubkey: HEX,
    })
    expect(ops.size).toBe(0)
  })
  it('an invalid announcement author gives an empty set', () => {
    expect(operatorPubkeys({ contact: [{ method: 'nostr', info: HEX }], announcePubkey: 'nope' }).size).toBe(0)
  })
  it('returns an empty set without data and is bounded for hostile input', () => {
    expect(operatorPubkeys({}).size).toBe(0)
    expect(operatorPubkeys({ contact: null, announcePubkey: null }).size).toBe(0)
    const many = Array.from({ length: 1000 }, (_, i) => ({ method: 'nostr', info: (i.toString(16).padStart(2, '0')).repeat(32).slice(0, 64) }))
    expect(operatorPubkeys({ contact: many, announcePubkey: HEX }).size).toBeLessThanOrEqual(1)
    expect(operatorPubkeys({ contact: [{ method: 'nostr', info: 'x'.repeat(100_000) }], announcePubkey: HEX }).size).toBe(0)
  })
})
