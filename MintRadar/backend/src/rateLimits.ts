// Every per-IP / per-pubkey rate limiter of the API and the middleware that applies the general ones (split out of
// index.ts on 2026-11-08). In memory: a restart resets them.
import { type Request, type Response, type NextFunction } from 'express'
import { rateLimitKey } from './mintAdmission.js'
import { usesWalletRateLimit, isRecommendPath, sendWalletError } from './walletApi.js'
export const RATE_LIMIT_WINDOW_MS = 60_000

export const RATE_LIMIT_MAX = 60

export interface RateLimitEntry {
  count: number
  resetAt: number
}

// ── Rate limiter ───────────────────────────────────────────────

export const rateLimitStore = new Map<string, RateLimitEntry>()

export interface RateLimitResult { allowed: boolean; remaining: number; limit: number; resetAt: number }

export function checkFixedWindow(store: Map<string, RateLimitEntry>, max: number, ip: string): RateLimitResult {
  const now = Date.now()
  const entry = store.get(ip)

  if (entry === undefined || now >= entry.resetAt) {
    const resetAt = now + RATE_LIMIT_WINDOW_MS
    store.set(ip, { count: 1, resetAt })
    return { allowed: true, remaining: max - 1, limit: max, resetAt }
  }

  if (entry.count >= max) {
    return { allowed: false, remaining: 0, limit: max, resetAt: entry.resetAt }
  }

  entry.count++
  return { allowed: true, remaining: max - entry.count, limit: max, resetAt: entry.resetAt }
}

export function checkRateLimit(ip: string): RateLimitResult {
  return checkFixedWindow(rateLimitStore, RATE_LIMIT_MAX, ip)
}

// The wallet API (/api/wallets/*) and /api/mints/recommend (which wallets call) have their own, larger per-IP
// budget: wallet backends and users behind one NAT share an address. Same in-memory mechanism, separate counters
// from the general limiter; the wallet routes and recommend share ONE counter.
export const WALLET_RATE_LIMIT_MAX = 300
export const walletRateLimitStore = new Map<string, RateLimitEntry>()

// The website's own read-only GETs (everything a page load fetches from our database) have a third budget:
// one Mint Detail load issues 9 of them (measured 2026-10-21), so 150/min = 10 loads + ~50% margin. Own counter,
// so it neither eats from nor is eaten by the 60/min general counter (/api/mint/probe and the other routes keep that).
export const READ_RATE_LIMIT_MAX = 150
export const readRateLimitStore = new Map<string, RateLimitEntry>()
export const READ_RATE_LIMIT_PATHS = new Set([
  '/api/mints/known', '/api/mints/history', '/api/mints/version-history', '/api/mints/outages', '/api/mints/changes',
  '/api/mints/nostr-reviews', '/api/mints/swaps', '/api/mints/audit-cz',
  '/api/stats/reliability-trend', '/api/stats/reliability-movers',
])
// The server-side head of the SPA pages (spaHtml.ts, every non-/api path that reaches the backend) counts against
// the read budget too: it is one page load, served from the cached snapshot.
export function usesReadRateLimit(path: string): boolean {
  if (!/^\/api(?:\/|$)/i.test(path)) return true
  return READ_RATE_LIMIT_PATHS.has(path.toLowerCase().replace(/\/+$/, ''))
}

export function setRateLimitHeaders(res: Response, r: RateLimitResult): number {
  const retryAfterSec = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000))
  res.setHeader('X-RateLimit-Limit', String(r.limit))
  res.setHeader('X-RateLimit-Remaining', String(r.remaining))
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(r.resetAt / 1000)))
  return retryAfterSec
}

// Seconds until the window of a per-key limiter frees up (for Retry-After on its 429).
export function setRetryAfter(res: Response, store: Map<string, RateLimitEntry>, key: string): void {
  const resetAt = store.get(key)?.resetAt
  if (resetAt !== undefined) res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))))
}

// Prevent unbounded memory growth: an entry lives at most one window, expired ones are dropped every window.
setInterval(() => {
  const now = Date.now()
  for (const store of [rateLimitStore, walletRateLimitStore, readRateLimitStore]) {
    for (const [ip, entry] of store) {
      if (now >= entry.resetAt) store.delete(ip)
    }
  }
}, RATE_LIMIT_WINDOW_MS)

// Rate limiting — exempt public read-only endpoints that sit behind Cache-Control
export const RATE_LIMIT_EXEMPT = new Set(['/health', '/api/stats', '/api/mint/icon'])

