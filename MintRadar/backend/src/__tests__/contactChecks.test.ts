import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nip19 } from 'nostr-tools'

// Facts about the contact entries of a mint (contactChecks.ts). The pool and the DNS resolver are mocked; a canary contact
// (a distinctive fake e-mail, npub and handle) must never reach a database write, a log line or an error message, and no
// HTTP request may be made to a contact value.

vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))
const dnsMock = vi.hoisted(() => ({
  resolveMx: vi.fn(), resolve4: vi.fn(), resolve6: vi.fn(),
}))
vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
  Resolver: class { resolveMx = dnsMock.resolveMx; resolve4 = dnsMock.resolve4; resolve6 = dnsMock.resolve6 },
}))
vi.mock('../ssrf.js', () => ({ safeFetch: vi.fn(), safeLookup: vi.fn() }))

type Mod = typeof import('../contactChecks.js')
let m: Mod
let query: ReturnType<typeof vi.fn>

const HEX = 'ab'.repeat(32)
const NPUB = nip19.npubEncode(HEX)
const NPROFILE = nip19.nprofileEncode({ pubkey: HEX, relays: ['wss://relay.nip19-host.com'] })
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000

const err = (code: string): Error => Object.assign(new Error(`query ${code} some.domain.example`), { code })

beforeEach(async () => {
  vi.resetModules()
  dnsMock.resolveMx.mockReset().mockResolvedValue([{ exchange: 'mx.mail.example', priority: 10 }])
  dnsMock.resolve4.mockReset().mockRejectedValue(err('ENODATA'))
  dnsMock.resolve6.mockReset().mockRejectedValue(err('ENODATA'))
  m = await import('../contactChecks.js')
  query = (await import('../db.js')).pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 })
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const yes = (): Promise<boolean | null> => Promise.resolve(true)

describe('kinds', () => {
  it('maps the stated method to the fixed list; website is url; anything else is other', () => {
    expect(['email', 'Nostr', ' twitter ', 'x', 'telegram', 'signal', 'website', 'url', 'vk', 'matrix', '', 5, null].map(k => m.kindOf(k)))
      .toEqual(['email', 'nostr', 'twitter', 'x', 'telegram', 'signal', 'url', 'url', 'other', 'other', 'other', 'other', 'other'])
  })
})

describe('e-mail syntax', () => {
  it.each(['a@example-mail.com', 'first.last+tag@sub.mail-host.org', "o'neil@mail-host.io", 'x@mail-host.technology', 'a@mail.com', 'a.b+tag@sub.mail.co.uk', 'info@bücher.de'])('valid: %s', v => {
    expect(m.parseEmail(v).valid).toBe(true)
  })
  it.each(['', 'plain', '@mail-host.com', 'a@', 'a b@mail-host.com', 'a@@mail-host.com', 'a@b@mail-host.com', '.a@mail-host.com', 'a.@mail-host.com',
    'a..b@mail-host.com', 'a@-mail.com', 'a@mail..com', 'a@mail-.com', `${'x'.repeat(65)}@mail-host.com`, 'a@1.2.3.4', 'a@[not-an-ip]',
    'a@mail.com/x', 'a@mail.com:25', 'a@mail.com?x', 'a@mail.com#x', 'a@b@c.com'])('invalid: %j', v => {
    expect(m.parseEmail(v).valid).toBe(false)
  })
  it('converts an internationalised domain to punycode', () => {
    expect(m.parseEmail('info@bücher.de')).toEqual({ valid: true, domain: 'xn--bcher-kva.de' })
  })
  it('an IP literal is valid syntax with no domain to look up', () => {
    expect(m.parseEmail('a@[203.0.113.9]')).toEqual({ valid: true, domain: null })
    expect(m.parseEmail('a@[IPv6:2001:db8::1]')).toEqual({ valid: true, domain: null })
  })
})

describe('public domain names', () => {
  it.each(['mail-host.com', 'a.b.mail-host.co.uk', 'xn--bcher-kva.de'])('public: %s', d => expect(m.isPublicDomainName(d)).toBe(true))
  it.each(['localhost', 'host.localhost', 'printer.local', 'db.internal', 'nas.lan', 'a.home.arpa', 'x.onion', 'example.com', 'mail.example.org',
    'foo.test', 'singlelabel', '1.2.3.4', '192.168.0.1', '[::1]', 'a.123', '', 'a'.repeat(64) + '.com'])('not public: %j', d => expect(m.isPublicDomainName(d)).toBe(false))
})

