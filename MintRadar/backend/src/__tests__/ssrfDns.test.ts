import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Schemes, ports, host-name forms, the DNS policy and DNS rebinding of ssrf.ts. No real network and no real DNS:
// both lookups (dns/promises for the validation, dns for the connect-time pin) are stubbed. The one real socket is a
// stub server on 127.0.0.1 that the test starts itself and which the code must NEVER reach.
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('dns', () => ({ lookup: vi.fn() }))

import { createServer, type Server } from 'node:net'
import { lookup as validationLookup } from 'dns/promises'
import { lookup as connectLookup } from 'dns'
import {
  checkUrlSafety, checkWsUrlSafety, isSafeUrl, isSafeWsUrl, isWellFormedMintUrl, isAllowedRelayPort, safeLookup, safeFetch,
} from '../ssrf.js'

const vLookup = vi.mocked(validationLookup)
const cLookup = vi.mocked(connectLookup)

type Answer = { address: string; family: number }
const answers = (...a: string[]): Answer[] => a.map(address => ({ address, family: address.includes(':') ? 6 : 4 }))
const resolvesTo = (...a: string[]): void => { vLookup.mockResolvedValue(answers(...a) as never) }

beforeEach(() => { vLookup.mockReset(); cLookup.mockReset() })

describe('schemes', () => {
  const BAD = [
    'http://mint.example.com', 'ws://mint.example.com', 'wss://mint.example.com', 'file:///etc/passwd', 'file://localhost/etc/passwd',
    'ftp://mint.example.com', 'gopher://mint.example.com:70/_x', 'data:text/plain,hi', 'javascript:alert(1)', 'blob:https://mint.example.com/uuid',
    'about:blank', '//mint.example.com', '/just/a/path', 'mint.example.com', '', 'https:', 'https://', 'HTTP://mint.example.com',
    'dict://mint.example.com:11211/stats', 'ldap://mint.example.com', 'sftp://mint.example.com', 'jar:https://mint.example.com!/',
  ]
  it.each(BAD)('checkUrlSafety refuses %j without a lookup', async (url) => {
    expect(await checkUrlSafety(url)).toBe('blocked')
    expect(vLookup).not.toHaveBeenCalled()
  })

  const BAD_WS = [
    'https://relay.example.com', 'http://relay.example.com', 'file:///etc/passwd', 'ftp://relay.example.com', 'gopher://relay.example.com',
    'data:text/plain,hi', 'javascript:alert(1)', 'blob:wss://relay.example.com/x', 'about:blank', '//relay.example.com', 'relay.example.com', '',
  ]
  it.each(BAD_WS)('checkWsUrlSafety refuses %j without a lookup', async (url) => {
    expect(await checkWsUrlSafety(url)).toBe('blocked')
    expect(vLookup).not.toHaveBeenCalled()
  })

  it('https is allowed for mints, ws/wss only for relays (and wss uses the same address rules)', async () => {
    resolvesTo('93.184.216.34')
    expect(await checkUrlSafety('https://mint.example.com')).toBe('safe')
    expect(await checkWsUrlSafety('wss://relay.example.com')).toBe('safe')
    expect(await checkWsUrlSafety('ws://relay.example.com')).toBe('safe')
    resolvesTo('10.0.0.1')
    expect(await checkWsUrlSafety('wss://relay.example.com')).toBe('blocked')
  })

  it('an over-long URL (> 500 characters) is refused before DNS', async () => {
    expect(await checkUrlSafety('https://mint.example.com/' + 'a'.repeat(480))).toBe('blocked')
    expect(await checkWsUrlSafety('wss://relay.example.com/' + 'a'.repeat(480))).toBe('blocked')
    expect(vLookup).not.toHaveBeenCalled()
  })
})

