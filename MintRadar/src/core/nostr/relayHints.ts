// Relay URLs that come from somewhere other than our own constants: naddr hints in a shared link
// (anyone can craft one) and the logged-in user's own NIP-65 list. Both end up as WebSocket
// connections from the visitor's browser, so they are filtered here before a socket is opened.

/** Most naddr relay hints that are ever used for one lookup. */
export const MAX_NADDR_HINTS = 3
/** Most relays taken from the user's own NIP-65 list for our connections (their list itself is untouched). */
export const MAX_USER_RELAYS = 10

const MAX_RELAY_URL_LENGTH = 200
const NON_PUBLIC_TLDS = new Set(['onion', 'local', 'localhost', 'internal', 'lan', 'home', 'arpa', 'invalid', 'test', 'example'])

/** `host[:port]` of a wss:// URL, lowercased, or null for anything else. Never throws. */
function wssHostKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text.length === 0 || text.length > MAX_RELAY_URL_LENGTH) return null
  let url: URL
  try { url = new URL(text) } catch { return null }
  if (url.protocol !== 'wss:' || url.username !== '' || url.password !== '') return null
  return url.host.toLowerCase() || null
}

/** True for a plain public DNS name: no IP literal (v4/v6), no localhost, no single-label name, no .onion/.local/... */
export function isPublicHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (!h || h.includes(':') || h.startsWith('[')) return false          // IPv6 literal / stray port
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) return false
  const labels = h.split('.')
  const tld = labels[labels.length - 1] as string
  if (!/[a-z]/.test(tld)) return false                                  // 127.0.0.1, 10.1.2.3, 2130706433 ...
  return !NON_PUBLIC_TLDS.has(tld)
}

/**
 * Keeps an naddr relay hint only if it is a wss:// URL whose host (and port) exactly matches a relay we already
 * know. The returned URL is the KNOWN relay's own string, never the hint's (so a path or query in the hint is
 * dropped too). Deduplicated, at most `MAX_NADDR_HINTS`; unknown hints are ignored without any request.
 */
export function filterNaddrRelayHints(hints: readonly string[] | null | undefined, knownRelays: readonly string[]): string[] {
  if (!hints || hints.length === 0) return []
  const known = new Map<string, string>()
  for (const relay of knownRelays) {
    const key = wssHostKey(relay)
    if (key && !known.has(key)) known.set(key, relay)
  }
  const out: string[] = []
  for (const hint of hints) {
    const key = wssHostKey(hint)
    const relay = key ? known.get(key) : undefined
    if (relay && !out.includes(relay)) out.push(relay)
    if (out.length >= MAX_NADDR_HINTS) break
  }
  return out
}

/** Relays an naddr lookup asks: the surviving hints first, then the defaults (deduplicated). */
export function resolveNaddrRelays(hints: readonly string[] | null | undefined, knownRelays: readonly string[], defaults: readonly string[]): string[] {
  return [...new Set([...filterNaddrRelayHints(hints, knownRelays), ...defaults])]
}

/**
 * The user's own relay list as far as WE connect to it: wss:// only, public host names only, deduplicated
 * (case-insensitive, trailing slash ignored), first `MAX_USER_RELAYS` in the order given. The input is not changed.
 */
export function sanitizeUserRelays(relays: readonly string[] | null | undefined, max: number = MAX_USER_RELAYS): string[] {
  if (!relays) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of relays) {
    if (out.length >= max) break
    if (typeof raw !== 'string' || raw.trim().length > MAX_RELAY_URL_LENGTH) continue
    let url: URL
    try { url = new URL(raw.trim()) } catch { continue }
    if (url.protocol !== 'wss:' || url.username !== '' || url.password !== '') continue
    if (!isPublicHostname(url.hostname)) continue
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
    const normalized = `wss://${url.host.toLowerCase()}${path}${url.search}`
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}