describe('nostr, url and handle formats', () => {
  it('npub with a valid checksum or 64 hex characters', () => {
    const ok = (v: string) => m.parseNostrContact(v).valid
    expect(ok(NPUB)).toBe(true)
    expect(ok(HEX)).toBe(true)
    expect(ok(HEX.toUpperCase())).toBe(true)
    const broken = NPUB.slice(0, -1) + (NPUB.endsWith('q') ? 'p' : 'q')
    expect(ok(broken)).toBe(false)
    expect(ok(HEX.slice(1))).toBe(false)
    expect(ok('nsec1' + 'q'.repeat(58))).toBe(false)
    expect(ok(nip19.nsecEncode(new Uint8Array(32).fill(7)))).toBe(false)
    expect(ok('')).toBe(false)
    expect(ok('   ')).toBe(false)
  })
  it('accepts whitespace around the value and an optional nostr: prefix (any case)', () => {
    for (const v of [`  ${NPUB}\n`, `nostr:${NPUB}`, `NOSTR:${NPUB}`, ` nostr:${HEX} `, `nostr:${NPROFILE}`, `nostr:ops@nip05-host.com`])
      expect(m.parseNostrContact(v).valid, v).toBe(true)
  })
  it('all-uppercase bech32 is accepted, mixed case is not (BIP-173)', () => {
    expect(m.parseNostrContact(NPUB.toUpperCase()).valid).toBe(true)
    expect(m.parseNostrContact(NPROFILE.toUpperCase()).valid).toBe(true)
    expect(m.parseNostrContact(`nostr:${NPUB.toUpperCase()}`).valid).toBe(true)
    const mixed = NPUB.slice(0, 20) + NPUB.slice(20).toUpperCase()
    expect(m.parseNostrContact(mixed).valid).toBe(false)
    expect(m.parseNostrContact('N' + NPUB.slice(1)).valid).toBe(false)
    expect(m.parseNostrContact(NPROFILE.slice(0, 20) + NPROFILE.slice(20).toUpperCase()).valid).toBe(false)
  })
  it('a bad checksum is rejected, for npub and nprofile', () => {
    const flip = (v: string) => v.slice(0, -1) + (v.endsWith('q') ? 'p' : 'q')
    expect(m.parseNostrContact(flip(NPUB)).valid).toBe(false)
    expect(m.parseNostrContact(flip(NPROFILE)).valid).toBe(false)
    expect(m.parseNostrContact(`nostr:${flip(NPUB)}`).valid).toBe(false)
  })
  it('nprofile: valid checksum and a 32-byte public key (relay hints are ignored, never contacted)', () => {
    expect(m.parseNostrContact(NPROFILE)).toEqual({ valid: true, domain: null })
    expect(m.parseNostrContact(nip19.nprofileEncode({ pubkey: HEX })).valid).toBe(true)
    // note1... / nevent1... are bech32 too but not a contact key
    expect(m.parseNostrContact(nip19.noteEncode(HEX)).valid).toBe(false)
    expect(m.parseNostrContact(nip19.neventEncode({ id: HEX })).valid).toBe(false)
  })
  it('NIP-05 style local@domain: a-z0-9-_. local part, public domain, case-insensitive', () => {
    for (const v of ['ops@nip05-host.com', '_@nip05-host.com', 'First.Last_1-x@Sub.NIP05-host.org', 'a@bücher.de'])
      expect(m.parseNostrContact(v).valid, v).toBe(true)
    expect(m.parseNostrContact('Ops@NIP05-Host.com')).toEqual({ valid: true, domain: 'nip05-host.com' })
    for (const v of ['@nip05-host.com', 'ops@', 'a b@nip05-host.com', 'a+b@nip05-host.com', 'a@@nip05-host.com', 'a@b@nip05-host.com', 'ops@localhost',
      'ops@printer.local', 'ops@1.2.3.4', 'ops@[::1]', 'ops@example.com', 'ops@nodot', 'ops@nip05-host.com/path', 'ops@nip05-host.com:80', 'npub@nip05-host.com.'.replace('.com.', '..com')])
      expect(m.parseNostrContact(v).valid, v).toBe(false)
  })
  it('anything else is not recognised', () => {
    for (const v of ['@somebody', 'somebody', 'https://nip05-host.com', 'npub', 'npub1', `npub${HEX}`, 'x'.repeat(301), `nostr:`, `nostr:nostr:${NPUB}`])
      expect(m.parseNostrContact(v).valid, v).toBe(false)
  })
  it('url: https with a public host name only', () => {
    expect(m.isValidContactUrl('https://mint-site.com/about')).toBe(true)
    for (const v of ['http://mint-site.com', 'https://localhost/x', 'https://10.0.0.1/', 'https://[::1]/', 'https://printer.local', 'javascript:alert(1)', 'mint-site.com', '', 'ftp://mint-site.com'])
      expect(m.isValidContactUrl(v), v).toBe(false)
  })
  it('handles: printable text of a sane length', () => {
    expect(m.isValidHandle('@somebody')).toBe(true)
    expect(m.isValidHandle('')).toBe(false)
    expect(m.isValidHandle('   ')).toBe(false)
    expect(m.isValidHandle('a\u0000b')).toBe(false)
    expect(m.isValidHandle('x'.repeat(201))).toBe(false)
  })
})

