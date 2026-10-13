import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { ATTESTATION_PUBKEY_HEX } from '../healthAssertions.js'

// The attestation public key lives in several places that must agree: the backend constant, the NIP-05 file served at
// /.well-known/nostr.json, the own relay's allow-list and the docs. The npub below is the one the owner gave (a public
// key, never a secret).

const APP_ROOT = resolve(__dirname, '../../..')
const read = (rel: string): string => readFileSync(resolve(APP_ROOT, rel), 'utf8')

const ATTESTATION_NPUB = 'npub19hwhe6vr85hd3g9l4tus8nr37etyrusd37q5yycpvwnzt2ntjswqjaru7p'
const MAINTAINER_HEX = '1757995286af8c2bcdcfd13a300e9c40bc4a67e761118c5b365573406c6b37bc'
const SERVICE_HEX = 'd03c080f3f3871f8a9ce741ecda4ff0f3b16d96f507a42f34d3c5d51146f4e03'

function hexOfNpub(npub: string): string {
  const d = nip19.decode(npub)
  if (d.type !== 'npub') throw new Error('not an npub')
  return d.data
}

describe('the attestation key agrees everywhere', () => {
  it('the owner npub decodes to 32 bytes and equals ATTESTATION_PUBKEY_HEX', () => {
    expect(ATTESTATION_NPUB.startsWith('npub1')).toBe(true)
    expect(hexOfNpub(ATTESTATION_NPUB)).toMatch(/^[0-9a-f]{64}$/)
    expect(hexOfNpub(ATTESTATION_NPUB)).toBe(ATTESTATION_PUBKEY_HEX)
  })

  it('docs/claude/nostr-health-assertions.md names the same npub and hex', () => {
    const doc = read('docs/claude/nostr-health-assertions.md')
    expect(doc).toContain(ATTESTATION_NPUB)
    expect(doc).toContain(ATTESTATION_PUBKEY_HEX)
    const npubs = doc.match(/npub1[a-z0-9]{58}/g) ?? []
    expect(npubs.length).toBeGreaterThan(0)
    for (const n of npubs) expect(hexOfNpub(n)).toBe(ATTESTATION_PUBKEY_HEX)
  })
})

describe('public/.well-known/nostr.json', () => {
  const file = JSON.parse(read('public/.well-known/nostr.json')) as { names: Record<string, string>; relays: Record<string, string[]> }

  it('is valid JSON with a "health" name that equals the attestation key', () => {
    expect(file.names['health']).toBe(ATTESTATION_PUBKEY_HEX)
    expect(file.names['health']).toBe(hexOfNpub(ATTESTATION_NPUB))
  })

  it('keeps the existing entries unchanged', () => {
    expect(file.names['_']).toBe(MAINTAINER_HEX)
    expect(file.names['wildcitizen7']).toBe(MAINTAINER_HEX)
    expect(file.relays[MAINTAINER_HEX]).toEqual(['wss://relay.primal.net', 'wss://relay.damus.io', 'wss://nos.lol'])
    expect(Object.keys(file.names).sort()).toEqual(['_', 'health', 'wildcitizen7'])
  })

  it('gives the own relay as the hint of the new name', () => {
    expect(file.relays[ATTESTATION_PUBKEY_HEX]).toEqual(['wss://nostr.mintradar.org'])
  })

  it('has no secret-looking content', () => {
    const raw = read('public/.well-known/nostr.json')
    expect(raw).not.toMatch(/nsec1/)
  })
})

describe('deploy/strfry/privileged-pubkeys.txt', () => {
  const raw = read('deploy/strfry/privileged-pubkeys.txt')
  const keyLines = raw.split('\n').map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#'))

  it('contains the attestation hex exactly once, as its own line', () => {
    expect(keyLines.filter(l => l === ATTESTATION_PUBKEY_HEX)).toHaveLength(1)
    expect(raw.split(ATTESTATION_PUBKEY_HEX)).toHaveLength(2)
  })

  it('keeps the existing keys, in order, ahead of the new one', () => {
    expect(keyLines).toEqual([MAINTAINER_HEX, SERVICE_HEX, ATTESTATION_PUBKEY_HEX])
  })

  it('every listed key is a 64 character hex public key', () => {
    for (const l of keyLines) expect(l).toMatch(/^[0-9a-f]{64}$/)
    expect(raw).not.toMatch(/nsec1/)
  })
})
