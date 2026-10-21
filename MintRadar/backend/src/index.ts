import './wsPolyfill.js'
import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { pool, initDb } from './db.js'
import { isNutDeclaredSupported } from './shared/nutSupport.js'
import { isSafeUrl, isWellFormedMintUrl, checkWsUrlSafety, safeFetch, readJsonLimited, RESPONSE_CAPS } from './ssrf.js'
import { upsertMint, probeMintToDb, validateCashuMintProbe, parseMintMethods, classifyFetchError, type MintMethodEntry } from './prober.js'
import { classifyProbeFailure, failureFromResponse, isAbortLike, type ProbeErrorKind, type ProbeFailure, type SafeFetchRejection } from './probeErrorKind.js'
import { normalizeMintPubkey, findMintsByPubkey, persistMintPubkeyIfChanged } from './mintPubkey.js'
import { getLatestVersionsMap } from './versionCatalog.js'
import type { LatestVersions } from './shared/versionRule.js'
import { METHODOLOGY_CHANGES } from './shared/methodology.js'
import { splitVersionString, canonicalSoftwareName, TRACKED_NUT_KEYS, MINT_ADVERTISED_NUT_KEYS, isEligibleForRecommendation } from './shared/reliabilityScore.js'
import { listMintChanges, ROUTE_CHANGES_MAX, WALLET_CHANGES_PER_MINT } from './mintChanges.js'
import { getAuditCzForMint, getAuditCzSyncStatus, auditCzSourceStatus, clampAuditCzLimit } from './auditCz.js'
import { seedKnownMints, startCron, getLastProbeCompletedAt } from './cron.js'
import { getLastVantageOutageAt } from './probeCycle.js'
import { publishServiceProfile } from './nostrService.js'
import { startAttestations } from './healthPublisher.js'
import { normalizeUrl, getSyncTimesFromDb, getAuditUpstreamStatus } from './discovery.js'
import { computeDegraded } from './degraded.js'
import { authenticateNip98 } from './nip98Auth.js'
import { fetchOgMintData, renderMintOgHtml, renderPageOgHtml } from './og.js'
import { getMintIcon } from './mintIcon.js'
import { computeReliabilityMovers, type MintScoreSnapshot } from './reliabilityMovers.js'
import { globalMeanRating, weightedRating } from './weightedRating.js'
import { hasRecentReviewSurge } from './reviewSurge.js'
import { isTestMint } from './testMints.js'
import { publicMintName, publicMintNameOrHost } from './mintNames.js'
import {
  usesWalletRateLimit, isRecommendPath, isPublicCorsPath, PUBLIC_CORS_EXPOSE_HEADERS, parseWalletListQuery, walletListEnvelope, walletSingleEnvelope, recommendEnvelope,
  memoizedBody, cachedBodyOf, buildCachedBody, sendCachedBody, sendWalletError, queryOf, keysetsOf, changesOf, type Snapshot, type WalletExtra, type AuditDirectionsRow,
} from './walletApi.js'
import { readStoredBreakdown } from './scoreBreakdown.js'
import { readStoredContactChecks } from './contactChecks.js'
import { setDeprecationHeaders, RECOMMEND_DEPRECATION } from './deprecation.js'
import { verifyNip05 } from './nip05Verify.js'
import { isAllowlistMode, isAllowedUrl } from './allowlist.js'
import { profileFieldsForReview } from './profilesSync.js'

// ONE computation of the /api/mints/known rows, shared with the wallet API (walletApi.ts): at most one database read
// per KNOWN_MINTS_CACHE_TTL for all of them, concurrent callers join the read in flight.
let knownMintsCache: (Snapshot & { expiresAt: number }) | null = null
let knownMintsInflight: Promise<Snapshot> | null = null
function invalidateKnownMints(): void {
  knownMintsCache = null
  knownMintsInflight = null
}
const KNOWN_MINTS_CACHE_TTL = 60_000 // 60 seconds

// /api/stats is in RATE_LIMIT_EXEMPT (see below) but, unlike the other
// exempt endpoints, ran two live pool.query() calls via Promise.all on every
// single request with no cache — against the shared `pool` (max: 5), that let
// ordinary traffic (Stats page open + Dashboard's own periodic refetch, no
// attack needed) exhaust the connection pool. Same in-process TTL cache shape
// as knownMintsCache above; the underlying data only moves once per 5-min
// probe cycle, so a 60s cache is well within tolerance and needs no
// invalidation beyond the TTL expiring.
let statsCache: { data: object; expiresAt: number } | null = null
const STATS_CACHE_TTL = 60_000 // 60 seconds

// /api/stats/reliability-trend aggregates ~1.3M mint_history rows for 90d (sequential scan, ~1.3s; MIN(checked_at) another
// ~0.3s, EXPLAIN ANALYZE 2026-10-16) and the result only changes once a day, so each period is cached for 10 minutes,
// concurrent misses share one query, and the cache is warmed at startup and refreshed in the background (below).
const reliabilityTrendCache = new Map<number, { data: object; expiresAt: number }>()
const reliabilityTrendInFlight = new Map<number, Promise<object>>()
const RELIABILITY_TREND_CACHE_TTL = 10 * 60_000 // 10 minutes
const RELIABILITY_TREND_REFRESH_MS = 9 * 60_000 // refresh before the TTL ends, so a visitor never pays for the scan

const reliabilityMoversCache = new Map<string, { data: object; expiresAt: number }>()
// Longer than KNOWN_MINTS_CACHE_TTL: the underlying snapshots only move once per
// probe cycle (5 min, refreshReliabilityMoversRollup on the probe cron), and a 7d/30d
// delta barely shifts between cycles — no reason to recompute per-minute.
const RELIABILITY_MOVERS_CACHE_TTL = 10 * 60_000 // 10 minutes

// Re-exported for backend/src/__tests__/nostrReviewsRelays.test.ts (a drift
// tripwire that pins the exact array). The list itself now lives in
// reviewsSync.ts, which owns the only remaining server-side relay fetch of
// kind:38000 reviews (the hourly background sync). GET /api/mints/nostr-reviews no
// longer touches a relay — it serves the DB rows that sync populates.
export { REVIEW_SYNC_RELAYS as NOSTR_REVIEWS_RELAYS } from './reviewsSync.js'
import { aggregateReviews, operatorKeysOf, contactKeysOf, type ReviewAggregate } from './reviewsSync.js'

const REQUIRED_ENV_VARS = ['DATABASE_URL', 'ALLOWED_ORIGINS'] as const
const missingVars = REQUIRED_ENV_VARS.filter(v => !process.env[v])
if (missingVars.length > 0) {
  for (const v of missingVars) console.error(`ERROR: Missing required environment variable: ${v}`)
  process.exit(1)
}
console.log('ENV OK')

const PORT = parseInt(process.env['PORT'] ?? '3002', 10)
const IS_DEV = process.env['NODE_ENV'] !== 'production'

// In production the fallback never includes localhost — only the live origin.
// Dev fallback includes the Vite dev server. Override via ALLOWED_ORIGINS env.
const DEFAULT_ORIGINS = IS_DEV
  ? 'https://mintradar.org,https://mintradar.pedani.eu,http://localhost:5173'
  : 'https://mintradar.org,https://mintradar.pedani.eu'

const ALLOWED_ORIGINS = (
  process.env['ALLOWED_ORIGINS'] ?? DEFAULT_ORIGINS
).split(',').map(o => o.trim())

const MAX_URL_LENGTH = 500
const RATE_LIMIT_WINDOW_MS = 60_000

// Strip control characters (CR/LF/tab/NUL/ANSI-escape/…) and cap the length
// before interpolating an untrusted string into a plain-text log line, so it
// cannot forge or split log entries or inject terminal escapes into a log
// viewer. `new URL()` (used on the /unsubscribe path) silently *drops* tab/CR/LF
// per the WHATWG spec rather than rejecting, so an explicit strip is needed
// wherever a raw client string reaches console.* — e.g. relay URLs in
// validateRelays(), which keeps the original string, not the parsed URL.
function sanitizeLogValue(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, '\uFFFD').slice(0, 200)
}
const RATE_LIMIT_MAX = 60

// Names leave the server cleaned (mintNames.ts): `name` is the display name (null = show the hostname),
// `nameFull` the full cleaned name, only when `name` was truncated/emoji-capped (title tooltip).
function knownMintNameFields(raw: string | null, url: string): { name: string | null; nameFull?: string } {
  const p = publicMintName(raw, url)
  return p.nameFull !== null ? { name: p.name, nameFull: p.nameFull } : { name: p.name }
}

// ── Types ──────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface MintInfo {
  name: string
  version?: string
  description?: string
  description_long?: string
  tos_url?: string
  nuts: Record<string, unknown>
  pubkey?: string
}

interface MintKeyset {
  id: string
  unit: string
  active: boolean
}

interface MintStatus {
  url: string
  online: boolean
  latencyMs: number | null
  info: MintInfo | null
  keysets: MintKeyset[] | null
  checkedAt: string
  error?: string
  // Coarse failure category (see probeErrorKind.ts) — additive to `error`.
  errorKind?: ProbeErrorKind
  units: string[] | null
  mintMethods: MintMethodEntry[] | null
  meltMethods: MintMethodEntry[] | null
}

// ── Rate limiter ───────────────────────────────────────────────

const rateLimitStore = new Map<string, RateLimitEntry>()

interface RateLimitResult { allowed: boolean; remaining: number; limit: number; resetAt: number }

function checkFixedWindow(store: Map<string, RateLimitEntry>, max: number, ip: string): RateLimitResult {
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

function checkRateLimit(ip: string): RateLimitResult {
  return checkFixedWindow(rateLimitStore, RATE_LIMIT_MAX, ip)
}

// The wallet API (/api/wallets/*) and /api/mints/recommend (which wallets call) have their own, larger per-IP
// budget: wallet backends and users behind one NAT share an address. Same in-memory mechanism, separate counters
// from the general limiter; the wallet routes and recommend share ONE counter.
const WALLET_RATE_LIMIT_MAX = 300
const walletRateLimitStore = new Map<string, RateLimitEntry>()

// The website's own read-only GETs (everything a page load fetches from our database) have a third budget:
// one Mint Detail load issues 9 of them (measured 2026-10-21), so 150/min = 10 loads + ~50% margin. Own counter,
// so it neither eats from nor is eaten by the 60/min general counter (/api/mint/probe and the other routes keep that).
const READ_RATE_LIMIT_MAX = 150
const readRateLimitStore = new Map<string, RateLimitEntry>()
const READ_RATE_LIMIT_PATHS = new Set([
  '/api/mints/known', '/api/mints/history', '/api/mints/version-history', '/api/mints/outages', '/api/mints/changes',
  '/api/mints/nostr-reviews', '/api/mints/daily-uptime', '/api/mints/swaps', '/api/mints/audit-cz',
  '/api/stats/reliability-trend', '/api/stats/reliability-movers', '/api/nuts',
])
function usesReadRateLimit(path: string): boolean {
  return READ_RATE_LIMIT_PATHS.has(path.toLowerCase().replace(/\/+$/, ''))
}

function setRateLimitHeaders(res: Response, r: RateLimitResult): number {
  const retryAfterSec = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000))
  res.setHeader('X-RateLimit-Limit', String(r.limit))
  res.setHeader('X-RateLimit-Remaining', String(r.remaining))
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(r.resetAt / 1000)))
  return retryAfterSec
}