describe('ports', () => {
  it.each([
    'wss://relay.example.com:22', 'wss://relay.example.com:25', 'wss://relay.example.com:3306', 'wss://relay.example.com:5432',
    'wss://relay.example.com:6379', 'wss://relay.example.com:11211', 'wss://relay.example.com:8080', 'wss://relay.example.com:0',
    'ws://relay.example.com:443', 'wss://relay.example.com:80', 'ws://relay.example.com:8080', 'ws://relay.example.com:22',
    'wss://relay.example.com:65536', 'wss://relay.example.com:-1', 'wss://relay.example.com:abc', 'wss://relay.example.com:443x',
    'wss://relay.example.com:4430',
  ])('relay %s: refused before any lookup', async (url) => {
    expect(isAllowedRelayPort(url)).toBe(false)
    expect(await checkWsUrlSafety(url)).toBe('blocked')
    expect(vLookup).not.toHaveBeenCalled()
  })

  it.each(['wss://relay.example.com', 'wss://relay.example.com:443', 'ws://relay.example.com', 'ws://relay.example.com:80', 'wss://relay.example.com:443/path?x=1'])(
    'relay %s: allowed (default or the one port of its scheme)', async (url) => {
      resolvesTo('93.184.216.34')
      expect(isAllowedRelayPort(url)).toBe(true)
      expect(await checkWsUrlSafety(url)).toBe('safe')
    })

  // Mint URLs have no port allow-list on purpose (mints run on 3338, 8085, ...): the target is always a PUBLIC host
  // reached over TLS. An invalid port is still refused, and a blocked address is blocked on every port.
  it.each(['https://mint.example.com:65536', 'https://mint.example.com:-1', 'https://mint.example.com:abc', 'https://mint.example.com:99999'])(
    'mint %s: invalid port → blocked', async (url) => {
      expect(await checkUrlSafety(url)).toBe('blocked')
      expect(vLookup).not.toHaveBeenCalled()
    })
  it.each(['https://127.0.0.1:22', 'https://10.0.0.1:6379', 'https://169.254.169.254:80', 'https://[::1]:3306'])(
    'mint %s: a blocked address stays blocked on any port', async (url) => {
      expect(await checkUrlSafety(url)).toBe('blocked')
      expect(vLookup).not.toHaveBeenCalled()
    })
  it('mint on a public host with a non-default port is allowed (documented behaviour)', async () => {
    resolvesTo('93.184.216.34')
    expect(await checkUrlSafety('https://mint.example.com:3338/Bitcoin')).toBe('safe')
  })
})