describe('checks per entry', () => {
  const now = () => NOW
  it('each kind: format result, DNS only for the e-mail domain, null elsewhere', async () => {
    const lookup = vi.fn(yes)
    const domains = m.createDomainChecker({ lookup, now })
    const out = await m.computeContactChecks([
      { method: 'email', info: 'ops@mail-host.com' },
      { method: 'email', info: 'not an email' },
      { method: 'nostr', info: NPUB },
      { method: 'nostr', info: 'npub1bad' },
      { method: 'nostr', info: 'ops@nip05-host.com' },
      { method: 'twitter', info: '@somebody' },
      { method: 'telegram', info: '' },
      { method: 'website', info: 'https://mint-site.com' },
      { method: 'website', info: 'http://mint-site.com' },
      { method: 'vk', info: 'id123' },
    ], { now, domains })
    const at = new Date(NOW).toISOString()
    expect(out).toEqual([
      { kind: 'email', formatValid: true, domainResolves: true, checkedAt: at },
      { kind: 'email', formatValid: false, domainResolves: null, checkedAt: at },
      { kind: 'nostr', formatValid: true, domainResolves: null, checkedAt: at },
      { kind: 'nostr', formatValid: false, domainResolves: null, checkedAt: at },
      { kind: 'nostr', formatValid: true, domainResolves: true, checkedAt: at },
      { kind: 'twitter', formatValid: true, domainResolves: null, checkedAt: at },
      { kind: 'telegram', formatValid: false, domainResolves: null, checkedAt: at },
      { kind: 'url', formatValid: true, domainResolves: null, checkedAt: at },
      { kind: 'url', formatValid: false, domainResolves: null, checkedAt: at },
      { kind: 'other', formatValid: true, domainResolves: null, checkedAt: at },
    ])
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(lookup.mock.calls.map(c => (c as unknown[])[0])).toEqual(['mail-host.com', 'nip05-host.com'])
  })

  it('an IP literal, localhost, a private or reserved name is never looked up (null)', async () => {
    const lookup = vi.fn(yes)
    const domains = m.createDomainChecker({ lookup, now })
    const batch = (list: string[]) => m.computeContactChecks(list.map(info => ({ method: 'email', info })), { now, domains })
    const out = [
      ...await batch(['a@[203.0.113.9]', 'a@localhost', 'a@printer.local']),
      ...await batch(['a@db.internal', 'a@example.com', 'a@nodot']),
    ]
    expect(out.map(c => c.formatValid)).toEqual([true, true, true, true, true, true])
    expect(out.map(c => c.domainResolves)).toEqual([null, null, null, null, null, null])
    expect(lookup).not.toHaveBeenCalled()
  })

  it('at most 3 e-mail entries are checked, other kinds are not affected', async () => {
    const lookup = vi.fn(yes)
    const raw = [1, 2, 3, 4, 5].map(i => ({ method: 'email', info: `u${i}@mail-host${i}.com` })).concat([{ method: 'nostr', info: HEX } as never])
    const out = await m.computeContactChecks(raw, { now, domains: m.createDomainChecker({ lookup, now }) })
    expect(out.filter(c => c.kind === 'email')).toHaveLength(3)
    expect(out.filter(c => c.kind === 'nostr')).toHaveLength(1)
    expect(lookup).toHaveBeenCalledTimes(3)
  })

  it('reads at most 10 entries and ignores entries that are not objects', () => {
    const raw = [...Array.from({ length: 20 }, () => ({ method: 'twitter', info: '@a' })), null]
    expect(m.entriesOf(raw)).toHaveLength(10)
    expect(m.entriesOf([null, 5, 'x', { method: 'email' }])).toEqual([{ kind: 'email', value: '' }])
    expect(m.entriesOf('nope')).toEqual([])
  })
})

describe('a NUL byte in a domain (CVE-2026-105482)', () => {
  const NUL_DOMAINS = ['example.com\0.evil.test', 'example.com%00.evil.test', 'mail-host.com\0']
  it.each(NUL_DOMAINS)('resolveMailDomain(%j) is "could not be checked" (null) and asks no resolver', async (d) => {
    expect(await m.resolveMailDomain(d)).toBeNull()
    expect(dnsMock.resolveMx).not.toHaveBeenCalled()
    expect(dnsMock.resolve4).not.toHaveBeenCalled()
    expect(dnsMock.resolve6).not.toHaveBeenCalled()
  })
  it.each(NUL_DOMAINS)('the domain checker answers null for %j without a lookup and caches nothing', async (d) => {
    const lookup = vi.fn(yes)
    const c = m.createDomainChecker({ lookup })
    expect(await c.check(d)).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
    expect(c.cacheSize).toBe(0)
  })
})

