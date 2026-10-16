import { parse, IPv4, IPv6 } from 'ipaddr.js'
import { lookup } from 'dns/promises'
import { lookup as dnsLookupCb } from 'dns'
import type { LookupAddress } from 'dns'
import type { LookupFunction } from 'net'
import { Agent, fetch as undiciFetch } from 'undici'

const BLOCKED_RANGES = [
  'loopback', 'private', 'linkLocal', 'uniqueLocal',
  'unspecified', 'reserved', 'carrierGradeNat', 'broadcast',
  // Never a public unicast destination: multicast (224/4, ff00::/8), the IPv6 discard prefix 100::/64,
  // benchmarking 2001:2::/48 and the deprecated site-local fec0::/10.
  'multicast', 'discard', 'benchmarking', 'deprecatedSiteLocal'
] as const

// Extracts an embedded IPv4 address from an IPv6 address that uses one of
// the well-known IPv4-in-IPv6 embedding schemes, so it can be re-checked
// against BLOCKED_RANGES. Returns null if the range isn't one we know how
// to unwrap.
function extractEmbeddedIPv4(addr: IPv6): IPv4 | null {
  const range = addr.range()
  const bytes = addr.toByteArray()

  if (range === 'ipv4Mapped') {
    return addr.toIPv4Address()
  }

  // NAT64 well-known prefix 64:ff9b::/96 (RFC 6052) — embedded IPv4 is the
  // last 4 bytes, unmodified.
  if (range === 'rfc6052') {
    return new IPv4(bytes.slice(12, 16))
  }

  // 6to4 2002::/16 (RFC 3056) — embedded IPv4 is bytes 2-5.
  if (range === '6to4') {
    return new IPv4(bytes.slice(2, 6))
  }

  // IPv4-translated ::ffff:0:0:0/96 (RFC 2765/6145) — the IPv4 address is the last 4 bytes.
  if (range === 'rfc6145') {
    return new IPv4(bytes.slice(12, 16))
  }

  // Teredo 2001::/32 (RFC 4380) — the client IPv4 occupies the last 4
  // bytes, XOR-obfuscated with 0xFFFFFFFF.
  if (range === 'teredo') {
    return new IPv4(bytes.slice(12, 16).map(b => b ^ 0xff))
  }

  return null
}

// Prefixes that must never be a destination, whatever they embed:
//  - ::/96 (deprecated IPv4-compatible addresses, e.g. ::127.0.0.1 which the URL parser prints as ::7f00:1; ipaddr.js
//    labels most of them "unicast");
//  - 64:ff9b:1::/48 (RFC 8215 local-use NAT64): the IPv4 sits at bytes 6-10 there, not in the last 4 bytes the
//    well-known-prefix unwrap reads, so an embedded private address could be hidden behind a public-looking suffix.
function isNeverPublicIPv6(bytes: number[]): boolean {
  if (bytes.slice(0, 12).every(b => b === 0)) return true
  return bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes[4] === 0x00 && bytes[5] === 0x01
}

function isBlockedAddress(addr: IPv4 | IPv6): boolean {
  const range = addr.range()
  if ((BLOCKED_RANGES as readonly string[]).includes(range)) return true
  if (addr.kind() === 'ipv6' && range !== 'ipv4Mapped' && isNeverPublicIPv6((addr as IPv6).toByteArray())) return true

  // Handle IPv4 addresses embedded in IPv6 (::ffff:x.x.x.x, NAT64, 6to4,
  // Teredo) — unwrap and re-check the embedded address against the same
  // blocklist, since routing/translation may deliver traffic to it.
  if (addr.kind() === 'ipv6') {
    const v4 = extractEmbeddedIPv4(addr as IPv6)
    if (v4 && (BLOCKED_RANGES as readonly string[]).includes(v4.range())) return true
  }

  return false
}

export function isBlockedIpString(ip: string): boolean {
  try {
    return isBlockedAddress(parse(ip))
  } catch {
    // Not parseable as an IP — fail closed
    return true
  }
}

// 'safe'      — proceed with fetch
// 'blocked'   — SSRF-blocked (private IP, bad protocol, etc.) — do not probe, do not write history
// 'dns-error' — DNS lookup failed, mint is unreachable — write offline history entry
export type UrlSafetyResult = 'safe' | 'blocked' | 'dns-error'

// A resolver that never answers must not hold a request open. The DNS step of one request gets at most this
// long (all lookups of the request together), and never more than what is left of the request deadline.
// A timeout is reported as 'dns-error' (fail closed, same as a failed lookup).
export const DNS_LOOKUP_CEILING_MS = 3_000

