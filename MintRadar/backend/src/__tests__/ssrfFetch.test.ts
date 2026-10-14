import { describe, it, expect, vi, beforeEach } from 'vitest'

// safeFetch (redirect handling, deadline, credentials, headers) and the body readers of ssrf.ts, with undici replaced
// by a stub: no socket is ever opened here, and every refused request must leave the fetch counter at its old value.
const undiciFetch = vi.fn()
vi.mock('undici', () => ({
  Agent: class { constructor(public opts: unknown) {} },
  fetch: (...a: unknown[]) => undiciFetch(...a),
}))
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('dns', () => ({ lookup: vi.fn() }))

import { lookup } from 'dns/promises'
import {
  safeFetch, SAFE_FETCH_USER_AGENT, readBodyLimited, readJsonLimited, ResponseTooLargeError, RESPONSE_CAPS,
} from '../ssrf.js'

const vLookup = vi.mocked(lookup)
const PUBLIC = [{ address: '93.184.216.34', family: 4 }]

/** DNS by host name: anything in `table` resolves there, everything else to a public address. */
function dns(table: Record<string, string> = {}): void {
  vLookup.mockImplementation((async (h: string) => [{ address: table[h] ?? PUBLIC[0]!.address, family: (table[h] ?? '').includes(':') ? 6 : 4 }]) as never)
}
const redirect = (location: string | null, status = 302): Response =>
  new Response(null, { status, headers: location === null ? {} : { location } })
const ok = (body = '{"ok":true}', init: ResponseInit = {}): Response => new Response(body, { status: 200, ...init })

beforeEach(() => { undiciFetch.mockReset(); vLookup.mockReset(); dns() })

describe('safeFetch: validation before the request', () => {
  it.each([
    'https://127.0.0.1/', 'https://10.0.0.1/', 'https://169.254.169.254/latest/meta-data/', 'https://[::1]/', 'https://2130706433/',
    'http://mint.example.com/', 'ftp://mint.example.com/', 'file:///etc/passwd', 'not a url', '',
  ])('%j: refused, onRejected("blocked"), no request', async (url) => {
    const why: string[] = []
    expect(await safeFetch(url, { onRejected: r => why.push(r) })).toBeNull()
    expect(why).toEqual(['blocked'])
    expect(undiciFetch).not.toHaveBeenCalled()
  })

  it('a host that does not resolve → onRejected("dns-error"), no request', async () => {
    vLookup.mockRejectedValue(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }))
    const why: string[] = []
    expect(await safeFetch('https://gone.example.com/', { onRejected: r => why.push(r) })).toBeNull()
    expect(why).toEqual(['dns-error'])
    expect(undiciFetch).not.toHaveBeenCalled()
  })

  it('a hostname that resolves to a private address → blocked, no request', async () => {
    dns({ 'internal.example.com': '10.0.0.8' })
    expect(await safeFetch('https://internal.example.com/')).toBeNull()
    expect(undiciFetch).not.toHaveBeenCalled()
  })
})

describe('safeFetch: the request itself', () => {
  it('sends no credentials, follows redirects manually through the pinned agent, and identifies itself honestly', async () => {
    undiciFetch.mockResolvedValue(ok())
    const res = await safeFetch('https://mint.example.com/v1/info')
    expect(res?.status).toBe(200)
    const [url, init] = undiciFetch.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toBe('https://mint.example.com/v1/info')
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'manual' })
    expect(init['dispatcher']).toBeDefined()
    expect(init['headers']).toEqual({ 'User-Agent': SAFE_FETCH_USER_AGENT })
    expect(SAFE_FETCH_USER_AGENT).toBe('MintRadar/1.0 (+https://mintradar.org)')
  })

  it('keeps a caller-set User-Agent (any case) and adds the extra headers', async () => {
    undiciFetch.mockResolvedValue(ok())
    await safeFetch('https://mint.example.com/', { headers: { Accept: 'application/json' } })
    await safeFetch('https://mint.example.com/', { headers: { 'user-agent': 'custom/1' } })
    expect(undiciFetch.mock.calls[0]![1]['headers']).toEqual({ Accept: 'application/json', 'User-Agent': SAFE_FETCH_USER_AGENT })
    expect(undiciFetch.mock.calls[1]![1]['headers']).toEqual({ 'user-agent': 'custom/1' })
  })

  it('a URL with credentials: undici refuses it, the helper returns null (no request goes out with them)', async () => {
    undiciFetch.mockImplementation(async (url: string) => { if (new URL(url).username) throw new TypeError('Request cannot be constructed from a URL that includes credentials'); return ok() })
    const errors: unknown[] = []
    expect(await safeFetch('https://user:secret@mint.example.com/', { onError: e => errors.push(e) })).toBeNull()
    expect(errors).toHaveLength(1)
  })

  it('a network error is reported through onError and returns null (never throws)', async () => {
    undiciFetch.mockRejectedValue(new Error('ECONNRESET'))
    const errors: unknown[] = []
    expect(await safeFetch('https://mint.example.com/', { onError: e => errors.push(e) })).toBeNull()
    expect((errors[0] as Error).message).toBe('ECONNRESET')
    expect(await safeFetch('https://mint.example.com/')).toBeNull() // no onError given: still no throw
  })

  it('passes a non-redirect answer (also 4xx/5xx) to the caller untouched', async () => {
    undiciFetch.mockResolvedValue(new Response('nope', { status: 404 }))
    expect((await safeFetch('https://mint.example.com/'))?.status).toBe(404)
    undiciFetch.mockResolvedValue({ status: 304, headers: new Headers() }) // 304 is in the 3xx band but has no Location (Response() cannot build it)
    const why: string[] = []
    expect(await safeFetch('https://mint.example.com/', { onRejected: r => why.push(r) })).toBeNull()
    expect(why).toEqual(['bad-redirect'])
  })
})

