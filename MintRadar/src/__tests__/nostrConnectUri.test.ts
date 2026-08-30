import { describe, it, expect } from 'vitest'
import { buildNostrConnectURI } from '@/core/nostr/client'

describe('buildNostrConnectURI', () => {
  it('produces a client-initiated nostrconnect:// URI', () => {
    const { uri } = buildNostrConnectURI()
    expect(uri.startsWith('nostrconnect://')).toBe(true)
    const u = new URL(uri)
    // origin/host is the client pubkey (32-byte hex)
    expect(u.host).toMatch(/^[0-9a-f]{64}$/)
    expect(u.searchParams.get('name')).toBe('MintRadar')
  })

  it('uses a full 32-byte (64 hex char) secret', () => {
    const { uri } = buildNostrConnectURI()
    const secret = new URL(uri).searchParams.get('secret')
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('carries the NIP-46 relay set', () => {
    const relays = new URL(buildNostrConnectURI().uri).searchParams.getAll('relay')
    expect(relays.length).toBe(6)
    expect(relays).toContain('wss://relay.primal.net')
  })

  it('returns a distinct client key + secret each call', () => {
    const a = buildNostrConnectURI()
    const b = buildNostrConnectURI()
    expect(a.uri).not.toBe(b.uri)
    expect(Buffer.from(a.clientSecretKey).equals(Buffer.from(b.clientSecretKey))).toBe(false)
    expect(a.clientSecretKey.length).toBe(32)
  })
})
