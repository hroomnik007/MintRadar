import { describe, it, expect } from 'vitest'
import { countryName, ipv4Address, networkLabel, networkRows, torLabel } from '@/utils/networkInfo'
import type { AuditCzDetail } from '@/hooks/useAuditCz'

describe('ipv4Address', () => {
  it('keeps a plain dotted IPv4 address, drops anything else', () => {
    expect(ipv4Address('188.166.166.165')).toBe('188.166.166.165')
    expect(ipv4Address(null)).toBeNull()
    expect(ipv4Address(undefined)).toBeNull()
    expect(ipv4Address('<img src=x>')).toBeNull()
    expect(ipv4Address('1.2.3')).toBeNull()
    expect(ipv4Address('999.1.1.1')).toBeNull()
    expect(ipv4Address('2a03:b0c0::1')).toBeNull()
  })
})

describe('networkLabel', () => {
  it('the reference: text after the first " - ", cut at the first comma', () => {
    expect(networkLabel(14061, 'DIGITALOCEAN-ASN - DigitalOcean, LLC, US')).toBe('AS14061 DigitalOcean')
  })
  it('without " - " the whole text (still cut at the comma)', () => {
    expect(networkLabel(24940, 'HETZNER-AS')).toBe('AS24940 HETZNER-AS')
    expect(networkLabel(1, 'Foo Networks, Inc.')).toBe('AS1 Foo Networks')
  })
  it('only the first " - " splits', () => {
    expect(networkLabel(7, 'A-AS - Big - Corp')).toBe('AS7 Big - Corp')
  })
  it('caps the name at 48 characters', () => {
    const out = networkLabel(9, `X - ${'n'.repeat(100)}`)!
    expect(out.startsWith('AS9 ')).toBe(true)
    expect(Array.from(out.slice(4))).toHaveLength(48)
    expect(out.endsWith('…')).toBe(true)
  })
  it('number only, name only, nothing', () => {
    expect(networkLabel(14061, undefined)).toBe('AS14061')
    expect(networkLabel(undefined, 'Name - Foo')).toBe('Foo')
    expect(networkLabel(undefined, undefined)).toBeNull()
    expect(networkLabel(undefined, '  ')).toBeNull()
  })
  it('an address-looking name is just text', () => {
    expect(networkLabel(1, '203.0.113.7 - 2001:db8::1')).toBe('AS1 2001:db8::1')
  })
})

describe('countryName', () => {
  it('English names with the code as fallback', () => {
    expect(countryName('US')).toBe('United States')
    expect(countryName('DE')).toBe('Germany')
    expect(countryName('CZ')).toBe('Czechia')
    expect(countryName('ZZ')).toBe('ZZ')
  })
  it('anything but two capital letters is not a country', () => {
    for (const bad of ['us', 'USA', '<b>', '', undefined, '1A']) expect(countryName(bad as string | undefined)).toBeNull()
  })
})

describe('torLabel', () => {
  it('wording and unknown', () => {
    expect(torLabel(true)).toBe('Onion address available')
    expect(torLabel(false)).toBe('No onion address')
    expect(torLabel(undefined)).toBeNull()
  })
})

describe('networkRows', () => {
  const base: AuditCzDetail = {
    network: { asn: 14061, asName: 'DIGITALOCEAN-ASN - DigitalOcean, LLC, US', country: 'US' },
    onion: false, fetchedAt: null,
  }
  it('all rows for the LNpay-like detail', () => {
    expect(networkRows(base, '188.166.166.165')).toEqual({
      ip: '188.166.166.165', network: 'AS14061 DigitalOcean', country: { name: 'United States' }, tor: 'No onion address'
    })
  })
  it('no network block: no card, whatever else is there', () => {
    expect(networkRows({ onion: true, fetchedAt: null }, null)).toBeNull()
    expect(networkRows(null, null)).toBeNull()
    expect(networkRows(undefined, undefined)).toBeNull()
  })
  it('a mint without a cashu.info detail still gets the IP row from our own lookup', () => {
    expect(networkRows(null, '188.166.166.165')).toEqual({ ip: '188.166.166.165', network: null, country: null, tor: null })
  })
  it('an offline mint without an address says Offline; an address wins; an online one stays hidden', () => {
    expect(networkRows(null, null, true)).toEqual({ ip: 'Offline', network: null, country: null, tor: null })
    expect(networkRows(null, '188.166.166.165', true)?.ip).toBe('188.166.166.165')
    expect(networkRows(null, null, false)).toBeNull()
  })
  it('hostile strings stay strings and a hostile country is hidden', () => {
    const r = networkRows({ network: { asn: 1, asName: '<img src=x onerror=alert(1)>', country: '<b>' }, fetchedAt: null }, null)!
    expect(r.network).toBe('AS1 <img src=x onerror=alert(1)>')
    expect(r.country).toBeNull()
  })
})
