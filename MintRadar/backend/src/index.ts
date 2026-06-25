import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { SimplePool, verifyEvent } from 'nostr-tools'
import WebSocket from 'ws'
import { pool, initDb } from './db.js'
import { isSafeUrl, safeFetch } from './ssrf.js'
import { upsertMint, probeMintToDb } from './prober.js'
import { seedKnownMints, startCron } from './cron.js'
import { normalizeUrl } from './discovery.js'

let knownMintsCache: { data: unknown; expiresAt: number } | null = null
const KNOWN_MINTS_CACHE_TTL = 60_000 // 60 seconds

interface NostrReviewEntry {
  id: string
  pubkey: string
  content: string
  rating: number
  createdAt: number
  source: 'nostr'
}

const nostrReviewsCache = new Map<string, { data: NostrReviewEntry[]; expiresAt: number }>()
const NOSTR_REVIEWS_CACHE_TTL = 10 * 60 * 1000 // 10 minutes
const NOSTR_REVIEWS_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
]
const NOSTR_REVIEWS_TIMEOUT_MS = 8_000

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
  ? 'https://mintradar.pedani.eu,http://localhost:5173'
  : 'https://mintradar.pedani.eu'

const ALLOWED_ORIGINS = (
  process.env['ALLOWED_ORIGINS'] ?? DEFAULT_ORIGINS
).split(',').map(o => o.trim())

const MAX_URL_LENGTH = 500
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60

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
}

// ── Rate limiter ───────────────────────────────────────────────

const rateLimitStore = new Map<string, RateLimitEntry>()

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; limit: number } {
  const now = Date.now()
  const entry = rateLimitStore.get(ip)

  if (entry === undefined || now >= entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, limit: RATE_LIMIT_MAX }
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, limit: RATE_LIMIT_MAX }
  }

  entry.count++
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count, limit: RATE_LIMIT_MAX }
}

// Prevent unbounded memory growth
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of rateLimitStore) {
    if (now >= entry.resetAt) rateLimitStore.delete(ip)
  }
}, RATE_LIMIT_WINDOW_MS)

// ── Mint probe ─────────────────────────────────────────────────

async function probeMint(url: string): Promise<MintStatus> {
  const start = Date.now()

  // safeFetch validates the URL and every redirect hop against isSafeUrl()
  // and pins DNS at connect time (SSRF + rebinding protection).
  const [infoRes, keysetsRes] = await Promise.all([
    safeFetch(`${url}/v1/info`),
    safeFetch(`${url}/v1/keysets`),
  ])

  const latencyMs = Date.now() - start

  let info: MintInfo | null = null
  let online = false

  if (infoRes && infoRes.ok) {
    try {
      const raw: unknown = await infoRes.json()
      if (typeof raw === 'object' && raw !== null && 'nuts' in raw) {
        info = raw as MintInfo
        online = true
      }
    } catch { /* invalid JSON — treat as offline */ }
  } else if (IS_DEV) {
    console.error('[probeMint] info fetch failed or blocked:', url)
  }

  let keysets: MintKeyset[] | null = null

  if (keysetsRes && keysetsRes.ok) {
    try {
      const raw: unknown = await keysetsRes.json()
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

  const status: MintStatus = {
    url,
    online,
    latencyMs: online ? latencyMs : null,
    info,
    keysets,
    checkedAt: new Date().toISOString(),
  }

  if (!online) {
    status.error = 'Mint unreachable'
  }

  return status
}

// ── App ────────────────────────────────────────────────────────

const app = express()

app.set('trust proxy', 1)

// Security headers
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-XSS-Protection', '0')
  next()
})

