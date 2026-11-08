// GET /health, GET /api (pointer for humans) and GET /sitemap.xml.
import { Router } from 'express'
import { type Request, type Response } from 'express'
import { pool } from '../db.js'
import { METHODOLOGY_CHANGES } from '../shared/methodology.js'
import { getAuditCzSyncStatus, auditCzSourceStatus } from '../auditCz.js'
import { getLastProbeCompletedAt } from '../cron.js'
import { getLastVantageOutageAt } from '../probeCycle.js'
import { isReady } from '../readiness.js'
import { getSyncTimesFromDb, getAuditUpstreamStatus } from '../discovery.js'
import { isTestMint } from '../testMints.js'
import { isArchivedMint } from '../archived.js'
import { LEARN_MODULES } from '../shared/learnModules.js'
import { IS_DEV } from '../serverConfig.js'

export const router = Router()

// ── Routes ─────────────────────────────────────────────────────

router.get('/health', async (_req: Request, res: Response) => {
  // While starting (initDb() may hold DDL locks) /health makes no database call at all: the two database-derived
  // sync times are null, everything else is in-memory and unchanged. Once ready it reads them as before.
  const ready = isReady()
  const { lastAuditSyncAt, lastReviewsSyncAt } = ready
    ? await getSyncTimesFromDb()
    : { lastAuditSyncAt: null, lastReviewsSyncAt: null }
  const lastProbeAt = getLastProbeCompletedAt()
  const audit8333 = getAuditUpstreamStatus()
  const auditCz = getAuditCzSyncStatus()
  const cashuInfoStatus = auditCzSourceStatus(auditCz)
  res.json({
    status: 'ok',
    // false while initDb() and the seed are still running (other database routes answer 503 then); status stays 200.
    ready,
    timestamp: new Date().toISOString(),
    lastProbeAt,
    lastVantageOutageAt: getLastVantageOutageAt(),
    lastAuditSyncAt,
    lastReviewsSyncAt,
    // auditUpstream(CheckedAt) follow cashu.info, the audit source of the score (since 2026-10-29); the legacy
    // audit.8333.space outcome is only in sources.audit8333.
    auditUpstream: cashuInfoStatus,
    auditUpstreamCheckedAt: auditCz.lastSyncAt,
    auditCz,
    // Additive: the same facts grouped by input. usedForScore says whether the source feeds the
    // Reliability Score (docs/API.md "GET /health"); audit.8333.space is display only since methodology 2.
    sources: {
      ownProbe: { usedForScore: true, lastProbeAt },
      cashuInfo: { usedForScore: true, lastSyncAt: auditCz.lastSyncAt, status: cashuInfoStatus },
      reviews: { usedForScore: false, lastSyncAt: lastReviewsSyncAt },
      audit8333: { usedForScore: false, lastSyncAt: lastAuditSyncAt, status: audit8333.auditUpstream },
    },
  })
})

// API root: a pointer for humans who open /api or /api/ (Express answers /api/ for /api too, non-strict
// routing). Counted by the normal per-IP limiter like any other read.
router.get('/api', (_req: Request, res: Response): void => {
  res.json({
    name: 'MintRadar API',
    docs: 'https://github.com/hroomnik007/MintRadar/blob/main/MintRadar/docs/API.md',
    health: '/api/v1/health',
  })
})

// Static routes here must stay in sync with App.tsx's route list (spaHtml.ts SPA_STATIC_ROUTES has the same list).
// The Learn modules come from shared/learnModules.ts, the backend copy of src/constants/learnModules.ts.
// `lastmod` (YYYY-MM-DD) only where the content has a date of its own: /methodology = the date of the newest
// METHODOLOGY_CHANGES entry (it changes with the formula); /for-wallets = FOR_WALLETS_PAGE_LASTMOD, bumped by hand
// when the page content changes.
export const METHODOLOGY_LASTMOD = METHODOLOGY_CHANGES.reduce((latest, c) => (c.date > latest ? c.date : latest), '')
export const FOR_WALLETS_PAGE_LASTMOD = '2026-11-06'
export const SITEMAP_STATIC_PATHS: Array<{ loc: string; changefreq: string; priority: string; lastmod?: string }> = [
  { loc: '/', changefreq: 'hourly', priority: '1.0' },
  { loc: '/stats', changefreq: 'daily', priority: '0.8' },
  { loc: '/tools', changefreq: 'weekly', priority: '0.7' },
  { loc: '/wallets', changefreq: 'weekly', priority: '0.6' },
  { loc: '/learn', changefreq: 'monthly', priority: '0.6' },
  ...[...LEARN_MODULES].sort((a, b) => a.order - b.order)
    .map(m => ({ loc: `/learn/${m.id}`, changefreq: 'monthly', priority: '0.5' })),
  { loc: '/about', changefreq: 'monthly', priority: '0.5' },
  { loc: '/methodology', changefreq: 'monthly', priority: '0.6', lastmod: METHODOLOGY_LASTMOD },
  { loc: '/for-wallets', changefreq: 'monthly', priority: '0.6', lastmod: FOR_WALLETS_PAGE_LASTMOD },
]

// Dynamically includes every tracked mint's /mint/:url page (excluding test mints) —
// a static file can't, since the mint list changes as mints are discovered/removed.
// See docs/claude/deploy-and-infra.md "Deploy Pipeline Notes" — nginx routes /sitemap.xml here instead of
// serving a static frontend file, mirroring the /health proxy above.
router.get('/sitemap.xml', (_req: Request, res: Response): void => {
  // Archived mints (archived.ts, the same rule as the `archived` flag of /api/mints/known) are left out: their page
  // stays reachable, but a mint gone for 30+ days is not a page to ask a search engine to crawl.
  pool.query(`
    SELECT m.url, m.last_online_at, latest.online AS latest_online
      FROM mints m
      LEFT JOIN LATERAL (
        SELECT online FROM mint_history WHERE url = m.url ORDER BY checked_at DESC, id DESC LIMIT 1
      ) latest ON true
     ORDER BY m.url`)
    .then(result => {
      const mintUrls = (result.rows as { url: string; last_online_at?: Date | string | null; latest_online?: boolean | null }[])
        .filter(r => !isArchivedMint(r.last_online_at, r.latest_online))
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
