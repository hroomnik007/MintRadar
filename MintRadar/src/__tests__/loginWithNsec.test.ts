import { describe, it, expect, afterEach } from 'vitest'
import { nip19 } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'
import { loginWithNsec, removeNsecShim, hasActiveNsecKey } from '@/core/nostr/client'

// The public key is derived inside loginWithNsec() (nostr-tools getPublicKey, BIP-340 x-only). These vectors are
// the x coordinates of k·G on secp256k1 for k = 1, 2, 3 — independent of the code under test. The first one is
// the well-known generator point G.
const KEY_ONE = '0000000000000000000000000000000000000000000000000000000000000001'
const VECTORS: Array<[string, string]> = [
  [KEY_ONE, '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'],
  ['0000000000000000000000000000000000000000000000000000000000000002', 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'],
  ['0000000000000000000000000000000000000000000000000000000000000003', 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'],
]

afterEach(() => {
  removeNsecShim()
})

describe('loginWithNsec — public key derivation', () => {
  it.each(VECTORS)('64-char hex key %s gives the x-only public key %s', async (hex, expected) => {
    const profile = await loginWithNsec(hex)
    expect(profile.pubkey).toBe(expected)
    expect(profile.npub).toBe(nip19.npubEncode(expected))
  })

  it('accepts upper-case hex and derives the same key', async () => {
    const profile = await loginWithNsec('00'.repeat(31) + 'AB')
    const lower = await loginWithNsec('00'.repeat(31) + 'ab')
    expect(profile.pubkey).toBe(lower.pubkey)
    expect(profile.pubkey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('nsec1 bech32 round trip: fixed nsec -> same pubkey, npub matches an independent nip19 encoding', async () => {
    const nsec = nip19.nsecEncode(hexToBytes(KEY_ONE))
    expect(nsec.startsWith('nsec1')).toBe(true)
    const profile = await loginWithNsec(nsec)
    expect(profile.pubkey).toBe(VECTORS[0]![1])
    const npub = nip19.npubEncode(VECTORS[0]![1])
    expect(profile.npub).toBe(npub)
    const decoded = nip19.decode(profile.npub)
    expect(decoded.type).toBe('npub')
    expect(decoded.data).toBe(VECTORS[0]![1])
  })

  it('installs the in-memory signer for the derived key and zeroes it on removal', async () => {
    const profile = await loginWithNsec(KEY_ONE)
    expect(hasActiveNsecKey()).toBe(true)
    expect(await window.nostr!.getPublicKey()).toBe(profile.pubkey)
    removeNsecShim()
    expect(hasActiveNsecKey()).toBe(false)
    expect(window.nostr).toBeUndefined()
  })

  it('rejects input that is neither an nsec nor 64 hex chars, and a non-nsec bech32', async () => {
    await expect(loginWithNsec('not a key')).rejects.toThrow(/valid nsec1/)
    await expect(loginWithNsec('ab'.repeat(31))).rejects.toThrow(/valid nsec1/)
    expect(hasActiveNsecKey()).toBe(false)
  })

  it('rejects the zero key instead of deriving a public key from it', async () => {
    await expect(loginWithNsec('00'.repeat(32))).rejects.toThrow()
    expect(hasActiveNsecKey()).toBe(false)
  })
})
