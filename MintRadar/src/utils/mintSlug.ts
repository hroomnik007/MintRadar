// Mint Detail address and display name. This frontend copy is byte-identical to backend/src/shared/mintSlug.ts
// (code, comments aside; src/__tests__/sharedModules.test.ts fails when they drift). SOURCE OF TRUTH is the backend
// file: change it there first and mirror the change here. Used through src/utils/mintFormatting.ts.

export function mintHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

// ── Mint-detail route param → tracked mint ─────────────────────
// The /mint/:url route param can be a bare host ("21mint.me") pasted by a user,
// not just the percent-encoded canonical URL the app links to
// ("https%3A%2F%2F21mint.me"). Without canonicalisation a bare host never
// matches a tracked row, so the page used to fall through to a hollow live-probe
// stub (0 NUTs, ~3% Reliability) instead of the real, tracked mint.
export type MintDetailResolution =
  | { kind: 'ok'; url: string }
  | { kind: 'redirect'; url: string }
  | { kind: 'not-tracked'; slug: string; suggestion: string | null }

export interface KnownMintLike { url: string; online?: boolean | null; reliabilityScore?: number | null }

function stripHostPrefix(host: string): string {
  return host.replace(/^(?:www\.|mint\.)+/, '')
}

// Among several tracked rows on the same host, pick the one the Dashboard treats
// as *the* mint: a row that has actually been probed (online !== null) beats a
// never-probed NIP-87-only stub; then a bare-root https://host; then the higher
// Reliability Score; then the shorter (path-less) URL.
function pickDashboardRow<T extends KnownMintLike>(rows: T[], host: string): T {
  return [...rows].sort((a, b) => {
    const aProbed = a.online != null ? 0 : 1
    const bProbed = b.online != null ? 0 : 1
    if (aProbed !== bProbed) return aProbed - bProbed
    const aRoot = a.url === `https://${host}` ? 0 : 1
    const bRoot = b.url === `https://${host}` ? 0 : 1
    if (aRoot !== bRoot) return aRoot - bRoot
    const at = a.reliabilityScore ?? -1
    const bt = b.reliabilityScore ?? -1
    if (at !== bt) return bt - at
    return a.url.length - b.url.length
  })[0]!
}

function closestKnownHostUrl(host: string, known: readonly KnownMintLike[]): string | null {
  const target = stripHostPrefix(host)
  for (const m of known) {
    const kh = mintHostname(m.url).toLowerCase()
    if (stripHostPrefix(kh) === target || kh.endsWith('.' + host) || host.endsWith('.' + kh)) {
      return m.url
    }
  }
  return null
}