// Stricter limiters for write endpoints that trigger outbound fetches /
// DNS resolution. Each submit performs 2+ outbound probes; each discovered
// URL performs a DNS lookup — so these are kept deliberately low to prevent
// the server being abused as an SSRF/DNS-amplification proxy.
export const HOUR_MS = 60 * 60 * 1000

// Submit: 20 req/IP/hour (each triggers probeMint + probeMintToDb).
export const submitRateLimitStore = new Map<string, RateLimitEntry>()
export const SUBMIT_RATE_LIMIT_MAX = 20

// Discover: two INDEPENDENT budgets, keyed by a `source` field in the request
// body, so the automatic background NIP-87 scan (useNostrDiscovery.ts — fires
// once per login/page-load, no fresh human intent behind it) can't starve a
// user's deliberate Dashboard "Bulk submit" of the shared budget, or vice
// versa. Before this split both callers shared one 10/hr/IP counter, so a
// user who logged in a few times in an hour (each reload re-runs the
// client-side discovery scan) could exhaust the same budget their own Bulk
// submit needed a minute later. Same endpoint, same validation/SSRF/probe
// logic either way — only which counter gets checked differs.
export const discoverAutoRateLimitStore = new Map<string, RateLimitEntry>()
export const discoverBulkRateLimitStore = new Map<string, RateLimitEntry>()
// Auto: background discovery, lower budget — a handful of logins/reloads per
// hour is normal; anything beyond that is not a human waiting on it.
export const DISCOVER_AUTO_RATE_LIMIT_MAX = 3
// Bulk: explicit "Submit All" click — unchanged from the limit both callers
// used to share.
export const DISCOVER_BULK_RATE_LIMIT_MAX = 10
export type DiscoverSource = 'auto' | 'bulk'
export function discoverRateLimitStoreFor(source: DiscoverSource): Map<string, RateLimitEntry> {
  return source === 'bulk' ? discoverBulkRateLimitStore : discoverAutoRateLimitStore
}

// Notifications subscribe/unsubscribe: 30 req/pubkey/hour each. Keyed on the
// NIP-98-authenticated pubkey rather than IP — these routes require auth, so
// the pubkey is the meaningful identity to throttle (an IP-based limit would
// let one attacker-controlled IP exhaust the budget of many pubkeys, or one
// pubkey rotate through many IPs to bypass it).
export const notifySubscribeRateLimitStore = new Map<string, RateLimitEntry>()
export const notifyUnsubscribeRateLimitStore = new Map<string, RateLimitEntry>()
// /api/notifications/list (restores the account's settings at login): own 30/hour budget.
export const notifyListRateLimitStore = new Map<string, RateLimitEntry>()
export const NOTIFY_RATE_LIMIT_MAX = 30

export function checkWindowedLimit(store: Map<string, RateLimitEntry>, max: number, key: string): boolean {
  const now = Date.now()
  const entry = store.get(key)
  if (entry === undefined || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + HOUR_MS })
    return true
  }
  if (entry.count >= max) return false
  entry.count++
  return true
}

// Unknown-URL probe (GET /api/mint/probe for a URL that is NOT in `mints`):
// every such request makes the server fetch an arbitrary public host, so it
// gets its own budget on top of the global limiter — 10/min and 60/hour per IP
// plus at most 3 probes in flight per IP. Tracked mints never touch this.
// In memory like the other limiters: a restart resets it.
export const MINUTE_MS = 60_000
export const UNKNOWN_PROBE_PER_MINUTE_MAX = 10
export const UNKNOWN_PROBE_PER_HOUR_MAX = 60
export const UNKNOWN_PROBE_CONCURRENT_MAX = 3
export const UNKNOWN_PROBE_CONCURRENT_RETRY_AFTER_S = 5
export const unknownProbeMinuteStore = new Map<string, RateLimitEntry>()
export const unknownProbeHourStore = new Map<string, RateLimitEntry>()
export const unknownProbeInFlight = new Map<string, number>()