describe('the DNS lookup', () => {
  it('MX records: true', async () => {
    expect(await m.resolveMailDomain('mail-host.com')).toBe(true)
  })
  it('no MX, an A record: true (implicit MX)', async () => {
    dnsMock.resolveMx.mockRejectedValue(err('ENODATA'))
    dnsMock.resolve4.mockResolvedValue(['203.0.113.5'])
    expect(await m.resolveMailDomain('mail-host.com')).toBe(true)
  })
  it('no MX, only an AAAA record: true', async () => {
    dnsMock.resolveMx.mockRejectedValue(err('ENODATA'))
    dnsMock.resolve6.mockResolvedValue(['2001:db8::1'])
    expect(await m.resolveMailDomain('mail-host.com')).toBe(true)
  })
  it('the name does not exist (ENOTFOUND everywhere): false', async () => {
    dnsMock.resolveMx.mockRejectedValue(err('ENOTFOUND'))
    dnsMock.resolve4.mockRejectedValue(err('ENOTFOUND'))
    dnsMock.resolve6.mockRejectedValue(err('ENOTFOUND'))
    expect(await m.resolveMailDomain('mail-host.com')).toBe(false)
  })
  it('a null MX (RFC 7505) says the domain takes no mail: false', async () => {
    dnsMock.resolveMx.mockResolvedValue([{ exchange: '', priority: 0 }])
    expect(await m.resolveMailDomain('mail-host.com')).toBe(false)
    dnsMock.resolveMx.mockResolvedValue([{ exchange: '.', priority: 0 }])
    expect(await m.resolveMailDomain('mail-host.com')).toBe(false)
  })
  it.each(['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EREFUSED', 'ECANCELLED'])('a %s on the MX query is unknown (null), never false', async code => {
    dnsMock.resolveMx.mockRejectedValue(err(code))
    expect(await m.resolveMailDomain('mail-host.com')).toBeNull()
  })
  it('a timeout on the A/AAAA fallback is unknown (null), never false', async () => {
    dnsMock.resolveMx.mockRejectedValue(err('ENODATA'))
    dnsMock.resolve4.mockRejectedValue(err('ETIMEOUT'))
    expect(await m.resolveMailDomain('mail-host.com')).toBeNull()
  })
  it('two full attempts (two queries in a row each) fit inside the overall deadline', () => {
    expect(4 * m.DNS_TIMEOUT_MS).toBeLessThan(m.DNS_TOTAL_MS)
  })
  it('the second attempt of a slow first one still runs and can answer inside the deadline', async () => {
    vi.useFakeTimers()
    // first attempt: MX answers nothing, A/AAAA time out at the per-query limit; second attempt answers
    dnsMock.resolveMx.mockRejectedValueOnce(err('ENODATA')).mockResolvedValueOnce([{ exchange: 'mx.mail-host.com', priority: 10 }])
    dnsMock.resolve4.mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(err('ETIMEOUT')), m.DNS_TIMEOUT_MS)))
    dnsMock.resolve6.mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(err('ETIMEOUT')), m.DNS_TIMEOUT_MS)))
    const p = m.resolveMailDomain('mail-host.com')
    await vi.advanceTimersByTimeAsync(m.DNS_TIMEOUT_MS + 10)
    expect(await p).toBe(true)
    expect(dnsMock.resolveMx).toHaveBeenCalledTimes(2)
  })
  it('a resolver that never answers is unknown (null) once the deadline passes', async () => {
    vi.useFakeTimers()
    dnsMock.resolveMx.mockReturnValue(new Promise(() => undefined))
    const p = m.resolveMailDomain('mail-host.com')
    await vi.advanceTimersByTimeAsync(m.DNS_TOTAL_MS + 10)
    expect(await p).toBeNull()
  })
  describe('one retry when the first attempt could not tell', () => {
    it('a timeout, then an answer: true', async () => {
      dnsMock.resolveMx.mockRejectedValueOnce(err('ETIMEOUT')).mockResolvedValueOnce([{ exchange: 'mx.mail-host.com', priority: 10 }])
      expect(await m.resolveMailDomain('mail-host.com')).toBe(true)
      expect(dnsMock.resolveMx).toHaveBeenCalledTimes(2)
    })
    it('a timeout twice: null, and no third try', async () => {
      dnsMock.resolveMx.mockRejectedValue(err('ETIMEOUT'))
      expect(await m.resolveMailDomain('mail-host.com')).toBeNull()
      expect(dnsMock.resolveMx).toHaveBeenCalledTimes(2)
    })
    it('NXDOMAIN is a definite answer: false, asked once', async () => {
      dnsMock.resolveMx.mockRejectedValue(err('ENOTFOUND'))
      dnsMock.resolve4.mockRejectedValue(err('ENOTFOUND'))
      dnsMock.resolve6.mockRejectedValue(err('ENOTFOUND'))
      expect(await m.resolveMailDomain('mail-host.com')).toBe(false)
      expect(dnsMock.resolveMx).toHaveBeenCalledTimes(1)
      expect(dnsMock.resolve4).toHaveBeenCalledTimes(1)
    })
    it('a definite answer on the first try does no second lookup', async () => {
      expect(await m.resolveMailDomain('mail-host.com')).toBe(true)
      expect(dnsMock.resolveMx).toHaveBeenCalledTimes(1)
    })
    it('the retry never goes past the overall deadline', async () => {
      vi.useFakeTimers()
      dnsMock.resolveMx
        .mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(err('ETIMEOUT')), m.DNS_TIMEOUT_MS)))
        .mockReturnValue(new Promise(() => undefined))
      const p = m.resolveMailDomain('mail-host.com')
      await vi.advanceTimersByTimeAsync(m.DNS_TOTAL_MS + 10)
      expect(await p).toBeNull()
      expect(dnsMock.resolveMx).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(m.DNS_TIMEOUT_MS * 10)
      expect(dnsMock.resolveMx).toHaveBeenCalledTimes(2)
    })
  })
  it('a resolver that throws synchronously is unknown (null)', async () => {
    dnsMock.resolveMx.mockImplementation(() => { throw new Error('boom mail-host.com') })
    expect(await m.resolveMailDomain('mail-host.com')).toBeNull()
  })
})

