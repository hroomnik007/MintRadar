// Where mint NAMES leave the server. Names originate from the mint's own untrusted /v1/info (or an
// announcement / third-party audit), so everything that goes to the browser, the OG HTML for bots or an
// API response passes through publicMintName() / publicMintNameOrHost():
//   1. a mint on the manual hidden list (data/hiddenMintNames.json) shows only its hostname — its raw
//      name is never sent, not even as a tooltip;
//   2. every other name is cleaned for display (shared/cleanMintName.ts).
// Stored database values are never changed; this is display only. See docs/claude/card-and-mint-detail-ui.md
// "Mint names: cleaning and the hidden list".
import hiddenMintNamesRaw from './data/hiddenMintNames.json'
import { cleanMintNameDetailed } from './shared/cleanMintName.js'

export const MAX_HIDDEN_MINT_NAMES = 200

// Same normalisation as discovery.ts normalizeUrl (https, lowercase host, no trailing slash) — kept local
// so this module has no database/import side effects.
export function normalizeMintUrl(raw: string): string {
  try {
    const parsed = new URL(raw.trim())
    parsed.protocol = 'https:'
    parsed.hostname = parsed.hostname.toLowerCase()
    let result = parsed.toString()
    if (parsed.pathname === '/') result = result.replace(/\/$/, '')
    return result
  } catch {
    return raw.trim()
  }
}

/** Validates the raw JSON: ignores invalid entries (not an object, bad url, empty/overlong reason),
 *  keeps at most MAX_HIDDEN_MINT_NAMES, later duplicates of the same url are ignored. url -> reason. */
export function loadHiddenMintNames(raw: unknown, onIgnored?: (why: string) => void): Map<string, string> {
  const out = new Map<string, string>()
  if (!Array.isArray(raw)) {
    onIgnored?.('hiddenMintNames.json is not an array')
    return out
  }
  for (const entry of raw) {
    if (out.size >= MAX_HIDDEN_MINT_NAMES) {
      onIgnored?.(`more than ${MAX_HIDDEN_MINT_NAMES} entries, the rest are ignored`)
      break
    }
    if (entry === null || typeof entry !== 'object') { onIgnored?.('entry is not an object'); continue }
    const { url, reason } = entry as { url?: unknown; reason?: unknown }
    if (typeof url !== 'string' || typeof reason !== 'string' || reason.trim() === '' || reason.length > 200) {
      onIgnored?.('entry needs a string url and a short string reason'); continue
    }
    let parsed: URL
    try { parsed = new URL(url) } catch { onIgnored?.(`invalid url ${url.slice(0, 80)}`); continue }
    if (parsed.protocol !== 'https:') { onIgnored?.(`url must be https: ${url.slice(0, 80)}`); continue }
    const key = normalizeMintUrl(url)
    if (!out.has(key)) out.set(key, reason.trim())
  }
  return out
}

let hidden: Map<string, string> = loadHiddenMintNames(hiddenMintNamesRaw, why => console.warn(`[mint-names] ${why}`))

/** Test hook. */
export function _setHiddenMintNamesForTest(map: Map<string, string>): void { hidden = map }

export function isHiddenMintName(url: string): boolean {
  return hidden.has(normalizeMintUrl(url))
}

function hostOf(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

export interface PublicMintName {
  /** Display name, or null when the client should fall back to the hostname (hidden / nothing displayable). */
  name: string | null
  /** Full cleaned name for a title tooltip, only when `name` was truncated or emoji-capped. Never set for a hidden mint. */
  nameFull: string | null
}

export function publicMintName(raw: string | null | undefined, url: string): PublicMintName {
  if (isHiddenMintName(url)) return { name: null, nameFull: null }
  const c = cleanMintNameDetailed(raw, '')
  if (c.name === '') return { name: null, nameFull: null }
  return { name: c.name, nameFull: c.full }
}

/** Always a string: the cleaned name, or the hostname (hidden / nothing displayable). For OG HTML etc. */
export function publicMintNameOrHost(raw: string | null | undefined, url: string): string {
  return publicMintName(raw, url).name ?? hostOf(url)
}
