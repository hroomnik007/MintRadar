import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { healthIdentifier, healthRecordFor, HEALTH_KIND } from '@/utils/healthRecord'
import { ATTESTATION_PUBKEY_HEX, ATTESTATION_RELAYS_PUBLIC } from '@/utils/healthAssertionConstants'
import { healthIdentifier as backendIdentifier, HEALTH_KIND as BACKEND_KIND } from '../../backend/src/healthAssertions'

const URLS = [
  'https://mint.minibits.cash/Bitcoin', 'https://mint.minibits.cash', 'https://mint.minibits.cash/', 'HTTPS://Mint.Example.COM/Path/',
  'http://mint.example.com', 'https://mint.example.com#frag', 'https://mint.example.com/a#', 'https://abc.onion', 'https://10.1.2.3',
  'https://[::1]', "https://mint.example.com/it's", 'https://mint.example.com:3338/x', 'not a url', '',
]

describe('Signed health record', () => {
  it('uses the same kind as the publisher', () => {
    expect(HEALTH_KIND).toBe(BACKEND_KIND)
  })
  it.each(URLS)('d tag equals the backend publisher for %s', u => {
    expect(healthIdentifier(u)).toBe(backendIdentifier(u))
  })
  it('naddr decodes to kind 30385, the attestation key, the d tag and the public relays', () => {
    const rec = healthRecordFor('https://mint.minibits.cash/Bitcoin/')!
    const dec = nip19.decode(rec.naddr)
    expect(dec.type).toBe('naddr')
    const d = dec.data as nip19.AddressPointer
    expect(d.kind).toBe(30385)
    expect(d.pubkey).toBe(ATTESTATION_PUBKEY_HEX)
    expect(d.identifier).toBe(backendIdentifier('https://mint.minibits.cash/Bitcoin/'))
    expect(d.relays).toEqual([...ATTESTATION_RELAYS_PUBLIC])
  })
  it('nak command carries kind, author, d tag (single-quoted) and the relays', () => {
    const rec = healthRecordFor("https://mint.example.com/it's")!
    expect(rec.nakCommand).toBe(`nak req -k 30385 -a ${ATTESTATION_PUBKEY_HEX} -d 'https://mint.example.com/it'\\''s' ${ATTESTATION_RELAYS_PUBLIC.join(' ')}`)
  })
  it('gives no record for a URL that gets no event', () => {
    expect(healthRecordFor('https://abc.onion')).toBeNull()
    expect(healthRecordFor('https://10.1.2.3')).toBeNull()
  })
})
