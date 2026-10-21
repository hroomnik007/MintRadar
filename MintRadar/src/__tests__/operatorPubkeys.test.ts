import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { operatorPubkeys, contactPubkeys } from '@/utils/operatorPubkeys'

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

describe('contactPubkeys (frontend copy)', () => {
  it('lists the nostr contact keys in every accepted form, whatever the announcement says', () => {
    const contact = [HEX, `nostr:${nip19.npubEncode(HEX2)}`].map(info => ({ method: 'nostr', info }))
    expect([...contactPubkeys(contact)].sort()).toEqual([HEX, HEX2].sort())
  })
  it('reads at most three entries, skips non-nostr methods, NIP-05 names and free text', () => {
    const c = (info: string) => ({ method: 'nostr', info })
    expect(contactPubkeys([c('bob@example.com'), c('hello'), { method: 'email', info: HEX }]).size).toBe(0)
    expect(contactPubkeys([c('a@b.c'), c('x'), c('y'), c(HEX)]).size).toBe(0) // the key is the fourth nostr entry
    expect(contactPubkeys(null).size).toBe(0)
    expect(contactPubkeys(undefined).size).toBe(0)
  })
  it('the operator rule is the contact set intersected with the announcement author (unchanged)', () => {
    const contact = [{ method: 'nostr', info: HEX }, { method: 'nostr', info: HEX2 }]
    expect([...operatorPubkeys({ contact, announcePubkey: HEX2 })]).toEqual([HEX2])
    expect(contactPubkeys(contact).size).toBe(2)
  })
})
