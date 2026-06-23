import { parse, IPv4, IPv6 } from 'ipaddr.js'
import { lookup } from 'dns/promises'
import { lookup as dnsLookupCb } from 'dns'
import type { LookupAddress } from 'dns'
import type { LookupFunction } from 'net'
import { Agent, fetch as undiciFetch } from 'undici'

const BLOCKED_RANGES = [
  'loopback', 'private', 'linkLocal', 'uniqueLocal',
  'unspecified', 'reserved', 'carrierGradeNat', 'broadcast'
] as const

function isBlockedAddress(addr: IPv4 | IPv6): boolean {
  const range = addr.range()
  if ((BLOCKED_RANGES as readonly string[]).includes(range)) return true

  // Handle IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
  if (addr.kind() === 'ipv6') {
    const v6 = addr as IPv6
    if (v6.isIPv4MappedAddress()) {
      const v4 = v6.toIPv4Address()
      const v4range = v4.range()
      if ((BLOCKED_RANGES as readonly string[]).includes(v4range)) return true
    }
  }

  return false
}

function isBlockedIpString(ip: string): boolean {
  try {
    return isBlockedAddress(parse(ip))
  } catch {
    // Not parseable as an IP — fail closed
    return true
  }
}

export async function isSafeUrl(rawUrl: string): Promise<boolean> {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:') return false
    if (rawUrl.length > 500) return false

    const hostname = url.hostname

    // Block if hostname is already an IP address
    try {
      const addr = parse(hostname)
      if (isBlockedAddress(addr)) return false
    } catch {
      // Not a raw IP — continue to DNS lookup
    }

    // Resolve DNS and check all returned addresses
    const addresses = await lookup(hostname, { all: true })
    if (addresses.length === 0) return false
    for (const addr of addresses) {
      try {
        const parsed = parse(addr.address)
        if (isBlockedAddress(parsed)) return false
      } catch {
        return false
      }
    }

    return true
  } catch {
    return false
  }
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
const safeLookup: LookupFunction = (hostname, options, callback): void => {
  dnsLookupCb(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) { callback(err, '', 0); return }
    const list = addresses as unknown as LookupAddress[]
    if (!Array.isArray(list) || list.length === 0) {
      callback(new Error('No addresses resolved'), '', 0)
      return
    }
    for (const a of list) {
      if (isBlockedIpString(a.address)) {
        callback(new Error('Blocked address (SSRF protection)'), '', 0)
        return
      }
    }
    callback(null, list, list[0]!.family)
  })
}

const safeAgent = new Agent({
  connect: { lookup: safeLookup },
})

const MAX_REDIRECTS = 3

export interface SafeFetchOptions {
  timeoutMs?: number
  onError?: (err: unknown) => void
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
  let currentUrl = rawUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSafeUrl(currentUrl))) return null

    let res: Response
    try {
      res = await undiciFetch(currentUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        credentials: 'omit',
        redirect: 'manual',
        dispatcher: safeAgent,
      }) as unknown as Response
    } catch (err) {
      options.onError?.(err)
      return null
    }

    // Manually follow redirects, re-validating each Location.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return null
      try {
        // Resolve relative redirects against the current URL.
        currentUrl = new URL(location, currentUrl).toString()
      } catch {
        return null
      }
      continue
    }

    return res
  }

  // Too many redirects.
  return null
}