// Admits (and counts) one unknown-URL probe, or returns the seconds until the
// blocking window frees up. A rejected request consumes no budget. On success
// the caller MUST call releaseUnknownProbe(ip) in a finally block.
export function tryAcquireUnknownProbe(ip: string): { ok: true } | { ok: false; retryAfterS: number } {
  const now = Date.now()
  const minute = unknownProbeMinuteStore.get(ip)
  const hour = unknownProbeHourStore.get(ip)
  const minuteFull = minute !== undefined && now < minute.resetAt && minute.count >= UNKNOWN_PROBE_PER_MINUTE_MAX
  const hourFull = hour !== undefined && now < hour.resetAt && hour.count >= UNKNOWN_PROBE_PER_HOUR_MAX
  if (minuteFull || hourFull) {
    const waitMs = Math.max(
      minuteFull ? minute.resetAt - now : 0,
      hourFull ? hour.resetAt - now : 0,
    )
    return { ok: false, retryAfterS: Math.max(1, Math.ceil(waitMs / 1000)) }
  }
  if ((unknownProbeInFlight.get(ip) ?? 0) >= UNKNOWN_PROBE_CONCURRENT_MAX) {
    return { ok: false, retryAfterS: UNKNOWN_PROBE_CONCURRENT_RETRY_AFTER_S }
  }
  if (minute === undefined || now >= minute.resetAt) unknownProbeMinuteStore.set(ip, { count: 1, resetAt: now + MINUTE_MS })
  else minute.count++
  if (hour === undefined || now >= hour.resetAt) unknownProbeHourStore.set(ip, { count: 1, resetAt: now + HOUR_MS })
  else hour.count++
  unknownProbeInFlight.set(ip, (unknownProbeInFlight.get(ip) ?? 0) + 1)
  return { ok: true }
}

export function releaseUnknownProbe(ip: string): void {
  const n = (unknownProbeInFlight.get(ip) ?? 0) - 1
  if (n > 0) unknownProbeInFlight.set(ip, n)
  else unknownProbeInFlight.delete(ip)
}

setInterval(() => {
  const now = Date.now()
  for (const store of [unknownProbeMinuteStore, unknownProbeHourStore]) {
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) store.delete(key)
    }
  }
}, MINUTE_MS)

export function checkSubmitRateLimit(ip: string): boolean {
  return checkWindowedLimit(submitRateLimitStore, SUBMIT_RATE_LIMIT_MAX, ip)
}

export function checkDiscoverRateLimit(ip: string, source: DiscoverSource): boolean {
  const max = source === 'bulk' ? DISCOVER_BULK_RATE_LIMIT_MAX : DISCOVER_AUTO_RATE_LIMIT_MAX
  return checkWindowedLimit(discoverRateLimitStoreFor(source), max, ip)
}

export function checkNotifySubscribeRateLimit(pubkey: string): boolean {
  return checkWindowedLimit(notifySubscribeRateLimitStore, NOTIFY_RATE_LIMIT_MAX, pubkey)
}

export function checkNotifyUnsubscribeRateLimit(pubkey: string): boolean {
  return checkWindowedLimit(notifyUnsubscribeRateLimitStore, NOTIFY_RATE_LIMIT_MAX, pubkey)
}

export function checkNotifyListRateLimit(pubkey: string): boolean {
  return checkWindowedLimit(notifyListRateLimitStore, NOTIFY_RATE_LIMIT_MAX, pubkey)
}

setInterval(() => {
  const now = Date.now()
  for (const store of [submitRateLimitStore, discoverAutoRateLimitStore, discoverBulkRateLimitStore, notifySubscribeRateLimitStore, notifyUnsubscribeRateLimitStore, notifyListRateLimitStore]) {
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) store.delete(key)
    }
  }
}, HOUR_MS)

// Every request after express.json(): the per-IP limiters (exempt paths, wallet, read, general).
export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (RATE_LIMIT_EXEMPT.has(req.path)) {
    next()
    return
  }
  const ip = rateLimitKey(req.ip ?? req.socket.remoteAddress)
  if (usesWalletRateLimit(req.path)) {
    const r = checkFixedWindow(walletRateLimitStore, WALLET_RATE_LIMIT_MAX, ip)
    const retryAfterSec = setRateLimitHeaders(res, r)
    if (!r.allowed) {
      res.setHeader('Retry-After', String(retryAfterSec))
      // /api/mints/recommend keeps its documented error shape { error: "text" }; the wallet routes use the JSON envelope.
      if (isRecommendPath(req.path)) res.status(429).json({ error: 'Too many requests' })
      else sendWalletError(res, 429, 'rate_limited', 'Too many requests. See Retry-After.', retryAfterSec)
      return
    }
    next()
    return
  }
  const r = usesReadRateLimit(req.path) ? checkFixedWindow(readRateLimitStore, READ_RATE_LIMIT_MAX, ip) : checkRateLimit(ip)
  const retryAfterSec = setRateLimitHeaders(res, r)
  if (!r.allowed) {
    res.setHeader('Retry-After', String(retryAfterSec))
    res.status(429).json({ error: 'Too many requests' })
    return
  }
  next()
}
