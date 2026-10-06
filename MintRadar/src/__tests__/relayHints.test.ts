import { describe, it, expect } from 'vitest'
import {
  filterNaddrRelayHints, resolveNaddrRelays, sanitizeUserRelays, isPublicHostname, MAX_NADDR_HINTS, MAX_USER_RELAYS,
} from '@/core/nostr/relayHints'

const KNOWN = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.mostr.pub/', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://offchain.pub']
const DEFAULTS = ['wss://relay.damus.io', 'wss://relay.snort.social']

describe('filterNaddrRelayHints', () => {
  it('keeps a known hint (returns our own string for it)', () => {
    expect(filterNaddrRelayHints(['wss://nos.lol'], KNOWN)).toEqual(['wss://nos.lol'])
    expect(filterNaddrRelayHints(['wss://relay.mostr.pub'], KNOWN)).toEqual(['wss://relay.mostr.pub/'])
  })
  it('drops an unknown host', () => {
    expect(filterNaddrRelayHints(['wss://evil.example'], KNOWN)).toEqual([])
  })
  it('drops ws:// and other schemes', () => {
    expect(filterNaddrRelayHints(['ws://nos.lol', 'https://nos.lol', 'nos.lol'], KNOWN)).toEqual([])
  })
  it('drops IP literals and localhost', () => {
    expect(filterNaddrRelayHints(['wss://127.0.0.1', 'wss://127.0.0.1:8765', 'wss://[::1]', 'wss://localhost:4870', 'wss://10.0.0.5'], KNOWN)).toEqual([])
  })
  it('matches the host case-insensitively and ignores a trailing slash and a path', () => {
    expect(filterNaddrRelayHints(['wss://NOS.LOL', 'wss://Relay.Damus.IO/', 'wss://relay.primal.net/evil?x=1'], KNOWN))
      .toEqual(['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.primal.net'])
  })
  it('does not accept a different port, userinfo or a look-alike host', () => {
    expect(filterNaddrRelayHints(['wss://nos.lol:9999', 'wss://user:pw@nos.lol', 'wss://nos.lol.evil.example', 'wss://evilnos.lol'], KNOWN)).toEqual([])
  })
  it('caps at 3 and deduplicates', () => {
    const out = filterNaddrRelayHints(['wss://nos.lol', 'wss://NOS.LOL/', 'wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://offchain.pub'], KNOWN)
    expect(out).toEqual(['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.primal.net'])
    expect(out.length).toBe(MAX_NADDR_HINTS)
  })
  it('ignores junk entries without throwing', () => {
    expect(filterNaddrRelayHints(['', 'not a url', 42 as unknown as string, null as unknown as string], KNOWN)).toEqual([])
    expect(filterNaddrRelayHints(undefined, KNOWN)).toEqual([])
  })
})

describe('resolveNaddrRelays', () => {
  it('an empty hint list falls back to the defaults', () => {
    expect(resolveNaddrRelays([], KNOWN, DEFAULTS)).toEqual(DEFAULTS)
    expect(resolveNaddrRelays(undefined, KNOWN, DEFAULTS)).toEqual(DEFAULTS)
  })
  it('only hostile hints leave exactly the defaults (no request to the hostile host)', () => {
    const out = resolveNaddrRelays(['wss://evil.example', 'ws://nos.lol'], KNOWN, DEFAULTS)
    expect(out).toEqual(DEFAULTS)
    expect(out.join()).not.toContain('evil')
  })
  it('surviving hints come first, then the defaults, deduplicated', () => {
    expect(resolveNaddrRelays(['wss://nos.lol', 'wss://relay.damus.io'], KNOWN, DEFAULTS))
      .toEqual(['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.snort.social'])
  })
})

describe('isPublicHostname', () => {
  it.each(['relay.damus.io', 'nostr-01.yakihonne.com', 'a.b.c.example.org'])('%s is public', h => expect(isPublicHostname(h)).toBe(true))
  it.each(['localhost', '127.0.0.1', '10.0.0.1', '192.168.1.1', '2130706433', '::1', '[::1]', 'relay', 'abc.onion', 'nas.local', 'x.internal', 'a_b.example.com', '-a.example.com', ''])('%s is not', h => expect(isPublicHostname(h)).toBe(false))
})

describe('sanitizeUserRelays', () => {
  it('keeps wss:// public hosts and normalises case and trailing slash', () => {
    expect(sanitizeUserRelays(['wss://Relay.Damus.io/', 'wss://nos.lol'])).toEqual(['wss://relay.damus.io', 'wss://nos.lol'])
  })
  it('drops ws://, IP literals, localhost, .onion, userinfo and junk', () => {
    expect(sanitizeUserRelays([
      'ws://relay.example.com', 'wss://127.0.0.1:8765', 'wss://localhost', 'wss://[::1]', 'wss://192.168.0.2',
      'wss://abcdef.onion', 'wss://u:p@relay.example.com', 'https://relay.example.com', 'garbage', '', 'wss://nos.lol',
    ])).toEqual(['wss://nos.lol'])
  })
  it('deduplicates', () => {
    expect(sanitizeUserRelays(['wss://nos.lol', 'wss://NOS.lol/', 'wss://nos.lol'])).toEqual(['wss://nos.lol'])
  })
  it('caps at 10, keeping the first 10 in the given order, and does not mutate the input', () => {
    const input = Array.from({ length: 51 }, (_, i) => `wss://relay${i}.example.com`)
    const copy = [...input]
    const out = sanitizeUserRelays(input)
    expect(out.length).toBe(MAX_USER_RELAYS)
    expect(out).toEqual(input.slice(0, 10))
    expect(input).toEqual(copy)
  })
  it('counts only valid relays toward the cap', () => {
    const input = ['ws://bad.example.com', ...Array.from({ length: 12 }, (_, i) => `wss://r${i}.example.com`)]
    expect(sanitizeUserRelays(input)).toEqual(input.slice(1, 11))
  })
  it('handles null / undefined', () => {
    expect(sanitizeUserRelays(null)).toEqual([])
    expect(sanitizeUserRelays(undefined)).toEqual([])
  })
})
