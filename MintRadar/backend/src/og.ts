import { pool } from './db.js'
import { computeDegraded } from './degraded.js'
import { mintStatus } from './shared/mintStatus.js'
import { publicMintName, isHiddenMintName } from './mintNames.js'
import { PAGE_META, OG_PAGE_SLUGS } from './shared/pageMeta.js'

// Minimal HTML fragment served ONLY to social-media crawlers (see nginx
// user-agent map, deploy/nginx.conf) that hit /mint/:url — they don't run JS,
// so they never see the SPA's client-rendered OG tags. Regular browsers never
// reach this route; they get the normal SPA `index.html` via try_files.

export interface OgMintData {
  name: string | null
  reliabilityScore: number | null
  online: boolean | null
  degraded: boolean
  /** Extra facts of the link preview (2026-11-13); each is left out of the description when absent. */
  uptimePct24h?: number | null
  nutCount?: number | null
  reviewAvgRating?: number | null
  reviewRatedCount?: number | null
}

// The description of a mint's link preview: score and status first (as before), then the facts we have. Numbers only,
// nothing mint-supplied, so there is nothing to escape beyond what renderHtml already does.
export function mintOgDescription(mint: OgMintData): string {
  const reliabilityScoreText = mint.reliabilityScore !== null ? `${mint.reliabilityScore}/100` : 'N/A'
  const parts = [`Reliability Score: ${reliabilityScoreText}`, mintStatusLabel(mint)]
  if (typeof mint.uptimePct24h === 'number' && Number.isFinite(mint.uptimePct24h)) parts.push(`${mint.uptimePct24h}% uptime (24h)`)
  if (typeof mint.nutCount === 'number' && mint.nutCount > 0) parts.push(`${mint.nutCount} NUTs`)
  const n = mint.reviewRatedCount ?? 0
  if (typeof mint.reviewAvgRating === 'number' && Number.isFinite(mint.reviewAvgRating) && n > 0) {
    parts.push(`rated ${mint.reviewAvgRating.toFixed(1)}/5 in ${n} ${n === 1 ? 'review' : 'reviews'}`)
  }
  return parts.join(' · ')
}

