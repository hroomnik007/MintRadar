// The website's mint routes: live probe, history, version history, outages, recommend (deprecated), known mints,
// icon proxy, NIP-05 check, OG fragments, audit swaps, cashu.info audit, change log and the stored NIP-87 reviews.
import { Router } from 'express'
import { type Request, type Response } from 'express'
import { pool } from '../db.js'
import { isNutDeclaredSupported, isNutDisabled } from '../shared/nutSupport.js'
import { isWellFormedMintUrl } from '../ssrf.js'
import { getLatestVersionsMap } from '../versionCatalog.js'
import { splitVersionString, canonicalSoftwareName } from '../shared/reliabilityScore.js'
import { listMintChanges, ROUTE_CHANGES_MAX } from '../mintChanges.js'
import { getAuditCzForMint, clampAuditCzLimit } from '../auditCz.js'
import { normalizeUrl } from '../discovery.js'
import { rateLimitKey } from '../mintAdmission.js'
import { fetchOgMintData, renderMintOgHtml, renderPageOgHtml } from '../og.js'
import { getMintIcon, iconEtag, isResizableIcon, ICON_RESIZE_LOCATION } from '../mintIcon.js'
import { publicMintNameOrHost } from '../mintNames.js'
import { recommendEnvelope, memoizedBody, buildCachedBody, sendCachedBody, ifNoneMatchMatches } from '../walletApi.js'
import { readStoredContactChecks } from '../contactChecks.js'
import { readStoredLastContacts } from '../lastContacts.js'
import { setDeprecationHeaders, RECOMMEND_DEPRECATION } from '../deprecation.js'
import { verifyNip05 } from '../nip05Verify.js'
import { isAllowedUrl } from '../allowlist.js'
import { profileFieldsForReview } from '../profilesSync.js'
import { KNOWN_MINTS_CACHE_TTL } from '../knownMintsCache.js'
import { summarizeOutages, type OutageRow } from '../outages.js'
import { lastInfoOf } from '../lastInfo.js'
import { historyLatencyPercentilesSql, latencyPercentilesOf } from '../latencyPercentiles.js'
import { operatorKeysOf, contactKeysOf } from '../reviewsSync.js'
import { IS_DEV, MAX_URL_LENGTH } from '../serverConfig.js'
import { tryAcquireUnknownProbe, releaseUnknownProbe } from '../rateLimits.js'
import { probeKnownMint, probeMint } from '../onDemandProbe.js'
import { loadKnownMints } from '../knownMintsSnapshot.js'

export const router = Router()

