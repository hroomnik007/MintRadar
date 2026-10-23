import { describe, it, expect, vi, beforeEach } from 'vitest'

// A NUL byte in an untrusted host name (CVE-2026-105482) is refused before any DNS call, on every path that
// hands a mint / relay / contact host to a resolver: ssrf.ts (checkUrlSafety, checkWsUrlSafety, safeFetch, safeLookup)
// and prober.ts (lookupGeo). mintAddress and contactChecks have their guard tests in their own files.
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('dns', () => ({ lookup: vi.fn(), default: { promises: { lookup: vi.fn() } } }))
vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('../nostrService.js', () => ({ notifySubscribers: vi.fn(), isNotificationServiceEnabled: vi.fn().mockReturnValue(false) }))
vi.mock('../versionCatalog.js', () => ({ getLatestVersionsMap: vi.fn().mockResolvedValue({}) }))

import dns, { lookup as connectLookup } from 'dns'
import { lookup as validationLookup } from 'dns/promises'
import { hasNulByte, authorityOf } from '../hostnameGuard.js'
import { checkUrlSafety, checkWsUrlSafety, isSafeUrl, safeFetch, safeLookup } from '../ssrf.js'

const vLookup = vi.mocked(validationLookup)
const cLookup = vi.mocked(connectLookup)

beforeEach(() => { vLookup.mockReset(); cLookup.mockReset() })

const NUL_HOSTS = [
  'example.com\0.evil.test',
  'example.com%00.evil.test',
  'example.com%2500.evil.test',
  'example.com%252500.evil.test',
  'example.com\0',
  '\0example.com',
  'example.com%00',
  'EXAMPLE.com%00.evil.test',
]

describe('hasNulByte / authorityOf', () => {
  it.each(NUL_HOSTS)('detects %j', (v) => { expect(hasNulByte(v)).toBe(true) })
  it.each(['example.com', 'xn--bcher-kva.example', 'a%20b.example', '100%', '%zz', ''])('passes %j', (v) => { expect(hasNulByte(v)).toBe(false) })
  it('authorityOf keeps only the part between the scheme and the first / ? #', () => {
    expect(authorityOf('https://user@host.example:8443/p%00?q#f')).toBe('user@host.example:8443')
    expect(authorityOf('wss://relay.example')).toBe('relay.example')
  })
})

describe('ssrf.ts', () => {
  it.each(NUL_HOSTS)('checkUrlSafety refuses https://%j without a lookup', async (host) => {
    vLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
    expect(await checkUrlSafety(`https://${host}/`)).toBe('blocked')
    expect(await isSafeUrl(`https://${host}`)).toBe(false)
    expect(vLookup).not.toHaveBeenCalled()
  })
  it('checkUrlSafety refuses a NUL byte in the middle of the name', async () => {
    expect(await checkUrlSafety('https://example.com\0.evil.test')).toBe('blocked')
    expect(vLookup).not.toHaveBeenCalled()
  })
  it('checkWsUrlSafety refuses a relay URL with a NUL byte without a lookup', async () => {
    expect(await checkWsUrlSafety('wss://relay.example\0.evil.test')).toBe('blocked')
    expect(await checkWsUrlSafety('wss://relay.example%00.evil.test')).toBe('blocked')
    expect(vLookup).not.toHaveBeenCalled()
  })
  it('safeFetch returns null, reports "blocked" and makes no lookup', async () => {
    const onRejected = vi.fn()
    expect(await safeFetch('https://example.com\0.evil.test/v1/info', { onRejected })).toBeNull()
    expect(await safeFetch('https://example.com%00.evil.test/v1/info', { onRejected })).toBeNull()
    expect(onRejected).toHaveBeenCalledWith('blocked')
    expect(vLookup).not.toHaveBeenCalled()
  })
  it('safeLookup (connect time) fails at once for a NUL host and never calls dns.lookup', () => {
    for (const host of ['example.com\0.evil.test', 'example.com%00.evil.test']) {
      const cb = vi.fn()
      safeLookup(host, {}, cb)
      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb.mock.calls[0]![0]).toBeInstanceOf(Error)
    }
    expect(cLookup).not.toHaveBeenCalled()
  })
  it('an ordinary host still resolves', async () => {
    vLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
    expect(await checkUrlSafety('https://mint.example.com')).toBe('safe')
  })
})

describe('prober.ts lookupGeo', () => {
  it('returns null for a NUL host without any lookup', async () => {
    const { lookupGeo } = await import('../prober.js')
    const spy = vi.mocked(dns.promises.lookup)
    spy.mockReset()
    expect(await lookupGeo('https://example.com\0.evil.test')).toBeNull()
    expect(await lookupGeo('https://example.com%00.evil.test')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
