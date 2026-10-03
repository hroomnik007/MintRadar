import { describe, it, expect } from 'vitest'
import {
  PROBE_ERROR_KINDS,
  classifyProbeFailure,
  failureFromResponse,
  isAbortLike,
  type ProbeFailure,
} from '../probeErrorKind.js'

function headers(h: Record<string, string>) {
  return { get: (name: string) => h[name.toLowerCase()] ?? null }
}

describe('classifyProbeFailure — HTTP answers', () => {
  it.each<[string, ProbeFailure, string]>([
    ['403 Cloudflare challenge', { status: 403, cfMitigated: true, server: 'cloudflare', contentType: 'text/html; charset=UTF-8' }, 'blocked_by_host'],
    ['401', { status: 401 }, 'blocked_by_host'],
    ['plain 403', { status: 403 }, 'blocked_by_host'],
    ['cf-mitigated on a 503', { status: 503, cfMitigated: true }, 'blocked_by_host'],
    ['200 Cloudflare HTML interstitial', { status: 200, server: 'cloudflare', contentType: 'text/html' }, 'blocked_by_host'],
    ['429', { status: 429 }, 'rate_limited_by_host'],
    ['500', { status: 500 }, 'host_error'],
    ['502', { status: 502 }, 'host_error'],
    ['Cloudflare 522 HTML page is an origin error, not a block', { status: 522, server: 'cloudflare', contentType: 'text/html' }, 'host_error'],
    ['404', { status: 404 }, 'not_cashu'],
    ['200 with non-Cloudflare HTML', { status: 200, server: 'nginx', contentType: 'text/html' }, 'not_cashu'],
    ['200 JSON without nuts / invalid JSON', { status: 200, contentType: 'application/json' }, 'not_cashu'],
    ['other 4xx', { status: 400 }, 'not_cashu'],
  ])('%s → %s', (_name, input, expected) => {
    expect(classifyProbeFailure(input)).toBe(expected)
  })
})

describe('classifyProbeFailure — no answer', () => {
  it.each<[string, ProbeFailure, string]>([
    ['guard: blocked address (looks like an unresolvable name)', { rejected: 'blocked' }, 'dns'],
    ['guard: DNS failure', { rejected: 'dns-error' }, 'dns'],
    ['bad redirect', { rejected: 'bad-redirect' }, 'unreachable'],
    ['timeout', { networkLabel: 'Connection timeout' }, 'timeout'],
    ['DNS at connect time', { networkLabel: 'DNS resolution failed' }, 'dns'],
    ['TLS', { networkLabel: 'TLS/SSL error' }, 'tls'],
    ['connection refused', { networkLabel: 'Connection refused' }, 'unreachable'],
    ['unknown network error', { networkLabel: 'Unreachable' }, 'unreachable'],
    ['nothing known', {}, 'unreachable'],
  ])('%s → %s', (_name, input, expected) => {
    expect(classifyProbeFailure(input)).toBe(expected)
  })

  it('a guard rejection wins over everything else', () => {
    expect(classifyProbeFailure({ rejected: 'blocked', status: 403, networkLabel: 'TLS/SSL error' })).toBe('dns')
  })
})

describe('failureFromResponse', () => {
  it('extracts only status and the three header facts', () => {
    const f = failureFromResponse({
      status: 403,
      headers: headers({ 'cf-mitigated': 'challenge', server: 'cloudflare', 'content-type': 'text/html', 'set-cookie': 'secret=1', 'cf-ray': 'abc' }),
    })
    expect(Object.keys(f).sort()).toEqual(['cfMitigated', 'contentType', 'server', 'status'])
    expect(f.cfMitigated).toBe(true)
  })

  it('tolerates a response without headers (mocks) and a throwing getter', () => {
    expect(failureFromResponse({ status: 502 })).toEqual({ status: 502, cfMitigated: false, server: null, contentType: null })
    const bad = { status: 500, headers: { get: () => { throw new Error('boom') } } }
    expect(classifyProbeFailure(failureFromResponse(bad))).toBe('host_error')
  })
})

describe('no leakage', () => {
  it('only ever returns a value from the fixed enum, never input text', () => {
    const hostile: ProbeFailure[] = [
      { networkLabel: 'ECONNRESET 10.0.0.5:443 secret-token' },
      { status: 403, server: '<script>alert(1)</script>', contentType: 'text/html' },
      { status: 200, server: 'cloudflare 1.2.3.4', contentType: 'text/html; body=leak' },
      { networkLabel: 'getaddrinfo ENOTFOUND internal.host' },
    ]
    for (const input of hostile) {
      const kind = classifyProbeFailure(input)
      expect(PROBE_ERROR_KINDS).toContain(kind)
      expect(kind).not.toMatch(/\d+\.\d+|script|secret|internal|leak/)
    }
  })
})

describe('isAbortLike', () => {
  it('recognises deadline aborts, also as a wrapped cause, and nothing else', () => {
    const timeout = new Error('t'); timeout.name = 'TimeoutError'
    const abort = new Error('a'); abort.name = 'AbortError'
    expect(isAbortLike(timeout)).toBe(true)
    expect(isAbortLike(abort)).toBe(true)
    expect(isAbortLike(new TypeError('terminated', { cause: abort }))).toBe(true)
    expect(isAbortLike(new SyntaxError('Unexpected token'))).toBe(false)
    expect(isAbortLike('TimeoutError')).toBe(false)
    expect(isAbortLike(null)).toBe(false)
  })
})