// Escapes text for safe interpolation into both HTML body text and
// double-quoted HTML attribute values. Mint `name` originates from the
// mint's own untrusted /v1/info response, so this is a real trust boundary,
// not defensive-for-its-own-sake.
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Same rule and words as the website (shared/mintStatus.ts, src/utils/mintFormatting.ts mintStatusLabel):
// a degraded mint reads "Degraded", like its Dashboard card and Mint detail page.
export function mintStatusLabel(mint: Pick<OgMintData, 'online' | 'degraded'>): string {
  const s = mintStatus(mint)
  return s === 'online' ? 'Online' : s === 'degraded' ? 'Degraded' : 'Offline'
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

const SITE_URL = 'https://mintradar.org'
const OG_IMAGE_URL = `${SITE_URL}/og-image-radar.png`

// Renders the standalone OG HTML fragment for one mint. `mint` is null when
// the URL isn't a known mint — crawlers still get a valid, generic MintRadar
// page rather than a 404/500 with no preview at all.
export function renderMintOgHtml(mint: OgMintData | null, mintUrl: string): string {
  const pageUrl = mintUrl.length > 0 ? `${SITE_URL}/mint/${encodeURIComponent(mintUrl)}` : SITE_URL

  if (mint === null) {
    const title = 'MintRadar - Cashu Mint Monitor'
    const description = 'Real-time Reliability Score, latency & NUT monitoring for Cashu mints. Open source & privacy first.'
    return renderHtml(title, description, pageUrl)
  }

  // Cleaned for display; a mint on the hidden list (or with nothing displayable left) shows its hostname.
  const displayName = publicMintName(mint.name, mintUrl).name
    ?? (isHiddenMintName(mintUrl) ? hostnameOf(mintUrl) : mintUrl)
  const title = `${displayName} — MintRadar`
  const description = mintOgDescription(mint)

  return renderHtml(title, description, pageUrl)
}

// `page` is set only for the static documentation pages (renderPageOgHtml): it adds the canonical link and a
// visible link to the real page. Without it the output is exactly what the mint fragment always was.
function renderHtml(title: string, description: string, pageUrl: string, page?: { linkText: string }): string {
  const safeTitle = escapeHtml(title)
  const safeDescription = escapeHtml(description)
  const safePageUrl = escapeHtml(pageUrl)
  const canonicalLink = page ? `\n    <link rel="canonical" href="${safePageUrl}" />` : ''
  const body = page ? `\n    <p><a href="${safePageUrl}">${escapeHtml(page.linkText)}</a></p>\n  ` : ''

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${safeTitle}</title>${canonicalLink}
    <meta name="description" content="${safeDescription}" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDescription}" />
    <meta property="og:url" content="${safePageUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="MintRadar" />
    <meta property="og:image" content="${OG_IMAGE_URL}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDescription}" />
    <meta name="twitter:image" content="${OG_IMAGE_URL}" />
  </head>
  <body>${body}</body>
</html>
`
}

// GET /api/og/page?p=<slug> — the bot HTML of a static documentation page (/methodology, /for-wallets), routed
// here by fixed `location = /path` rules in deploy/nginx.conf. The slug is looked up in a strict allowlist
// (Map, so `__proto__` or `constructor` are just unknown keys); every word of the output comes from PAGE_META
// (shared/pageMeta.ts), none from the request. Returns null for anything not on the list.
const PAGE_SLUGS: ReadonlyMap<string, keyof typeof PAGE_META> = new Map(Object.entries(OG_PAGE_SLUGS))

export function renderPageOgHtml(slug: unknown): string | null {
  if (typeof slug !== 'string') return null
  const path = PAGE_SLUGS.get(slug)
  if (path === undefined) return null
  const meta = PAGE_META[path]
  return renderHtml(meta.title, meta.description, `${SITE_URL}${meta.canonicalPath}`, { linkText: meta.title })
}

// Scoped, single-mint version of the /api/mints/known aggregate query —
// reuses the same shape (24h window join + LATERAL latest probe) so
// computeDegraded() behaves identically, without pulling in the full
// known-mints payload (icon/NUTs/audit/etc.) that this fragment doesn't need.
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function fetchOgMintData(url: string): Promise<OgMintData | null> {
  const result = await pool.query(
    `SELECT m.name, m.last_reliability_score, m.nut_count, m.review_avg_rating, m.review_rated_count,
        COUNT(h.online) AS total,
        COALESCE(SUM(CASE WHEN h.online THEN 1 ELSE 0 END), 0) AS online_count,
        latest.online AS latest_online,
        latest.checked_at AS latest_checked_at
      FROM mints m
      LEFT JOIN mint_history h ON h.url = m.url AND h.checked_at > NOW() - INTERVAL '24 hours'
      LEFT JOIN LATERAL (
        SELECT online, checked_at FROM mint_history
        WHERE url = m.url ORDER BY checked_at DESC, id DESC LIMIT 1
      ) latest ON true
      WHERE m.url = $1
      GROUP BY m.name, m.last_reliability_score, m.nut_count, m.review_avg_rating, m.review_rated_count, latest.online, latest.checked_at`,
    [url]
  )

  if (result.rows.length === 0) return null

  const row = result.rows[0] as Record<string, unknown>
  const total = Number(row['total'])
  const onlineCount = Number(row['online_count'])
  const latestOnline = row['latest_online'] as boolean | null
  const latestCheckedAt = row['latest_checked_at'] as string | null

  return {
    name: row['name'] as string | null,
    reliabilityScore: (row['last_reliability_score'] as number | null) ?? null,
    online: latestOnline,
    degraded: computeDegraded(total, onlineCount, latestOnline, latestCheckedAt),
    uptimePct24h: total > 0 ? Math.round((onlineCount / total) * 100) : null,
    nutCount: numOrNull(row['nut_count']),
    reviewAvgRating: numOrNull(row['review_avg_rating']),
    reviewRatedCount: numOrNull(row['review_rated_count']),
  }
}
