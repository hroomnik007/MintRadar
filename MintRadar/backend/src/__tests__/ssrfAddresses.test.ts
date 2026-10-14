import { describe, it, expect, vi, beforeEach } from 'vitest'

// Table-driven tests of the address rules of ssrf.ts (isBlockedIpString, the IP-literal part of checkUrlSafety /
// checkWsUrlSafety / isWellFormedMintUrl). No network and no real DNS: dns/promises is stubbed and a blocked literal
// must be refused WITHOUT any lookup.
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))

import { isIP } from 'node:net'
import { lookup } from 'dns/promises'
import { isBlockedIpString, checkUrlSafety, checkWsUrlSafety, isWellFormedMintUrl } from '../ssrf.js'

const mockedLookup = vi.mocked(lookup)

beforeEach(() => {
  mockedLookup.mockReset()
  // A literal "resolves" to itself, like the real resolver does.
  mockedLookup.mockImplementation((async (h: string) => [{ address: h.replace(/^\[|\]$/g, ''), family: isIP(h.replace(/^\[|\]$/g, '')) || 4 }]) as never)
})

// [address as ipaddr.js sees it, blocked?, why]
const V4: [string, boolean, string][] = [
  ['127.0.0.1', true, 'loopback'], ['127.255.255.254', true, 'loopback high'],
  ['10.0.0.1', true, '10/8'], ['10.255.255.255', true, '10/8 high'],
  ['172.16.0.1', true, '172.16/12 low'], ['172.31.255.255', true, '172.16/12 high'],
  ['172.15.255.255', false, 'just below 172.16/12'], ['172.32.0.1', false, 'just above 172.16/12'],
  ['192.168.0.1', true, '192.168/16'], ['192.167.255.255', false, 'just below 192.168/16'],
  ['169.254.0.1', true, 'link-local'], ['169.254.169.254', true, 'cloud metadata'], ['169.255.0.1', false, 'just above link-local'],
  ['100.64.0.1', true, 'CGNAT low'], ['100.127.255.255', true, 'CGNAT high'], ['100.63.255.255', false, 'below CGNAT'], ['100.128.0.1', false, 'above CGNAT'],
  ['0.0.0.0', true, 'this-network'], ['0.1.2.3', true, '0/8'],
  ['224.0.0.1', true, 'multicast low'], ['239.255.255.255', true, 'multicast high'],
  ['240.0.0.1', true, 'reserved 240/4'], ['255.255.255.254', true, 'reserved top'], ['255.255.255.255', true, 'broadcast'],
  ['192.0.2.1', true, 'TEST-NET-1'], ['198.51.100.1', true, 'TEST-NET-2'], ['203.0.113.1', true, 'TEST-NET-3'],
  ['198.18.0.1', true, 'benchmark 198.18/15 low'], ['198.19.255.255', true, 'benchmark high'],
  ['192.0.0.1', true, 'IETF protocol assignments 192.0.0/24'], ['192.88.99.1', true, '6to4 relay anycast (deprecated)'],
  ['93.184.216.34', false, 'public'], ['1.1.1.1', false, 'public'], ['8.8.8.8', false, 'public'], ['104.26.9.58', false, 'public (Cloudflare)'],
]

