// Process-wide settings and small helpers shared by the routes (split out of index.ts on 2026-11-08).
import { publicMintName } from './mintNames.js'
export const IS_DEV = process.env['NODE_ENV'] !== 'production'

// In production the fallback never includes localhost — only the live origin.
// Dev fallback includes the Vite dev server. Override via ALLOWED_ORIGINS env.
export const DEFAULT_ORIGINS = IS_DEV
  ? 'https://mintradar.org,http://localhost:5173'
  : 'https://mintradar.org'

export const ALLOWED_ORIGINS = (
  process.env['ALLOWED_ORIGINS'] ?? DEFAULT_ORIGINS
).split(',').map(o => o.trim())

export const MAX_URL_LENGTH = 500

// Strip control characters (CR/LF/tab/NUL/ANSI-escape/…) and cap the length
// before interpolating an untrusted string into a plain-text log line, so it
// cannot forge or split log entries or inject terminal escapes into a log
// viewer. `new URL()` (used on the /unsubscribe path) silently *drops* tab/CR/LF
// per the WHATWG spec rather than rejecting, so an explicit strip is needed
// wherever a raw client string reaches console.* — e.g. relay URLs in
// validateRelays(), which keeps the original string, not the parsed URL.
export function sanitizeLogValue(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, '\uFFFD').slice(0, 200)
}

// Names leave the server cleaned (mintNames.ts): `name` is the display name (null = show the hostname),
// `nameFull` the full cleaned name, only when `name` was truncated/emoji-capped (title tooltip).
export function knownMintNameFields(raw: string | null, url: string): { name: string | null; nameFull?: string } {
  const p = publicMintName(raw, url)
  return p.nameFull !== null ? { name: p.name, nameFull: p.nameFull } : { name: p.name }
}