// Seconds until the window of a per-key limiter frees up (for Retry-After on its 429).
function setRetryAfter(res: Response, store: Map<string, RateLimitEntry>, key: string): void {
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

// ── Mint probe ─────────────────────────────────────────────────

// On-demand single-mint probe (GET /api/mint/probe) — matches the cron
// prober's PROBE_TIMEOUT_MS (prober.ts) so a hanging mint fails at the same
// ceiling everywhere, and stays comfortably under the frontend's own
// AbortSignal.timeout(15000) around this endpoint (src/core/mint/api.ts).
const ON_DEMAND_PROBE_TIMEOUT_MS = 10_000

// One overall deadline for the whole on-demand probe — both requests plus any
// retry share it (each request's timeout is derived from the time left), so the
// worst case is ~12 s instead of 10 + 1 + 10 = 21 s, still under the frontend's
// 15 s abort. A retry is only started if at least ON_DEMAND_MIN_RETRY_MS would
// remain for it after the wait.
const ON_DEMAND_PROBE_DEADLINE_MS = 12_000
const ON_DEMAND_NETWORK_RETRY_DELAY_MS = 1_000
const ON_DEMAND_5XX_RETRY_DELAY_MS = 2_000
const ON_DEMAND_MIN_RETRY_MS = 1_500

// safeFetch for /v1/info that also remembers WHY a null came back (network
// error object or guard rejection), so probeMint can classify the failure.
function fetchInfoTraced(target: string, timeoutMs: number): {
  res: ReturnType<typeof safeFetch>
  trace: { err: unknown; rejected: SafeFetchRejection | null }
} {
  const trace: { err: unknown; rejected: SafeFetchRejection | null } = { err: null, rejected: null }
  const res = safeFetch(target, {
    timeoutMs,
    onError: (err) => { trace.err = err },
    onRejected: (reason) => { trace.rejected = reason },
  })
  return { res, trace }
}

async function probeMintWithin(url: string, start: number): Promise<MintStatus> {
  const deadlineAt = start + ON_DEMAND_PROBE_DEADLINE_MS
  const remainingMs = (): number => deadlineAt - Date.now()
  // Each request gets the usual per-request ceiling, but never more than what
  // is left of the overall deadline.
  const budgetMs = (): number => Math.max(1, Math.min(ON_DEMAND_PROBE_TIMEOUT_MS, remainingMs()))

  // safeFetch validates the URL and every redirect hop against isSafeUrl()
  // and pins DNS at connect time (SSRF + rebinding protection).
  const firstInfo = fetchInfoTraced(`${url}/v1/info`, budgetMs())
  const [infoResFirst, keysetsRes] = await Promise.all([
    firstInfo.res,
    safeFetch(`${url}/v1/keysets`, { timeoutMs: budgetMs() }),
  ])

  // Retry once on network/DNS failure (res === null) — mirrors probeMintToDb's
  // retry in prober.ts, so a transient blip doesn't disagree with the cron's
  // last-known status shown on the Dashboard card (see mint.macadamia.cash report).
  // Also retry once after 2 s on 502/503/504 (a restart/deploy blip), like the
  // cron — but not on a Cloudflare challenge, which a retry can't clear.
  // Either retry only starts if the deadline leaves it a usable window.
  let infoRes = infoResFirst
  let infoTrace = firstInfo.trace
  const firstStatus = infoResFirst?.status
  const isTransient5xx = firstStatus === 502 || firstStatus === 503 || firstStatus === 504
  if (infoResFirst === null || (isTransient5xx && infoResFirst.headers?.get?.('cf-mitigated') == null)) {
    const delayMs = infoResFirst === null ? ON_DEMAND_NETWORK_RETRY_DELAY_MS : ON_DEMAND_5XX_RETRY_DELAY_MS
    if (remainingMs() >= delayMs + ON_DEMAND_MIN_RETRY_MS) {
      await new Promise<void>(r => setTimeout(r, delayMs))
      const retry = fetchInfoTraced(`${url}/v1/info`, budgetMs())
      const retryRes = await retry.res
      // A 5xx that is followed by a network failure keeps the host's own 5xx
      // answer (more informative than "connection failed" on the retry).
      if (retryRes !== null || infoResFirst === null) {
        infoRes = retryRes
        infoTrace = retry.trace
      }
    }
  }

  const latencyMs = Date.now() - start

  let info: MintInfo | null = null
  let online = false
  // What went wrong, as inputs for the (pure) classifier — never echoed raw.
  let failure: ProbeFailure | null = null

  if (infoRes && infoRes.ok) {
    try {
      const raw: unknown = await readJsonLimited(infoRes, RESPONSE_CAPS.mintInfo)
      if (typeof raw === 'object' && raw !== null && 'nuts' in raw) {
        info = raw as MintInfo
        online = true
      } else {
        failure = failureFromResponse(infoRes)
      }
    } catch (err) {
      /* invalid JSON — treat as offline; a deadline abort mid-body is a timeout */
      failure = isAbortLike(err) ? { networkLabel: 'Connection timeout' } : failureFromResponse(infoRes)
    }
  } else {
    if (IS_DEV) console.error('[probeMint] info fetch failed or blocked:', url)
    failure = infoRes
      ? failureFromResponse(infoRes)
      : {
          rejected: infoTrace.rejected,
          networkLabel: infoTrace.err !== null ? classifyFetchError(infoTrace.err) : null,
        }
  }

  let keysets: MintKeyset[] | null = null

  if (keysetsRes && keysetsRes.ok) {
    try {
      const raw: unknown = await readJsonLimited(keysetsRes, RESPONSE_CAPS.mintKeysets)
      if (
        typeof raw === 'object' &&
        raw !== null &&
        'keysets' in raw &&
        Array.isArray((raw as { keysets: unknown }).keysets)
      ) {
        keysets = (raw as { keysets: MintKeyset[] }).keysets
      }
    } catch { /* invalid JSON — skip keysets */ }
  }

  const { units, mintMethods, meltMethods } = parseMintMethods(info?.nuts ?? null)

  const status: MintStatus = {
    url,
    online,
    latencyMs: online ? latencyMs : null,
    info,
    keysets,
    checkedAt: new Date().toISOString(),
    units,
    mintMethods,
    meltMethods,
  }

  if (!online) {
    status.error = 'Mint unreachable'
    status.errorKind = classifyProbeFailure(failure ?? {})
  }

  return status
}

// Hard cap: safeFetch's own deadline cannot cover its DNS pre-check or a stalled
// body read in every case, so the whole probe is also raced against the
// deadline. The losing inner promise just finishes in the background.
async function probeMint(url: string): Promise<MintStatus> {
  const start = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const capped = new Promise<MintStatus>(resolve => {
    timer = setTimeout(() => resolve({
      url,
      online: false,
      latencyMs: null,
      info: null,
      keysets: null,
      checkedAt: new Date().toISOString(),
      error: 'Mint unreachable',
      errorKind: 'timeout',
      units: null,
      mintMethods: null,
      meltMethods: null,
    }), ON_DEMAND_PROBE_DEADLINE_MS)
  })
  try {
    return await Promise.race([probeMintWithin(url, start), capped])
  } finally {
    clearTimeout(timer)
  }
}

// ── App ────────────────────────────────────────────────────────

export const app = express()

// Do not tell the world which framework answers (Express sets X-Powered-By by default).
app.disable('x-powered-by')

// `trust proxy` must stay a hop count (a number), never a subnet string such as '10.0.0.0/8' or
// '::ffff:10.0.0.0/8'. With a number Express never asks proxy-addr to compile a trust subnet; with
// a short IPv4-mapped IPv6 prefix proxy-addr < 2.0.8 matched EVERY client as a trusted proxy
// (GHSA-jqcg-44mw-7w3h), so req.ip became whatever X-Forwarded-For says and the per-IP rate
// limits below, which key on req.ip, could be bypassed. 1 = trust exactly the nginx in front of
// us, which overwrites X-Forwarded-For with $remote_addr (deploy/nginx.conf).
// Pinned by __tests__/security/trust-proxy.test.ts.
app.set('trust proxy', 1)

// Security headers
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-XSS-Protection', '0')
  next()
})

// /api/v1/* alias — rewritten to its /api/* equivalent before any routing,
// rate-limit, or exemption check below runs, so it shares every one of those
// mechanisms (and their per-IP/per-pubkey counters) with the unversioned path
// instead of getting its own copy. /api/v1 is preferred going forward; the
// unversioned /api/* is kept as a legacy alias (see docs/API.md).
app.use((req: Request, _res: Response, next: NextFunction) => {
  // /api/v1/health maps to the root /health (there is deliberately no /api/health).
  if (req.url === '/api/v1/health' || req.url.startsWith('/api/v1/health?')) {
    req.url = '/health' + req.url.slice('/api/v1/health'.length)
    next()
    return
  }
  if (req.url === '/api/v1' || req.url.startsWith('/api/v1/') || req.url.startsWith('/api/v1?')) {
    req.url = '/api' + req.url.slice('/api/v1'.length)
  }
  next()
})

// CORS. The public read routes (the wallet API, /api/mints/recommend, /health) answer ANY origin
// for GET, HEAD and OPTIONS, without credentials; the preflight is a 204 that never reaches the rate limiter.
// Every other route, /api/mints/known included (it is the website's own data feed, with network details the wallet API
// leaves out), keeps the origin allow-list; a foreign Origin there gets a JSON 403 (it used to be an HTML 500).
// Runs after the /api/v1 rewrite above, so it sees the canonical path.
const restrictedCors = cors({
  origin: (origin, callback) => callback(null, origin === undefined || ALLOWED_ORIGINS.includes(origin)),
  methods: ['GET', 'POST'],
})
const PREFLIGHT_HEADERS_RE = /^[A-Za-z0-9-]+(?:, ?[A-Za-z0-9-]+){0,19}$/
app.use((req: Request, res: Response, next: NextFunction) => {
  if (isPublicCorsPath(req.path) && (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS')) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Expose-Headers', PUBLIC_CORS_EXPOSE_HEADERS)
    if (req.method === 'OPTIONS') {
      const asked = req.headers['access-control-request-headers']
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', typeof asked === 'string' && PREFLIGHT_HEADERS_RE.test(asked) ? asked : 'Content-Type, If-None-Match')
      res.setHeader('Access-Control-Max-Age', '86400')
      res.status(204).end()
      return
    }
    next()
    return
  }
  const origin = req.headers.origin
  if (origin !== undefined && !ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({ error: { code: 'cors_forbidden', message: 'This origin may not call this endpoint from a browser. Public read routes (/api/wallets/*, /api/mints/recommend, /health) allow any origin.' } })
    return
  }
  restrictedCors(req, res, next)
})

app.use(express.json())

// Rate limiting — exempt public read-only endpoints that sit behind Cache-Control
const RATE_LIMIT_EXEMPT = new Set(['/health', '/api/stats', '/api/mint/icon'])

// Stricter limiters for write endpoints that trigger outbound fetches /
// DNS resolution. Each submit performs 2+ outbound probes; each discovered
// URL performs a DNS lookup — so these are kept deliberately low to prevent
// the server being abused as an SSRF/DNS-amplification proxy.
const HOUR_MS = 60 * 60 * 1000

// Submit: 20 req/IP/hour (each triggers probeMint + probeMintToDb).
const submitRateLimitStore = new Map<string, RateLimitEntry>()
const SUBMIT_RATE_LIMIT_MAX = 20

// Discover: two INDEPENDENT budgets, keyed by a `source` field in the request
// body, so the automatic background NIP-87 scan (useNostrDiscovery.ts — fires
// once per login/page-load, no fresh human intent behind it) can't starve a
// user's deliberate Dashboard "Bulk submit" of the shared budget, or vice
// versa. Before this split both callers shared one 10/hr/IP counter, so a
// user who logged in a few times in an hour (each reload re-runs the
// client-side discovery scan) could exhaust the same budget their own Bulk
// submit needed a minute later. Same endpoint, same validation/SSRF/probe
// logic either way — only which counter gets checked differs.
const discoverAutoRateLimitStore = new Map<string, RateLimitEntry>()
const discoverBulkRateLimitStore = new Map<string, RateLimitEntry>()
// Auto: background discovery, lower budget — a handful of logins/reloads per
// hour is normal; anything beyond that is not a human waiting on it.
const DISCOVER_AUTO_RATE_LIMIT_MAX = 3
// Bulk: explicit "Submit All" click — unchanged from the limit both callers
// used to share.
const DISCOVER_BULK_RATE_LIMIT_MAX = 10
type DiscoverSource = 'auto' | 'bulk'
function discoverRateLimitStoreFor(source: DiscoverSource): Map<string, RateLimitEntry> {
  return source === 'bulk' ? discoverBulkRateLimitStore : discoverAutoRateLimitStore
}

// Notifications subscribe/unsubscribe: 30 req/pubkey/hour each. Keyed on the
// NIP-98-authenticated pubkey rather than IP — these routes require auth, so
// the pubkey is the meaningful identity to throttle (an IP-based limit would
// let one attacker-controlled IP exhaust the budget of many pubkeys, or one
// pubkey rotate through many IPs to bypass it).
const notifySubscribeRateLimitStore = new Map<string, RateLimitEntry>()
const notifyUnsubscribeRateLimitStore = new Map<string, RateLimitEntry>()
const NOTIFY_RATE_LIMIT_MAX = 30

function checkWindowedLimit(store: Map<string, RateLimitEntry>, max: number, key: string): boolean {
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
const MINUTE_MS = 60_000
const UNKNOWN_PROBE_PER_MINUTE_MAX = 10
const UNKNOWN_PROBE_PER_HOUR_MAX = 60
const UNKNOWN_PROBE_CONCURRENT_MAX = 3
const UNKNOWN_PROBE_CONCURRENT_RETRY_AFTER_S = 5
const unknownProbeMinuteStore = new Map<string, RateLimitEntry>()
const unknownProbeHourStore = new Map<string, RateLimitEntry>()
const unknownProbeInFlight = new Map<string, number>()

// Admits (and counts) one unknown-URL probe, or returns the seconds until the
// blocking window frees up. A rejected request consumes no budget. On success
// the caller MUST call releaseUnknownProbe(ip) in a finally block.
function tryAcquireUnknownProbe(ip: string): { ok: true } | { ok: false; retryAfterS: number } {
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

function releaseUnknownProbe(ip: string): void {
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

function checkSubmitRateLimit(ip: string): boolean {
  return checkWindowedLimit(submitRateLimitStore, SUBMIT_RATE_LIMIT_MAX, ip)
}

function checkDiscoverRateLimit(ip: string, source: DiscoverSource): boolean {
  const max = source === 'bulk' ? DISCOVER_BULK_RATE_LIMIT_MAX : DISCOVER_AUTO_RATE_LIMIT_MAX
  return checkWindowedLimit(discoverRateLimitStoreFor(source), max, ip)
}

function checkNotifySubscribeRateLimit(pubkey: string): boolean {
  return checkWindowedLimit(notifySubscribeRateLimitStore, NOTIFY_RATE_LIMIT_MAX, pubkey)
}

function checkNotifyUnsubscribeRateLimit(pubkey: string): boolean {
  return checkWindowedLimit(notifyUnsubscribeRateLimitStore, NOTIFY_RATE_LIMIT_MAX, pubkey)
}

setInterval(() => {
  const now = Date.now()
  for (const store of [submitRateLimitStore, discoverAutoRateLimitStore, discoverBulkRateLimitStore, notifySubscribeRateLimitStore, notifyUnsubscribeRateLimitStore]) {
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) store.delete(key)
    }
  }
}, HOUR_MS)

app.use((req: Request, res: Response, next: NextFunction) => {
  if (RATE_LIMIT_EXEMPT.has(req.path)) {
    next()
    return
  }
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
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
})

// ── Routes ─────────────────────────────────────────────────────

app.get('/health', async (_req: Request, res: Response) => {
  const { lastAuditSyncAt, lastReviewsSyncAt } = await getSyncTimesFromDb()
  const lastProbeAt = getLastProbeCompletedAt()
  const audit8333 = getAuditUpstreamStatus()
  const auditCz = getAuditCzSyncStatus()
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    lastProbeAt,
    lastVantageOutageAt: getLastVantageOutageAt(),
    lastAuditSyncAt,
    lastReviewsSyncAt,
    ...audit8333,
    auditCz,
    // Additive (2026-10-20): the same facts grouped by input. usedForScore says whether the source feeds the
    // Reliability Score (docs/API.md "GET /health"); audit.8333.space is display only since methodology 2.
    sources: {
      ownProbe: { usedForScore: true, lastProbeAt },
      cashuInfo: { usedForScore: true, lastSyncAt: auditCz.lastSyncAt, status: auditCzSourceStatus(auditCz) },
      reviews: { usedForScore: false, lastSyncAt: lastReviewsSyncAt },
      audit8333: { usedForScore: false, lastSyncAt: lastAuditSyncAt, status: audit8333.auditUpstream },
    },
  })
})

// API root: a pointer for humans who open /api or /api/ (Express answers /api/ for /api too, non-strict
// routing). Counted by the normal per-IP limiter like any other read.
app.get('/api', (_req: Request, res: Response): void => {
  res.json({
    name: 'MintRadar API',
    docs: 'https://github.com/hroomnik007/MintRadar/blob/main/MintRadar/docs/API.md',
    health: '/api/v1/health',
  })
})

