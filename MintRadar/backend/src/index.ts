// MintRadar backend entry: environment check, the Express app and its middleware chain (security headers, /api/v1
// rewrite, CORS, readiness gate, JSON body, rate limits), the routers, the /api 404 and the server-side SPA head, and
// the start-up sequence. Where things live: serverConfig.ts (IS_DEV, origins, shared helpers), rateLimits.ts (every
// limiter and its middleware), onDemandProbe.ts (GET /api/mint/probe's live probe), knownMintsSnapshot.ts (the
// /api/mints/known rows shared with the wallet API), routes/*.ts (one router per area).
import './wsPolyfill.js'
import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { initDb } from './db.js'
import { upsertMint } from './prober.js'
import { seedKnownMints, startCron } from './cron.js'
import { publishServiceProfile } from './nostrService.js'
import { startAttestations } from './healthPublisher.js'
import { readinessGate, isReady, openGateAfter } from './readiness.js'
import { loadSpaTemplate, renderSpaHtml, resolveSpaHead, type SpaKnownMint } from './spaHtml.js'
import { isPublicCorsPath, PUBLIC_CORS_EXPOSE_HEADERS, sendWalletError } from './walletApi.js'
import { isAllowlistMode } from './allowlist.js'
import { IS_DEV, ALLOWED_ORIGINS } from './serverConfig.js'
import { rateLimitMiddleware } from './rateLimits.js'
import { knownMints, loadKnownMints } from './knownMintsSnapshot.js'
import { stats, RELIABILITY_TREND_REFRESH_MS, refreshReliabilityTrendCache } from './routes/stats.js'
import { router as metaRouter } from './routes/meta.js'
import { router as mintsRouter } from './routes/mints.js'
import { router as statsRouter } from './routes/stats.js'
import { router as walletRouter } from './routes/wallet.js'
import { router as submitRouter } from './routes/submit.js'
import { router as notificationsRouter } from './routes/notifications.js'

// Re-exported for backend/src/__tests__/nostrReviewsRelays.test.ts (a drift
// tripwire that pins the exact array). The list itself now lives in
// reviewsSync.ts, which owns the only remaining server-side relay fetch of
// kind:38000 reviews (the hourly background sync). GET /api/mints/nostr-reviews no
// longer touches a relay — it serves the DB rows that sync populates.
export { REVIEW_SYNC_RELAYS as NOSTR_REVIEWS_RELAYS } from './reviewsSync.js'

const REQUIRED_ENV_VARS = ['DATABASE_URL', 'ALLOWED_ORIGINS'] as const
const missingVars = REQUIRED_ENV_VARS.filter(v => !process.env[v])
if (missingVars.length > 0) {
  for (const v of missingVars) console.error(`ERROR: Missing required environment variable: ${v}`)
  process.exit(1)
}
console.log('ENV OK')

const PORT = parseInt(process.env['PORT'] ?? '3002', 10)

// ── Types ──────────────────────────────────────────────────────

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

// Readiness gate (readiness.ts): 503 {"error":"starting"} + Retry-After: 2 on database-dependent routes until
// initDb() and the seed have finished. Before the body parser and the rate limiter, so a refused request costs
// neither a parse nor a rate-limit slot.
app.use(readinessGate)

app.use(express.json())

app.use(rateLimitMiddleware)

// ── Routes (routes/*.ts); registered in this order, before the /api 404 and the SPA head below ──
app.use(metaRouter)
app.use(mintsRouter)
app.use(statsRouter)
app.use(walletRouter)
app.use(submitRouter)
app.use(notificationsRouter)

// Any /api/* path no route above answered: JSON, never Express's HTML "Cannot GET". /api/v1/* uses the wallet API's
// error envelope, the other paths the { error: "text" } shape the rest of the API uses (og/page does the same).
// The /api/v1 rewrite has already run, so the original URL is what tells the two apart.
app.use('/api', (req: Request, res: Response): void => {
  if (/^\/api\/v1(?:[/?]|$)/i.test(req.originalUrl)) sendWalletError(res, 404, 'not_found', 'Unknown API route')
  else res.status(404).json({ error: 'Not found' })
})

// Server-side head of the SPA (spaHtml.ts): nginx sends an HTML navigation that is not a static file here
// (location @spa_html, deploy/nginx.conf) and answers with the built index.html itself when this returns an error.
// Every path that is not /api/*, /health or /sitemap.xml (those are answered above). 503 while starting, when the
// template is missing or the known-mints snapshot is not there in SPA_SNAPSHOT_WAIT_MS: nginx then serves the plain
// index.html, the page works exactly as before, only without the server-side head and status.
const SPA_SNAPSHOT_WAIT_MS = 2_000
const SPA_EXCLUDED_PATH = new RegExp('^(?:/api(?:/|$)|/health$|/sitemap\\.xml$)', 'i')
app.use((req: Request, res: Response, next: NextFunction): void => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || SPA_EXCLUDED_PATH.test(req.path)) { next(); return }
  const unavailable = (): void => { res.status(503).set('Cache-Control', 'no-store').type('text/plain').send('Unavailable') }
  if (!isReady()) { unavailable(); return }
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), SPA_SNAPSHOT_WAIT_MS) })
  Promise.all([loadSpaTemplate(), Promise.race([loadKnownMints(), timeout])])
    .then(([template, snap]) => {
      if (template === null || snap === null || !Array.isArray(snap.data)) { unavailable(); return }
      const head = resolveSpaHead(req.path, snap.data as SpaKnownMint[])
      res.status(head.status)
      res.set('Content-Type', 'text/html; charset=utf-8')
      // index.html is never cached (the hashed assets are); same for its server-rendered form.
      res.set('Cache-Control', 'no-cache')
      res.send(renderSpaHtml(template, head))
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[spa-html]', err)
      unavailable()
    })
    .finally(() => clearTimeout(timer))
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
    openGateAfter(() => initDb().then(() => seedKnownMints(upsertMint)))
      .then(() => {
        startCron()
        knownMints.start() // fire-and-forget warm-up + 45 s refresh timer (unref'ed); failures are logged, never thrown
        stats.start() // same for /api/stats (statsCache.ts)
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