describe('host-name forms', () => {
  // A name is judged by what it RESOLVES to; the URL parser lower-cases and punycodes it first.
  const LOOPBACK_NAMES = [
    'https://localhost', 'https://localhost.', 'https://LOCALHOST', 'https://foo.localhost', 'https://a.b.localhost.', 'https://ＬＯＣＡＬＨＯＳＴ',
    'https://localhost%2e', 'https://localhost。',
  ]
  it.each(LOOPBACK_NAMES)('%s resolving to loopback → blocked', async (url) => {
    resolvesTo('127.0.0.1')
    expect(await checkUrlSafety(url)).toBe('blocked')
    resolvesTo('::1')
    expect(await checkUrlSafety(url)).toBe('blocked')
  })

  it.each([
    ['https://anything.local', '192.168.1.5'], ['https://printer.internal', '10.0.0.7'], ['https://metadata.google.internal', '169.254.169.254'],
    ['https://instance-data', '169.254.169.254'], ['https://kubernetes.default.svc', '10.96.0.1'], ['https://db.corp.', '172.16.4.4'],
  ])('%s resolving to %s → blocked', async (url, ip) => {
    resolvesTo(ip)
    expect(await checkUrlSafety(url)).toBe('blocked')
  })

  it('the lookup receives the normalised host: lower case, punycode, no brackets games', async () => {
    resolvesTo('93.184.216.34')
    await checkUrlSafety('https://MINT.Example.COM/x')
    await checkUrlSafety('https://bücher.example')
    await checkUrlSafety('https://xn--bcher-kva.example')
    await checkUrlSafety('https://mint.example.com.')
    expect(vLookup.mock.calls.map(c => c[0])).toEqual(['mint.example.com', 'xn--bcher-kva.example', 'xn--bcher-kva.example', 'mint.example.com.'])
  })

  it.each(['https://1.2.3.256', 'https://1.2.3.4.5', 'https://0x', 'https://a b', 'https://exa%00mple.com', 'https://a\u0000b.com'])(
    '%j: not a valid host → blocked, no lookup', async (url) => {
      expect(await checkUrlSafety(url)).toBe('blocked')
      expect(vLookup).not.toHaveBeenCalled()
    })

  it('a digits-and-dots host is an IPv4 literal for the URL parser: the check judges the address the socket would use', async () => {
    expect(new URL('https://123.456').hostname).toBe('123.0.1.200')
    resolvesTo('123.0.1.200')
    expect(await checkUrlSafety('https://123.456')).toBe('safe')
    expect(vLookup).toHaveBeenCalledWith('123.0.1.200', { all: true })
    expect(await checkUrlSafety('https://10.456')).toBe('blocked') // 10.0.1.200
  })

  it('a 300-character host name and an empty label never reach "safe" without a resolver answer', async () => {
    vLookup.mockRejectedValue(Object.assign(new Error('bad name'), { code: 'ENOTFOUND' }))
    expect(await checkUrlSafety('https://' + 'a'.repeat(300) + '.example.com')).toBe('dns-error')
    expect(await checkUrlSafety('https://a..example.com')).not.toBe('safe')
    expect(isWellFormedMintUrl('https://' + 'a'.repeat(300) + '.example.com')).toBe(false)
    expect(isWellFormedMintUrl('https://a..example.com')).toBe(false)
    expect(isWellFormedMintUrl('https://' + ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(62)].join('.') + '.com')).toBe(false) // > 253
  })

  describe('isWellFormedMintUrl (syntax only, never a lookup)', () => {
    it.each([
      'https://mint.example.com', 'https://mint.example.com.', 'https://MINT.EXAMPLE.COM', 'https://xn--bcher-kva.example', 'https://bücher.example',
      'https://my_mint.example.com', 'https://mint.example.com:3338/Bitcoin', 'https://abcdefghijklmnop.onion', 'https://8.8.8.8', 'https://[2606:4700:20::681a:83a]',
      'https://a-b.example.com', 'https://' + 'a'.repeat(63) + '.com',
    ])('accepts %s', (url) => { expect(isWellFormedMintUrl(url)).toBe(true) })
    it.each([
      'https://localhost', 'https://localhost.', 'https://intranet', 'https://a..b', 'https://.example.com', 'https://-a.example.com', 'https://a-.example.com',
      'https://exa mple.com', 'https://user@mint.example.com', 'https://user:pw@mint.example.com', 'https://:pw@mint.example.com', 'http://mint.example.com',
      'https://mint.example.com\n', ' https://mint.example.com', 'https://' + 'a'.repeat(64) + '.com', 'https://a.b..',
      'https://127.0.0.1', 'https://[::1]', 'https://169.254.169.254', 'https://10.0.0.1', 'https://224.0.0.1', 'https://[ff02::1]', 'https://[::7f00:1]',
    ])('rejects %j', (url) => { expect(isWellFormedMintUrl(url)).toBe(false) })
    it('rejects non-strings', () => { expect(isWellFormedMintUrl(undefined as never)).toBe(false); expect(isWellFormedMintUrl(null as never)).toBe(false); expect(isWellFormedMintUrl(5 as never)).toBe(false) })
    it('never touches DNS', () => { isWellFormedMintUrl('https://mint.example.com'); expect(vLookup).not.toHaveBeenCalled() })
  })
})