// Static routes here must stay in sync with LEARN_MODULES (src/constants/learnModules.ts)
// and App.tsx's route list — there is no shared workspace between frontend/backend to
// import that from, same caveat as testMints.ts/reliabilityScore.ts.
// `lastmod` (YYYY-MM-DD) only where the content has a date of its own: /methodology = the date of the newest
// METHODOLOGY_CHANGES entry (it changes with the formula); /for-wallets = FOR_WALLETS_PAGE_LASTMOD, bumped by hand
// when the page content changes.
const METHODOLOGY_LASTMOD = METHODOLOGY_CHANGES.reduce((latest, c) => (c.date > latest ? c.date : latest), '')
const FOR_WALLETS_PAGE_LASTMOD = '2026-10-21'
const SITEMAP_STATIC_PATHS: Array<{ loc: string; changefreq: string; priority: string; lastmod?: string }> = [
  { loc: '/', changefreq: 'hourly', priority: '1.0' },
  { loc: '/stats', changefreq: 'daily', priority: '0.8' },
  { loc: '/tools', changefreq: 'weekly', priority: '0.7' },
  { loc: '/wallets', changefreq: 'weekly', priority: '0.6' },
  { loc: '/learn', changefreq: 'monthly', priority: '0.6' },
  { loc: '/learn/cashu-basics', changefreq: 'monthly', priority: '0.5' },
  { loc: '/learn/understanding-the-risks', changefreq: 'monthly', priority: '0.5' },
  { loc: '/learn/how-to-choose-a-mint', changefreq: 'monthly', priority: '0.5' },
  { loc: '/learn/getting-started-with-a-wallet', changefreq: 'monthly', priority: '0.5' },
  { loc: '/learn/safe-habits', changefreq: 'monthly', priority: '0.5' },
  { loc: '/about', changefreq: 'monthly', priority: '0.5' },
  { loc: '/methodology', changefreq: 'monthly', priority: '0.6', lastmod: METHODOLOGY_LASTMOD },
  { loc: '/for-wallets', changefreq: 'monthly', priority: '0.6', lastmod: FOR_WALLETS_PAGE_LASTMOD },
]