describe('safeFetch: redirects are re-validated hop by hop', () => {
  it.each([
    ['an IPv4 literal', 'https://127.0.0.1/admin'], ['the metadata address', 'https://169.254.169.254/latest/meta-data/'],
    ['a decimal-integer loopback', 'https://2130706433/'], ['an IPv6 loopback', 'https://[::1]/'], ['a v4-mapped loopback', 'https://[::ffff:7f00:1]/'],
    ['a private literal with credentials', 'https://user:pw@10.0.0.1/'], ['a different scheme (http)', 'http://mint.example.com/'],
    ['a different scheme (file)', 'file:///etc/passwd'], ['a protocol-relative private host', '//10.0.0.1/x'],
  ])('public → %s: the second request is never sent', async (_n, location) => {
    undiciFetch.mockResolvedValueOnce(redirect(location))
    const why: string[] = []
    expect(await safeFetch('https://mint.example.com/start', { onRejected: r => why.push(r) })).toBeNull()
    expect(undiciFetch).toHaveBeenCalledTimes(1)
    expect(why).toEqual(['blocked'])
  })

  it('public → a hostname that resolves to a private address: blocked, still one request', async () => {
    dns({ 'sneaky.example.net': '192.168.1.1' })
    undiciFetch.mockResolvedValueOnce(redirect('https://sneaky.example.net/'))
    expect(await safeFetch('https://mint.example.com/')).toBeNull()
    expect(undiciFetch).toHaveBeenCalledTimes(1)
  })

  it('public → a hostname that does not resolve: dns-error, still one request', async () => {
    vLookup.mockImplementation((async (h: string) => { if (h === 'gone.example.net') throw new Error('nx'); return PUBLIC }) as never)
    undiciFetch.mockResolvedValueOnce(redirect('https://gone.example.net/'))
    const why: string[] = []
    expect(await safeFetch('https://mint.example.com/', { onRejected: r => why.push(r) })).toBeNull()
    expect(why).toEqual(['dns-error'])
    expect(undiciFetch).toHaveBeenCalledTimes(1)
  })

  it('follows public hops: relative, absolute, protocol-relative; the final answer is returned', async () => {
    undiciFetch
      .mockResolvedValueOnce(redirect('/v2/info', 301))
      .mockResolvedValueOnce(redirect('https://other.example.org/x', 307))
      .mockResolvedValueOnce(redirect('//third.example.net/y', 308))
      .mockResolvedValueOnce(ok('done'))
    const res = await safeFetch('https://mint.example.com/v1/info')
    expect(await res?.text()).toBe('done')
    expect(undiciFetch.mock.calls.map(c => c[0])).toEqual([
      'https://mint.example.com/v1/info', 'https://mint.example.com/v2/info', 'https://other.example.org/x', 'https://third.example.net/y',
    ])
  })

  it('every hop runs the same checks: three public hops allowed, the fourth redirect is "bad-redirect"', async () => {
    undiciFetch.mockImplementation(async () => redirect('/again'))
    const why: string[] = []
    expect(await safeFetch('https://mint.example.com/', { onRejected: r => why.push(r) })).toBeNull()
    expect(undiciFetch).toHaveBeenCalledTimes(4) // the first request + MAX_REDIRECTS (3) hops
    expect(why).toEqual(['bad-redirect'])
  })

  it('a redirect loop between two public URLs ends the same way', async () => {
    undiciFetch.mockImplementation(async (url: string) => redirect(url.endsWith('/a') ? '/b' : '/a'))
    const why: string[] = []
    expect(await safeFetch('https://mint.example.com/a', { onRejected: r => why.push(r) })).toBeNull()
    expect(undiciFetch).toHaveBeenCalledTimes(4)
    expect(why).toEqual(['bad-redirect'])
  })

  it('a redirect without Location, or with an unparseable one, is "bad-redirect"', async () => {
    for (const loc of [null, 'http://[::1', 'https://']) {
      undiciFetch.mockResolvedValueOnce(redirect(loc))
      const why: string[] = []
      expect(await safeFetch('https://mint.example.com/', { onRejected: r => why.push(r) })).toBeNull()
      expect(why[0] === 'bad-redirect' || why[0] === 'blocked').toBe(true)
    }
  })

  it('the lookup runs again for every hop, none is skipped', async () => {
    undiciFetch.mockResolvedValueOnce(redirect('https://b.example.org/')).mockResolvedValueOnce(ok())
    await safeFetch('https://a.example.com/')
    expect(vLookup.mock.calls.map(c => c[0])).toEqual(['a.example.com', 'b.example.org'])
  })
})

