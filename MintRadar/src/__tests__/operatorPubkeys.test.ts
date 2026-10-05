import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { operatorPubkeys } from '@/utils/operatorPubkeys'

const HEX = 'ab'.repeat(32)
const HEX2 = 'cd'.repeat(32)

describe('operatorPubkeys (frontend copy)', () => {
  it('returns the contact key that is also the announcement author, in npub, nprofile and hex form', () => {
    for (const info of [nip19.npubEncode(HEX), nip19.nprofileEncode({ pubkey: HEX }), HEX]) {
      expect([...operatorPubkeys({ contact: [{ method: 'nostr', info }], announcePubkey: HEX })]).toEqual([HEX])
    }
  })
  it('contact only, announcement only, or disagreeing sources give an empty set', () => {
    expect(operatorPubkeys({ contact: [{ method: 'nostr', info: HEX }] }).size).toBe(0)
    expect(operatorPubkeys({ announcePubkey: HEX }).size).toBe(0)
    expect(operatorPubkeys({ contact: [{ method: 'nostr', info: HEX2 }], announcePubkey: HEX }).size).toBe(0)
  })
  it('ignores invalid entries and returns an empty set without data', () => {
    expect(operatorPubkeys({ contact: [{ method: 'nostr', info: 'bob@example.com' }, { method: 'email', info: HEX }], announcePubkey: HEX }).size).toBe(0)
    expect(operatorPubkeys({}).size).toBe(0)
    expect(operatorPubkeys({ contact: null, announcePubkey: null }).size).toBe(0)
  })
})