/**
 * Time left for DNS in one request: `deadlineAt` is the request deadline (ms timestamp), `dnsUsedMs` the time
 * earlier lookups of the same request already used. Standalone checks get a fresh budget (ceiling only).
 */
export interface DnsBudget { deadlineAt: number; dnsUsedMs: number }

class DnsTimeoutError extends Error {
  readonly code = 'ETIMEOUT'
  constructor() { super('DNS lookup timed out') }
}

async function boundedLookup(hostname: string, budget: DnsBudget): Promise<LookupAddress[]> {
  const limitMs = Math.min(budget.deadlineAt - Date.now(), DNS_LOOKUP_CEILING_MS - budget.dnsUsedMs)
  if (limitMs <= 0) throw new DnsTimeoutError()
  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  // async wrapper: a stub or resolver that throws synchronously becomes a rejection like any other.
  const pending = (async () => lookup(hostname, { all: true }))()
  // The lookup may settle after the timeout won; its late rejection must never surface as unhandledRejection.
  pending.catch(() => undefined)
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DnsTimeoutError()), limitMs) })
  try {
    return await Promise.race([pending, timeout])
  } finally {
    clearTimeout(timer)
    budget.dnsUsedMs += Date.now() - startedAt
  }
}

// Shared by checkUrlSafety (https:) and checkWsUrlSafety (ws:/wss:) — only the
// allowed protocol set differs; hostname/DNS/private-range checks are identical.
async function checkUrlSafetyForProtocols(
  rawUrl: string,
  allowedProtocols: readonly string[],
  budget: DnsBudget = { deadlineAt: Infinity, dnsUsedMs: 0 }
): Promise<UrlSafetyResult> {
  try {
    const url = new URL(rawUrl)
    if (!allowedProtocols.includes(url.protocol)) return 'blocked'
    if (rawUrl.length > 500) return 'blocked'

    const hostname = url.hostname

    // Block if hostname is already a private/blocked IP address. URL.hostname keeps the brackets of an
    // IPv6 literal ("[::1]"), which ipaddr.js cannot parse — strip them so IPv6 literals go through the
    // same isBlockedAddress() as IPv4 ones instead of only failing later at the DNS lookup of "[::1]".
    try {
      const addr = parse(hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname)
      if (isBlockedAddress(addr)) return 'blocked'
    } catch {
      // Not a raw IP — continue to DNS lookup
    }

    // Resolve DNS — failure here is a network error, not an SSRF attempt
    let addresses: LookupAddress[]
    try {
      addresses = await boundedLookup(hostname, budget)
    } catch (err) {
      // Same outcome as any failed lookup — every caller treats 'dns-error' generically; the log line tells them apart.
      if (err instanceof DnsTimeoutError) console.warn('[ssrf] dns-timeout')
      return 'dns-error'
    }

    if (addresses.length === 0) return 'dns-error'

    for (const addr of addresses) {
      try {
        const parsed = parse(addr.address)
        if (isBlockedAddress(parsed)) return 'blocked'
      } catch {
        return 'blocked'
      }
    }

    return 'safe'
  } catch {
    return 'blocked'
  }
}

export async function checkUrlSafety(rawUrl: string, budget?: DnsBudget): Promise<UrlSafetyResult> {
  return checkUrlSafetyForProtocols(rawUrl, ['https:'], budget)
}

export async function isSafeUrl(rawUrl: string): Promise<boolean> {
  const result = await checkUrlSafety(rawUrl)
  return result === 'safe'
}

// Host-name label: letters, digits, '-' and '_' (some real hosts use '_'), 1-63 chars,
// no leading/trailing '-'. A trailing dot (absolute FQDN) is stripped before the split.
const HOSTNAME_LABEL_RE = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/

/**
 * Purely syntactic URL validation for endpoints that only READ our own database
 * (history, swaps, audit-cz, ...): no DNS and no network. checkUrlSafety() resolves
 * the host and answers 'dns-error' for a mint whose DNS record is gone, which made
 * stored data of dead mints unloadable (400 "Invalid url") although those endpoints
 * never connect to the host. Endpoints that DO make an outbound request to a
 * user-supplied host must keep using isSafeUrl()/checkUrlSafety()/safeFetch().
 *
 * Accepts: https only, <= 500 chars, no whitespace, no credentials, and either
 * a host name that looks like one (>= 2 labels) or a non-blocked IP literal (the
 * URL parser already folds decimal/hex/octal IPv4 forms into dotted quads).
 * Rejects every IP literal in a range isBlockedAddress() blocks, so the
 * IP-literal part of the check is the same as in checkUrlSafety().
 */
