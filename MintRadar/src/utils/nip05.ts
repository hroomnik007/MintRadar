// Pure NIP-05 identifier parsing. No I/O — verification (domain lookup +
// pubkey match) happens server-side, see useVerifiedNip05.ts.

export interface ParsedNip05 {
  name: string
  domain: string
}

const NAME_RE = /^[a-z0-9-_.]{1,64}$/i
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i

// "name@domain" (name omitted → root identifier "_@domain", per NIP-05).
// Returns null for anything that doesn't look like a well-formed NIP-05
// identifier — callers should silently skip rendering it, not guess.
export function parseNip05(raw: string): ParsedNip05 | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > 320) return null
  const at = trimmed.indexOf('@')
  const name = at === -1 ? '_' : trimmed.slice(0, at)
  const domain = at === -1 ? trimmed : trimmed.slice(at + 1)
  if (!NAME_RE.test(name) || domain.length > 255 || !DOMAIN_RE.test(domain)) return null
  return { name, domain }
}

// Display form matching the reference pattern (name@domain, "_@domain" shown
// as "@domain" — the root identifier has no separate visible name part).
export function formatNip05({ name, domain }: ParsedNip05): string {
  return name === '_' ? `@${domain}` : `${name}@${domain}`
}