describe('the per-domain cache and the concurrency limit', () => {
  it('caches a definite answer for 7 days, then asks again', async () => {
    let t = NOW
    const lookup = vi.fn(yes)
    const c = m.createDomainChecker({ lookup, now: () => t })
    await c.check('mail-host.com'); await c.check('mail-host.com')
    expect(lookup).toHaveBeenCalledTimes(1)
    t += 7 * DAY - 1
    await c.check('mail-host.com')
    expect(lookup).toHaveBeenCalledTimes(1)
    t += 2
    await c.check('mail-host.com')
    expect(lookup).toHaveBeenCalledTimes(2)
  })
  it('caches false too, never an unknown answer', async () => {
    const lookup = vi.fn<m.MailLookup>().mockResolvedValueOnce(false).mockResolvedValueOnce(null).mockResolvedValue(true)
    const c = m.createDomainChecker({ lookup, now: () => NOW })
    expect(await c.check('a-host.com')).toBe(false)
    expect(await c.check('a-host.com')).toBe(false)
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(await c.check('b-host.com')).toBeNull()
    expect(c.cacheSize).toBe(1)
    expect(await c.check('b-host.com')).toBe(true)
  })
  it('two simultaneous questions about one domain are one lookup', async () => {
    const lookup = vi.fn(yes)
    const c = m.createDomainChecker({ lookup })
    await Promise.all([c.check('mail-host.com'), c.check('mail-host.com'), c.check('mail-host.com')])
    expect(lookup).toHaveBeenCalledTimes(1)
  })
  it('the cache is bounded (oldest entry out)', async () => {
    const c = m.createDomainChecker({ lookup: yes, maxEntries: 3 })
    for (const d of ['a1.com', 'a2.com', 'a3.com', 'a4.com']) await c.check(d)
    expect(c.cacheSize).toBe(3)
  })
  it('never more than 5 lookups run at once, and 5 do', async () => {
    let active = 0
    let peak = 0
    const gates: Array<() => void> = []
    const lookup: m.MailLookup = () => new Promise(resolve => {
      active++; peak = Math.max(peak, active)
      gates.push(() => { active--; resolve(true) })
    })
    const c = m.createDomainChecker({ lookup })
    const all = Promise.all(Array.from({ length: 14 }, (_, i) => c.check(`d${i}-host.com`)))
    for (let spins = 0; spins < 200 && gates.length < 5; spins++) await Promise.resolve()
    expect(active).toBe(5)
    let released = 0
    while (released < 14) {
      for (let spins = 0; spins < 50 && gates.length <= released; spins++) await Promise.resolve()
      gates[released++]!()
    }
    expect(await all).toEqual(Array(14).fill(true))
    expect(peak).toBe(5)
  })
  it('a lookup that throws or answers a non-boolean is unknown; a full queue is unknown without a lookup', async () => {
    const c = m.createDomainChecker({ lookup: () => { throw new Error('x') } })
    expect(await c.check('mail-host.com')).toBeNull()
    const odd = m.createDomainChecker({ lookup: (() => Promise.resolve('yes')) as unknown as m.MailLookup })
    expect(await odd.check('mail-host.com')).toBeNull()
    const lookup = vi.fn(() => new Promise<boolean | null>(() => undefined))
    const small = m.createDomainChecker({ lookup, concurrency: 1, queueMax: 1 })
    void small.check('a1.com'); void small.check('a2.com')
    expect(await small.check('a3.com')).toBeNull()
    expect(lookup).toHaveBeenCalledTimes(1)
  })
})

describe('no request to a contact value', () => {
  it('a url entry makes no HTTP request and no lookup of any kind', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this test'))
    const lookup = vi.fn(yes)
    const { safeFetch } = await import('../ssrf.js')
    const out = await m.computeContactChecks([{ method: 'website', info: 'https://canary-site-7f3a.com/contact' }], { domains: m.createDomainChecker({ lookup }) })
    expect(out[0]).toMatchObject({ kind: 'url', formatValid: true, domainResolves: null })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(safeFetch).not.toHaveBeenCalled()
    expect(lookup).not.toHaveBeenCalled()
    expect(dnsMock.resolveMx).not.toHaveBeenCalled()
    expect(dnsMock.resolve4).not.toHaveBeenCalled()
  })
  it('a NIP-05 style identifier is checked by DNS only: no HTTP request, no relay, no safeFetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this test'))
    const { safeFetch } = await import('../ssrf.js')
    const lookup = vi.fn(yes)
    const out = await m.computeContactChecks([{ method: 'nostr', info: 'zq7@canary-nip05-7f3a.com' }], { domains: m.createDomainChecker({ lookup }) })
    expect(out[0]).toMatchObject({ kind: 'nostr', formatValid: true, domainResolves: true })
    expect(lookup).toHaveBeenCalledWith('canary-nip05-7f3a.com')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(safeFetch).not.toHaveBeenCalled()
  })
  it('a NIP-05 domain goes through the real resolver path (MX, else A/AAAA) and nothing else', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    dnsMock.resolveMx.mockRejectedValue(err('ENODATA'))
    dnsMock.resolve4.mockResolvedValue(['203.0.113.5'])
    const out = await m.computeContactChecks([{ method: 'nostr', info: 'ops@nip05-host.com' }], { domains: m.createDomainChecker() })
    expect(out[0]).toMatchObject({ formatValid: true, domainResolves: true })
    expect(dnsMock.resolveMx).toHaveBeenCalledWith('nip05-host.com')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('a NIP-05 domain whose lookup fails stays unknown (null); a non-public domain is not looked up at all', async () => {
    const lookup = vi.fn<m.MailLookup>().mockResolvedValue(null)
    const domains = m.createDomainChecker({ lookup })
    const out = await m.computeContactChecks([{ method: 'nostr', info: 'ops@nip05-host.com' }, { method: 'nostr', info: 'ops@localhost' }], { domains })
    expect(out.map(c => [c.formatValid, c.domainResolves])).toEqual([[true, null], [false, null]])
    expect(lookup).toHaveBeenCalledTimes(1)
  })
  it('a nostr key is not looked up anywhere', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await m.computeContactChecks([{ method: 'nostr', info: NPUB }], { domains: m.createDomainChecker({ lookup: yes }) })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(dnsMock.resolveMx).not.toHaveBeenCalled()
  })
})