const V6: [string, boolean, string][] = [
  ['::1', true, 'loopback'], ['::', true, 'unspecified'],
  ['fe80::1', true, 'link-local'], ['febf::1', true, 'link-local top'], ['fe80::1%eth0', true, 'link-local with zone id'],
  ['fc00::1', true, 'unique local'], ['fdff::1', true, 'unique local top'],
  ['ff00::1', true, 'multicast'], ['ff02::1', true, 'link-local multicast'],
  ['::ffff:127.0.0.1', true, 'v4-mapped loopback'], ['::ffff:7f00:1', true, 'v4-mapped loopback (hex)'],
  ['::FFFF:7F00:1', true, 'v4-mapped loopback (upper case)'], ['0:0:0:0:0:ffff:7f00:0001', true, 'v4-mapped, zero padded'],
  ['::ffff:10.0.0.1', true, 'v4-mapped private'], ['::ffff:169.254.169.254', true, 'v4-mapped metadata'],
  ['::ffff:8.8.8.8', false, 'v4-mapped PUBLIC stays allowed'],
  ['::127.0.0.1', true, 'v4-compatible loopback'], ['::7f00:1', true, 'v4-compatible loopback (hex, what the URL parser prints)'],
  ['::a00:1', true, 'v4-compatible 10.0.0.1'], ['::808:808', true, 'v4-compatible 8.8.8.8: the whole ::/96 is deprecated, never routed'],
  ['64:ff9b::7f00:1', true, 'NAT64 loopback'], ['64:ff9b::a9fe:a9fe', true, 'NAT64 metadata'], ['64:ff9b::a00:1', true, 'NAT64 10.0.0.1'],
  ['64:ff9b::808:808', false, 'NAT64 PUBLIC embedded v4'],
  ['64:ff9b:1::7f00:1', true, 'NAT64 local-use /48 with embedded loopback (suffix form)'],
  ['64:ff9b:1:7f00:0:100:808:808', true, 'NAT64 local-use /48, loopback in the RFC 6052 /48 position, public-looking suffix'],
  ['64:ff9b:1::808:808', true, 'NAT64 local-use /48 is never public'],
  ['2002:7f00:1::', true, '6to4 loopback'], ['2002:a00:1::', true, '6to4 10.0.0.1'], ['2002:a9fe:a9fe::', true, '6to4 metadata'],
  ['2002:808:808::', false, '6to4 PUBLIC embedded v4'],
  ['2001:0:4136:e378:8000:63bf:f5ff:fffa', true, 'Teredo, client 10.0.0.5 (obfuscated)'], ['2001::1', true, 'Teredo, client 255.255.255.254 = reserved'],
  ['2001:0:4136:e378:8000:63bf:f7f7:f7f7', false, 'Teredo with a PUBLIC client address'],
  ['2001:db8::1', true, 'documentation'],
  ['100::1', true, 'discard 100::/64'], ['100::', true, 'discard'],
  ['::ffff:0:127.0.0.1', true, 'IPv4-translated ::ffff:0:0:0/96 with loopback'],
  ['2001:2::1', true, 'benchmarking 2001:2::/48'], ['fec0::1', true, 'deprecated site-local'],
  ['2606:4700:20::681a:83a', false, 'public (Cloudflare)'], ['2a00:1450:4001:81b::200e', false, 'public (Google)'],
]

describe('isBlockedIpString: IPv4 ranges', () => {
  it.each(V4)('%s → blocked=%s (%s)', (ip, blocked) => { expect(isBlockedIpString(ip)).toBe(blocked) })
})

describe('isBlockedIpString: IPv6 ranges and embedded IPv4', () => {
  it.each(V6)('%s → blocked=%s (%s)', (ip, blocked) => { expect(isBlockedIpString(ip)).toBe(blocked) })
})

describe('isBlockedIpString: not an address → fail closed', () => {
  it.each(['', 'not-an-ip', '1.2.3.4.5', '256.1.1.1', 'gggg::1', '1.2.3.4/8', ' 1.2.3.4', '[::1]'])('%p', (s) => {
    expect(isBlockedIpString(s)).toBe(true)
  })
})

// IPv4 literals as written in a URL: the WHATWG parser folds every notation into dotted quads before the check sees it,
// so the host the check inspects is the host the socket connects to.
const NOTATIONS: [string, string][] = [
  ['https://2130706433', 'decimal integer 127.0.0.1'], ['https://0x7f000001', 'hex integer'], ['https://0x7f.1', 'hex + short'],
  ['https://0177.0.0.1', 'octal'], ['https://0177.0.0.01', 'octal, leading zeros'], ['https://127.1', 'short form 127.1'],
  ['https://127.0.1', 'short form 127.0.1'], ['https://0x7f.0x0.0x0.0x1', 'all hex'], ['https://0177.0x0.0.1', 'mixed bases'],
  ['https://017700000001', 'octal integer'], ['https://127.0.0.1.', 'trailing dot'], ['https://127。0。0。1', 'ideographic full stop'],
  ['https://127．0．0．1', 'fullwidth full stop'], ['https://127｡0｡0｡1', 'halfwidth ideographic full stop'], ['https://127%2e0%2e0%2e1', 'percent-encoded dots'],
  ['https://0', 'single zero'], ['https://0.0', 'short zero'], ['https://0x0', 'hex zero'],
  ['https://10.1', '10.0.0.1 short'], ['https://0xa000001', '10.0.0.1 hex integer'], ['https://167772161', '10.0.0.1 decimal'],
  ['https://192.168.1', '192.168.0.1 short'], ['https://3232235777', '192.168.1.1 decimal'], ['https://0xc0a80101', '192.168.1.1 hex'],
  ['https://2852039166', '169.254.169.254 decimal'], ['https://0xa9fea9fe', '169.254.169.254 hex'], ['https://0251.0376.0251.0376', '169.254.169.254 octal'],
  ['https://4294967295', '255.255.255.255 decimal'], ['https://3758096385', '224.0.0.1 decimal'],
  ['https://[::1]', 'IPv6 loopback'], ['https://[0:0:0:0:0:0:0:1]', 'IPv6 loopback long form'], ['https://[::ffff:127.0.0.1]', 'v4-mapped'],
  ['https://[::ffff:7f00:1]', 'v4-mapped hex'], ['https://[::FFFF:7F00:1]', 'v4-mapped upper case'], ['https://[::127.0.0.1]', 'v4-compatible'],
  ['https://[::7f00:1]', 'v4-compatible hex'], ['https://[fe80::1]', 'link-local'], ['https://[fc00::1]', 'unique local'], ['https://[ff02::1]', 'multicast'],
  ['https://[64:ff9b::7f00:1]', 'NAT64'], ['https://[2002:7f00:1::]', '6to4'], ['https://[100::1]', 'discard'], ['https://[2001:db8::1]', 'documentation'],
  ['https://[::ffff:0:127.0.0.1]', 'IPv4-translated'],
]

