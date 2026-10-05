import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { operatorPubkeys } from '@/utils/operatorPubkeys'

const HEX = 'ab'.repeat(32)

describe('operatorPubkeys (frontend copy)', () => {
  it('reads npub, nprofile and hex contacts plus the announcement author', () => {
    const ops = operatorPubkeys({
      contact: [
        { method: 'nostr', info: nip19.npubEncode(HEX) },
        { method: 'nostr', info: nip19.nprofileEncode({ pubkey: 'cd'.repeat(32) }) },
        { method: 'nostr', info: 'ef'.repeat(32) },
      ],
      announcePubkey: '12'.repeat(32),
    })
    expect([...ops].sort()).toEqual([HEX, 'cd'.repeat(32), 'ef'.repeat(32), '12'.repeat(32)].sort())
  })
  it('ignores invalid entries and returns an empty set without data', () => {
    expect(operatorPubkeys({ contact: [{ method: 'nostr', info: 'bob@example.com' }, { method: 'email', info: HEX }] }).size).toBe(0)
    expect(operatorPubkeys({}).size).toBe(0)
    expect(operatorPubkeys({ contact: null, announcePubkey: null }).size).toBe(0)
  })
})