export function isWellFormedMintUrl(rawUrl: string): boolean {
  try {
    if (typeof rawUrl !== 'string' || rawUrl.length > 500 || /\s/.test(rawUrl)) return false
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:') return false
    if (url.username !== '' || url.password !== '') return false

    const hostname = url.hostname
    if (hostname === '') return false

    try {
      const addr = parse(hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname)
      return !isBlockedAddress(addr)
    } catch {
      // Not an IP literal — validate as a host name below
    }

    const name = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
    if (name.length === 0 || name.length > 253) return false
    const labels = name.split('.')
    return labels.length >= 2 && labels.every(label => HOSTNAME_LABEL_RE.test(label))
  } catch {
    return false
  }
}

// Same guard as checkUrlSafety, but for Nostr relay URLs (ws:/wss:) instead of
// mint URLs (https:) — used to validate user-supplied relay lists before they
// are stored, so they can't be used to make the server probe/connect to
// internal infrastructure later.
// Subscriber relays may only listen where relays really do: wss on 443, ws on 80 (no port = the default).
// Anything else (25, 6379, 8080, ws on 443, wss on 80, ...) would let a subscriber point the backend at an
// arbitrary port of a public host. new URL() drops an explicit default port, so '' means the default.
export const RELAY_WSS_PORT = '443'
export const RELAY_WS_PORT = '80'

export function isAllowedRelayPort(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'wss:') return url.port === '' || url.port === RELAY_WSS_PORT
    if (url.protocol === 'ws:') return url.port === '' || url.port === RELAY_WS_PORT
    return false
  } catch {
    return false
  }
}

export async function checkWsUrlSafety(rawUrl: string): Promise<UrlSafetyResult> {
  if (!isAllowedRelayPort(rawUrl)) return 'blocked'
  return checkUrlSafetyForProtocols(rawUrl, ['ws:', 'wss:'])
}

export async function isSafeWsUrl(rawUrl: string): Promise<boolean> {
  const result = await checkWsUrlSafety(rawUrl)
  return result === 'safe'
}

// ── SSRF-safe fetch ────────────────────────────────────────────
//
// Defends against three classes of SSRF:
//  1. Direct internal targets — isSafeUrl() validates before connecting.
//  2. Redirect-based SSRF — redirects are followed manually and each hop
//     is re-validated with isSafeUrl().
//  3. DNS rebinding (TOCTOU) — a custom lookup re-checks the resolved IP
//     at connect time, inside the same resolution the socket uses, so a
//     low-TTL domain cannot rebind to an internal IP between check and fetch.

// Custom DNS lookup that rejects any resolved address in a blocked range.
// undici uses this for the actual TCP connect, closing the TOCTOU window
// while preserving the original hostname for SNI and the Host header.
// Bounded by DNS_LOOKUP_CEILING_MS too (the WebSocket path has no other deadline); an answer after the timeout is dropped.
export const safeLookup: LookupFunction = (hostname, options, callback): void => {
  let settled = false
  const finish = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    callback(err, address as never, family as never)
  }
  const timer = setTimeout(() => {
    console.warn('[ssrf] dns-timeout')
    finish(new DnsTimeoutError(), '', 0)
  }, DNS_LOOKUP_CEILING_MS)
  try {
    dnsLookupCb(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) { finish(err, '', 0); return }
      const list = addresses as unknown as LookupAddress[]
      if (!Array.isArray(list) || list.length === 0) {
        finish(new Error('No addresses resolved'), '', 0)
        return
      }
      for (const a of list) {
        if (isBlockedIpString(a.address)) {
          finish(new Error('Blocked address (SSRF protection)'), '', 0)
          return
        }
      }
      finish(null, list, list[0]!.family)
    })
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

const safeAgent = new Agent({
  connect: { lookup: safeLookup },
})

const MAX_REDIRECTS = 3

// Honest, identifying User-Agent for every outbound request made through
// safeFetch (mint probes, discovery, GitHub, icons, NIP-05). Operators can see
// who is calling and allow-list it; it is NOT a browser impersonation. A caller
// that sets its own User-Agent keeps it.
export const SAFE_FETCH_USER_AGENT = 'MintRadar/1.0 (+https://mintradar.org)'

function withDefaultUserAgent(headers: Record<string, string> | undefined): Record<string, string> {
  if (headers !== undefined && Object.keys(headers).some(k => k.toLowerCase() === 'user-agent')) return headers
  return { ...headers, 'User-Agent': SAFE_FETCH_USER_AGENT }
}

export interface SafeFetchOptions {
  timeoutMs?: number
  onError?: (err: unknown) => void
  /**
   * Called (before returning null) when the request was refused without being
   * sent or followed: 'blocked' (SSRF guard), 'dns-error' (host did not
   * resolve) or 'bad-redirect' (missing/invalid Location, too many hops).
   * Separate from onError so existing onError consumers see no new events.
   */
  onRejected?: (reason: 'blocked' | 'dns-error' | 'bad-redirect') => void
  /** Extra request headers (e.g. an Accept header for a JSON API). A User-Agent given here wins over the default. */
  headers?: Record<string, string>
}

