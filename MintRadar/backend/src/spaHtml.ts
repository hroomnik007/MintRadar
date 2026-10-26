import { readFile, stat } from 'node:fs/promises'
import { decode as decodeNip19 } from 'nostr-tools/nip19'
import { escapeHtml } from './og.js'
import { cleanMintName } from './shared/cleanMintName.js'
import { LEARN_MODULES } from './shared/learnModules.js'
import {
  duplicateNamesOf, mintHostname, resolveMintDetailUrl, resolveStrippedMintName, stripCleanedNameQuotes,
} from './shared/mintSlug.js'
import {
  LEARN_MODULE_NOT_FOUND_TITLE, MINT_NOT_FOUND_TITLE, NOT_FOUND_TITLE, ROUTE_META_BY_PATH, SITE_DESCRIPTION,
  learnModuleTitle, mintDetailMeta, type RouteMetaPath,
} from './shared/pageMeta.js'

// Server-side head of the SPA (index.html) for crawlers and link previews that do not run JavaScript.
//
// nginx sends an HTML navigation that is not a file (try_files $uri @spa_html, deploy/nginx.conf) here. This module
// answers with the built index.html and only its <head> changed: <title>, the meta description, the canonical link,
// og:title / og:description / og:url, twitter:title / twitter:description, and a robots noindex where the page sets
// one. The values come from the SAME definitions the browser uses (shared/pageMeta.ts, shared/mintSlug.ts,
// shared/learnModules.ts), so the head a crawler sees is the head the page sets after it loads.
//
// Status: 200 for every page the router renders; 404 (with the SPA 404 page, noindex, no canonical, og:url = the
// opened address) for an unknown route, an unknown Learn module, a /mint/ address that is not a tracked mint or does
// not decode, and a /mint/nostr/ link that is not a kind-38172 naddr. The body is the same index.html either way,
// so the browser renders its own not-found page.
//
// Route matching mirrors React Router 7 (src/App.tsx): static segments case-insensitive, one optional trailing
// slash, each segment percent-decoded once (a segment that does not decode → 404).

export const SITE_ORIGIN = 'https://mintradar.org'

export interface SpaKnownMint {
  url: string
  name?: string | null
  online?: boolean | null
  reliabilityScore?: number | null
}

export interface SpaHead {
  status: 200 | 404
  title: string
  description: string
  /** Absolute canonical URL; null = no canonical link (not-found and redirector pages). */
  canonical: string | null
  ogUrl: string
  noindex: boolean
}

// The static routes of src/App.tsx (path → its ROUTE_META_BY_PATH key).
const STATIC_ROUTES: ReadonlyMap<string, RouteMetaPath> = new Map(
  (Object.keys(ROUTE_META_BY_PATH) as RouteMetaPath[]).map(k => [k === '/' ? '' : k.slice(1), k]),
)

function decodeSegments(segments: string[]): string[] | null {
  try {
    return segments.map(s => decodeURIComponent(s))
  } catch {
    return null
  }
}

function notFound(title: string, ownUrl: string): SpaHead {
  return { status: 404, title, description: SITE_DESCRIPTION, canonical: null, ogUrl: ownUrl, noindex: true }
}

function isMintNaddr(naddr: string): boolean {
  try {
    const d = decodeNip19(naddr)
    return d.type === 'naddr' && d.data.kind === 38172
  } catch {
    return false
  }
}

// The Mint Detail display name, exactly as the page computes it (mintFormatting.ts displayName over the known list).
function mintDisplayNameOf(mint: SpaKnownMint, known: readonly SpaKnownMint[]): string {
  const strip = (n: string | null | undefined): string => stripCleanedNameQuotes(cleanMintName(n, ''))
  const duplicates = duplicateNamesOf(known.map(m => strip(m.name)))
  return resolveStrippedMintName(strip(mint.name), mint.url, duplicates).text
}

/**
 * The head for one request path. `rawPath` is the path as sent (still percent-encoded, no query), `known` the
 * tracked mints of the /api/mints/known snapshot.
 */