// CORS
app.use(cors({
  origin: (origin, callback) => {
    if (origin === undefined || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  methods: ['GET', 'POST'],
}))

app.use(express.json())

// Rate limiting — exempt public read-only endpoints that sit behind Cache-Control
const RATE_LIMIT_EXEMPT = new Set(['/health', '/api/mints/known', '/api/stats'])

// Stricter limiters for write endpoints that trigger outbound fetches /
// DNS resolution. Each submit performs 2+ outbound probes; each discovered
// URL performs a DNS lookup — so these are kept deliberately low to prevent
// the server being abused as an SSRF/DNS-amplification proxy.
const HOUR_MS = 60 * 60 * 1000

// Submit: 20 req/IP/hour (each triggers probeMint + probeMintToDb).
const submitRateLimitStore = new Map<string, RateLimitEntry>()
const SUBMIT_RATE_LIMIT_MAX = 20

// Discover: 10 req/IP/hour (each accepts a batch of up to MAX_DISCOVER_BATCH).
const discoverRateLimitStore = new Map<string, RateLimitEntry>()
const DISCOVER_RATE_LIMIT_MAX = 10

function checkWindowedLimit(store: Map<string, RateLimitEntry>, max: number, ip: string): boolean {
  const now = Date.now()
  const entry = store.get(ip)
  if (entry === undefined || now >= entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + HOUR_MS })
    return true
  }
  if (entry.count >= max) return false
  entry.count++
  return true
}

function checkSubmitRateLimit(ip: string): boolean {
  return checkWindowedLimit(submitRateLimitStore, SUBMIT_RATE_LIMIT_MAX, ip)
}

function checkDiscoverRateLimit(ip: string): boolean {
  return checkWindowedLimit(discoverRateLimitStore, DISCOVER_RATE_LIMIT_MAX, ip)
}

setInterval(() => {
  const now = Date.now()
  for (const store of [submitRateLimitStore, discoverRateLimitStore]) {
    for (const [ip, entry] of store) {
      if (now >= entry.resetAt) store.delete(ip)
    }
  }
}, HOUR_MS)

app.use((req: Request, res: Response, next: NextFunction) => {
  if (RATE_LIMIT_EXEMPT.has(req.path)) {
    next()
    return
  }
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
  const { allowed, remaining, limit } = checkRateLimit(ip)
  res.setHeader('X-RateLimit-Limit', String(limit))
  res.setHeader('X-RateLimit-Remaining', String(remaining))
  if (!allowed) {
    res.status(429).json({ error: 'Too many requests' })
    return
  }
  next()
})