describe('when a check is due', () => {
  const entries = (kinds: string[]) => kinds.map(k => ({ kind: k as m.ContactKind, value: 'v' }))
  const stored = (kinds: string[], at: number): m.ContactCheck[] => kinds.map(kind => ({ kind: kind as m.ContactKind, formatValid: true, domainResolves: null, checkedAt: new Date(at).toISOString() }))
  it('nothing stored: due; same kinds within 24 h: not due; 24 h later: due; other kinds: due at once', () => {
    expect(m.isCheckDue(null, entries(['email']), NOW)).toBe(true)
    expect(m.isCheckDue(stored(['email', 'nostr'], NOW - DAY + 1000), entries(['nostr', 'email']), NOW)).toBe(false)
    expect(m.isCheckDue(stored(['email', 'nostr'], NOW - DAY), entries(['email', 'nostr']), NOW)).toBe(true)
    expect(m.isCheckDue(stored(['email'], NOW - 1000), entries(['email', 'nostr']), NOW)).toBe(true)
    expect(m.isCheckDue(stored(['email'], NOW - 1000), entries(['email', 'email']), NOW)).toBe(true)
  })
  it('results of other rules are due at once, once: the new result carries the current version', async () => {
    const fresh = stored(['nostr'], NOW - 1000)
    expect(m.isCheckDue(fresh, entries(['nostr']), NOW, true)).toBe(false)
    expect(m.isCheckDue(fresh, entries(['nostr']), NOW, false)).toBe(true)
    expect(m.storedRulesCurrent(null)).toBe(false)
    expect(m.storedRulesCurrent(fresh)).toBe(false)
    expect(m.storedRulesCurrent(fresh.map(c => ({ ...c, rules: m.CONTACT_RULES_VERSION - 1 })))).toBe(false)
    expect(m.storedRulesCurrent(fresh.map(c => ({ ...c, rules: m.CONTACT_RULES_VERSION })))).toBe(true)
    expect(m.isCheckDue(fresh, [], NOW, false)).toBe(true) // entries gone: cleared as before
    expect(m.isCheckDue([], [], NOW, false)).toBe(false)
  })
  it('no entries: nothing to do unless old checks must be cleared', () => {
    expect(m.isCheckDue(null, [], NOW)).toBe(false)
    expect(m.isCheckDue([], [], NOW)).toBe(false)
    expect(m.isCheckDue(stored(['email'], NOW), [], NOW)).toBe(true)
  })
  it('a malformed stored column counts as nothing stored', () => {
    expect(m.readStoredContactChecks({ a: 1 })).toBeNull()
    expect(m.readStoredContactChecks([{ kind: 'email' }])).toBeNull()
    expect(m.readStoredContactChecks([{ kind: 'sms', formatValid: true, domainResolves: null, checkedAt: new Date(NOW).toISOString() }])).toBeNull()
    expect(m.readStoredContactChecks(stored(['email'], NOW))).toHaveLength(1)
  })
})

