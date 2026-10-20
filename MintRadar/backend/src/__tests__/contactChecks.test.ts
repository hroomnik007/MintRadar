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
  it.each(['a@example-mail.com', 'first.last+tag@sub.mail-host.org', "o'neil@mail-host.io", 'x@mail-host.technology'])('valid: %s', v => {
    expect(m.parseEmail(v).valid).toBe(true)
  })
  it.each(['', 'plain', '@mail-host.com', 'a@', 'a b@mail-host.com', 'a@@mail-host.com', 'a@b@mail-host.com', '.a@mail-host.com', 'a.@mail-host.com',
    'a..b@mail-host.com', 'a@-mail.com', 'a@mail..com', 'a@mail-.com', `${'x'.repeat(65)}@mail-host.com`, 'a@1.2.3.4', 'a@[not-an-ip]'])('invalid: %j', v => {
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
    expect(m.isValidNostrKey(NPUB)).toBe(true)
    expect(m.isValidNostrKey(HEX)).toBe(true)
    expect(m.isValidNostrKey(HEX.toUpperCase())).toBe(true)
    const broken = NPUB.slice(0, -1) + (NPUB.endsWith('q') ? 'p' : 'q')
    expect(m.isValidNostrKey(broken)).toBe(false)
    expect(m.isValidNostrKey(HEX.slice(1))).toBe(false)
    expect(m.isValidNostrKey('nsec1' + 'q'.repeat(58))).toBe(false)
    expect(m.isValidNostrKey(nip19.nsecEncode(new Uint8Array(32).fill(7)))).toBe(false)
    expect(m.isValidNostrKey('')).toBe(false)
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
      { kind: 'twitter', formatValid: true, domainResolves: null, checkedAt: at },
      { kind: 'telegram', formatValid: false, domainResolves: null, checkedAt: at },
      { kind: 'url', formatValid: true, domainResolves: null, checkedAt: at },
      { kind: 'url', formatValid: false, domainResolves: null, checkedAt: at },
      { kind: 'other', formatValid: true, domainResolves: null, checkedAt: at },
    ])
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith('mail-host.com')
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
  it('a resolver that never answers is unknown (null) once the deadline passes', async () => {
    vi.useFakeTimers()
    dnsMock.resolveMx.mockReturnValue(new Promise(() => undefined))
    const p = m.resolveMailDomain('mail-host.com')
    await vi.advanceTimersByTimeAsync(m.DNS_TIMEOUT_MS * 3 + 10)
    expect(await p).toBeNull()
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
    for (const e of stored) expect(Object.keys(e).sort()).toEqual(['checkedAt', 'domainResolves', 'formatValid', 'kind'])
  })

  it('does not write inside 24 h for the same kinds, and writes [] when the entries are gone', async () => {
    const fresh = [{ kind: 'email', formatValid: true, domainResolves: true, checkedAt: new Date(NOW - 1000).toISOString() }]
    await m.scheduleContactChecks('https://mint.example', [{ method: 'email', info: 'ops@mail-host.com' }], fresh, opts())
    expect(query).not.toHaveBeenCalled()
    await m.scheduleContactChecks('https://mint.example', [], fresh, opts())
    expect(JSON.parse((query.mock.calls[0] as [string, string[]])[1][0] as string)).toEqual([])
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
  }
  const contact = [
    { method: 'email', info: CANARY.email },
    { method: 'nostr', info: NPUB },
    { method: 'twitter', info: CANARY.handle },
    { method: 'website', info: CANARY.site },
  ]
  const needles = [CANARY.email, CANARY.local, CANARY.domain, CANARY.handle, CANARY.site, CANARY.siteHost, NPUB, HEX, 'canary']

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

  it('the stored result of the canary contact is exactly the four fields per entry', async () => {
    await run(false)
    const stored = JSON.parse((query.mock.calls.at(-1) as [string, string[]])[1][0] as string) as Array<Record<string, unknown>>
    expect(stored.map(e => e['kind'])).toEqual(['email', 'nostr', 'twitter', 'url'])
    expect(stored.every(e => Object.keys(e).sort().join() === 'checkedAt,domainResolves,formatValid,kind')).toBe(true)
  })
})