// ── Routes ─────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
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

  probeMint(url)
    .then(status => { res.json(status) })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mint/probe] unexpected error:', err)
      res.json({
        url,
        online: false,
        latencyMs: null,
        info: null,
        keysets: null,
        checkedAt: new Date().toISOString(),
        error: 'Mint unreachable',
      })
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

  isSafeUrl(url)
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
            ROUND(AVG(trust_score))::int AS trust_score
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
            ROUND(AVG(trust_score))::int AS trust_score
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
            ROUND(AVG(trust_score))::int AS trust_score
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
            ROUND(AVG(trust_score))::int AS trust_score
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
      ]).then(([segResult, prevResult]) => {
        const segments = segResult.rows.map(r => ({
          bucket: (r.bucket as Date).toISOString(),
          online: r.online as boolean,
          latencyMs: r.latency_ms as number | null,
          total: Number(r.total),
          onlineCount: Number(r.online_count),
          uptimePct: Number(r.total) === 0 ? null
            : Math.round(Number(r.online_count) / Number(r.total) * 100),
          trustScore: r.trust_score != null ? Number(r.trust_score) : null,
        }))
        const prevRow = prevResult.rows[0]
        const prevUptimePct = prevRow?.uptime_ratio != null
          ? Math.round(Number(prevRow.uptime_ratio) * 100)
          : null
        const prevAvgLatencyMs = prevRow?.avg_latency_ms != null
          ? Number(prevRow.avg_latency_ms)
          : null

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

function parseVerParts(v: string): [number, number, number] {
  const m = v.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!m) return [0, 0, 0]
  return [parseInt(m[1] ?? '0', 10), parseInt(m[2] ?? '0', 10), parseInt(m[3] ?? '0', 10)]
}
function versionGt(a: string, b: string): boolean {
  const [a0, a1, a2] = parseVerParts(a)
  const [b0, b1, b2] = parseVerParts(b)
  if (a0 !== b0) return a0 > b0
  if (a1 !== b1) return a1 > b1
  return a2 > b2
}

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

  isSafeUrl(url)
    .then(safe => {
      if (!safe) {
        res.status(400).json({ error: 'Invalid url' })
        return
      }
      return Promise.all([
        pool.query(
          `SELECT version, first_seen_at FROM mint_version_history
           WHERE url = $1 ORDER BY first_seen_at DESC LIMIT 50`,
          [url]
        ),
        pool.query('SELECT DISTINCT version FROM mint_version_history'),
      ]).then(([result, globalResult]) => {
        const globalVersions = (globalResult.rows as { version: string }[]).map(r => r.version)
        let latestGlobalVersion: string | null = null
        for (const v of globalVersions) {
          if (!latestGlobalVersion || versionGt(v, latestGlobalVersion)) latestGlobalVersion = v
        }
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
      const NUT_KEYS = ['4','5','7','8','9','10','11','12','14','15','17','19','20','29']
      const total = rows.length
      const nuts = NUT_KEYS.map(key => ({
        nut: `NUT-${key.padStart(2, '0')}`,
        percent: total > 0
          ? Math.round(rows.filter(r => r.nuts_limits[key] != null).length / total * 100)
          : 0,
        mints: rows.filter(r => r.nuts_limits[key] != null).map(r => r.url),
      }))
      res.json(nuts)
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/nuts]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

app.get('/api/stats', (_req: Request, res: Response): void => {
  Promise.all([
    pool.query(`
      SELECT m.url, m.name, m.last_trust_score, m.nuts_limits,
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
      type MintRow = { url: string; name: string | null; last_trust_score: number | null; nuts_limits: Record<string, unknown> | null; online: boolean | null; latency_ms: number | null }
      const rows = mintsResult.rows as MintRow[]
      const online = rows.filter(r => r.online === true)
      const offline = rows.filter(r => r.online === false)
      const nonOffline = rows.filter(r => r.online !== false)
      const onlineTrustScores = online.map(r => r.last_trust_score ?? 0)
      const avgTrustScore = onlineTrustScores.length > 0
        ? Math.round(onlineTrustScores.reduce((a, b) => a + b) / onlineTrustScores.length)
        : null
      const avgLatency24h = latencyResult.rows[0]?.avg_latency as number | null ?? null
      const low = onlineTrustScores.filter(s => s < 40).length
      const moderate = onlineTrustScores.filter(s => s >= 40 && s < 70).length
      const high = onlineTrustScores.filter(s => s >= 70).length
      // Matches ALL_NUTS in MintDetail — mandatory baseline NUTs (1,2,3,6) are never
      // returned in /v1/info nuts object, so they cannot be tracked here.
      const NUT_KEYS = ['4','5','7','8','9','10','11','12','14','15','17','19','20','29']
      const onlineWithNuts = online.filter(r => r.nuts_limits != null)
      const totalForAdoption = onlineWithNuts.length
      const nutAdoption = NUT_KEYS.map(key => ({
        nut: `NUT-${key.padStart(2, '0')}`,
        count: onlineWithNuts.filter(r => r.nuts_limits && r.nuts_limits[key] != null).length,
        percent: totalForAdoption > 0
          ? Math.round(onlineWithNuts.filter(r => r.nuts_limits && r.nuts_limits[key] != null).length / totalForAdoption * 100)
          : 0,
      }))
      const top5 = [...rows]
        .filter(r => r.last_trust_score != null)
        .sort((a, b) => (b.last_trust_score as number) - (a.last_trust_score as number))
        .slice(0, 5)
        .map(r => ({ url: r.url, name: r.name, trustScore: r.last_trust_score as number }))
      res.json({ totalMints: rows.length, onlineMints: online.length, offlineMints: offline.length, avgTrustScore, avgLatency24h, trustDistribution: { low, moderate, high }, nutAdoption, top5ByTrustScore: top5 })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/stats]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

app.get('/api/mints/known', (_req: Request, res: Response): void => {
  if (knownMintsCache && Date.now() < knownMintsCache.expiresAt) {
    res.json(knownMintsCache.data)
    return
  }
  pool
    .query(`
      SELECT m.url, m.name, m.icon_url, m.version, m.nut_count,
        m.tos_url, m.description_long, m.nuts_limits,
        m.audit_n_mints, m.audit_n_melts, m.audit_n_errors, m.audit_checked_at,
        m.discovered_at, m.last_trust_score, m.last_error, m.server_location,
        COUNT(h.online) AS total,
        COALESCE(SUM(CASE WHEN h.online THEN 1 ELSE 0 END), 0) AS online_count,
        latest.online AS latest_online,
        latest.latency_ms AS latest_latency_ms,
        latest.checked_at AS latest_checked_at
      FROM mints m
      LEFT JOIN mint_history h ON h.url = m.url AND h.checked_at > NOW() - INTERVAL '24 hours'
      LEFT JOIN LATERAL (
        SELECT online, latency_ms, checked_at FROM mint_history
        WHERE url = m.url ORDER BY checked_at DESC, id DESC LIMIT 1
      ) latest ON true
      GROUP BY m.url, m.name, m.icon_url, m.version, m.nut_count,
        m.tos_url, m.description_long, m.nuts_limits,
        m.audit_n_mints, m.audit_n_melts, m.audit_n_errors, m.audit_checked_at,
        m.discovered_at, m.last_trust_score, m.last_error, m.server_location,
        latest.online, latest.latency_ms, latest.checked_at
    `)
    .then(result => {
      const data = result.rows.map(r => {
        const total = Number(r.total)
        const onlineCount = Number(r.online_count)
        return {
          url: r.url as string,
          name: r.name as string | null,
          iconUrl: (r.icon_url as string | null) ?? null,
          degraded: total >= 4 && onlineCount === 0,
          online: r.latest_online as boolean | null,
          latencyMs: r.latest_latency_ms as number | null,
          version: r.version as string | null,
          nutCount: r.nut_count as number | null,
          tosUrl: (r.tos_url as string | null) ?? null,
          descriptionLong: (r.description_long as string | null) ?? null,
          nutsLimits: (r.nuts_limits as Record<string, unknown> | null) ?? null,
          auditNMints: (r.audit_n_mints as number | null) ?? null,
          auditNMelts: (r.audit_n_melts as number | null) ?? null,
          auditNErrors: (r.audit_n_errors as number | null) ?? null,
          auditCheckedAt: (r.audit_checked_at as string | null) ?? null,
          discoveredAt: (r.discovered_at as string | null) ?? null,
          trustScore: (r.last_trust_score as number | null) ?? null,
          lastError: (r.last_error as string | null) ?? null,
          uptimePct24h: total === 0 ? null : Math.round(onlineCount / total * 100),
          serverLocation: (r.server_location as string | null) ?? null,
          lastCheckedAt: (r.latest_checked_at as string | null) ?? null,
        }
      })
      knownMintsCache = { data, expiresAt: Date.now() + KNOWN_MINTS_CACHE_TTL }
      res.setHeader('Cache-Control', 'max-age=300')
      res.json(data)
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mints/known]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
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

  isSafeUrl(url)
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

app.post('/api/mint/submit', (req: Request, res: Response): void => {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
  if (!checkSubmitRateLimit(ip)) {
    res.status(429).json({ error: 'Too many requests. Try again later.' })
    return
  }

  const body = req.body as { url?: unknown }
  const url = body.url

  if (typeof url !== 'string' || url.length === 0) {
    res.status(400).json({ error: 'Missing required field: url' })
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
          res.status(400).json({ error: 'URL does not appear to be a valid Cashu mint' })
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
        knownMintsCache = null
        res.json({ success: true, isNew, name: status.info?.name ?? null })
      })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mint/submit]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

const MAX_DISCOVER_BATCH = 100

app.post('/api/mints/discover', async (req: Request, res: Response): Promise<void> => {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
  if (!checkDiscoverRateLimit(ip)) {
    res.status(429).json({ error: 'Too many requests. Try again later.' })
    return
  }

  const body = req.body as { urls?: unknown }
  if (!Array.isArray(body.urls)) {
    res.status(400).json({ error: 'urls must be array' })
    return
  }

  if (body.urls.length > MAX_DISCOVER_BATCH) {
    res.status(400).json({ error: `urls exceeds maximum batch size of ${MAX_DISCOVER_BATCH}` })
    return
  }

  let added = 0
  for (const url of body.urls) {
    if (typeof url !== 'string') continue
    if (url.length > MAX_URL_LENGTH) continue
    if (!url.startsWith('https://')) continue
    const normalized = normalizeUrl(url)
    try {
      if (!(await isSafeUrl(normalized))) continue
      const result = await pool.query(
        'INSERT INTO mints (url, is_known) VALUES ($1, true) ON CONFLICT (url) DO NOTHING',
        [normalized]
      )
      if (result.rowCount !== null && result.rowCount > 0) added++
    } catch { continue }
  }

  if (added > 0) knownMintsCache = null
  res.json({ added, total: body.urls.length })
})

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

  const cached = nostrReviewsCache.get(url)
  if (cached && Date.now() < cached.expiresAt) {
    res.json(cached.data)
    return
  }

  if (!globalThis.WebSocket) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).WebSocket = WebSocket
  }

  const nostrPool = new SimplePool()

  Promise.race([
    nostrPool.querySync(NOSTR_REVIEWS_RELAYS, { kinds: [38000], '#u': [url], limit: 50 }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), NOSTR_REVIEWS_TIMEOUT_MS)
    ),
  ])
    .then(events => {
      const validEvents = events.filter(e => verifyEvent(e))
      // One review per pubkey — keep the most recent
      const byPubkey = new Map<string, typeof validEvents[0]>()
      for (const e of validEvents) {
        const existing = byPubkey.get(e.pubkey)
        if (!existing || e.created_at > existing.created_at) {
          byPubkey.set(e.pubkey, e)
        }
      }

      const reviews: NostrReviewEntry[] = []
      for (const e of byPubkey.values()) {
        const ratingTag = (e.tags as string[][]).find(t => t[0] === 'rating')
        const commentTag = (e.tags as string[][]).find(t => t[0] === 'comment')
        const rating = ratingTag ? parseInt(ratingTag[1] ?? '', 10) : 0
        const content = commentTag ? (commentTag[1] ?? '') : (e.content ?? '')
        if (rating >= 1 && rating <= 5) {
          reviews.push({ id: e.id, pubkey: e.pubkey, content, rating, createdAt: e.created_at, source: 'nostr' })
        }
      }

      reviews.sort((a, b) => b.createdAt - a.createdAt)
      nostrReviewsCache.set(url, { data: reviews, expiresAt: Date.now() + NOSTR_REVIEWS_CACHE_TTL })
      nostrPool.destroy()
      res.json(reviews)
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mints/nostr-reviews]', err)
      nostrPool.destroy()
      res.json([])
    })
})

// ── Start ──────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`MintRadar backend listening on port ${PORT}`)
  initDb()
    .then(() => seedKnownMints(upsertMint))
    .then(() => { startCron() })
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