router.get('/api/mint/probe', (req: Request, res: Response): void => {
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
  const ip = rateLimitKey(req.ip ?? req.socket.remoteAddress)
  pool.query(
    `SELECT m.contact_checks, m.last_contacts, m.last_contacts_at, m.last_online_at, s.info AS change_state_info,
            (SELECT h.online FROM mint_history h WHERE h.url = m.url ORDER BY h.checked_at DESC LIMIT 1) AS last_probe_online
       FROM mints m LEFT JOIN mint_change_state s ON s.url = m.url
      WHERE m.url = $1`,
    [url],
  )
    .then(async (known) => {
      if ((known.rowCount ?? 0) > 0) {
        // last_probe_online === false: the cron's latest probe found it offline (known-down fast path).
        const status = await probeKnownMint(url, known.rows[0]?.last_probe_online === false)
        // Additive, known mints only: the stored facts about the contact entries (contactChecks.ts), which Mint Detail shows
        // as one muted line under the contact information. Never a value or a domain; [] while nothing was checked.
        const contactChecks = readStoredContactChecks(known.rows[0]?.contact_checks) ?? []
        // Last published contacts for offline display. Only returned for known mints; never for unknown URLs.
        const lastContacts = readStoredLastContacts(known.rows[0]?.last_contacts)
        const lastContactsAt = known.rows[0]?.last_contacts_at ?? null
        const body: Record<string, unknown> = status.info
          ? { ...status, info: { ...status.info, name: publicMintNameOrHost(status.info.name, url) }, contactChecks }
          : { ...status, contactChecks }
        if (lastContacts && lastContacts.length > 0) {
          body.lastContacts = lastContacts
          body.lastContactsAt = lastContactsAt
        }
        // Additive, known mints only (same gate as lastContacts): the last CONFIRMED, sanitised MOTD and short description
        // (mint_change_state.info, mintChanges.ts), for Mint Detail while the live /v1/info is missing. Never for an unknown URL.
        const lastInfo = lastInfoOf(known.rows[0]?.change_state_info, known.rows[0]?.last_online_at)
        if (lastInfo) body.lastInfo = lastInfo
        res.json(body)
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
              // per-NUT config an arbitrary host might stuff in here. A switched-off NUT-04/05 keeps only
              // `disabled: true`, so the page counts it the way the score does (methodology 5).
              nuts: Object.fromEntries(Object.keys(status.info.nuts).filter(k => isNutDeclaredSupported(status.info!.nuts[k])).map(k => [k, isNutDisabled(status.info!.nuts[k]) ? { disabled: true } : {}])),
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

router.get('/api/mints/history', (req: Request, res: Response): void => {
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
        // Additive: median and p95 of the successful probes' latency over the same window as the segments (one value
        // per probe, not per bucket, so a quiet bucket does not weigh as much as a busy one).
        pool.query(historyLatencyPercentilesSql(PERIOD_DAYS[period]), [url]),
      ]).then(([segResult, prevResult, earliestResult, pctResult]) => {
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
          ...latencyPercentilesOf(pctResult?.rows?.[0]),
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

router.get('/api/mints/version-history', (req: Request, res: Response): void => {
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

router.get('/api/mints/outages', (req: Request, res: Response): void => {
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
        res.json(summarizeOutages(result.rows as OutageRow[]))
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
router.get('/api/mints/recommend', (req: Request, res: Response): void => {
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

// Cache-Control public, max-age=300 and a strong ETag on every response (cache hit or miss); If-None-Match gives 304.
router.get('/api/mints/known', (_req: Request, res: Response): void => {
  loadKnownMints()
    .then(snap => sendCachedBody(res, memoizedBody(snap, 'known', () => snap.data)))
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mints/known]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
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
export function sendNoIcon(res: Response): void {
  res.setHeader('Cache-Control', 'public, max-age=1800')
  res.status(204).end()
}

router.get('/api/mint/icon', (req: Request, res: Response): void => {
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
      // 7 days in the browser (was 1 day): the icon of a mint changes rarely, the server cache is 6 h, and a copy that
      // expired is revalidated by its strong ETag (304, no body). stale-while-revalidate: for a day past that the stale
      // copy shows at once while the 304 check runs in the background. The 204 "no icon" answer keeps its 30 minutes.
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400')
      const etag = iconEtag(icon.body)
      res.setHeader('ETag', etag)
      // Not req.fresh: fetch() adds Cache-Control: no-cache next to If-None-Match, and fresh() then never matches.
      if (ifNoneMatchMatches(req.headers['if-none-match'], etag)) {
        res.removeHeader('Content-Type')
        res.status(304).end()
        return
      }
      // Resizing is nginx's job (image_filter, deploy/nginx.conf). Its public icon location asks with X-Icon-Resize: 1;
      // for a file the filter can read we send no body and point nginx at its internal resizing location, which asks
      // again without the header and gets the bytes below. Everything else (.ico, AVIF, HEAD, a caller without the
      // header: local development, e2e, an nginx without that block) is answered as before.
      if (req.method === 'GET' && req.headers['x-icon-resize'] === '1' && isResizableIcon(icon.body)) {
        // Every header nginx copies from THIS response onto the resized one must be absent here, or it is sent twice:
        // nginx keeps Content-Type, Cache-Control, Expires, Content-Disposition, Accept-Ranges and Set-Cookie of the
        // redirecting response. A `Cache-Control: no-store` here reached the browser next to the 7-day one of the
        // second response (seen live on 2026-11-13) and would have switched icon caching off.
        res.removeHeader('Content-Type')
        res.removeHeader('ETag')
        res.removeHeader('Cache-Control')
        res.removeHeader('Content-Security-Policy')
        res.removeHeader('Cross-Origin-Resource-Policy')
        res.setHeader('X-Accel-Redirect', `${ICON_RESIZE_LOCATION}?url=${encodeURIComponent(rawUrl)}`)
        res.status(200).end()
        return
      }
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
router.get('/api/nip05/verify', (req: Request, res: Response): void => {
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

router.get('/api/og/mint', (req: Request, res: Response): void => {
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
router.get('/api/og/page', (req: Request, res: Response): void => {
  const html = renderPageOgHtml(req.query['p'])
  if (html === null) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.send(html)
})

// GET /api/mints/swaps?url= — the audit.8333.space rolling-window swap detail
// (mint_audit_swaps) for one mint, kept OUT of /api/mints/known: that endpoint
// is fetched on every Dashboard load for every mint, and embedding up to 100
// swap rows per mint there would multiply its payload size ~65x for a feature
// only the (currently unbuilt) Mint Detail Audit tab would use. /api/mints/known
// keeps only the small scalar auditAvgTimeMs; this endpoint serves the full list
// on demand, same shape as /api/mints/history|version-history.
router.get('/api/mints/swaps', (req: Request, res: Response): void => {
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
router.get('/api/mints/audit-cz', (req: Request, res: Response): void => {
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
// confirmed changes (up to ROUTE_CHANGES_MAX), when tracking of the mint started, `pending` (only when a difference was seen
// once and waits for its confirming observation; never a change) and `keysetsSeen` (first/last seen of each keyset in
// mint_keysets, for the keyset dates). A website route like /api/mints/known (the
// default CORS allow-list and the general per-IP limit); the wallet API serves the same rows as `changes`. Unknown url -> 404,
// so it is no oracle for anything but "is this mint tracked".
router.get('/api/mints/changes', (req: Request, res: Response): void => {
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
router.get('/api/mints/nostr-reviews', (req: Request, res: Response): void => {
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
