import { safeFetch, readJsonLimited, RESPONSE_CAPS } from './ssrf.js'

// SSRF-safe NIP-05 verification proxy.
//
// A review's kind:0 profile can claim any `nip05` string — it's unauthenticated
// operator/user-supplied text, same trust level as a mint's `icon_url`. Per
// NIP-05, "verifying" it means fetching https://<domain>/.well-known/nostr.json
// and confirming the returned pubkey matches. Doing that fetch directly from the
// browser would send every visitor's IP to a domain the review's AUTHOR (a
// potential attacker) controls, on every page view — the same tracking-beacon
// class of issue documented for mint icon_url (see mintIcon.ts) and the reason
// useMintOperatorNip05.ts deliberately does NOT verify. This module gives
// reviewer NIP-05 the same backend-proxy treatment: the server does the
// external fetch (via safeFetch — SSRF guard + DNS pinning + redirect
// re-validation), the client only ever talks to our own origin.

const NAME_RE = /^[a-z0-9-_.]{1,64}$/i
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i
const PUBKEY_RE = /^[0-9a-f]{64}$/i

export function isValidNip05Name(name: string): boolean {
  return NAME_RE.test(name)
}

export function isValidNip05Domain(domain: string): boolean {
  return domain.length <= 255 && DOMAIN_RE.test(domain)
}

export function isValidPubkeyHex(pubkey: string): boolean {
  return PUBKEY_RE.test(pubkey)
}

interface CacheEntry {
  verified: boolean
  expiresAt: number
}

const POSITIVE_TTL_MS = 6 * 60 * 60 * 1000 // 6h — matches mintIcon.ts's positive TTL
const NEGATIVE_TTL_MS = 30 * 60 * 1000 // 30min — a fixable misconfig shouldn't stay hidden all day
const MAX_CACHE_ENTRIES = 2000

const cache = new Map<string, CacheEntry>()

/** Test hook — clears the in-process verification cache. */
export function _resetNip05VerifyCache(): void {
  cache.clear()
}

function cacheKey(domain: string, name: string, pubkey: string): string {
  return `${domain.toLowerCase()}|${name.toLowerCase()}|${pubkey.toLowerCase()}`
}

interface NostrJsonResponse {
  names?: Record<string, string>
}

/**
 * Verifies a NIP-05 claim (name@domain) against a pubkey by fetching
 * https://<domain>/.well-known/nostr.json?name=<name> and comparing the
 * returned pubkey. Returns false (never throws) for any invalid input,
 * unreachable domain, or mismatch — callers should treat false as "don't
 * show this identifier", not as an error to surface.
 */
export async function verifyNip05(domain: string, name: string, pubkey: string): Promise<boolean> {
  if (!isValidNip05Domain(domain) || !isValidNip05Name(name) || !isValidPubkeyHex(pubkey)) return false

  const key = cacheKey(domain, name, pubkey)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.verified

  const verified = await fetchAndVerify(domain, name, pubkey)

  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Evict the oldest inserted entry (Map preserves insertion order) —
    // same bound-the-memory approach as mintIcon.ts's icon cache.
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(key, { verified, expiresAt: Date.now() + (verified ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) })
  return verified
}

async function fetchAndVerify(domain: string, name: string, pubkey: string): Promise<boolean> {
  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`
  const res = await safeFetch(url, {
    timeoutMs: 5000,
    headers: { Accept: 'application/json' },
  })
  if (!res || !res.ok) return false

  try {
    const body = (await readJsonLimited(res, RESPONSE_CAPS.nip05)) as NostrJsonResponse
    const returned = body.names?.[name]
    return typeof returned === 'string' && returned.toLowerCase() === pubkey.toLowerCase()
  } catch {
    return false
  }
}
