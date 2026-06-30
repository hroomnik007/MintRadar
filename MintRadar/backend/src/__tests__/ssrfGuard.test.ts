import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock DNS resolution so the SSRF guard's three-state result can be tested
// deterministically without real network lookups.
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))

import { lookup } from 'dns/promises'
import { checkUrlSafety, isSafeUrl } from '../ssrf.js'

const mockedLookup = vi.mocked(lookup)

// Helper: make lookup resolve to the given addresses (all:true shape).
function resolvesTo(...addrs: { address: string; family: number }[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedLookup.mockResolvedValue(addrs as any)
}

beforeEach(() => {
  mockedLookup.mockReset()
})

describe('checkUrlSafety', () => {
  describe('raw private/loopback IP literals → blocked (no DNS needed)', () => {
    it.each([
      ['https://127.0.0.1', 'loopback'],
      ['https://10.0.0.1', 'private 10/8'],
      ['https://192.168.1.1', 'private 192.168/16'],
      ['https://172.16.0.1', 'private 172.16/12 low'],
      ['https://172.31.255.255', 'private 172.16/12 high'],
      ['https://169.254.1.1', 'link-local'],
      ['https://0.0.0.0', 'unspecified'],
    ])('blocks %s (%s)', async (url) => {
      expect(await checkUrlSafety(url)).toBe('blocked')
      expect(mockedLookup).not.toHaveBeenCalled()
    })
  })

  describe('protocol and length guards → blocked before DNS', () => {
    it('blocks non-https schemes', async () => {
      expect(await checkUrlSafety('http://mint.example.com')).toBe('blocked')
      expect(mockedLookup).not.toHaveBeenCalled()
    })

    it('blocks URLs longer than 500 chars', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(600)
      expect(await checkUrlSafety(longUrl)).toBe('blocked')
      expect(mockedLookup).not.toHaveBeenCalled()
    })
  })

  describe('malformed URLs → blocked (never throws)', () => {
    it.each(['not a url', '', '://', 'ht!tp://x'])('blocks %p', async (bad) => {
      expect(await checkUrlSafety(bad)).toBe('blocked')
    })
  })

  describe('public domains resolving to a public IP → safe', () => {
    it('returns safe when the domain resolves to a public unicast address', async () => {
      resolvesTo({ address: '1.2.3.4', family: 4 })
      expect(await checkUrlSafety('https://mint.example.com')).toBe('safe')
      expect(mockedLookup).toHaveBeenCalledWith('mint.example.com', { all: true })
    })
  })

  describe('domains resolving to internal IPs (DNS-rebinding style) → blocked', () => {
    it('blocks a domain that resolves to a private IP', async () => {
      resolvesTo({ address: '10.0.0.5', family: 4 })
      expect(await checkUrlSafety('https://rebind.example.com')).toBe('blocked')
    })

    it('blocks "localhost" resolving to loopback', async () => {
      resolvesTo({ address: '127.0.0.1', family: 4 })
      expect(await checkUrlSafety('https://localhost')).toBe('blocked')
    })

    it('blocks an IPv4-mapped IPv6 loopback address (::ffff:127.0.0.1)', async () => {
      resolvesTo({ address: '::ffff:127.0.0.1', family: 6 })
      expect(await checkUrlSafety('https://mapped.example.com')).toBe('blocked')
    })

    it('blocks if ANY resolved address is private (fail-safe over the set)', async () => {
      resolvesTo({ address: '1.2.3.4', family: 4 }, { address: '10.0.0.1', family: 4 })
      expect(await checkUrlSafety('https://multi.example.com')).toBe('blocked')
    })

    it('blocks (fail-closed) when a resolved address is unparseable', async () => {
      resolvesTo({ address: 'not-an-ip', family: 4 })
      expect(await checkUrlSafety('https://garbage-dns.example.com')).toBe('blocked')
    })
  })

  describe('DNS failures → dns-error (distinct third state, not blocked/safe)', () => {
    it('returns dns-error on ENOTFOUND', async () => {
      const err = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
      mockedLookup.mockRejectedValue(err)
      expect(await checkUrlSafety('https://nx.example.com')).toBe('dns-error')
    })

    it('returns dns-error when resolution yields zero addresses', async () => {
      resolvesTo()
      expect(await checkUrlSafety('https://empty.example.com')).toBe('dns-error')
    })
  })
})

describe('isSafeUrl', () => {
  it('is false for a raw private IP', async () => {
    expect(await isSafeUrl('https://127.0.0.1')).toBe(false)
  })

  it('is true for a public domain resolving to a public IP', async () => {
    resolvesTo({ address: '1.2.3.4', family: 4 })
    expect(await isSafeUrl('https://mint.example.com')).toBe(true)
  })

  it('is false for a dns-error (only "safe" maps to true)', async () => {
    mockedLookup.mockRejectedValue(new Error('boom'))
    expect(await isSafeUrl('https://nx.example.com')).toBe(false)
  })
})