// Dynamically includes every tracked mint's /mint/:url page (excluding test mints) —
// a static file can't, since the mint list changes as mints are discovered/removed.
// See docs/claude/deploy-and-infra.md "Deploy Pipeline Notes" — nginx routes /sitemap.xml here instead of
// serving a static frontend file, mirroring the /health proxy above.
app.get('/sitemap.xml', (_req: Request, res: Response): void => {
  pool.query('SELECT url FROM mints ORDER BY url')
    .then(result => {
      const mintUrls = (result.rows as { url: string }[])
        .map(r => r.url)
        .filter(url => !isTestMint(url))

      const urlEntry = (loc: string, changefreq: string, priority: string, lastmod?: string): string =>
        `  <url>\n    <loc>${loc}</loc>\n${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ''}    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`

      const staticXml = SITEMAP_STATIC_PATHS
        .map(p => urlEntry(`https://mintradar.org${p.loc}`, p.changefreq, p.priority, p.lastmod))
        .join('\n')
      const mintXml = mintUrls
        .map(u => urlEntry(`https://mintradar.org/mint/${encodeURIComponent(u)}`, 'daily', '0.4'))
        .join('\n')

      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${staticXml}\n${mintXml}\n</urlset>\n`
      res.set('Content-Type', 'application/xml; charset=utf-8')
      res.set('Cache-Control', 'public, max-age=3600')
      res.send(xml)
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/sitemap.xml]', err)
      res.status(500).type('text/plain').send('Failed to generate sitemap')
    })
})

app.get('/api/mint/probe', (req: Request, res: Response): void => {
  const url = req.query['url']

  if (typeof url !== 'string' || url.length === 0) {
    res.status(400).json({ error: 'Missing required query parameter: url' })
    return
  }

  if (!url.startsWith('https://')) {
    res.status(400).json({ error: 'url must start with https://' })
    return
  }

  if (url.length > MAX_URL_LENGTH) {
    res.status(400).json({ error: `url exceeds maximum length of ${MAX_URL_LENGTH} characters` })
    return
  }

  if (!isAllowedUrl(typeof url === 'string' ? url : '')) {
    res.status(403).json({ error: 'This deployment monitors a fixed mint allowlist.' })
    return
  }

  // This endpoint is unauthenticated and SSRF-guarded (safeFetch: private/
  // loopback/link-local/CGN ranges + DNS-rebinding blocked, GET to /v1/info and
  // /v1/keysets only). Reflecting the fetched body back to the caller makes it a
  // (weak) oracle for *public* https hosts. Mint Detail genuinely needs the full
  // live /v1/info for a mint the user is viewing, and the Dashboard submit form
  // needs name/version/nut-count for a mint about to be submitted — so:
  //   - known mint (already in `mints`, already probed continuously by the
  //     public cron): return the full status, nothing new leaks.
  //   - any other URL: return only the fields the submit preview renders
  //     (online, latency, and a stripped-down info: name/version/nut keys) —
  //     not the mint's full contact list / MOTD / description / raw keysets.
  //
  // The DB lookup runs first so an unknown URL can be charged to the dedicated
  // unknown-probe limiter BEFORE any outbound fetch happens.
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
  pool.query('SELECT contact_checks FROM mints WHERE url = $1', [url])
    .then(async (known) => {
      if ((known.rowCount ?? 0) > 0) {
        const status = await probeMint(url)
        // Additive, known mints only: the stored facts about the contact entries (contactChecks.ts), which Mint Detail shows
        // as one muted line under the contact information. Never a value or a domain; [] while nothing was checked.
        const contactChecks = readStoredContactChecks(known.rows[0]?.contact_checks) ?? []
        res.json(status.info ? { ...status, info: { ...status.info, name: publicMintNameOrHost(status.info.name, url) }, contactChecks } : { ...status, contactChecks })
        return
      }
      const admit = tryAcquireUnknownProbe(ip)
      if (!admit.ok) {
        res.setHeader('Retry-After', String(admit.retryAfterS))
        res.status(429).json({ error: 'Too many requests. Try again later.' })
        return
      }
      let status: Awaited<ReturnType<typeof probeMint>>
      try {
        status = await probeMint(url)
      } finally {
        releaseUnknownProbe(ip)
      }
      res.json({
        url: status.url,
        online: status.online,
        latencyMs: status.latencyMs,
        checkedAt: status.checkedAt,
        info: status.info
          ? {
              name: publicMintNameOrHost(status.info.name, url),
              version: status.info.version,
              // keys only — enough for `Object.keys(nuts).length`, none of the
              // per-NUT config an arbitrary host might stuff in here.
              nuts: Object.fromEntries(Object.keys(status.info.nuts).filter(k => isNutDeclaredSupported(status.info!.nuts[k])).map(k => [k, {}])),
            }
          : null,
        keysets: null,
        ...(status.error !== undefined ? { error: status.error } : {}),
        ...(status.errorKind !== undefined ? { errorKind: status.errorKind } : {}),
      })
    })
    .catch((err: unknown) => {
      // Our own failure (a database error), not a mint state: never answered as "offline".
      if (IS_DEV) console.error('[/api/mint/probe] unexpected error:', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

// ── Routes: mint history & known ──────────────────────────────

app.get('/api/mints/history', (req: Request, res: Response): void => {
  const url = req.query['url']

  if (typeof url !== 'string' || url.length === 0) {
    res.status(400).json({ error: 'Missing required query parameter: url' })
    return
  }

  if (!url.startsWith('https://')) {
    res.status(400).json({ error: 'url must start with https://' })
    return
  }

  if (url.length > MAX_URL_LENGTH) {
    res.status(400).json({ error: `url exceeds maximum length of ${MAX_URL_LENGTH} characters` })
    return
  }

  const periodParam = req.query['period']
  // Support legacy `days` param for backward compat
  const daysParam = req.query['days']
  let period: '24h' | '7d' | '30d' | '90d'
  if (periodParam === '7d') period = '7d'
  else if (periodParam === '30d') period = '30d'
  else if (periodParam === '90d') period = '90d'
  else if (daysParam === '7') period = '7d'
  else period = '24h'

  const PERIOD_DAYS: Record<typeof period, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }
  // Matches each branch's prevQuery window start below (24h→48h ago, 7d→14d ago, 30d→60d ago, 90d→180d ago).
  const PREV_WINDOW_START_HOURS: Record<typeof period, number> = { '24h': 48, '7d': 336, '30d': 1440, '90d': 4320 }

  Promise.resolve(isWellFormedMintUrl(url))
    .then(safe => {
      if (!safe) {
        res.status(400).json({ error: 'Invalid url' })
        return
      }

      // Each period returns N segments + prev period uptime for trend.
      // 24h → 24 hourly buckets, prev 24h for trend
      // 7d  → 7 daily buckets, prev 7d for trend
      // 30d → 30 daily buckets, prev 30d for trend
      let segmentsQuery: string
      let prevQuery: string

      if (period === '24h') {
        segmentsQuery = `
          SELECT
            (DATE_TRUNC('hour', checked_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS bucket,
            BOOL_OR(online) AS online,
            ROUND(AVG(CASE WHEN online THEN latency_ms END))::int AS latency_ms,
            COUNT(*) AS total,
            SUM(CASE WHEN online THEN 1 ELSE 0 END) AS online_count,
            ROUND(AVG(reliability_score))::int AS reliability_score
          FROM mint_history
          WHERE url = $1
            AND checked_at >= NOW() - INTERVAL '24 hours'
            AND checked_at < NOW()
          GROUP BY DATE_TRUNC('hour', checked_at AT TIME ZONE 'UTC')
          ORDER BY DATE_TRUNC('hour', checked_at AT TIME ZONE 'UTC') ASC`
        prevQuery = `
          SELECT
            SUM(CASE WHEN online THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) AS uptime_ratio,
            ROUND(AVG(CASE WHEN online THEN latency_ms END))::int AS avg_latency_ms
          FROM mint_history
          WHERE url = $1
            AND checked_at >= NOW() - INTERVAL '48 hours'
            AND checked_at < NOW() - INTERVAL '24 hours'`
      } else if (period === '7d') {
        segmentsQuery = `
          SELECT
            (DATE_TRUNC('day', checked_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS bucket,
            BOOL_OR(online) AS online,
            ROUND(AVG(CASE WHEN online THEN latency_ms END))::int AS latency_ms,
            COUNT(*) AS total,
            SUM(CASE WHEN online THEN 1 ELSE 0 END) AS online_count,
            ROUND(AVG(reliability_score))::int AS reliability_score
          FROM mint_history
          WHERE url = $1
            AND checked_at >= NOW() - INTERVAL '7 days'
            AND checked_at < NOW()
          GROUP BY DATE_TRUNC('day', checked_at AT TIME ZONE 'UTC')
          ORDER BY DATE_TRUNC('day', checked_at AT TIME ZONE 'UTC') ASC`
        prevQuery = `
          SELECT
            SUM(CASE WHEN online THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) AS uptime_ratio,
            ROUND(AVG(CASE WHEN online THEN latency_ms END))::int AS avg_latency_ms
          FROM mint_history
          WHERE url = $1
            AND checked_at >= NOW() - INTERVAL '14 days'
            AND checked_at < NOW() - INTERVAL '7 days'`
      } else if (period === '30d') {
        segmentsQuery = `
          SELECT
            (DATE_TRUNC('day', checked_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS bucket,
            BOOL_OR(online) AS online,
            ROUND(AVG(CASE WHEN online THEN latency_ms END))::int AS latency_ms,
            COUNT(*) AS total,
            SUM(CASE WHEN online THEN 1 ELSE 0 END) AS online_count,
            ROUND(AVG(reliability_score))::int AS reliability_score
          FROM mint_history
          WHERE url = $1
            AND checked_at >= NOW() - INTERVAL '30 days'
            AND checked_at < NOW()
          GROUP BY DATE_TRUNC('day', checked_at AT TIME ZONE 'UTC')
          ORDER BY DATE_TRUNC('day', checked_at AT TIME ZONE 'UTC') ASC`
        prevQuery = `
          SELECT
            SUM(CASE WHEN online THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) AS uptime_ratio,
            ROUND(AVG(CASE WHEN online THEN latency_ms END))::int AS avg_latency_ms
          FROM mint_history
          WHERE url = $1
            AND checked_at >= NOW() - INTERVAL '60 days'
            AND checked_at < NOW() - INTERVAL '30 days'`
      } else {
        // 90d — weekly buckets
        segmentsQuery = `
          SELECT
            (DATE_TRUNC('week', checked_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS bucket,
            BOOL_OR(online) AS online,
            ROUND(AVG(CASE WHEN online THEN latency_ms END))::int AS latency_ms,
            COUNT(*) AS total,
            SUM(CASE WHEN online THEN 1 ELSE 0 END) AS online_count,
            ROUND(AVG(reliability_score))::int AS reliability_score
          FROM mint_history
          WHERE url = $1
            AND checked_at >= NOW() - INTERVAL '90 days'
            AND checked_at < NOW()
          GROUP BY DATE_TRUNC('week', checked_at AT TIME ZONE 'UTC')
          ORDER BY DATE_TRUNC('week', checked_at AT TIME ZONE 'UTC') ASC`
        prevQuery = `
          SELECT
            SUM(CASE WHEN online THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) AS uptime_ratio,
            ROUND(AVG(CASE WHEN online THEN latency_ms END))::int AS avg_latency_ms
          FROM mint_history
          WHERE url = $1
            AND checked_at >= NOW() - INTERVAL '180 days'
            AND checked_at < NOW() - INTERVAL '90 days'`
      }

      return Promise.all([
        pool.query(segmentsQuery, [url]),
        pool.query(prevQuery, [url]),
        pool.query('SELECT MIN(checked_at) AS earliest FROM mint_history WHERE url = $1', [url]),
      ]).then(([segResult, prevResult, earliestResult]) => {
        const segments = segResult.rows.map(r => ({
          bucket: (r.bucket as Date).toISOString(),
          online: r.online as boolean,
          latencyMs: r.latency_ms as number | null,
          total: Number(r.total),
          onlineCount: Number(r.online_count),
          uptimePct: Number(r.total) === 0 ? null
            : Math.round(Number(r.online_count) / Number(r.total) * 100),
          reliabilityScore: r.reliability_score != null ? Number(r.reliability_score) : null,
        }))
        const prevRow = prevResult.rows[0]
        const prevUptimePct = prevRow?.uptime_ratio != null
          ? Math.round(Number(prevRow.uptime_ratio) * 100)
          : null
        const prevAvgLatencyMs = prevRow?.avg_latency_ms != null
          ? Number(prevRow.avg_latency_ms)
          : null

        const earliestRaw = earliestResult.rows[0]?.earliest as Date | null
        const earliestCheckedAt = earliestRaw ? earliestRaw.toISOString() : null
        const periodDays = PERIOD_DAYS[period]
        const daysOfDataAvailable = earliestRaw
          ? Math.min(periodDays, Math.max(0, Math.floor((Date.now() - earliestRaw.getTime()) / 86_400_000)))
          : 0
        const prevPeriodInsufficientHistory = earliestRaw === null
          || earliestRaw.getTime() > (Date.now() - PREV_WINDOW_START_HOURS[period] * 3_600_000)

        // Compute overall stats for the period
        const totalChecks = segments.reduce((s, r) => s + r.total, 0)
        const totalOnline = segments.reduce((s, r) => s + r.onlineCount, 0)
        const uptimePct = totalChecks === 0 ? null : Math.round(totalOnline / totalChecks * 100)
        const latencies = segments.filter(r => r.latencyMs !== null).map(r => r.latencyMs as number)
        const avgLatencyMs = latencies.length === 0 ? null
          : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)

        res.json({
          url,
          period,
          segments,
          uptimePct,
          avgLatencyMs,
          prevUptimePct,
          prevAvgLatencyMs,
          earliestCheckedAt,
          daysOfDataAvailable,
          periodDays,
          prevPeriodInsufficientHistory,
          // Legacy field for backward compat
          history: segResult.rows.map(r => ({
            online: r.online as boolean,
            latencyMs: r.latency_ms as number | null,
            checkedAt: (r.bucket as Date).toISOString(),
          })),
        })
      })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mints/history]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

app.get('/api/mints/version-history', (req: Request, res: Response): void => {
  const url = req.query['url']

  if (typeof url !== 'string' || url.length === 0) {
    res.status(400).json({ error: 'Missing required query parameter: url' })
    return
  }

  if (!url.startsWith('https://')) {
    res.status(400).json({ error: 'url must start with https://' })
    return
  }

  if (url.length > MAX_URL_LENGTH) {
    res.status(400).json({ error: `url exceeds maximum length of ${MAX_URL_LENGTH} characters` })
    return
  }

  Promise.resolve(isWellFormedMintUrl(url))
    .then(safe => {
      if (!safe) {
        res.status(400).json({ error: 'Invalid url' })
        return
      }
      // latestGlobalVersion must be scoped to THIS mint's own software family —
      // comparing a cdk-mintd mint's version against, say, Nutshell's highest
      // known version (previously a plain `SELECT DISTINCT version FROM
      // mint_version_history` + versionGt() across every software in the DB)
      // is meaningless, since the two projects have independent numbering.
      // The GitHub-backed software_versions cache (versionCatalog.ts, also
      // the source for the Reliability Score's version component) is used here
      // instead of scanning mint_version_history for the network-wide max:
      // it reflects the real current upstream release rather than "the
      // highest version any tracked mint happens to have already adopted"
      // (which can only ever lag behind, understating how outdated a mint
      // really is), and it comes with the same 14-day grace period already
      // applied — so this badge and the Reliability Score version component never
      // disagree about what counts as "latest" for a given software.
      return Promise.all([
        pool.query(
          `SELECT version, first_seen_at FROM mint_version_history
           WHERE url = $1 ORDER BY first_seen_at DESC LIMIT 50`,
          [url]
        ),
        pool.query<{ version: string | null }>('SELECT version FROM mints WHERE url = $1', [url]),
        getLatestVersionsMap(),
      ]).then(([result, mintResult, latestVersions]) => {
        const mintVersion = mintResult.rows[0]?.version ?? null
        const canonical = mintVersion != null ? canonicalSoftwareName(splitVersionString(mintVersion).software) : null
        const latest = canonical != null ? latestVersions[canonical] : undefined
        const latestGlobalVersion = latest ? `${canonical}/${latest.major}.${latest.minor}` : null
        res.json({
          url,
          history: result.rows.map(r => ({
            version: r.version as string,
            firstSeenAt: (r.first_seen_at as Date).toISOString(),
          })),
          latestGlobalVersion,
        })
      })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mints/version-history]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})


app.get('/api/mints/outages', (req: Request, res: Response): void => {
  const url = req.query['url']
  const daysParam = req.query['days']
  const days = typeof daysParam === 'string' && /^\d+$/.test(daysParam)
    ? Math.min(90, Math.max(1, parseInt(daysParam, 10)))
    : 30

  if (typeof url !== 'string' || url.length === 0) {
    res.status(400).json({ error: 'Missing required query parameter: url' })
    return
  }
  if (!url.startsWith('https://')) {
    res.status(400).json({ error: 'url must start with https://' })
    return
  }
  if (url.length > MAX_URL_LENGTH) {
    res.status(400).json({ error: `url exceeds maximum length of ${MAX_URL_LENGTH} characters` })
    return
  }

  Promise.resolve(isWellFormedMintUrl(url))
    .then(safe => {
      if (!safe) {
        res.status(400).json({ error: 'Invalid url' })
        return
      }

      // Consecutive offline blocks (min 2 checks) in the window.
      // A single failed probe is ignored to avoid flaky noise.
      return pool.query(
        `SELECT online, checked_at
         FROM mint_history
         WHERE url = $1
           AND checked_at >= NOW() - ($2 || ' days')::interval
         ORDER BY checked_at ASC`,
        [url, days]
      ).then(result => {
        const rows = result.rows as { online: boolean; checked_at: Date }[]
        const outages: { startedAt: string; durationMs: number; error: string }[] = []
        let blockStart: Date | null = null
        let blockCount = 0

        for (const row of rows) {
          if (!row.online) {
            if (blockStart === null) blockStart = row.checked_at
            blockCount++
          } else if (blockStart !== null) {
            if (blockCount >= 2) {
              const durationMs = row.checked_at.getTime() - blockStart.getTime()
              outages.push({
                startedAt: blockStart.toISOString(),
                durationMs,
                error: 'offline',
              })
            }
            blockStart = null
            blockCount = 0
          }
        }
        // Open block at the end of the window
        if (blockStart !== null && blockCount >= 2) {
          const last = rows[rows.length - 1]!
          const durationMs = last.checked_at.getTime() - blockStart.getTime()
          outages.push({
            startedAt: blockStart.toISOString(),
            durationMs,
            error: 'offline',
          })
        }

        const lastOutage = outages[outages.length - 1]
        const sinceLastOutageMs = lastOutage
          ? Date.now() - new Date(lastOutage.startedAt).getTime() - lastOutage.durationMs
          : null
        const avgRecoveryMs = outages.length > 0
          ? Math.round(outages.reduce((s, o) => s + o.durationMs, 0) / outages.length)
          : null

        res.json({
          sinceLastOutageMs,
          avgRecoveryMs,
          outageCount: outages.length,
          outages: outages.slice(-20),
        })
      })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mints/outages]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})


// Built on the same snapshot and the same filter function as the wallet API (walletApi.ts): only online, scored,
// non-test, non-archived mints that were first seen at least 14 days ago (eligibleForRecommendation). The shape is
// the one from 2026-10-10 plus `methodology`; `generatedAt` is the time of the snapshot (so the ETag stays stable).
app.get('/api/mints/recommend', (req: Request, res: Response): void => {
  // Deprecated 2026-10-20 in favour of GET /api/v1/wallets/mints?eligible=true (docs/API.md "Stability"). The body and
  // the behaviour are unchanged. /api/v1/mints/recommend and the unversioned alias are this one route.
  setDeprecationHeaders(res, RECOMMEND_DEPRECATION)
  const unit = typeof req.query['unit'] === 'string' ? req.query['unit'] : 'sat'
  const minScore = typeof req.query['minScore'] === 'string' && /^\d+$/.test(req.query['minScore'])
    ? Math.min(100, Math.max(0, parseInt(req.query['minScore'], 10)))
    : 80
  const limit = typeof req.query['limit'] === 'string' && /^\d+$/.test(req.query['limit'])
    ? Math.min(10, Math.max(1, parseInt(req.query['limit'], 10)))
    : 5
  const nutsParam = typeof req.query['nuts'] === 'string' ? req.query['nuts'] : ''
  const requiredNuts = nutsParam.split(',').map(n => n.trim()).filter(Boolean)

  loadKnownMints()
    .then(snap => sendCachedBody(res, memoizedBody(snap, `recommend|${JSON.stringify([unit, minScore, limit, requiredNuts])}`,
      () => recommendEnvelope(snap, { unit, minScore, limit, requiredNuts }))))
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mints/recommend]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

app.get('/api/nuts', (_req: Request, res: Response): void => {
  pool.query(`
    SELECT m.url, m.name, m.nuts_limits
    FROM mints m
    JOIN LATERAL (
      SELECT online FROM mint_history
      WHERE url = m.url ORDER BY checked_at DESC, id DESC LIMIT 1
    ) latest ON true
    WHERE latest.online = true AND m.nuts_limits IS NOT NULL
  `)
    .then(result => {
      type Row = { url: string; name: string | null; nuts_limits: Record<string, unknown> }
      const rows = result.rows as Row[]
      const total = rows.length
      const nuts = TRACKED_NUT_KEYS.map(key => ({
        nut: `NUT-${key.padStart(2, '0')}`,
        percent: total > 0
          ? Math.round(rows.filter(r => isNutDeclaredSupported(r.nuts_limits[key])).length / total * 100)
          : 0,
        mints: rows.filter(r => isNutDeclaredSupported(r.nuts_limits[key])).map(r => r.url),
      }))
      res.json(nuts)
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/nuts]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

app.get('/api/stats', (_req: Request, res: Response): void => {
  if (statsCache && Date.now() < statsCache.expiresAt) {
    sendCachedBody(res, cachedBodyOf(statsCache.data), Math.floor(STATS_CACHE_TTL / 1000))
    return
  }
  Promise.all([
    pool.query(`
      SELECT m.url, m.name, m.last_reliability_score, m.nuts_limits, m.discovered_at,
        latest.online AS online, latest.latency_ms
      FROM mints m
      LEFT JOIN LATERAL (
        SELECT online, latency_ms FROM mint_history
        WHERE url = m.url ORDER BY checked_at DESC, id DESC LIMIT 1
      ) latest ON true
    `),
    pool.query(`
      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)::int AS avg_latency
      FROM mint_history
      WHERE online = true
        AND checked_at > NOW() - INTERVAL '24 hours'
        AND latency_ms IS NOT NULL
        AND latency_ms > 0
        AND latency_ms < 10000
    `),
  ])
    .then(([mintsResult, latencyResult]) => {
      type MintRow = { url: string; name: string | null; last_reliability_score: number | null; nuts_limits: Record<string, unknown> | null; discovered_at: string | Date | null; online: boolean | null; latency_ms: number | null }
      const rows = mintsResult.rows as MintRow[]
      const online = rows.filter(r => r.online === true)
      const offline = rows.filter(r => r.online === false)
      const onlineReliabilityScores = online.map(r => r.last_reliability_score ?? 0)
      const avgReliabilityScore = onlineReliabilityScores.length > 0
        ? Math.round(onlineReliabilityScores.reduce((a, b) => a + b) / onlineReliabilityScores.length)
        : null
      const avgLatency24h = latencyResult.rows[0]?.avg_latency as number | null ?? null
      const low = onlineReliabilityScores.filter(s => s < 40).length
      const moderate = onlineReliabilityScores.filter(s => s >= 40 && s < 70).length
      const high = onlineReliabilityScores.filter(s => s >= 70).length
      // MINT_ADVERTISED_NUT_KEYS, not TRACKED_NUT_KEYS — Stats.tsx's NUT
      // Coverage panel only ever iterates the frontend's TRACKED_NUTS (14) so
      // extra entries here are simply ignored there, but the Network Health
      // Index's "advanced adoption" component also reads this array directly
      // for a few auth/payment-method NUTs (21/22/25) outside the 14.
      const onlineWithNuts = online.filter(r => r.nuts_limits != null)
      const totalForAdoption = onlineWithNuts.length
      const nutAdoption = MINT_ADVERTISED_NUT_KEYS.map(key => ({
        nut: `NUT-${key.padStart(2, '0')}`,
        count: onlineWithNuts.filter(r => r.nuts_limits && isNutDeclaredSupported(r.nuts_limits[key])).length,
        percent: totalForAdoption > 0
          ? Math.round(onlineWithNuts.filter(r => r.nuts_limits && isNutDeclaredSupported(r.nuts_limits[key])).length / totalForAdoption * 100)
          : 0,
      }))
      const top5 = [...rows]
        .filter(r => r.last_reliability_score != null)
        // Known dev/test-only mints are excluded from this "best of" list —
        // still fully visible/probed elsewhere, just not proactively recommended.
        .filter(r => !isTestMint(r.url as string))
        // Minimum observation window before a mint can be recommended — see
        // isEligibleForRecommendation (2026-09-19 audit run-3 MEDIUM finding).
        // Additive to NEW_MINT_RELIABILITY_CAP (score-side discount); this is the
        // ranking-eligibility side.
        .filter(r => isEligibleForRecommendation(r.discovered_at))
        .sort((a, b) => (b.last_reliability_score as number) - (a.last_reliability_score as number))
        .slice(0, 5)
        .map(r => ({ url: r.url, name: publicMintName(r.name, r.url).name, reliabilityScore: r.last_reliability_score as number }))
      const data = { totalMints: rows.length, onlineMints: online.length, offlineMints: offline.length, avgReliabilityScore, avgLatency24h, reliabilityDistribution: { low, moderate, high }, nutAdoption, top5ByReliabilityScore: top5 }
      statsCache = { data, expiresAt: Date.now() + STATS_CACHE_TTL }
      sendCachedBody(res, cachedBodyOf(data), Math.floor(STATS_CACHE_TTL / 1000))
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/stats]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

async function computeReliabilityTrend(days: number): Promise<object> {
  const [result, earliestResult] = await Promise.all([
    pool.query(
      `SELECT
         (DATE_TRUNC('day', checked_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::date AS date,
         ROUND(AVG(reliability_score))::int AS avg_reliability
       FROM mint_history
       WHERE reliability_score IS NOT NULL
         AND online = true
         AND checked_at > NOW() - INTERVAL '1 day' * $1
       GROUP BY DATE_TRUNC('day', checked_at AT TIME ZONE 'UTC')
       ORDER BY 1 ASC`,
      [days]
    ),
    // Network-wide oldest probe, unbounded — used to tell the frontend when
    // the selected window (e.g. 90d) exceeds what's actually been collected.
    pool.query('SELECT MIN(checked_at) AS earliest FROM mint_history'),
  ])
  const earliestRaw = earliestResult.rows[0]?.earliest as Date | null
  const earliestCheckedAt = earliestRaw ? earliestRaw.toISOString() : null
  const daysOfDataAvailable = earliestRaw
    ? Math.min(days, Math.max(0, Math.floor((Date.now() - earliestRaw.getTime()) / 86_400_000)))
    : 0
  return {
    trend: result.rows.map(r => ({
      date: (r.date as Date).toISOString().slice(0, 10),
      avgReliability: r.avg_reliability as number,
    })),
    periodDays: days,
    earliestCheckedAt,
    daysOfDataAvailable,
  }
}

// One query pair per period at a time: concurrent callers (and the background refresh) share the same promise.
function loadReliabilityTrend(days: number): Promise<object> {
  const running = reliabilityTrendInFlight.get(days)
  if (running) return running
  const started = computeReliabilityTrend(days)
    .then(data => {
      reliabilityTrendCache.set(days, { data, expiresAt: Date.now() + RELIABILITY_TREND_CACHE_TTL })
      return data
    })
    .finally(() => { reliabilityTrendInFlight.delete(days) })
  reliabilityTrendInFlight.set(days, started)
  return started
}

// Warms both periods; a failure is only logged (the route then computes on demand and answers 500 itself on an error).
function refreshReliabilityTrendCache(): void {
  for (const days of [30, 90]) {
    loadReliabilityTrend(days).catch((err: unknown) => {
      if (IS_DEV) console.error('[reliability-trend warm-up]', err)
    })
  }
}

app.get('/api/stats/reliability-trend', (req: Request, res: Response): void => {
  const daysParam = parseInt(String(req.query['days'] ?? '30'), 10)
  const days = [30, 90].includes(daysParam) ? daysParam : 30

  const cached = reliabilityTrendCache.get(days)
  if (cached && Date.now() < cached.expiresAt) {
    sendCachedBody(res, cachedBodyOf(cached.data), Math.floor(RELIABILITY_TREND_CACHE_TTL / 1000))
    return
  }

  loadReliabilityTrend(days)
    .then(data => {
      sendCachedBody(res, cachedBodyOf(data), Math.floor(RELIABILITY_TREND_CACHE_TTL / 1000))
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/stats/reliability-trend]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

// Reliability Score risers/fallers over the last 7 or 30 days. Reads entirely from
// `mints`: last_reliability_score is the "latest" snapshot (written by every probe),
// and reliability_score_{7,30}d_ago are the point-in-time snapshots rolled up by
// refreshReliabilityMoversRollup() (reliabilityMoversRollup.ts) on the probe cron — this
// used to be two DISTINCT ON passes over all of mint_history (~2.5s cold) run
// on every cache miss. A mint with no old-enough scored history has a NULL
// snapshot and is filtered out here (same effect as the old INNER JOIN). The
// +/-3 threshold and top-3 ranking live in reliabilityMovers.ts (computeReliabilityMovers),
// unit-tested independently of this query.
app.get('/api/stats/reliability-movers', (req: Request, res: Response): void => {
  const period: '7d' | '30d' = req.query['period'] === '30d' ? '30d' : '7d'
  const days = period === '30d' ? 30 : 7

  const cached = reliabilityMoversCache.get(period)
  if (cached && Date.now() < cached.expiresAt) {
    sendCachedBody(res, cachedBodyOf(cached.data), Math.floor(RELIABILITY_MOVERS_CACHE_TTL / 1000))
    return
  }

  pool.query(
    `SELECT url, name,
       last_reliability_score AS latest_score,
       CASE WHEN $1 = 30 THEN reliability_score_30d_ago ELSE reliability_score_7d_ago END AS old_score
     FROM mints
     WHERE last_reliability_score IS NOT NULL
       AND CASE WHEN $1 = 30 THEN reliability_score_30d_ago ELSE reliability_score_7d_ago END IS NOT NULL`,
    [days]
  )
    .then(result => {
      const snapshots: MintScoreSnapshot[] = result.rows.map(r => ({
        url: r.url as string,
        name: publicMintName(r.name as string | null, r.url as string).name,
        latestScore: Number(r.latest_score),
        oldScore: Number(r.old_score),
      }))
      const data = { period, ...computeReliabilityMovers(snapshots) }
      reliabilityMoversCache.set(period, { data, expiresAt: Date.now() + RELIABILITY_MOVERS_CACHE_TTL })
      sendCachedBody(res, cachedBodyOf(data), Math.floor(RELIABILITY_MOVERS_CACHE_TTL / 1000))
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/stats/reliability-movers]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

// "latest" { major, minor } of a mint's own software family from the latest-versions map (null when the
// software is not recognised or the family has no latest). Sent as `softwareLatest` on /api/mints/known.
function latestOfFamily(version: string | null, latestVersions: LatestVersions): { major: number; minor: number } | null {
  if (!version) return null
  const family = canonicalSoftwareName(splitVersionString(version).software)
  return family ? latestVersions[family] ?? null : null
}

// The /api/mints/known rows: ONE database read (plus the cached software-version map) per KNOWN_MINTS_CACHE_TTL for
// every caller (this route, the wallet API, /api/mints/recommend); callers during a read join it.
function loadKnownMints(): Promise<Snapshot> {
  if (knownMintsCache && Date.now() < knownMintsCache.expiresAt) return Promise.resolve(knownMintsCache)
  if (knownMintsInflight) return knownMintsInflight
  const p: Promise<Snapshot> = computeKnownMints().finally(() => { if (knownMintsInflight === p) knownMintsInflight = null })
  knownMintsInflight = p
  return p
}

function computeKnownMints(): Promise<Snapshot> {
  return Promise.all([
    pool
    .query(`
      SELECT m.url, m.name, m.icon_url, m.version, m.nut_count,
        m.tos_url, m.description_long, m.nuts_limits,
        m.units, m.mint_methods, m.melt_methods, m.pubkey,
        m.audit_n_mints, m.audit_n_melts, m.audit_n_errors, m.audit_checked_at,
        m.audit_synced_at, m.audit_recent_total, m.audit_recent_errors, m.audit_avg_time_ms,
        m.audit_cz_total, m.audit_cz_blamed, m.audit_cz_fetched_at,
        m.discovered_at, m.nostr_announced_at, m.nostr_announce_id, m.nostr_announce_pubkey, m.nostr_announce_d, m.last_reliability_score, m.last_error, m.server_location, m.ip_address, m.net_asn, m.net_org, m.net_country, m.has_onion,
        m.review_count, m.review_avg_rating, m.review_operator_count, m.review_rated_count, m.review_count_7d_ago, m.review_count_7d_ago_at,
        m.contact_nostr, m.contact_checks,
        -- Only while the rollup is missing (review_rated_count IS NULL: before the first recount after a deploy or
        -- a failed one): the stored reviews, so the wallet API can count them at read time instead of showing 0.
        CASE WHEN m.review_rated_count IS NULL THEN
          (SELECT json_agg(json_build_object('pubkey', r.pubkey, 'rating', r.rating, 'comment', r.comment))
             FROM mint_reviews r WHERE r.url = m.url)
        END AS stored_reviews,
        -- Wallet API only (never in /api/mints/known): the breakdown stored with the score, the start of the current
        -- offline streak (first failed probe after the last successful one) and the keysets of the latest keysets check.
        m.score_breakdown, m.keysets_checked_at,
        CASE WHEN latest.online = false THEN
          (SELECT MIN(d.checked_at) FROM mint_history d
            WHERE d.url = m.url AND d.online = false AND d.checked_at > COALESCE(m.last_online_at, '-infinity'::timestamptz))
        END AS down_since,
        (SELECT json_agg(json_build_object('id', k.keyset_id, 'unit', k.unit, 'active', k.active, 'fee', k.input_fee_ppk,
                  'expiry', to_char(k.final_expiry AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  'version', k.id_version, 'valid', k.id_valid) ORDER BY k.keyset_id)
           FROM mint_keysets k
          WHERE k.url = m.url AND m.keysets_checked_at IS NOT NULL AND k.last_seen_at >= m.keysets_checked_at - INTERVAL '10 minutes'
        ) AS keysets_json,
        -- Wallet API only: cashu.info's 7-day swaps per direction, read from the stored detail (auditCzDetail.ts); the row of the
        -- mint itself, else the one of an alias cashu.info lists for it (the mapping the detail job writes the score inputs with).
        (SELECT json_build_object('asSource', d.detail #> '{swaps7d,asSource}', 'asDest', d.detail #> '{swaps7d,asDest}', 'fetchedAt', d.fetched_at)
           FROM audit_cz_detail d
          WHERE d.url = rtrim(m.url, '/')
             OR d.url IN (SELECT a.mint_url FROM audit_cz_aliases a WHERE a.alias_url = rtrim(m.url, '/'))
          ORDER BY (d.url = rtrim(m.url, '/')) DESC, d.fetched_at DESC LIMIT 1
        ) AS audit_directions_json,
        -- Wallet API only: the newest confirmed changes of the mint (mintChanges.ts), same read as everything else.
        (SELECT json_agg(json_build_object('type', c.change_type, 'field', c.field, 'old', c.old_value, 'new', c.new_value,
                  'observed', to_char(c.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                  'first', to_char(c.first_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY c.observed_at DESC, c.id DESC)
           FROM (SELECT * FROM mint_changes WHERE url = m.url ORDER BY observed_at DESC, id DESC LIMIT ${WALLET_CHANGES_PER_MINT}) c
        ) AS changes_json,
        COUNT(h.online) AS total,
        COALESCE(SUM(CASE WHEN h.online THEN 1 ELSE 0 END), 0) AS online_count,
        h7.total_7d,
        h7.online_count_7d,
        latest.online AS latest_online,
        latest.latency_ms AS latest_latency_ms,
        latest.checked_at AS latest_checked_at,
        m.last_online_at
      FROM mints m
      LEFT JOIN mint_history h ON h.url = m.url AND h.checked_at > NOW() - INTERVAL '24 hours'
      LEFT JOIN (
        SELECT url, COUNT(*) AS total_7d,
          COALESCE(SUM(CASE WHEN online THEN 1 ELSE 0 END), 0) AS online_count_7d
        FROM mint_history
        WHERE checked_at > NOW() - INTERVAL '7 days'
        GROUP BY url
      ) h7 ON h7.url = m.url
      LEFT JOIN LATERAL (
        SELECT online, latency_ms, checked_at FROM mint_history
        WHERE url = m.url ORDER BY checked_at DESC, id DESC LIMIT 1
      ) latest ON true
      GROUP BY m.url, m.name, m.icon_url, m.version, m.nut_count,
        m.tos_url, m.description_long, m.nuts_limits,
        m.units, m.mint_methods, m.melt_methods, m.pubkey,
        m.audit_n_mints, m.audit_n_melts, m.audit_n_errors, m.audit_checked_at,
        m.audit_synced_at, m.audit_recent_total, m.audit_recent_errors, m.audit_avg_time_ms,
        m.audit_cz_total, m.audit_cz_blamed, m.audit_cz_fetched_at,
        m.discovered_at, m.last_reliability_score, m.last_error, m.server_location, m.ip_address, m.net_asn, m.net_org, m.net_country, m.has_onion,
        m.review_count, m.review_avg_rating, m.review_count_7d_ago, m.review_count_7d_ago_at,
        h7.total_7d, h7.online_count_7d,
        latest.online, latest.latency_ms, latest.checked_at
    `),
    // The ONE "latest" per software family (versionCatalog.ts), sent with every mint so the labels and the
    // breakdown on the frontend are measured against exactly what the stored score used.
    getLatestVersionsMap(),
  ])
    .then(([result, latestVersions]) => {
      // C for the IMDB-style weighted Rating sort (see below) — computed from
      // the raw rollup columns before the row map so each mint's WR can be set
      // inline in the literal.
      const globalMean = globalMeanRating(
        result.rows.map(r => ({
          reviewCount: (r.review_count as number | null) ?? null,
          reviewAvgRating: r.review_avg_rating != null ? Number(r.review_avg_rating) : null,
        })),
      )
      const data = result.rows.map(r => {
        const total = Number(r.total)
        const onlineCount = Number(r.online_count)
        const total7d = Number(r.total_7d ?? 0)
        const onlineCount7d = Number(r.online_count_7d ?? 0)
        const latestOnline = r.latest_online as boolean | null
        const latestCheckedAt = r.latest_checked_at as string | null
        return {
          url: r.url as string,
          // Display name (cleaned; hidden-list mints show their hostname): see mintNames.ts.
          // nameFull = the full cleaned name, only when `name` was truncated/emoji-capped.
          ...knownMintNameFields(r.name as string | null, r.url as string),
          iconUrl: (r.icon_url as string | null) ?? null,
          degraded: computeDegraded(total, onlineCount, latestOnline, latestCheckedAt),
          lastOnlineAt: (r.last_online_at as Date | string | null)
            ? new Date(r.last_online_at as Date | string).toISOString()
            : null,
          archived: (() => {
            const lo = r.last_online_at as Date | string | null
            if (!lo || r.latest_online === true) return false
            return Date.now() - new Date(lo).getTime() > 30 * 86_400_000
          })(),
          online: r.latest_online as boolean | null,
          latencyMs: r.latest_latency_ms as number | null,
          version: r.version as string | null,
          // Latest { major, minor } of THIS mint's software family (null for unknown software).
          softwareLatest: latestOfFamily(r.version as string | null, latestVersions),
          nutCount: r.nut_count as number | null,
          tosUrl: (r.tos_url as string | null) ?? null,
          descriptionLong: (r.description_long as string | null) ?? null,
          nutsLimits: (r.nuts_limits as Record<string, unknown> | null) ?? null,
          units: (r.units as string[] | null) ?? null,
          mintMethods: (r.mint_methods as Record<string, unknown>[] | null) ?? null,
          meltMethods: (r.melt_methods as Record<string, unknown>[] | null) ?? null,
          // NUT-06 mint identity pubkey — see mintPubkey.ts. Not on every
          // mint yet (populated by the probe cycle); used to suggest alias
          // hints at submit time, never to merge cards.
          pubkey: (r.pubkey as string | null) ?? null,
          auditNMints: (r.audit_n_mints as number | null) ?? null,
          auditNMelts: (r.audit_n_melts as number | null) ?? null,
          auditNErrors: (r.audit_n_errors as number | null) ?? null,
          auditCheckedAt: (r.audit_checked_at as string | null) ?? null,
          auditSyncedAt: (r.audit_synced_at as string | null) ?? null,
          auditRecentTotal: (r.audit_recent_total as number | null) ?? null,
          auditRecentErrors: (r.audit_recent_errors as number | null) ?? null,
          // cashu.info 7-day window feeding the audit part of the Reliability Score (shared/auditScore.ts):
          // swaps whose failure is attributed to the mint, all swaps, and when the stored detail was fetched.
          auditCzBlamed: (r.audit_cz_blamed as number | null) ?? null,
          auditCzTotal: (r.audit_cz_total as number | null) ?? null,
          auditCzFetchedAt: r.audit_cz_fetched_at ? new Date(r.audit_cz_fetched_at as string | Date).toISOString() : null,
          // Mean time_taken (ms) over the OK swaps in the same rolling window
          // as auditRecentTotal/Errors — see mint_audit_swaps / computeSwapStats()
          // in discovery.ts. Null when the window has no OK swap with a known time.
          auditAvgTimeMs: r.audit_avg_time_ms != null ? Number(r.audit_avg_time_ms) : null,
          discoveredAt: (r.discovered_at as string | null) ?? null,
          nostrAnnouncedAt: (r.nostr_announced_at as string | null) ?? null,
          nostrAnnounceId: (r.nostr_announce_id as string | null) ?? null,
          nostrAnnouncePubkey: (r.nostr_announce_pubkey as string | null) ?? null,
          nostrAnnounceD: (r.nostr_announce_d as string | null) ?? null,
          reliabilityScore: (r.last_reliability_score as number | null) ?? null,
          lastError: (r.last_error as string | null) ?? null,
          uptimePct24h: total === 0 ? null : Math.round(onlineCount / total * 100),
          // Same computation as uptimePct24h, over a 7-day window — feeds the
          // Stats "Most Reliable" panel (see docs/claude/discovery-and-relays.md), which switched to a
          // 7d default because most of the network sits at 100% on a 24h
          // window and can't be meaningfully ranked. uptimePct24h itself is
          // unchanged and still used everywhere else (mint cards, avg-uptime
          // hero tile, degraded detection).
          uptimePct7d: total7d === 0 ? null : Math.round(onlineCount7d / total7d * 100),
          serverLocation: (r.server_location as string | null) ?? null,
          ipAddress: (r.ip_address as string | null) ?? null,
          netAsn: (r.net_asn as number | null) ?? null,
          netOrg: (r.net_org as string | null) ?? null,
          netCountry: (r.net_country as string | null) ?? null,
          hasOnion: (r.has_onion as boolean | null) ?? null,
          lastCheckedAt: (r.latest_checked_at as string | null) ?? null,
          // Additive, only for a mint that is not online (Mint Detail's "unavailable" block): the start of the
          // current offline streak and the keysets of the last successful keysets check. Online mints get null/[].
          ...(r.latest_online === true
            ? { offlineSince: null, lastKeysets: [], lastKeysetsCheckedAt: null }
            : {
                offlineSince: r.down_since ? new Date(r.down_since as string | Date).toISOString() : null,
                lastKeysets: keysetsOf(r.keysets_json),
                lastKeysetsCheckedAt: r.keysets_checked_at ? new Date(r.keysets_checked_at as string | Date).toISOString() : null,
              }),
          reviewCount: (r.review_count as number | null) ?? null,
          reviewAvgRating: r.review_avg_rating != null ? Number(r.review_avg_rating) : null,
          // Additive: stored reviews written by the mint's own operator. They are NOT in
          // reviewCount / reviewAvgRating / reviewWeightedRating / reviewSurge (see reviewsSync.ts).
          operatorReviewCount: (r.review_operator_count as number | null) ?? 0,
          // Additive: how many of reviewCount carry a rating (the n behind reviewAvgRating); null until the
          // startup recount / next review sync. The frontend Rating sort uses it (src/utils/bayesianRating.ts).
          reviewRatedCount: (r.review_rated_count as number | null) ?? null,
          // Forgery-resistant sybil signal: the mint's review_count jumped
          // sharply vs. the daily rollup's ~1-week-ago snapshot. Informational
          // only — never feeds Reliability Score or reviewWeightedRating.
          reviewSurge: hasRecentReviewSurge({
            reviewCount: (r.review_count as number | null) ?? null,
            reviewCount7dAgo: (r.review_count_7d_ago as number | null) ?? null,
            reviewCount7dAgoAt: (r.review_count_7d_ago_at as string | null) ?? null,
          }),
          // IMDB-style weighted rating — used ONLY to order the Rating sort,
          // never displayed (the card badge keeps showing reviewAvgRating /
          // reviewCount). Kept out of reviewsSync's per-mint rollup because C is
          // a global mean over all mints; this endpoint already loads them all.
          reviewWeightedRating: weightedRating(
            (r.review_count as number | null) ?? null,
            r.review_avg_rating != null ? Number(r.review_avg_rating) : null,
            globalMean,
          ),
        }
      })
      // Read-time fallback for the wallet API (never part of /api/mints/known): the review aggregate of the stored
      // reviews of every mint whose review_rated_count is still NULL, by the same rule as the rollup.
      const reviewFallback = new Map<string, ReviewAggregate>()
      for (const r of result.rows as Array<{ url: string; review_rated_count: number | null; stored_reviews?: unknown; contact_nostr?: unknown; nostr_announce_pubkey?: unknown }>) {
        if (r.review_rated_count != null || !Array.isArray(r.stored_reviews) || r.stored_reviews.length === 0) continue
        reviewFallback.set(r.url, aggregateReviews(r.stored_reviews as Array<{ pubkey: string; rating: number | null; comment: string | null }>, operatorKeysOf(r)))
      }
      // Wallet API extras (probes in the last 24 h, offline-streak start, stored score breakdown, keysets), by URL.
      const walletExtra = new Map<string, WalletExtra>()
      for (const r of result.rows as Array<Record<string, unknown>>) {
        walletExtra.set(r.url as string, {
          probes24h: Number(r.total ?? 0),
          downSince: r.down_since ? new Date(r.down_since as string | Date).toISOString() : null,
          scoreBreakdown: readStoredBreakdown(r.score_breakdown),
          keysets: keysetsOf(r.keysets_json),
          keysetsCheckedAt: r.keysets_checked_at ? new Date(r.keysets_checked_at as string | Date).toISOString() : null,
          changes: changesOf(r.changes_json),
          contactChecks: readStoredContactChecks(r.contact_checks) ?? [],
          auditDirections: (r.audit_directions_json as AuditDirectionsRow | null) ?? null,
        })
      }
      const now = Date.now()
      const snapshot = { data, computedAt: now, expiresAt: now + KNOWN_MINTS_CACHE_TTL, reviewFallback, walletExtra }
      knownMintsCache = snapshot
      return snapshot
    })
}

// Cache-Control public, max-age=300 and a strong ETag on every response (cache hit or miss); If-None-Match gives 304.
app.get('/api/mints/known', (_req: Request, res: Response): void => {
  loadKnownMints()
    .then(snap => sendCachedBody(res, memoizedBody(snap, 'known', () => snap.data)))
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mints/known]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

// ── Wallet API v1 (docs/API.md "API for wallets", docs/openapi/wallets-v1.yaml) ──────────────────────────────
// Served from the same snapshot as /api/mints/known (loadKnownMints), never one query per request. CORS and the
// 300/min limiter for /api/wallets/* are in the middleware above. Errors use { error: { code, message } }.
const walletInternalError = (res: Response, route: string, err: unknown): void => {
  if (IS_DEV) console.error(route, err)
  sendWalletError(res, 500, 'internal_error', 'Internal server error')
}

app.get('/api/wallets/mints', (req: Request, res: Response): void => {
  const parsed = parseWalletListQuery(queryOf(req))
  if (!parsed.ok) {
    sendWalletError(res, 400, 'invalid_parameter', parsed.message)
    return
  }
  const f = parsed.filter
  loadKnownMints()
    .then(snap => sendCachedBody(res, memoizedBody(snap, `list|${JSON.stringify(f)}`, () => walletListEnvelope(snap, f))))
    .catch((err: unknown) => walletInternalError(res, '[/api/wallets/mints]', err))
})

// One mint: the rest of the path is the percent-encoded mint URL. A mount (not a :param route) so a malformed
// percent-encoding is ours to answer as JSON 400 instead of Express's HTML.
app.use('/api/wallets/mints/', (req: Request, res: Response, next: NextFunction): void => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return }
  let decoded: string
  try {
    decoded = decodeURIComponent(req.path.slice(1))
  } catch {
    sendWalletError(res, 400, 'invalid_url', 'The mint URL in the path is not valid percent-encoding')
    return
  }
  // normalizeUrl rewrites the scheme of any special URL to https (ftp://x, ws://x), which would turn a foreign scheme into
  // a 404 for a "valid" mint. Only http:// (normalised to https://) and https:// are accepted; nothing else is looked up.
  const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(decoded)?.[1]?.toLowerCase()
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') {
    sendWalletError(res, 400, 'invalid_url', 'The URL scheme must be http or https')
    return
  }
  const url = normalizeUrl(decoded)
  if (!isWellFormedMintUrl(url)) {
    sendWalletError(res, 400, 'invalid_url', 'The path must be a percent-encoded https:// mint URL')
    return
  }
  loadKnownMints()
    .then(snap => {
      const body = walletSingleEnvelope(snap, url)
      if (body === null) {
        sendWalletError(res, 404, 'mint_not_found', 'No tracked mint has this URL')
        return
      }
      sendCachedBody(res, memoizedBody(snap, `mint|${url}`, () => body))
    })
    .catch((err: unknown) => walletInternalError(res, '[/api/wallets/mints/:url]', err))
})

app.use('/api/wallets', (_req: Request, res: Response): void => {
  sendWalletError(res, 404, 'not_found', 'Unknown wallet API route')
})

// Bot-only OG tag fragment for /mint/:url — nginx routes social-crawler user
// agents here (see deploy/nginx.conf); regular browsers never hit this route
// and get the normal client-rendered SPA instead. Always responds 200 with a
// valid HTML fragment (generic fallback if the mint/url isn't found or the DB
// lookup fails) since a crawler getting a 404/500 means no preview at all.
// SSRF-safe favicon proxy — see backend/src/mintIcon.ts for the full rationale.
// The frontend points every mint <img> here instead of fetching a mint-controlled
// icon_url directly, so a hostile icon_url can't turn a page view into an IP /
// User-Agent tracking beacon (2026-09-07 security audit). Known mints only;
// bytes are fetched through safeFetch and re-served from our origin, cached
// in-process. Anything unsafe/unfetchable → 204 No Content (one answer for every
// reason, see sendNoIcon) and the client shows its SVG placeholder. Exempt from the per-IP rate limit (read-only, cacheable, and the
// in-process cache means upstream is hit at most once per mint per TTL anyway).
// "No icon to serve", the one answer for EVERY reason (unknown mint, no icon_url, blocked address, DNS, TLS, upstream
// status, too large, wrong type, timeout, internal error): 204 with no body, so the route is no oracle for why. 204, not 404:
// Chromium prints "Failed to load resource" for a 404 on every <img> request but stays silent for a 204, and the <img> error
// event still fires, so MintFavicon shows the monogram. Same Cache-Control as the former 404.
function sendNoIcon(res: Response): void {
  res.setHeader('Cache-Control', 'public, max-age=1800')
  res.status(204).end()
}

app.get('/api/mint/icon', (req: Request, res: Response): void => {
  const rawUrl = req.query['url']
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
    res.status(400).end()
    return
  }

  getMintIcon(rawUrl)
    .then(icon => {
      if (!icon) {
        sendNoIcon(res)
        return
      }
      res.setHeader('Content-Type', icon.contentType)
      // Belt-and-suspenders against a mint serving something script-y that slipped
      // the content-type allow-list: no active content, no framing, treat as an
      // opaque same-origin resource.
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
      res.setHeader('Cache-Control', 'public, max-age=86400')
      res.end(icon.body)
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mint/icon]', err)
      sendNoIcon(res)
    })
})

// SSRF-safe NIP-05 verification proxy for reviewer identifiers (Reviews tab).
// See nip05Verify.ts for why this must be server-side: the domain in a
// reviewer's claimed nip05 is unauthenticated author-supplied input, so a
// direct browser fetch would leak every viewer's IP to a domain the review's
// author (a potential attacker) controls. Subject to the general per-IP rate
// limit (not exempt) — unlike mint icons this isn't hit on every page view at
// site-wide scale, only for the handful of named reviewers on one Reviews page.
app.get('/api/nip05/verify', (req: Request, res: Response): void => {
  const domain = req.query['domain']
  const name = req.query['name']
  const pubkey = req.query['pubkey']
  if (typeof domain !== 'string' || typeof name !== 'string' || typeof pubkey !== 'string') {
    res.status(400).json({ error: 'domain, name and pubkey are required' })
    return
  }

  verifyNip05(domain, name, pubkey)
    .then(verified => {
      res.setHeader('Cache-Control', 'public, max-age=1800')
      res.json({ verified })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/nip05/verify]', err)
      res.json({ verified: false })
    })
})

app.get('/api/og/mint', (req: Request, res: Response): void => {
  const rawUrl = req.query['url']
  const hasValidUrl = typeof rawUrl === 'string' && rawUrl.length > 0 && rawUrl.length <= MAX_URL_LENGTH

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', `max-age=${Math.floor(KNOWN_MINTS_CACHE_TTL / 1000)}`)

  if (!hasValidUrl) {
    res.send(renderMintOgHtml(null, ''))
    return
  }

  const normalized = normalizeUrl(rawUrl)
  fetchOgMintData(normalized)
    .then(mint => {
      res.send(renderMintOgHtml(mint, normalized))
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/og/mint]', err)
      res.send(renderMintOgHtml(null, normalized))
    })
})

// Bot HTML for the static documentation pages (/methodology, /for-wallets); nginx routes social crawlers here with
// a fixed slug per path (deploy/nginx.conf). Strict allowlist in og.ts: anything but a listed slug is a 404 JSON
// with a constant body, and no query value is ever echoed.
app.get('/api/og/page', (req: Request, res: Response): void => {
  const html = renderPageOgHtml(req.query['p'])
  if (html === null) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.send(html)
})

app.get('/api/mints/daily-uptime', (req: Request, res: Response): void => {
  const url = req.query['url']

  if (typeof url !== 'string' || url.length === 0) {
    res.status(400).json({ error: 'Missing required query parameter: url' })
    return
  }

  if (!url.startsWith('https://')) {
    res.status(400).json({ error: 'url must start with https://' })
    return
  }

  if (url.length > MAX_URL_LENGTH) {
    res.status(400).json({ error: `url exceeds maximum length of ${MAX_URL_LENGTH} characters` })
    return
  }

  Promise.resolve(isWellFormedMintUrl(url))
    .then(safe => {
      if (!safe) {
        res.status(400).json({ error: 'Invalid url' })
        return
      }
      return pool
        .query(
          `SELECT
            (DATE_TRUNC('day', checked_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS day,
            SUM(CASE WHEN online THEN 1 ELSE 0 END)::int AS online_count,
            COUNT(*)::int AS total_count
           FROM mint_history
           WHERE url = $1 AND checked_at > NOW() - INTERVAL '30 days'
           GROUP BY DATE_TRUNC('day', checked_at AT TIME ZONE 'UTC')
           ORDER BY DATE_TRUNC('day', checked_at AT TIME ZONE 'UTC') ASC`,
          [url]
        )
        .then(result => {
          res.json({
            url,
            days: result.rows.map(r => ({
              day: (r.day as Date).toISOString().slice(0, 10),
              onlineCount: r.online_count as number,
              totalCount: r.total_count as number,
            })),
          })
        })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mints/daily-uptime]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

// GET /api/mints/swaps?url= — the audit.8333.space rolling-window swap detail
// (mint_audit_swaps) for one mint, kept OUT of /api/mints/known: that endpoint
// is fetched on every Dashboard load for every mint, and embedding up to 100
// swap rows per mint there would multiply its payload size ~65x for a feature
// only the (currently unbuilt) Mint Detail Audit tab would use. /api/mints/known
// keeps only the small scalar auditAvgTimeMs; this endpoint serves the full list
// on demand, same shape as /api/mints/history|version-history|daily-uptime.
app.get('/api/mints/swaps', (req: Request, res: Response): void => {
  const url = req.query['url']

  if (typeof url !== 'string' || url.length === 0) {
    res.status(400).json({ error: 'Missing required query parameter: url' })
    return
  }

  if (!url.startsWith('https://')) {
    res.status(400).json({ error: 'url must start with https://' })
    return
  }

  if (url.length > MAX_URL_LENGTH) {
    res.status(400).json({ error: `url exceeds maximum length of ${MAX_URL_LENGTH} characters` })
    return
  }

  Promise.resolve(isWellFormedMintUrl(url))
    .then(safe => {
      if (!safe) {
        res.status(400).json({ error: 'Invalid url' })
        return
      }
      return pool
        .query(
          `SELECT swap_id, to_url, amount, fee, created_at, time_taken_ms, state, error
           FROM mint_audit_swaps
           WHERE url = $1
           ORDER BY created_at DESC NULLS LAST
           LIMIT 100`,
          [url]
        )
        .then(result => {
          const swaps = result.rows.map(r => ({
            swapId: Number(r.swap_id),
            toUrl: (r.to_url as string | null) ?? null,
            amount: (r.amount as number | null) ?? null,
            fee: (r.fee as number | null) ?? null,
            createdAt: r.created_at != null ? (r.created_at as Date).toISOString() : null,
            timeTakenMs: r.time_taken_ms != null ? Number(r.time_taken_ms) : null,
            state: r.state as string,
            error: (r.error as string | null) ?? null,
          }))
          const okTimes = swaps
            .filter(s => s.state === 'OK' && s.timeTakenMs !== null)
            .map(s => s.timeTakenMs as number)
          const avgTimeMs = okTimes.length > 0 ? okTimes.reduce((a, b) => a + b, 0) / okTimes.length : null
          sendCachedBody(res, buildCachedBody({ url, avgTimeMs, swaps }), 300)
        })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mints/swaps]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

// GET /api/mints/audit-cz?url= — cashu.info data (formerly audit.cashu.cz; second audit source).
// This endpoint is display only; the score reads mints.audit_cz_* (auditCzDetail.ts), not this response. Read from audit_cz_* tables
// filled by the 10-minute cron in auditCz.ts. Always 200 for a valid url;
// covered:false when the mint is not in their feed. Optional `limit` (swaps, default 20, clamped 1..100).
app.get('/api/mints/audit-cz', (req: Request, res: Response): void => {
  const url = req.query['url']

  if (typeof url !== 'string' || url.length === 0) {
    res.status(400).json({ error: 'Missing required query parameter: url' })
    return
  }

  if (!url.startsWith('https://')) {
    res.status(400).json({ error: 'url must start with https://' })
    return
  }

  if (url.length > MAX_URL_LENGTH) {
    res.status(400).json({ error: `url exceeds maximum length of ${MAX_URL_LENGTH} characters` })
    return
  }

  Promise.resolve(isWellFormedMintUrl(url))
    .then(async safe => {
      if (!safe) {
        res.status(400).json({ error: 'Invalid url' })
        return
      }
      const rawDir = req.query['direction']
      const direction = rawDir === undefined || rawDir === 'both' ? 'both' : rawDir === 'from' || rawDir === 'to' ? rawDir : null
      if (direction === null) {
        res.status(400).json({ error: 'direction must be from, to, or both' })
        return
      }
      const body = await getAuditCzForMint(url, clampAuditCzLimit(req.query['limit']), direction)
      sendCachedBody(res, buildCachedBody(body), 60)
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mints/audit-cz]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

// GET /api/mints/changes?url= — the mint change log of ONE tracked mint (mintChanges.ts) for the Mint Detail page: the newest
// confirmed changes (up to ROUTE_CHANGES_MAX) and when tracking of the mint started. A website route like /api/mints/known (the
// default CORS allow-list and the general per-IP limit); the wallet API serves the same rows as `changes`. Unknown url -> 404,
// so it is no oracle for anything but "is this mint tracked".
app.get('/api/mints/changes', (req: Request, res: Response): void => {
  const url = req.query['url']
  if (typeof url !== 'string' || url.length === 0) {
    res.status(400).json({ error: 'Missing required query parameter: url' })
    return
  }
  if (url.length > MAX_URL_LENGTH || !url.startsWith('https://') || !isWellFormedMintUrl(url)) {
    res.status(400).json({ error: 'Invalid url' })
    return
  }
  pool.query('SELECT 1 FROM mints WHERE url = $1', [url])
    .then(async found => {
      if ((found.rowCount ?? 0) === 0) {
        res.status(404).json({ error: 'Not found' })
        return
      }
      sendCachedBody(res, buildCachedBody({ url, ...(await listMintChanges(url, ROUTE_CHANGES_MAX)) }), 60)
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mints/changes]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

app.post('/api/mint/submit', (req: Request, res: Response): void => {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
  if (!checkSubmitRateLimit(ip)) {
    setRetryAfter(res, submitRateLimitStore, ip)
    res.status(429).json({ error: 'Too many requests. Try again later.' })
    return
  }

  const body = req.body as { url?: unknown }
  const url = body.url

  if (typeof url !== 'string' || url.length === 0) {
    res.status(400).json({ error: 'Missing required field: url' })
    return
  }

  if (!isAllowedUrl(url)) {
    res.status(403).json({ error: 'This deployment monitors a fixed mint allowlist.' })
    return
  }

  if (!url.startsWith('https://')) {
    res.status(400).json({ error: 'url must start with https://' })
    return
  }

  if (url.length > MAX_URL_LENGTH) {
    res.status(400).json({ error: `url exceeds maximum length of ${MAX_URL_LENGTH} characters` })
    return
  }

  const normalized = normalizeUrl(url)

  isSafeUrl(normalized)
    .then(safe => {
      if (!safe) {
        res.status(400).json({ error: 'Invalid url' })
        return
      }
      return probeMint(normalized).then(async status => {
        if (!status.online) {
          res.status(400).json({
            error: 'URL does not appear to be a valid Cashu mint',
            ...(status.errorKind !== undefined ? { errorKind: status.errorKind } : {}),
          })
          return
        }
        const result = await pool.query(
          'INSERT INTO mints (url, is_known) VALUES ($1, true) ON CONFLICT (url) DO NOTHING',
          [normalized]
        )
        const isNew = (result.rowCount ?? 0) > 0
        try {
          await probeMintToDb(normalized)
        } catch (probeErr) {
          if (IS_DEV) console.error('[submit] post-insert probe failed:', probeErr)
        }
        invalidateKnownMints()

        // Alias hint — never merges cards, URL stays the only identity. Only
        // meaningful for a genuinely new row; a re-submit of an already-tracked
        // URL doesn't need "is this an alias of itself" noise.
        let aliasOf: { url: string; name: string | null }[] = []
        if (isNew) {
          const pubkey = normalizeMintPubkey(status.info?.pubkey)
          if (pubkey !== null) {
            try {
              aliasOf = await findMintsByPubkey(pubkey, normalized)
            } catch (aliasErr) {
              if (IS_DEV) console.error('[submit] alias lookup failed:', aliasErr)
            }
          }
        }

        res.json({
          success: true,
          isNew,
          added: isNew,
          alreadyTracked: !isNew,
          name: publicMintName(status.info?.name, normalized).name,
          aliasOf: aliasOf.map(a => ({ url: a.url, name: publicMintName(a.name, a.url).name })),
        })
      })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mint/submit]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

const MAX_DISCOVER_BATCH = 100

app.post('/api/mints/discover', async (req: Request, res: Response): Promise<void> => {
  if (isAllowlistMode()) {
    res.status(403).json({ error: 'This deployment monitors a fixed mint allowlist.' })
    return
  }
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
  const body = req.body as { urls?: unknown; source?: unknown }
  // Default to 'auto' — the smaller budget — when the field is missing or
  // unrecognized, so an unspecified/older caller can't silently claim the
  // larger 'bulk' budget meant for an explicit user action.
  const source: DiscoverSource = body.source === 'bulk' ? 'bulk' : 'auto'

  if (!checkDiscoverRateLimit(ip, source)) {
    const resetAt = discoverRateLimitStoreFor(source).get(ip)?.resetAt
    if (resetAt !== undefined) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))))
    }
    res.status(429).json({ error: 'Too many requests. Try again later.' })
    return
  }

  if (!Array.isArray(body.urls)) {
    res.status(400).json({ error: 'urls must be array' })
    return
  }

  if (body.urls.length > MAX_DISCOVER_BATCH) {
    res.status(400).json({ error: `urls exceeds maximum batch size of ${MAX_DISCOVER_BATCH}` })
    return
  }

  let added = 0
  const results: Array<{ url: string; success: boolean; isNew: boolean; error?: string; errorKind?: ProbeErrorKind; aliasOf?: { url: string; name: string | null }[] }> = []
  for (const url of body.urls) {
    if (typeof url !== 'string') continue
    if (url.length > MAX_URL_LENGTH) {
      results.push({ url, success: false, isNew: false, error: `url exceeds maximum length of ${MAX_URL_LENGTH} characters` })
      continue
    }
    if (!url.startsWith('https://')) {
      results.push({ url, success: false, isNew: false, error: 'url must start with https://' })
      continue
    }
    const normalized = normalizeUrl(url)
    try {
      if (!(await isSafeUrl(normalized))) {
        results.push({ url: normalized, success: false, isNew: false, error: 'Invalid url' })
        continue
      }
      // validateCashuMintProbe() does the same single /v1/info fetch
      // isValidCashuMint() used to do, plus hands back the raw pubkey so it
      // can be persisted on first insert (see mintPubkey.ts) without a
      // second outbound request.
      const { valid, pubkey, errorKind } = await validateCashuMintProbe(normalized)
      if (!valid) {
        results.push({
          url: normalized,
          success: false,
          isNew: false,
          error: 'URL does not appear to be a valid Cashu mint',
          ...(errorKind !== undefined ? { errorKind } : {}),
        })
        continue
      }
      const result = await pool.query(
        'INSERT INTO mints (url, is_known) VALUES ($1, true) ON CONFLICT (url) DO NOTHING',
        [normalized]
      )
      const isNew = result.rowCount !== null && result.rowCount > 0
      if (isNew) added++

      // Alias hint — see the same rationale in POST /api/mint/submit above.
      // Only meaningful for a genuinely new row.
      let aliasOf: { url: string; name: string | null }[] = []
      if (isNew && pubkey !== null) {
        try {
          await persistMintPubkeyIfChanged(normalized, pubkey)
          aliasOf = await findMintsByPubkey(pubkey, normalized)
        } catch (aliasErr) {
          if (IS_DEV) console.error('[discover] alias lookup/persist failed:', aliasErr)
        }
      }

      results.push({ url: normalized, success: true, isNew, aliasOf: aliasOf.map(a => ({ url: a.url, name: publicMintName(a.name, a.url).name })) })
    } catch {
      results.push({ url: normalized, success: false, isNew: false, error: 'Internal error' })
    }
  }

  if (added > 0) invalidateKnownMints()
  res.json({ added, total: body.urls.length, results })
})

// Secondary review source in a two-mechanism pattern. The frontend's
// useMintReviews.ts fetches live from Nostr relays client-side on every Mint
// Detail view (PRIMARY — the only path guaranteed to surface a user's own
// just-published review immediately, see useSubmitReview.ts). This endpoint
// serves the `mint_reviews` rows that the hourly background sync (reviewsSync.ts)
// populates — an independent server-side vantage point that can reach relays a
// user's connection can't. It used to do its OWN live relay query on every
// request (~3s, the single biggest contributor to slow Mint Detail loads); now
// it's a fast DB read. MintDetail.tsx merges both sources and only adds rows
// the live fetch missed (see the dedup comment there). Do not collapse the two
// mechanisms without re-confirming with the maintainer.
app.get('/api/mints/nostr-reviews', (req: Request, res: Response): void => {
  const url = req.query['url']

  if (typeof url !== 'string' || url.length === 0) {
    res.status(400).json({ error: 'Missing required query parameter: url' })
    return
  }

  if (!url.startsWith('https://')) {
    res.status(400).json({ error: 'url must start with https://' })
    return
  }

  if (url.length > MAX_URL_LENGTH) {
    res.status(400).json({ error: `url exceeds maximum length of ${MAX_URL_LENGTH} characters` })
    return
  }

  pool
    .query(
      `SELECT r.event_id, r.pubkey, r.rating, r.comment, r.created_at, p.found, p.name, p.display_name, p.nip05,
              (SELECT contact_nostr FROM mints WHERE url = $1) AS contact_nostr,
              (SELECT nostr_announce_pubkey FROM mints WHERE url = $1) AS nostr_announce_pubkey
       FROM mint_reviews r LEFT JOIN nostr_profiles p ON p.pubkey = r.pubkey
       WHERE r.url = $1
       ORDER BY r.created_at DESC`,
      [url],
    )
    .then(result => {
      // The mint's own listed nostr contacts and its announcement author, only to compare with each review author (every row
      // carries the same two values); a boolean per review leaves the server, never a contact value.
      const mintRow = result.rows[0] as { contact_nostr?: unknown; nostr_announce_pubkey?: unknown } | undefined
      const contactKeys = contactKeysOf(mintRow)
      const operatorKeys = operatorKeysOf(mintRow)
      const reviews = result.rows.map(r => ({
        id: r.event_id as string,
        pubkey: r.pubkey as string,
        content: (r.comment as string | null) ?? '',
        rating: r.rating as number | null,
        createdAt: Number(r.created_at),
        source: 'nostr' as const,
        // The author's key is one of the nostr contacts the mint itself lists and the review is NOT excluded as an operator
        // review (that rule also needs the announcement author: shared/operatorPubkeys.ts). Shown as a neutral label only; it
        // never excludes a review or changes a count, average or score.
        listedAsContact: contactKeys.has(String(r.pubkey).toLowerCase()) && !operatorKeys.has(String(r.pubkey).toLowerCase()),
        // Untrusted display text only (profilesSync.ts); never used for rating, operator rule or any score.
        ...profileFieldsForReview(r),
      }))
      sendCachedBody(res, buildCachedBody(reviews), 120)
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mints/nostr-reviews]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

// ── Routes: notification subscriptions ────────────────────────
//
// Phase 1: storage only — no sending. A subscription records that `pubkey`
// wants a DM (over `relays`) when `mintUrl` transitions online/offline.
// Both routes require NIP-98 auth (RFC 27235 "Nostr" HTTP Auth) so a
// subscription can only be created/removed by the key that owns it.

const MIN_RELAYS = 1
const MAX_RELAYS = 10

// Per-pubkey caps on the notification-subscription store. `notifySubscribers`
// (nostrService.ts) fans a gift-wrap signed by NOTIFICATION_SERVICE_NSEC out to
// (row.relays ∪ NOTIFICATION_RELAYS) for every matching row on a mint
// transition. Without a total cap, one free pubkey could accumulate a
// subscription row for every mint (each carrying up to 10 attacker-chosen relay
// URLs), turning a flapping mint into amplified traffic toward arbitrary public
// relays — and getting the service key rate-limited/banned, breaking
// notifications for everyone. A real user watches single- to low-double-digit
// mints and reuses one relay list across them, so these limits are far above
// legitimate use. (The 30/hr rate limit bounds the *rate* of writes, not the
// *total* — and pubkeys are free, so it isn't enough on its own.)
const MAX_SUBSCRIPTIONS_PER_PUBKEY = 50
const MAX_DISTINCT_RELAYS_PER_PUBKEY = 25

// Validates the relay list shape and, for each entry, that it's a ws:/wss:
// URL that passes the same SSRF guard used for mint probing (adapted for the
// ws(s) scheme in ssrf.ts) — prevents a subscription from later being used to
// make the (future, phase-2) DM-sending code connect to internal
// infrastructure via an attacker-supplied "relay".
//
// `logContext` (a truncated pubkey — never full request data) is included in
// every rejection log line so a rejected batch is diagnosable server-side
// without needing to expose which specific relay/reason failed to the client.
async function validateRelays(relays: unknown, logContext: string): Promise<string[] | null> {
  if (!Array.isArray(relays)) {
    console.warn(`[notifications] relay validation rejected (${logContext}): relays is not an array`)
    return null
  }
  if (relays.length < MIN_RELAYS || relays.length > MAX_RELAYS) {
    console.warn(`[notifications] relay validation rejected (${logContext}): ${relays.length} relays, expected ${MIN_RELAYS}-${MAX_RELAYS}`)
    return null
  }
  for (const r of relays) {
    if (typeof r !== 'string' || r.length === 0 || r.length > MAX_URL_LENGTH) {
      console.warn(`[notifications] relay validation rejected (${logContext}): malformed relay entry (not a string, empty, or over ${MAX_URL_LENGTH} chars)`)
      return null
    }
  }
  const typedRelays = relays as string[]
  const checks = await Promise.all(
    typedRelays.map(async url => ({ url, result: await checkWsUrlSafety(url) }))
  )

  // A DNS failure is not an SSRF signal — mirrors checkWsUrlSafety's own
  // three-state contract (ssrf.ts), where 'dns-error' means "currently
  // unreachable", not "malicious" (only 'blocked' does: bad scheme, or
  // resolves to a private/internal address). Treating 'dns-error' the same
  // as 'blocked' was the actual bug: a single relay with a dead/unresolvable
  // hostname (e.g. relay.nostr.bg — confirmed via `dig`, no DNS records at
  // all) rejected the ENTIRE subscribe request, even with 9 other perfectly
  // valid relays in the same batch. A relay list naturally includes relays
  // that are temporarily or permanently down; that's not something the
  // request as a whole should fail on. Only a genuinely 'blocked' relay
  // invalidates the batch — 'dns-error' relays are still stored as given.
  const blocked = checks.filter(c => c.result === 'blocked')
  if (blocked.length > 0) {
    console.warn(
      `[notifications] relay validation rejected (${logContext}): blocked — ` +
      blocked.map(c => sanitizeLogValue(c.url)).join(', ')
    )
    return null
  }

  const dnsErrors = checks.filter(c => c.result === 'dns-error')
  if (dnsErrors.length > 0) {
    console.warn(
      `[notifications] relay(s) unresolvable but accepted (${logContext}): ` +
      dnsErrors.map(c => sanitizeLogValue(c.url)).join(', ')
    )
  }

  return typedRelays
}

app.post('/api/notifications/subscribe', (req: Request, res: Response): void => {
  authenticateNip98(req)
    .then(auth => {
      if (!auth.ok) {
        res.status(auth.status).json({ error: auth.error })
        return
      }
      const { pubkey } = auth

      if (!checkNotifySubscribeRateLimit(pubkey)) {
        setRetryAfter(res, notifySubscribeRateLimitStore, pubkey)
        res.status(429).json({ error: 'Too many requests. Try again later.' })
        return
      }

      const body = req.body as {
        mintUrl?: unknown
        notifyOnDown?: unknown
        notifyOnUp?: unknown
        notifyOnMintMeltIssues?: unknown
        notifyOnVersionOutdated?: unknown
        notifyOnNutLoss?: unknown
        relays?: unknown
      }

      const mintUrl = body.mintUrl
      if (typeof mintUrl !== 'string' || mintUrl.length === 0) {
        res.status(400).json({ error: 'Missing required field: mintUrl' })
        return
      }
      if (mintUrl.length > MAX_URL_LENGTH) {
        res.status(400).json({ error: `mintUrl exceeds maximum length of ${MAX_URL_LENGTH} characters` })
        return
      }

      const { notifyOnDown, notifyOnUp } = body
      if (typeof notifyOnDown !== 'boolean' || typeof notifyOnUp !== 'boolean') {
        res.status(400).json({ error: 'notifyOnDown and notifyOnUp must be boolean' })
        return
      }
      // "More alerts" flags are optional: omitted = keep what is stored (false for a new row), so a client
      // that only knows down/up never switches them off. When present they must be boolean.
      const moreFlags = [body.notifyOnMintMeltIssues, body.notifyOnVersionOutdated, body.notifyOnNutLoss]
      if (moreFlags.some(f => f !== undefined && typeof f !== 'boolean')) {
        res.status(400).json({ error: 'notifyOnMintMeltIssues, notifyOnVersionOutdated and notifyOnNutLoss must be boolean when provided' })
        return
      }
      const [notifyOnMintMelt, notifyOnVersionOutdated, notifyOnNutLoss] = moreFlags.map(f => (typeof f === 'boolean' ? f : null))

      return validateRelays(body.relays, pubkey.slice(0, 8)).then(relays => {
        if (relays === null) {
          res.status(400).json({
            error: `relays must be an array of ${MIN_RELAYS}-${MAX_RELAYS} valid ws:// or wss:// URLs`,
          })
          return
        }

        return pool.query('SELECT 1 FROM mints WHERE url = $1', [mintUrl]).then(mintResult => {
          if ((mintResult.rowCount ?? 0) === 0) {
            res.status(400).json({ error: 'Unknown mint' })
            return
          }

          // Per-pubkey caps — one round-trip: current row count, whether THIS
          // mint already has a row (an update, always allowed), and the set of
          // relay URLs already stored for this pubkey's OTHER subscriptions.
          return pool.query(
            `SELECT
               (SELECT COUNT(*)::int FROM notification_subscriptions WHERE pubkey = $1) AS total,
               (SELECT COUNT(*)::int FROM notification_subscriptions WHERE pubkey = $1 AND mint_url = $2) AS this_mint,
               COALESCE(ARRAY(
                 SELECT DISTINCT r FROM notification_subscriptions ns, unnest(ns.relays) AS r
                 WHERE ns.pubkey = $1 AND ns.mint_url <> $2
               ), '{}'::text[]) AS other_relays`,
            [pubkey, mintUrl]
          ).then(capRow => {
            const { total, this_mint, other_relays } = capRow.rows[0] as {
              total: number; this_mint: number; other_relays: string[]
            }
            const isNewRow = this_mint === 0

            if (isNewRow && total >= MAX_SUBSCRIPTIONS_PER_PUBKEY) {
              res.status(409).json({
                error: `You already have ${MAX_SUBSCRIPTIONS_PER_PUBKEY} mint notification subscriptions, which is the maximum. Unsubscribe from one before adding another.`,
              })
              return
            }

            const distinctRelaysAfter = new Set([...other_relays, ...relays])
            if (distinctRelaysAfter.size > MAX_DISTINCT_RELAYS_PER_PUBKEY) {
              res.status(400).json({
                error: `This subscription would push your notification relay list to ${distinctRelaysAfter.size} distinct relays across all your subscriptions; the maximum is ${MAX_DISTINCT_RELAYS_PER_PUBKEY}. Reuse the same relay list across your subscriptions.`,
              })
              return
            }

            return pool.query(
              `INSERT INTO notification_subscriptions
               (pubkey, mint_url, notify_on_down, notify_on_up, relays, updated_at,
                notify_on_mint_melt_issues, notify_on_version_outdated, notify_on_nut_loss)
             VALUES ($1, $2, $3, $4, $5, now(), COALESCE($6::boolean, false), COALESCE($7::boolean, false), COALESCE($8::boolean, false))
             ON CONFLICT (pubkey, mint_url) DO UPDATE SET
               notify_on_down = EXCLUDED.notify_on_down,
               notify_on_up = EXCLUDED.notify_on_up,
               notify_on_mint_melt_issues = COALESCE($6::boolean, notification_subscriptions.notify_on_mint_melt_issues),
               notify_on_version_outdated = COALESCE($7::boolean, notification_subscriptions.notify_on_version_outdated),
               notify_on_nut_loss = COALESCE($8::boolean, notification_subscriptions.notify_on_nut_loss),
               relays = EXCLUDED.relays,
               updated_at = now()`,
            [pubkey, mintUrl, notifyOnDown, notifyOnUp, relays, notifyOnMintMelt, notifyOnVersionOutdated, notifyOnNutLoss]
            ).then(() => {
              // Audit trail: truncated pubkey + mint only — never relays/notify
              // flags, which is the rest of the request body.
              console.log(`[notifications/subscribe] pubkey=${pubkey.slice(0, 8)}… mint=${mintUrl}`)
              res.json({ success: true })
            })
          })
        })
      })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/notifications/subscribe]', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' })
    })
})

app.post('/api/notifications/unsubscribe', (req: Request, res: Response): void => {
  authenticateNip98(req)
    .then(auth => {
      if (!auth.ok) {
        res.status(auth.status).json({ error: auth.error })
        return
      }
      const { pubkey } = auth

      if (!checkNotifyUnsubscribeRateLimit(pubkey)) {
        setRetryAfter(res, notifyUnsubscribeRateLimitStore, pubkey)
        res.status(429).json({ error: 'Too many requests. Try again later.' })
        return
      }

      const body = req.body as { mintUrl?: unknown }
      const mintUrl = body.mintUrl
      if (typeof mintUrl !== 'string' || mintUrl.length === 0) {
        res.status(400).json({ error: 'Missing required field: mintUrl' })
        return
      }
      if (mintUrl.length > MAX_URL_LENGTH) {
        res.status(400).json({ error: `mintUrl exceeds maximum length of ${MAX_URL_LENGTH} characters` })
        return
      }

      // Normalize the same way every other mint-URL entry point does before
      // using it anywhere — including in the log line below, where a raw
      // client-supplied string with an embedded newline could otherwise
      // forge a second, fabricated log entry.
      try {
        new URL(mintUrl.trim())
      } catch {
        res.status(400).json({ error: 'Invalid mintUrl' })
        return
      }
      const normalizedMintUrl = normalizeUrl(mintUrl)

      return pool.query(
        'DELETE FROM notification_subscriptions WHERE pubkey = $1 AND mint_url = $2',
        [pubkey, normalizedMintUrl]
      ).then(() => {
        console.log(`[notifications/unsubscribe] pubkey=${pubkey.slice(0, 8)}… mint=${normalizedMintUrl}`)
        res.json({ success: true })
      })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/notifications/unsubscribe]', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' })
    })
})

// Any /api/* path no route above answered: JSON, never Express's HTML "Cannot GET". /api/v1/* uses the wallet API's
// error envelope, the other paths the { error: "text" } shape the rest of the API uses (og/page does the same).
// The /api/v1 rewrite has already run, so the original URL is what tells the two apart.
app.use('/api', (req: Request, res: Response): void => {
  if (/^\/api\/v1(?:[/?]|$)/i.test(req.originalUrl)) sendWalletError(res, 404, 'not_found', 'Unknown API route')
  else res.status(404).json({ error: 'Not found' })
})

// ── Start ──────────────────────────────────────────────────────

// Only bind the port and run startup side effects when not under test.
// Integration tests import `app` directly and drive it via supertest, so the
// real server, DB init, seeding and cron must not run on import.
if (process.env['NODE_ENV'] !== 'test') {
  // Registered here, with the SIGTERM/SIGINT handlers, and not at import: every integration test imports this module,
  // and one more pair of process listeners per import made Node print MaxListenersExceededWarning. The handlers
  // themselves are unchanged and still active before the first socket is opened (nothing async runs before this block).
  // Last-resort safety net for unexpected errors: log and keep the API process alive instead of letting one stray
  // error in a background job kill it. These handlers are NOT the fix for the known nostr-tools relay case (a
  // connection-timeout path closes a socket that is still connecting and nulls onerror, so `ws` emitted an
  // unhandled 'error' event): that is handled at the source, every nostr-tools pool connects with RelayWebSocket
  // (wsPolyfill.ts, a permanent no-op 'error' listener) and relayConnectionErrors.test.ts fails when an uncaught
  // exception or rejection escapes.
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err)
  })
  process.on('unhandledRejection', (err) => {
    console.error('[unhandledRejection]', err)
  })

  const server = app.listen(PORT, () => {
    console.log(`MintRadar backend listening on port ${PORT}`)
    initDb()
      .then(() => seedKnownMints(upsertMint))
      .then(() => {
        startCron()
        refreshReliabilityTrendCache()
        setInterval(refreshReliabilityTrendCache, RELIABILITY_TREND_REFRESH_MS).unref()
        void publishServiceProfile()
        // Dormant: does nothing (one log line) unless ATTESTATION_SERVICE_NSEC is set — healthPublisher.ts.
        startAttestations({ loadSnapshot: loadKnownMints, isAllowlistMode })
      })
      .catch((err: unknown) => {
        console.error('[startup] DB init failed — exiting:', err)
        process.exit(1)
      })
  })

  process.on('SIGTERM', () => {
    server.close(() => { process.exit(0) })
  })

  process.on('SIGINT', () => {
    server.close(() => { process.exit(0) })
  })
}