export function resolveSpaHead(rawPath: string, known: readonly SpaKnownMint[]): SpaHead {
  // og:url of a not-found page names the address that was opened (never the home page). The raw path is already
  // percent-encoded; anything outside the URL alphabet is encoded so the value is one clean URL.
  const ownPath = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath
  const ownUrl = SITE_ORIGIN + (ownPath === '' ? '/' : urlSafePath(ownPath))

  let segments = rawPath.split('/').slice(1)
  if (segments.length > 1 && segments[segments.length - 1] === '') segments = segments.slice(0, -1)
  const decoded = decodeSegments(segments)
  if (decoded === null) return notFound(NOT_FOUND_TITLE, ownUrl)
  const lower = decoded.map(s => s.toLowerCase())

  if (decoded.length === 1) {
    const key = STATIC_ROUTES.get(lower[0]!)
    if (key !== undefined) {
      const meta: { title: string; description: string; noindex?: boolean } = ROUTE_META_BY_PATH[key]
      const canonical = `${SITE_ORIGIN}${key}`
      return {
        status: 200, title: meta.title, description: meta.description, canonical, ogUrl: canonical,
        noindex: meta.noindex === true,
      }
    }
  }

  if (decoded.length === 2 && lower[0] === 'learn' && decoded[1] !== '') {
    const id = decoded[1]!
    const sorted = [...LEARN_MODULES].sort((a, b) => a.order - b.order)
    const mod = /^[1-9][0-9]*$/.test(id) ? sorted.find(m => m.order === Number(id)) : sorted.find(m => m.id === id)
    if (!mod) return notFound(LEARN_MODULE_NOT_FOUND_TITLE, ownUrl)
    const canonical = `${SITE_ORIGIN}/learn/${mod.id}`
    return { status: 200, title: learnModuleTitle(mod.title), description: mod.summary, canonical, ogUrl: canonical, noindex: false }
  }

  if (decoded.length === 3 && lower[0] === 'mint' && lower[1] === 'nostr' && decoded[2] !== '') {
    if (!isMintNaddr(decoded[2]!)) return notFound(MINT_NOT_FOUND_TITLE, ownUrl)
    // A redirector page (it looks the mint up on relays and opens its Mint Detail): served, never indexed.
    const home = ROUTE_META_BY_PATH['/']
    return { status: 200, title: home.title, description: home.description, canonical: null, ogUrl: ownUrl, noindex: true }
  }

  if (decoded.length === 2 && lower[0] === 'mint' && decoded[1] !== '') {
    // MintDetail.tsx: the route param, decoded once more (safeDecode), resolved against the tracked mints.
    let slug: string
    try { slug = decodeURIComponent(decoded[1]!) } catch { return notFound(MINT_NOT_FOUND_TITLE, ownUrl) }
    const res = resolveMintDetailUrl(slug, known)
    if (res.kind === 'not-tracked') return notFound(MINT_NOT_FOUND_TITLE, ownUrl)
    const mint = known.find(m => m.url === res.url)!
    const meta = mintDetailMeta(mintDisplayNameOf(mint, known), mintHostname(mint.url), mint)
    const canonical = `${SITE_ORIGIN}/mint/${encodeURIComponent(mint.url)}`
    return { status: 200, title: meta.title, description: meta.description, canonical, ogUrl: canonical, noindex: false }
  }

  return notFound(NOT_FOUND_TITLE, ownUrl)
}

// Keeps the path's own percent-escapes; encodes every other character outside the URL path alphabet, and a "%" that
// does not start an escape.
function urlSafePath(path: string): string {
  return path
    .replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
    .replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@/%]/gu, c => encodeURIComponent(c))
}

// ── index.html rewrite ─────────────────────────────────────────
// Every value is HTML-escaped (escapeHtml, og.ts): a mint name comes from the mint's own /v1/info. Replacements use
// replacer functions, so a "$" in a value is never read as a replacement pattern.

function replaceContent(html: string, re: RegExp, value: string): string {
  return html.replace(re, (_m, before: string, after: string) => `${before}${escapeHtml(value)}${after}`)
}

const META_CONTENT = (attr: 'name' | 'property', key: string): RegExp =>
  new RegExp(`(<meta ${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" content=")[^"]*(")`)

export function renderSpaHtml(template: string, head: SpaHead): string {
  let html = template.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(head.title)}</title>`)
  html = replaceContent(html, META_CONTENT('name', 'description'), head.description)
  html = replaceContent(html, META_CONTENT('property', 'og:title'), head.title)
  html = replaceContent(html, META_CONTENT('property', 'og:description'), head.description)
  html = replaceContent(html, META_CONTENT('property', 'og:url'), head.ogUrl)
  html = replaceContent(html, META_CONTENT('name', 'twitter:title'), head.title)
  html = replaceContent(html, META_CONTENT('name', 'twitter:description'), head.description)
  const canonicalRe = /[ \t]*<link rel="canonical" href="[^"]*" \/>\n?/
  html = head.canonical !== null
    ? html.replace(/(<link rel="canonical" href=")[^"]*(")/, (_m, b: string, a: string) => `${b}${escapeHtml(head.canonical!)}${a}`)
    : html.replace(canonicalRe, '')
  if (head.noindex) {
    html = html.replace(/<meta name="description"/, () => '<meta name="robots" content="noindex, follow" />\n    <meta name="description"')
  }
  return html
}

// ── Template ───────────────────────────────────────────────────
// The built index.html, read from SPA_INDEX_HTML (docker-compose mounts the deployed dist/ read-only at
// /srv/mintradar-dist). Re-read when its mtime or size changes (a deploy replaces it); null when it is missing.

export const SPA_INDEX_HTML_DEFAULT = '/srv/mintradar-dist/index.html'
let cached: { key: string; html: string } | null = null

export async function loadSpaTemplate(path: string = process.env['SPA_INDEX_HTML'] ?? SPA_INDEX_HTML_DEFAULT): Promise<string | null> {
  try {
    const st = await stat(path)
    const key = `${path}:${st.mtimeMs}:${st.size}`
    if (cached?.key === key) return cached.html
    const html = await readFile(path, 'utf8')
    if (!/<title>[^<]*<\/title>/.test(html)) return null
    cached = { key, html }
    return html
  } catch {
    return null
  }
}

/** Test hook. */
export function _resetSpaTemplateCacheForTest(): void { cached = null }