/**
 * Performs an SSRF-safe HTTPS fetch. Validates the URL (and every redirect
 * hop) with isSafeUrl(), pins DNS resolution to a blocked-range check at
 * connect time, follows redirects manually, and never sends credentials.
 * Returns null if the URL is unsafe or the request fails.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<Response | null> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const requestHeaders = withDefaultUserAgent(options.headers)
  // One deadline for the whole call, not per hop — a signal fresh per redirect
  // hop let a mint that redirects a couple of times before hanging block for
  // up to (MAX_REDIRECTS + 1) * timeoutMs instead of timeoutMs total.
  const deadline = AbortSignal.timeout(timeoutMs)
  // The DNS pre-checks of all hops count against that same deadline (and share one DNS ceiling), not on top of it.
  const dnsBudget: DnsBudget = { deadlineAt: Date.now() + timeoutMs, dnsUsedMs: 0 }
  let currentUrl = rawUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safety = await checkUrlSafety(currentUrl, dnsBudget)
    if (safety !== 'safe') {
      options.onRejected?.(safety)
      return null
    }

    let res: Response
    try {
      res = await undiciFetch(currentUrl, {
        signal: deadline,
        credentials: 'omit',
        redirect: 'manual',
        dispatcher: safeAgent,
        headers: requestHeaders,
      }) as unknown as Response
    } catch (err) {
      options.onError?.(err)
      return null
    }

    // Manually follow redirects, re-validating each Location.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) {
        options.onRejected?.('bad-redirect')
        return null
      }
      try {
        // Resolve relative redirects against the current URL.
        currentUrl = new URL(location, currentUrl).toString()
      } catch {
        options.onRejected?.('bad-redirect')
        return null
      }
      continue
    }

    return res
  }

  // Too many redirects.
  options.onRejected?.('bad-redirect')
  return null
}

// ── Response size caps ─────────────────────────────────────────
//
// safeFetch bounds time, not size: a host that streams (or inflates, for a
// gzip bomb — undici decompresses transparently) gigabytes inside the
// deadline would be buffered by res.json()/arrayBuffer(). Every body read goes
// through readBodyLimited/readJsonLimited instead. Caps are generous
// (>= 4x the largest legitimate answer) — they only stop abuse.
export const RESPONSE_CAPS = {
  mintInfo: 256 * 1024,       // /v1/info — observed 1-2 KB
  mintKeysets: 256 * 1024,    // /v1/keysets — observed < 1 KB
  mintKeys: 2 * 1024 * 1024,  // /v1/keys — ~6 KB per 64-key keyset
  auditList: 2 * 1024 * 1024, // audit.8333.space page of 100 records
  auditSwaps: 1024 * 1024,    // audit.8333.space last 100 swaps
  auditCzMints: 1024 * 1024,  // cashu.info /api/v1/mints (~62 mints)
  auditCzSwaps: 1024 * 1024,  // cashu.info /api/v1/swaps?limit=500
  auditCzMintDetail: 64 * 1024, // cashu.info /api/v1/mints/{id} — observed ~7 KB (with the 90-day daily array)
  githubRelease: 512 * 1024,  // GitHub /releases/latest
  nip05: 1024 * 1024,         // /.well-known/nostr.json?name=
  geo: 64 * 1024,             // ipinfo.io/<ip>/json
  icon: 512 * 1024,           // proxied mint icon
} as const

/** The body exceeded its cap. Callers treat it like any other invalid answer. */
export class ResponseTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Response body exceeds ${maxBytes} bytes`)
    this.name = 'ResponseTooLargeError'
  }
}

/**
 * Reads a response body, rejecting at once on a Content-Length above maxBytes,
 * otherwise streaming and cancelling the stream (which drops the connection) as
 * soon as the running total passes maxBytes — never more than the cap plus one
 * chunk is held. Counts decoded (decompressed) bytes.
 */
export async function readBodyLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = res.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) {
    void res.body?.cancel().catch(() => undefined)
    throw new ResponseTooLargeError(maxBytes)
  }
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      // Not awaited: cancel() can wait on a producer that is still sending.
      void reader.cancel().catch(() => undefined)
      throw new ResponseTooLargeError(maxBytes)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, total)
}

/** readBodyLimited + JSON.parse (UTF-8, BOM stripped like Response.json()). */
export async function readJsonLimited(res: Response, maxBytes: number): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readBodyLimited(res, maxBytes)))
}