describe('safeFetch: one deadline for the whole call', () => {
  it('passes the same AbortSignal to every hop, and it aborts after timeoutMs', async () => {
    const signals: AbortSignal[] = []
    undiciFetch.mockImplementation(async (url: string, init: { signal: AbortSignal }) => {
      signals.push(init.signal)
      if (url.endsWith('/hang')) return new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)))
      return redirect('/hang')
    })
    const errors: unknown[] = []
    const t0 = Date.now()
    expect(await safeFetch('https://mint.example.com/start', { timeoutMs: 150, onError: e => errors.push(e) })).toBeNull()
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBe(signals[1])
    expect(signals[0]!.aborted).toBe(true)
    expect(String((errors[0] as Error).name)).toMatch(/Timeout|Abort/)
  })
})

describe('response size and shape limits', () => {
  const stream = (chunks: Uint8Array[], headers: Record<string, string> = {}): Response =>
    new Response(new ReadableStream({ start(c) { chunks.forEach(x => c.enqueue(x)); c.close() } }), { status: 200, headers })

  it('a body at the cap is returned whole', async () => {
    const buf = await readBodyLimited(stream([new Uint8Array(10), new Uint8Array(6)]), 16)
    expect(buf.byteLength).toBe(16)
  })

  it('a Content-Length above the cap is refused without reading the body', async () => {
    let pulled = false
    const res = new Response(new ReadableStream({ pull(c) { pulled = true; c.enqueue(new Uint8Array(1)); c.close() } }), { headers: { 'content-length': '1000' } })
    await expect(readBodyLimited(res, 100)).rejects.toBeInstanceOf(ResponseTooLargeError)
    expect(pulled).toBe(false)
  })

  it('a lying Content-Length (small header, big body) is cut while streaming', async () => {
    const res = stream([new Uint8Array(60), new Uint8Array(60), new Uint8Array(60)], { 'content-length': '10' })
    await expect(readBodyLimited(res, 100)).rejects.toMatchObject({ name: 'ResponseTooLargeError', maxBytes: 100 })
  })

  it('a body larger than the cap without any Content-Length is cut', async () => {
    await expect(readBodyLimited(stream([new Uint8Array(101)]), 100)).rejects.toBeInstanceOf(ResponseTooLargeError)
  })

  it('an endless stream is cancelled once the cap is passed (never buffered further)', async () => {
    let pulls = 0
    let cancelled = false
    const res = new Response(new ReadableStream({ pull(c) { pulls++; c.enqueue(new Uint8Array(1024)) }, cancel() { cancelled = true } }))
    await expect(readBodyLimited(res, 4096)).rejects.toBeInstanceOf(ResponseTooLargeError)
    await new Promise(r => setTimeout(r, 20))
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThan(20)
  })

  it('no body → empty buffer; a non-numeric Content-Length does not reject by itself', async () => {
    expect((await readBodyLimited(new Response(null, { status: 204 }), 10)).byteLength).toBe(0)
    expect((await readBodyLimited(stream([new Uint8Array(3)], { 'content-length': 'abc' }), 10)).byteLength).toBe(3)
  })

  it('readJsonLimited parses UTF-8 with a BOM, and rejects invalid JSON and oversize bodies', async () => {
    const enc = new TextEncoder()
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('{"a":"é"}')])
    expect(await readJsonLimited(stream([withBom]), 100)).toEqual({ a: 'é' })
    await expect(readJsonLimited(stream([enc.encode('{nope')]), 100)).rejects.toThrow()
    await expect(readJsonLimited(stream([enc.encode('{"a":"' + 'x'.repeat(200) + '"}')]), 100)).rejects.toBeInstanceOf(ResponseTooLargeError)
  })

  it('every cap is positive and the icon cap is 512 KB', () => {
    for (const [name, cap] of Object.entries(RESPONSE_CAPS)) expect(cap, name).toBeGreaterThan(0)
    expect(RESPONSE_CAPS.icon).toBe(512 * 1024)
  })
})