describe('scheduling and storage', () => {
  const opts = (lookup: m.MailLookup = yes) => ({ now: () => NOW, domains: m.createDomainChecker({ lookup, now: () => NOW }) })

  it('stores exactly kind, formatValid, domainResolves and checkedAt', async () => {
    await m.scheduleContactChecks('https://mint.example', [{ method: 'email', info: 'ops@mail-host.com' }, { method: 'nostr', info: HEX }], null, opts())
    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0] as [string, [string, string]]
    expect(sql).toMatch(/UPDATE mints SET contact_checks = \$1::jsonb WHERE url = \$2/)
    expect(params[1]).toBe('https://mint.example')
    const stored = JSON.parse(params[0]) as Array<Record<string, unknown>>
    expect(stored).toHaveLength(2)
    for (const e of stored) expect(Object.keys(e).sort()).toEqual(['checkedAt', 'domainResolves', 'formatValid', 'kind', 'rules'])
    expect(stored.every(e => e['rules'] === m.CONTACT_RULES_VERSION)).toBe(true)
  })

  it('a result stored under older rules is recomputed once; the next probe finds it current and writes nothing', async () => {
    const old = [{ kind: 'nostr', formatValid: false, domainResolves: null, checkedAt: new Date(NOW - 1000).toISOString(), rules: m.CONTACT_RULES_VERSION - 1 }]
    const noRules = old.map(e => ({ kind: e.kind, formatValid: e.formatValid, domainResolves: e.domainResolves, checkedAt: e.checkedAt })) // written before the rules version existed
    const raw = [{ method: 'nostr', info: `nostr:${NPUB}` }]
    for (const before of [old, noRules]) {
      query.mockClear()
      await m.scheduleContactChecks('https://mint.example', raw, before, opts())
      expect(query).toHaveBeenCalledTimes(1)
      const written = JSON.parse((query.mock.calls[0] as [string, string[]])[1][0] as string) as Array<Record<string, unknown>>
      expect(written).toMatchObject([{ kind: 'nostr', formatValid: true, rules: m.CONTACT_RULES_VERSION }])
      query.mockClear()
      await m.scheduleContactChecks('https://mint.example', raw, written, opts())
      expect(query).not.toHaveBeenCalled()
    }
  })

  it('what the API returns (readStoredContactChecks) has the four fields, never the rules version', () => {
    const at = new Date(NOW).toISOString()
    const out = m.readStoredContactChecks([{ kind: 'nostr', formatValid: true, domainResolves: null, checkedAt: at, rules: m.CONTACT_RULES_VERSION }])
    expect(Object.keys(out![0]!).sort()).toEqual(['checkedAt', 'domainResolves', 'formatValid', 'kind'])
  })

  it('does not write inside 24 h for the same kinds, and writes [] when the entries are gone', async () => {
    const fresh = [{ kind: 'email', formatValid: true, domainResolves: true, checkedAt: new Date(NOW - 1000).toISOString(), rules: m.CONTACT_RULES_VERSION }]
    await m.scheduleContactChecks('https://mint.example', [{ method: 'email', info: 'ops@mail-host.com' }], fresh, opts())
    expect(query).not.toHaveBeenCalled()
    await m.scheduleContactChecks('https://mint.example', [], fresh, opts())
    expect(JSON.parse((query.mock.calls[0] as [string, string[]])[1][0] as string)).toEqual([])
  })

  describe('a lookup that could not tell keeps an earlier true for 48 h (domainResolves)', () => {
    const H = 3_600_000
    // The mint adds a twitter entry, so the kinds differ from the stored ones and the check is due before the 48 h are over.
    const EMAIL = [{ method: 'email', info: 'ops@mail-host.com' }, { method: 'twitter', info: '@canary' }]
    const storedAt = (value: boolean | null, ageMs: number, rules = m.CONTACT_RULES_VERSION) =>
      [{ kind: 'email', formatValid: true, domainResolves: value, checkedAt: new Date(NOW - ageMs).toISOString(), rules }]
    const written = async (stored: unknown, lookup: () => Promise<boolean | null>) => {
      await m.scheduleContactChecks('https://mint.example', EMAIL, stored, opts(lookup))
      expect(query).toHaveBeenCalledTimes(1)
      return JSON.parse((query.mock.calls[0] as [string, string[]])[1][0] as string) as Array<Record<string, unknown>>
    }
    it('null within 48 h: true stays, with the checkedAt of the real answer', async () => {
      const [e] = await written(storedAt(true, 47 * H), async () => null)
      expect(e).toMatchObject({ domainResolves: true, checkedAt: new Date(NOW - 47 * H).toISOString() })
    })
    it('null after 48 h: becomes null with the new checkedAt', async () => {
      const [e] = await written(storedAt(true, 49 * H), async () => null)
      expect(e).toMatchObject({ domainResolves: null, checkedAt: new Date(NOW).toISOString() })
    })
    it('exactly 48 h is already too old', async () => {
      const [e] = await written(storedAt(true, 48 * H), async () => null)
      expect(e).toMatchObject({ domainResolves: null })
    })
    it('one missed daily check: the regular re-check ~24 h after the last true returns null and true is kept', async () => {
      const at = 24 * H + 5 * 60_000 // the regular re-check, same kinds, a little past the 24 h interval
      await m.scheduleContactChecks('https://mint.example', [EMAIL[0]], storedAt(true, at), opts(async () => null))
      expect(query).toHaveBeenCalledTimes(1)
      const [e] = JSON.parse((query.mock.calls[0] as [string, string[]])[1][0] as string) as Array<Record<string, unknown>>
      expect(e).toMatchObject({ domainResolves: true, checkedAt: new Date(NOW - at).toISOString() })
      expect(m.DOMAIN_KEEP_TRUE_MS).toBe(48 * H)
    })
    it('a real false overwrites true', async () => {
      const [e] = await written(storedAt(true, 25 * H), async () => false)
      expect(e).toMatchObject({ domainResolves: false, checkedAt: new Date(NOW).toISOString() })
      expect(m.keepKnownTrue([{ kind: 'email', formatValid: true, domainResolves: false, checkedAt: 'x' }], storedAt(true, H) as unknown as m.ContactCheck[], NOW)[0]!.domainResolves).toBe(false)
    })
    it('a true overwrites null', async () => {
      const [e] = await written(storedAt(null, 25 * H), async () => true)
      expect(e).toMatchObject({ domainResolves: true, checkedAt: new Date(NOW).toISOString() })
    })
    it('null never turns a stored null or false into true, and other rules versions or kinds are not carried over', () => {
      const next: m.ContactCheck[] = [{ kind: 'email', formatValid: true, domainResolves: null, checkedAt: new Date(NOW).toISOString() }]
      const stored = (v: boolean | null, kind: m.ContactKind = 'email') => [{ kind, formatValid: true, domainResolves: v, checkedAt: new Date(NOW - H).toISOString() }]
      expect(m.keepKnownTrue(next, stored(null), NOW)[0]!.domainResolves).toBeNull()
      expect(m.keepKnownTrue(next, stored(false), NOW)[0]!.domainResolves).toBeNull()
      expect(m.keepKnownTrue(next, stored(true, 'nostr'), NOW)[0]!.domainResolves).toBeNull()
      expect(m.keepKnownTrue(next, null, NOW)).toBe(next)
    })
    it('an entry whose stored rules version is old is not carried over', async () => {
      const [e] = await written(storedAt(true, 25 * H, m.CONTACT_RULES_VERSION - 1), async () => null)
      expect(e).toMatchObject({ domainResolves: null })
      query.mockClear()
      const [f] = await written(storedAt(true, H, m.CONTACT_RULES_VERSION - 1), async () => null)
      expect(f).toMatchObject({ domainResolves: null })
    })
    it('a kept true keeps the old checkedAt, so the check is due again at the next probe', () => {
      const kept = m.keepKnownTrue(
        [{ kind: 'email', formatValid: true, domainResolves: null, checkedAt: new Date(NOW).toISOString() }],
        storedAt(true, 20 * H) as unknown as m.ContactCheck[], NOW)
      expect(m.isCheckDue(kept, [{ kind: 'email', value: '' }], NOW + 5 * H)).toBe(true)
    })
  })

  it('a failed store never rejects and logs no text of the error', async () => {
    query.mockRejectedValue(new Error('connection to canary-db-7f3a refused'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(m.scheduleContactChecks('https://mint.example', [{ method: 'twitter', info: '@canary' }], null, opts())).resolves.toBeUndefined()
    expect(log.mock.calls.flat().join(' ')).not.toContain('canary')
  })

  it('queueContactChecks returns at once and swallows everything, even a failing pool', () => {
    query.mockImplementation(() => { throw new Error('sync boom') })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(m.queueContactChecks('https://mint.example', [{ method: 'twitter', info: '@a' }], null)).toBeUndefined()
    expect(() => m.queueContactChecks('https://mint.example', undefined, undefined)).not.toThrow()
  })

  it('one check per mint at a time', async () => {
    let release: (v: boolean) => void = () => undefined
    const slow = new Promise<boolean>(r => { release = r })
    const o = opts(() => slow)
    const first = m.scheduleContactChecks('https://mint.example', [{ method: 'email', info: 'ops@mail-host.com' }], null, o)
    await m.scheduleContactChecks('https://mint.example', [{ method: 'email', info: 'ops@mail-host.com' }], null, o)
    expect(query).not.toHaveBeenCalled()
    release(true)
    await first
    expect(query).toHaveBeenCalledTimes(1)
  })
})

describe('canary: no contact value or domain is persisted, logged or put in an error', () => {
  const CANARY = {
    email: 'zq7canary.person@canary-mail-7f3a9c.com',
    local: 'zq7canary.person',
    domain: 'canary-mail-7f3a9c.com',
    handle: '@canaryhandle7f3a9c',
    site: 'https://canary-site-7f3a9c.com/contact',
    siteHost: 'canary-site-7f3a9c.com',
    nip05: 'zq7canarynip@canary-nip05-7f3a9c.com',
    nip05Local: 'zq7canarynip',
    nip05Domain: 'canary-nip05-7f3a9c.com',
  }
  const contact = [
    { method: 'email', info: CANARY.email },
    { method: 'nostr', info: NPUB },
    { method: 'nostr', info: `nostr:${NPROFILE}` },
    { method: 'nostr', info: CANARY.nip05 },
    { method: 'twitter', info: CANARY.handle },
    { method: 'website', info: CANARY.site },
  ]
  const needles = [CANARY.email, CANARY.local, CANARY.domain, CANARY.handle, CANARY.site, CANARY.siteHost, CANARY.nip05, CANARY.nip05Local, CANARY.nip05Domain, NPUB, NPROFILE, HEX, 'nip19-host', 'canary']

  async function run(rejectDns: boolean): Promise<{ writes: string; logs: string }> {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map(k => vi.spyOn(console, k).mockImplementation(() => undefined))
    // The real resolver path with a resolver whose errors carry the domain in their message, like a real one.
    if (rejectDns) {
      dnsMock.resolveMx.mockRejectedValue(Object.assign(new Error(`queryMx ETIMEOUT ${CANARY.domain}`), { code: 'ETIMEOUT' }))
    }
    const out = await m.computeContactChecks(contact, { now: () => NOW, domains: m.createDomainChecker({ now: () => NOW }) })
    await m.scheduleContactChecks('https://mint.example', contact, null, { now: () => NOW, domains: m.createDomainChecker({ now: () => NOW }) })
    return {
      writes: JSON.stringify(query.mock.calls) + JSON.stringify(out),
      logs: spies.map(s => JSON.stringify(s.mock.calls)).join(' '),
    }
  }

  it.each([false, true])('answered lookup (rejectDns=%s)', async rejectDns => {
    const { writes, logs } = await run(rejectDns)
    expect(query).toHaveBeenCalled()
    for (const n of needles) {
      expect(writes.toLowerCase(), `write: ${n}`).not.toContain(n.toLowerCase())
      expect(logs.toLowerCase(), `log: ${n}`).not.toContain(n.toLowerCase())
    }
  })

  it('the stored result of the canary contact is exactly the four fields plus the rules version per entry', async () => {
    await run(false)
    const stored = JSON.parse((query.mock.calls.at(-1) as [string, string[]])[1][0] as string) as Array<Record<string, unknown>>
    expect(stored.map(e => e['kind'])).toEqual(['email', 'nostr', 'nostr', 'nostr', 'twitter', 'url'])
    expect(stored.every(e => Object.keys(e).sort().join() === 'checkedAt,domainResolves,formatValid,kind,rules')).toBe(true)
  })
})