export function resolveMintDetailUrl(slug: string, known: readonly KnownMintLike[]): MintDetailResolution {
  const trimmed = slug.trim()

  // 1. The slug is already an exact tracked URL (the canonical encoded form, or
  //    a real http:// row) — render it as-is.
  if (known.some(m => m.url === trimmed)) return { kind: 'ok', url: trimmed }

  // 2. Canonicalise a bare host → https://host (keep any path; never append a
  //    trailing slash — that would be a *different* URL / a second mint row) and
  //    resolve by hostname. Hostname match is authoritative: among every tracked
  //    row on that host, pickDashboardRow() chooses the one the Dashboard shows
  //    — a probed row always beats a never-probed NIP-87-only stub, even the
  //    stub that happens to be the exact bare-root URL.
  const hasScheme = /^https?:\/\//i.test(trimmed)
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`

  let host = ''
  try { host = new URL(withScheme).hostname.toLowerCase() } catch { host = '' }

  if (host) {
    const hostMatches = known.filter(m => mintHostname(m.url).toLowerCase() === host)
    if (hostMatches.length > 0) {
      const best = pickDashboardRow(hostMatches, host)
      return best.url === trimmed ? { kind: 'ok', url: best.url } : { kind: 'redirect', url: best.url }
    }
  } else {
    // Slug isn't URL-parseable — last-ditch exact-match on the scheme-prefixed
    // and trailing-slash-stripped forms.
    const canonical = withScheme.replace(/\/+$/, '')
    if (canonical !== trimmed && known.some(m => m.url === canonical)) return { kind: 'redirect', url: canonical }
    if (withScheme !== trimmed && known.some(m => m.url === withScheme)) return { kind: 'redirect', url: withScheme }
  }

  // 3. Nothing tracked under this host — do not render a fake full detail.
  return { kind: 'not-tracked', slug: trimmed, suggestion: host ? closestKnownHostUrl(host, known) : null }
}

// ── Mint display name ──────────────────────────────────────────
// The name shown on cards, in the Name sort, in the Compare picker and in the head of Mint Detail.
// A mint's `name` comes from its own untrusted /v1/info — many mints ship a
// generic placeholder ("Cashu", "Cashu mint", "mint") or wrap the name in
// quotes. In those cases the hostname is the more useful title.
//
// "Cashu test mint" is deliberately NOT a denylist entry — it's a real known
// test mint that carries its own "Test mint" badge, so its name is kept.
//
// These functions take a name that is ALREADY display-cleaned (cleanMintName(raw, ''): controls, zero-width, bidi,
// emoji spam, length cap), so this module needs no import: src/utils/mintFormatting.ts cleans first in the browser,
// backend/src/spaHtml.ts in the server.
const GENERIC_NAME_DENYLIST = new Set(['cashu', 'cashu mint', 'mint'])

// Strips one pair of wrapping quotes (" or ') from a cleaned name.
export function stripCleanedNameQuotes(cleanedName: string): string {
  let name = cleanedName
  if (name.length >= 2) {
    const first = name[0]
    const last = name[name.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      name = name.slice(1, -1).trim()
    }
  }
  return name
}

// The set of normalized (lowercased) names that appear on 2+ mints, from the names already passed through
// stripCleanedNameQuotes (see computeDuplicateMintNames in mintFormatting.ts for why).
export function duplicateNamesOf(strippedNames: ReadonlyArray<string>): Set<string> {
  const counts = new Map<string, number>()
  for (const n of strippedNames) {
    const key = n.toLowerCase()
    if (key === '') continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const duplicates = new Set<string>()
  for (const [key, count] of counts) {
    if (count >= 2) duplicates.add(key)
  }
  return duplicates
}

// `name` is the stripped name (stripCleanedNameQuotes). `isFallback` marks the cases where the title had to fall
// back to the raw hostname (empty/denylisted name, or a genuine parent-domain suffix collision) as opposed to a
// mint whose real name simply happens to equal its hostname verbatim (e.g. name="cashu.cz", url="https://cashu.cz").
export function resolveStrippedMintName(
  name: string,
  url: string,
  duplicateNames?: ReadonlySet<string> | undefined,
): { text: string; isFallback: boolean } {
  const host = mintHostname(url)
  if (name === '' || GENERIC_NAME_DENYLIST.has(name.toLowerCase())) return { text: host, isFallback: true }
  // If the resolved name is just a parent-domain suffix of the hostname
  // (e.g. name "aleafnd.org" for host "bitcoin.aleafnd.org"), two sibling
  // mints under the same parent domain would collapse to an identical title.
  // Fall back to the full hostname so they stay distinguishable — but only
  // when a sibling sharing that exact name is actually present in
  // `duplicateNames`; otherwise this mint's own name is real, deliberate
  // information (e.g. "cashu.chat" for host "mint.cashu.chat") and is kept.
  // An EXACT match (name === hostname) is deliberately excluded from this
  // guard entirely.
  const nl = name.toLowerCase()
  const hl = host.toLowerCase()
  if (hl !== nl && hl.endsWith('.' + nl) && duplicateNames?.has(nl)) return { text: host, isFallback: true }
  return { text: name, isFallback: false }
}
