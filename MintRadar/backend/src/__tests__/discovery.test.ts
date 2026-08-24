import { describe, it, expect } from 'vitest'
import { computeSilentRelays, relayUrlsThatResponded } from '../discovery.js'

// Regression coverage for the "relay(s) connected but returned nothing" logging bug:
// nostr-tools normalizes relay URLs with a trailing slash (relay.url, seenOn's Set entries),
// while DISCOVERY_RELAYS entries never have one. Comparing the two directly (the old
// listConnectionStatus()-based check) meant the lookup could never match, so every connected
// relay was reported as silent every cycle regardless of what it actually returned.
describe('computeSilentRelays', () => {
  it('does not flag a relay as silent when it responded, even though seenOn URLs carry a trailing slash the input list lacks', () => {
    // Mirrors the reported case: nos.lol delivered events (per formatRelayBreakdown showing
    // nos.lol=34) but the un-normalized-vs-normalized URL mismatch put it in the silent list.
    const respondedRelays = new Set(['wss://nos.lol/', 'wss://relay.damus.io/'])
    const failedRelays = new Set<string>()
    const discoveryRelays = ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.snort.social']

    const silent = computeSilentRelays(discoveryRelays, failedRelays, respondedRelays)

    expect(silent).not.toContain('wss://nos.lol')
    expect(silent).not.toContain('wss://relay.damus.io')
    expect(silent).toEqual(['wss://relay.snort.social'])
  })

  it('does not flag a relay that failed to connect, even if also absent from respondedRelays', () => {
    const respondedRelays = new Set<string>()
    const failedRelays = new Set(['wss://relay.snort.social'])
    const discoveryRelays = ['wss://nos.lol', 'wss://relay.snort.social']

    const silent = computeSilentRelays(discoveryRelays, failedRelays, respondedRelays)

    expect(silent).toEqual(['wss://nos.lol'])
  })

  it('flags a relay as silent when nothing in either kind attributes to it', () => {
    const respondedRelays = new Set(['wss://relay.damus.io/'])
    const failedRelays = new Set<string>()
    const discoveryRelays = ['wss://relay.damus.io', 'wss://nostr.wine']

    const silent = computeSilentRelays(discoveryRelays, failedRelays, respondedRelays)

    expect(silent).toEqual(['wss://nostr.wine'])
  })
})

describe('relayUrlsThatResponded', () => {
  it('collects relay URLs from seenOn attribution for the given events only', () => {
    const seenOn = new Map([
      ['event-1', new Set([{ url: 'wss://nos.lol/' }, { url: 'wss://relay.damus.io/' }])],
      ['event-2', new Set([{ url: 'wss://nostr.wine/' }])],
    ])

    const responded = relayUrlsThatResponded([{ id: 'event-1' }], seenOn)

    expect(responded).toEqual(new Set(['wss://nos.lol/', 'wss://relay.damus.io/']))
  })

  it('returns an empty set when no events are given', () => {
    const seenOn = new Map([['event-1', new Set([{ url: 'wss://nos.lol/' }])]])

    expect(relayUrlsThatResponded([], seenOn)).toEqual(new Set())
  })
})