describe('DNS policy (validation lookup)', () => {
  const P4 = '93.184.216.34', P6 = '2606:4700:20::681a:83a'
  it.each([
    ['public v4 only', [P4], 'safe'],
    ['public v6 only', [P6], 'safe'],
    ['public v4 + public v6', [P4, P6], 'safe'],
    ['several public v4', [P4, '1.1.1.1', '8.8.8.8'], 'safe'],
    ['private only', ['10.0.0.5'], 'blocked'],
    ['loopback only', ['127.0.0.1'], 'blocked'],
    ['metadata only', ['169.254.169.254'], 'blocked'],
    ['public + private (fail closed over the whole set)', [P4, '10.0.0.5'], 'blocked'],
    ['private first, public second', ['192.168.1.1', P4], 'blocked'],
    ['public v4 + loopback v6', [P4, '::1'], 'blocked'],
    ['public v4 + v4-mapped private', [P4, '::ffff:10.0.0.1'], 'blocked'],
    ['public v6 + link-local v6', [P6, 'fe80::1'], 'blocked'],
    ['v6 NAT64 with private v4', ['64:ff9b::a00:1'], 'blocked'],
    ['multicast answer', ['224.0.0.1'], 'blocked'],
    ['unparseable answer', ['not-an-ip'], 'blocked'],
    ['unparseable among public', [P4, 'garbage'], 'blocked'],
    ['empty answer', [], 'dns-error'],
  ] as [string, string[], string][])('%s → %s', async (_n, ips, expected) => {
    resolvesTo(...ips)
    expect(await checkUrlSafety('https://mint.example.com')).toBe(expected)
    expect(await isSafeUrl('https://mint.example.com')).toBe(expected === 'safe')
    expect(await checkWsUrlSafety('wss://mint.example.com')).toBe(expected)
    expect(await isSafeWsUrl('wss://mint.example.com')).toBe(expected === 'safe')
  })

  it.each([['ENOTFOUND'], ['ETIMEOUT'], ['EAI_AGAIN'], ['ESERVFAIL'], ['ECONNREFUSED'], ['EINVAL']])('lookup error %s → dns-error (never "safe")', async (code) => {
    vLookup.mockRejectedValue(Object.assign(new Error(code), { code }))
    expect(await checkUrlSafety('https://mint.example.com')).toBe('dns-error')
    expect(await isSafeUrl('https://mint.example.com')).toBe(false)
  })

  it('a non-error rejection and a throwing stub are also dns-error / blocked, never "safe"', async () => {
    vLookup.mockRejectedValue('boom')
    expect(await checkUrlSafety('https://mint.example.com')).toBe('dns-error')
    vLookup.mockImplementation((() => { throw new Error('sync throw') }) as never)
    expect(await checkUrlSafety('https://mint.example.com')).toBe('dns-error')
  })

  it('the verdict is recomputed on every call (no caching of a "safe")', async () => {
    resolvesTo('93.184.216.34')
    expect(await checkUrlSafety('https://flip.example.com')).toBe('safe')
    resolvesTo('127.0.0.1')
    expect(await checkUrlSafety('https://flip.example.com')).toBe('blocked')
    expect(vLookup).toHaveBeenCalledTimes(2)
  })
})

