import { describe, it, expect } from 'vitest'
import * as nip19 from 'nostr-tools/nip19'
import { njumpEventUrl, NEVENT_MAX_RELAYS } from '@/utils/nostrLinks'

const ID = 'ab'.repeat(32)
const AUTHOR = 'cd'.repeat(32)
const decode = (url: string) => {
  const d = nip19.decode(url.replace('https://njump.me/', ''))
  if (d.type !== 'nevent') throw new Error(d.type)
  return d.data
}

describe('njumpEventUrl relay hints (2026-11-15)', () => {
  it('a bare id still gives a plain nevent', () => {
    expect(decode(njumpEventUrl(ID)!)).toMatchObject({ id: ID })
    expect(decode(njumpEventUrl(ID)!).relays ?? []).toEqual([])
  })
  it('carries up to three wss:// relays, the author and the kind', () => {
    const relays = ['wss://a.example', 'https://not-a-relay.example', 'wss://b.example', 'wss://c.example', 'wss://d.example']
    const d = decode(njumpEventUrl(ID, { relays, author: AUTHOR.toUpperCase(), kind: 38172 })!)
    expect(d.relays).toEqual(['wss://a.example', 'wss://b.example', 'wss://c.example'])
    expect(d.relays!.length).toBeLessThanOrEqual(NEVENT_MAX_RELAYS)
    expect(d.author).toBe(AUTHOR)
    expect(d.kind).toBe(38172)
  })
  it('drops an author that is not 64 hex characters', () => {
    expect(decode(njumpEventUrl(ID, { author: 'npub1xyz' })!).author).toBeUndefined()
  })
  it('passes ready-made nevent / note strings through and rejects junk', () => {
    expect(njumpEventUrl('nevent1abc')).toBe('https://njump.me/nevent1abc')
    expect(njumpEventUrl('not-an-id')).toBeNull()
  })
})
