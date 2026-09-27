import { useEffect, useMemo, useState } from 'react'
import { parseNip05, formatNip05 } from '@/utils/nip05'

// Verifies reviewer NIP-05 claims against GET /api/nip05/verify (the backend
// SSRF-safe proxy — see backend/src/nip05Verify.ts for why this can't be a
// direct browser fetch to the reviewer's claimed domain).
//
// Caching/rate-limiting approach (module-level, for the page session):
// - `verifiedCache` is keyed by pubkey+name+domain and never expires client-side
//   for the session — the backend endpoint itself has the real TTL (Cache-Control
//   + its own in-process cache), so a re-render/re-mount (paging, revisiting a
//   mint) never re-triggers a network request for a pubkey already resolved.
// - `inFlight` dedupes concurrent requests for the same identity (e.g. the same
//   reviewer showing up while two components mount at once).
// - No explicit request cap was needed beyond that: callers only ever pass the
//   reviews actually rendered on screen (MintDetail's Reviews tab is paginated
//   at 5 per page — REVIEWS_PER_PAGE), so at most 5 external verifications fire
//   per page view, not one per review a mint has ever received.
const verifiedCache = new Map<string, boolean>()
const inFlight = new Map<string, Promise<boolean>>()

const VERIFY_TIMEOUT_MS = 4000

function cacheKey(pubkey: string, name: string, domain: string): string {
  return `${pubkey}|${name.toLowerCase()}|${domain.toLowerCase()}`
}

async function fetchVerified(domain: string, name: string, pubkey: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
    const res = await fetch(
      `/api/nip05/verify?domain=${encodeURIComponent(domain)}&name=${encodeURIComponent(name)}&pubkey=${encodeURIComponent(pubkey)}`,
      { signal: controller.signal }
    )
    window.clearTimeout(timeout)
    if (!res.ok) return false
    const data = (await res.json()) as { verified?: boolean }
    return data.verified === true
  } catch {
    // Timeout, network error, or dead domain — fail silent (no badge), never throw.
    return false
  }
}

export interface Nip05Entry {
  pubkey: string
  nip05?: string | undefined
}

// Returns { [pubkey]: "name@domain" } for entries whose NIP-05 claim has been
// verified so far — entries pending verification, unverifiable, or malformed
// are simply absent (fail silent, not an "unverified" badge).
export function useVerifiedNip05(entries: Nip05Entry[]): Record<string, string> {
  const dedupeKey = useMemo(
    () => entries.map(e => `${e.pubkey}:${e.nip05 ?? ''}`).sort().join(','),
    [entries]
  )
  const [, bumpVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    for (const { pubkey, nip05 } of entries) {
      if (!nip05) continue
      const parsed = parseNip05(nip05)
      if (!parsed) continue
      const key = cacheKey(pubkey, parsed.name, parsed.domain)
      if (verifiedCache.has(key)) continue

      let promise = inFlight.get(key)
      if (!promise) {
        promise = fetchVerified(parsed.domain, parsed.name, pubkey)
        inFlight.set(key, promise)
      }
      void promise.then(verified => {
        inFlight.delete(key)
        verifiedCache.set(key, verified)
        if (!cancelled) bumpVersion(n => n + 1)
      })
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dedupeKey is the stable proxy for entries' content
  }, [dedupeKey])

  const result: Record<string, string> = {}
  for (const { pubkey, nip05 } of entries) {
    if (!nip05) continue
    const parsed = parseNip05(nip05)
    if (!parsed) continue
    const key = cacheKey(pubkey, parsed.name, parsed.domain)
    if (verifiedCache.get(key)) result[pubkey] = formatNip05(parsed)
  }
  return result
}