describe('safeLookup: the connect-time pin', () => {
  type Cb = (err: Error | null, addr: unknown, family?: number) => void
  const run = (host: string, ...ips: string[]): Promise<{ err: Error | null; addr: unknown; family: number | undefined }> =>
    new Promise(resolve => {
      cLookup.mockImplementationOnce(((_h: string, _o: unknown, cb: Cb) => cb(null, answers(...ips))) as never)
      safeLookup(host, {}, ((err: Error | null, addr: unknown, family?: number) => resolve({ err, addr, family })) as never)
    })

  it('hands the connection exactly the validated addresses, resolving once', async () => {
    const r = await run('mint.example.com', '93.184.216.34', '2606:4700:20::681a:83a')
    expect(r.err).toBeNull()
    expect(r.addr).toEqual(answers('93.184.216.34', '2606:4700:20::681a:83a'))
    expect(r.family).toBe(4)
    expect(cLookup).toHaveBeenCalledTimes(1)
    expect(cLookup.mock.calls[0]![1]).toMatchObject({ all: true })
  })

  it.each([
    ['loopback', ['127.0.0.1']], ['private', ['10.0.0.9']], ['metadata', ['169.254.169.254']], ['mixed with a public one', ['93.184.216.34', '192.168.0.2']],
    ['v4-mapped loopback', ['::ffff:7f00:1']], ['NAT64 private', ['64:ff9b::a00:1']], ['multicast', ['224.0.0.1']], ['unparseable', ['x']],
  ] as [string, string[]][])('refuses a connect-time answer that is %s', async (_n, ips) => {
    const r = await run('mint.example.com', ...ips)
    expect(r.err).toBeInstanceOf(Error)
    expect(r.addr).toBe('')
  })

  it('passes resolver errors and an empty answer on as errors', async () => {
    cLookup.mockImplementationOnce(((_h: string, _o: unknown, cb: Cb) => cb(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }), [])) as never)
    const e = await new Promise<Error | null>(res => safeLookup('nx.example.com', {}, ((err: Error | null) => res(err)) as never))
    expect((e as NodeJS.ErrnoException).code).toBe('ENOTFOUND')
    const r = await run('empty.example.com')
    expect(r.err?.message).toBe('No addresses resolved')
  })
})

describe('DNS rebinding: public at validation, private at connection', () => {
  let server: Server
  let port: number
  let connections: number

  beforeEach(async () => {
    connections = 0
    server = createServer(sock => { connections++; sock.destroy() })
    await new Promise<void>(res => server.listen(0, '127.0.0.1', res))
    port = (server.address() as { port: number }).port
  })
  afterEach(async () => { await new Promise<void>(res => server.close(() => res())) })

  it('safeFetch validates a public answer, then the connect-time lookup returns 127.0.0.1: no socket is opened', async () => {
    resolvesTo('93.184.216.34')
    let connectResolutions = 0
    cLookup.mockImplementation(((_h: string, _o: unknown, cb: Cb2) => { connectResolutions++; cb(null, answers('127.0.0.1')) }) as never)
    type Cb2 = (err: Error | null, addr: unknown) => void
    const errors: unknown[] = []
    const res = await safeFetch(`https://rebind.example:${port}/v1/info`, { timeoutMs: 3000, onError: e => errors.push(e) })
    expect(res).toBeNull()
    expect(connections).toBe(0)
    expect(vLookup).toHaveBeenCalledTimes(1)
    expect(connectResolutions).toBe(1) // the one connect-time resolution is the pinned one; nothing resolves again
    expect(String((errors[0] as { cause?: Error })?.cause?.message ?? errors[0])).toMatch(/Blocked address/)
  })

  it('same for a rebind to the metadata address, a private range and an IPv4-mapped loopback', async () => {
    for (const ip of ['169.254.169.254', '10.1.2.3', '::ffff:127.0.0.1']) {
      resolvesTo('93.184.216.34')
      cLookup.mockImplementation(((_h: string, _o: unknown, cb: (e: Error | null, a: unknown) => void) => cb(null, answers(ip))) as never)
      expect(await safeFetch(`https://rebind.example:${port}/`, { timeoutMs: 3000 })).toBeNull()
    }
    expect(connections).toBe(0)
  })

  it('a literal loopback URL is refused before any lookup at all', async () => {
    const rejected: string[] = []
    expect(await safeFetch(`https://127.0.0.1:${port}/`, { timeoutMs: 3000, onRejected: r => rejected.push(r) })).toBeNull()
    expect(rejected).toEqual(['blocked'])
    expect(vLookup).not.toHaveBeenCalled()
    expect(cLookup).not.toHaveBeenCalled()
    expect(connections).toBe(0)
  })
})