describe('IP literals in every URL notation: blocked before any DNS lookup', () => {
  it.each(NOTATIONS)('checkUrlSafety %s (%s)', async (url) => {
    expect(await checkUrlSafety(url)).toBe('blocked')
    expect(mockedLookup).not.toHaveBeenCalled()
  })
  it.each(NOTATIONS)('checkWsUrlSafety (wss) %s (%s)', async (url) => {
    expect(await checkWsUrlSafety(url.replace('https:', 'wss:'))).toBe('blocked')
    expect(mockedLookup).not.toHaveBeenCalled()
  })
  it.each(NOTATIONS)('isWellFormedMintUrl %s (%s)', (url) => {
    expect(isWellFormedMintUrl(url)).toBe(false)
  })
})

describe('the host the check sees is the host the connection uses (URL parser differentials)', () => {
  // [input, hostname the URL parser reports (what undici/ws connect to)]
  const CASES: [string, string][] = [
    ['https://allowed.example@127.0.0.1/', '127.0.0.1'],
    ['https://127.0.0.1#@allowed.example/', '127.0.0.1'],
    ['https://allowed.example\\@127.0.0.1/', 'allowed.example'],
    ['https://allowed.example%2f@127.0.0.1/', '127.0.0.1'],
    ['https://user:pw@10.0.0.1:8443/x', '10.0.0.1'],
    ['https://127.0.0.1:443@allowed.example/', 'allowed.example'],
    ['https://allowed.example:443@[::1]/', '[::1]'],
    ['https://allowed.example?@127.0.0.1/', 'allowed.example'],
    ['https:\\\\127.0.0.1\\', '127.0.0.1'],
    ['https:///127.0.0.1/', '127.0.0.1'],
    ['https:127.0.0.1', '127.0.0.1'],
    ['HTTPS://LOCALHOST', 'localhost'],
    ['https://ＬＯＣＡＬＨＯＳＴ', 'localhost'],
    ['https://ALLOWED.Example', 'allowed.example'],
    ['https://000127.0.0.1', '87.0.0.1'], // octal 000127 = 87: a PUBLIC address, and exactly what the socket would use
  ]
  it.each(CASES)('%s connects to %s', async (input, host) => {
    expect(new URL(input).hostname).toBe(host)
    // Whatever the verdict, it is the verdict for that very host: a loopback/private one is blocked, a name goes to DNS.
    const verdict = await checkUrlSafety(input)
    const bare = host.replace(/^\[|\]$/g, '')
    const isLiteralBlocked = isIP(bare) !== 0 && isBlockedIpString(bare)
    if (isLiteralBlocked) {
      expect(verdict).toBe('blocked')
      expect(mockedLookup).not.toHaveBeenCalled()
    } else {
      expect(mockedLookup).toHaveBeenCalledWith(host, { all: true })
    }
  })

  it.each([
    'https://allowed.example\u0000@127.0.0.1/', 'https://127.0.0.1\n/', 'https://127.0.\t0.1/', 'https://exa mple.com/',
    'https://[::1', 'https://127.0.0.1:99999/', 'https://127.0.0.1:-1/', 'https://127.0.0.1:abc/', 'https://%00/', 'https://a b/',
  ])('malformed or smuggling input %j never yields "safe"', async (input) => {
    expect(await checkUrlSafety(input)).not.toBe('safe')
  })
})
