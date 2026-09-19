import type { KnownMint } from '@/hooks/useKnownMints'

// Shared `?compare=url1,url2[,url3,url4]` URL persistence for the Compare
// feature (Dashboard + Watchlist) — see "Compare feature" in CLAUDE.md.
// Max 4 mints, matching MintComparePicker's existing cap.
//
// The value is written via URLSearchParams.set() (same as every other
// Dashboard filter, e.g. requiredNuts.join(',')) — that API percent-encodes
// the whole value automatically (colons, slashes AND the comma separator
// alike), so callers must hand it the raw, un-encoded mint URLs. Doing our
// own encodeURIComponent() per URL first (the pattern used for the one-off
// `/mint/${encodeURIComponent(url)}` route link elsewhere in the app) would
// double-encode here — URLSearchParams would then also escape the '%' its
// output already contains. Reading back via searchParams.get('compare')
// already reverses the automatic encoding, so no manual decode is needed.
export const MAX_COMPARE_MINTS = 4

export function parseCompareParam(raw: string | null): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const urls: string[] = []
  for (const part of raw.split(',')) {
    if (!part || seen.has(part)) continue
    seen.add(part)
    urls.push(part)
    if (urls.length >= MAX_COMPARE_MINTS) break
  }
  return urls
}

export function buildCompareParam(urls: string[]): string {
  return urls.slice(0, MAX_COMPARE_MINTS).join(',')
}

// Resolves a compare URL list against the known-mints set, silently dropping
// any URL that isn't a currently-tracked mint — a stale/invalid/untracked
// entry in a shared link must never crash or block the rest of the selection.
export function resolveComparedMints(urls: string[], known: KnownMint[]): KnownMint[] {
  const resolved: KnownMint[] = []
  for (const url of urls) {
    const mint = known.find(m => m.url === url)
    if (mint) resolved.push(mint)
    if (resolved.length >= MAX_COMPARE_MINTS) break
  }
  return resolved
}
