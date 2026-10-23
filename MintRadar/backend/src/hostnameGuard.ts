// A NUL byte in a host name can make a resolver see a different name than the one we validated
// (CVE-2026-105482: dns.resolve truncated at the NUL). Every untrusted host name is refused with this
// BEFORE any dns call. No imports on purpose: modules that mock ssrf.ts still get the real guard.

/**
 * True when `value` contains a NUL byte, raw or percent-encoded (%00, also behind a second or third
 * level of encoding such as %2500). An undecodable value is checked in its encoded form only.
 */
export function hasNulByte(value: string): boolean {
  let current = value
  for (let i = 0; i < 4; i++) {
    if (current.includes('\0') || /%00/i.test(current)) return true
    let next: string
    try { next = decodeURIComponent(current) } catch { return false }
    if (next === current) return false
    current = next
  }
  return false
}

/** The authority (user@host:port) of a URL-like string, without the scheme; used to look for NUL in the host part only. */
export function authorityOf(rawUrl: string): string {
  return rawUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/, 1)[0] ?? ''
}
