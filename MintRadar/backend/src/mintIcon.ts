import { createHash } from 'node:crypto'
import { pool } from './db.js'
import { safeFetch, readBodyLimited, ResponseTooLargeError } from './ssrf.js'
import { normalizeUrl } from './discovery.js'

// SSRF-safe mint favicon proxy.
//
// The frontend must never fetch a mint-controlled `icon_url` directly: that URL
// comes from the mint's own /v1/info response, so a hostile operator could point
// it at an attacker server and harvest the IP + User-Agent of every visitor who
// loads a page showing that mint — a deanonymisation beacon across the whole
// user base (2026-09-07 security audit). Instead the client points every <img>
// at GET /api/mint/icon?url=<mint url>, which:
//   1. resolves `icon_url` from the DB for a KNOWN mint only (never proxies an
//      arbitrary caller-supplied URL — the stored value was already validated by
//      the prober to be https://),
//   2. fetches it through safeFetch (private-range block + connect-time DNS
//      pinning + redirect re-validation — same guard the mint prober uses),
//   3. re-serves the bytes from our own origin, cached in-process.
// Anything that isn't a small raster image → the client falls back to the
// bundled SVG placeholder.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000   // 6h for a resolved icon
// 24h for "no icon / unfetchable" (was 30min) — raised 2026-09-20 so a mint
// with a genuinely dead/missing icon_url doesn't cost an upstream request on
// every 30-min window across the whole Dashboard's request volume. A mint
// whose icon comes back (new icon_url written by the prober, or a transient
// outage resolves) self-heals within a day, same as the client-side failure
// cache (src/utils/mintIconFailureCache.ts) it pairs with.
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000
// 512 KB. Raised from 256 KB (2026-09-08): a diagnostic run showed 5 of 65
// favicon failures were legitimate operator logos rejected purely for size.
// 512 KB comfortably covers a high-res PNG logo while still bounding worst-case
// memory (MAX_CACHE_ENTRIES * 512 KB). The handful of mints shipping a 1–2 MB
// image as their favicon still fall back to the monogram — re-encoding them
// server-side would mean a native image dependency (sharp), which is not worth
// it for that few mints with an unreasonably large asset.
const MAX_ICON_BYTES = 512 * 1024
const MAX_CACHE_ENTRIES = 500

// SVG is deliberately excluded. An <img> never runs an SVG's scripts, but a
// direct navigation to /api/mint/icon?url=… would render it as a document on
// mintradar's own origin — stored XSS. Raster + ico only.
const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
])

export interface MintIcon {
  body: Buffer
  contentType: string
}

// Strong ETag of the bytes we serve (sha256, first 32 hex), so a browser whose 7-day copy expired revalidates with a 304
// instead of downloading the icon again. Computed once per cached icon object (weak key: dropped with the cache entry).
const etagByBody = new WeakMap<Buffer, string>()
export function iconEtag(body: Buffer): string {
  let etag = etagByBody.get(body)
  if (!etag) {
    etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`
    etagByBody.set(body, etag)
  }
  return etag
}

interface CacheEntry {
  icon: MintIcon | null
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

/** Test hook — clears the in-process icon cache. */
export function _resetMintIconCache(): void {
  cache.clear()
}

/**
 * Magic-bytes fallback for when a mint serves a real raster image under a
 * wrong or generic Content-Type (the diagnostic run found several mints, e.g.
 * cashu.cz and mint.chorus.community, sending `application/octet-stream` for a
 * genuine .webp / .jpg). Returns the sniffed content type for a *supported*
 * raster format, or null.
 *
 * SVG is explicitly rejected here too — even though it has no binary signature
 * to match, an XML/SVG payload must never pass this path (M1: a direct
 * navigation to the proxy would render it as a document on our own origin).
 */
export function sniffRasterImageType(buf: Buffer): string | null {
  if (buf.length < 4) return null

  // Reject anything that looks like XML/SVG before the signature checks.
  const head = buf.toString('latin1', 0, 256).trimStart().toLowerCase()
  if (head.startsWith('<?xml') || head.startsWith('<svg') || head.includes('<svg')) {
    return null
  }

  // PNG — 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'image/png'
  }

  // JPEG — FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg'
  }

  // GIF — "GIF8" (47 49 46 38), i.e. GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return 'image/gif'
  }

  // WebP — "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }

  return null
}

// Largest side, in pixels, of an icon we serve. nginx resizes the icon on its way out (image_filter, deploy/nginx.conf) and
// decodes the whole bitmap to do so: a 249 KB PNG declaring 16000 x 16000 pixels kept a worker busy for 6.8 s and took
// 500 MB (measured 2026-11-13). The byte cap above does not bound that, the declared size does. 2048 is twice the largest
// real icon seen that day (1084 px) and at most about 16 MB decoded.
export const MAX_ICON_DIMENSION = 2048

/**
 * Pixel size declared in the header of a PNG, JPEG, GIF or WebP file, read without decoding it; null when the bytes
 * are not one of the four or the header is cut short or malformed. These are the formats nginx's image filter decodes
 * (it sniffs the bytes itself and ignores Content-Type), so this reads the same fields its decoder will trust.
 */
export function imageDimensions(buf: Buffer): { width: number; height: number } | null {
  const type = sniffRasterImageType(buf)
  if (type === 'image/png') {
    // signature (8) + chunk length (4) + "IHDR" (4) + width (4) + height (4)
    if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return null
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (type === 'image/gif') {
    if (buf.length < 10) return null
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  }
  if (type === 'image/webp') {
    if (buf.length < 30) return null
    const chunk = buf.toString('latin1', 12, 16)
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L') {
      if (buf[20] !== 0x2f) return null
      const bits = buf.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 }
    return null
  }
  if (type === 'image/jpeg') {
    // Walk the segments to the first start-of-frame marker (C0..CF except C4 DHT, C8 JPG, CC DAC).
    let i = 2
    while (i + 9 <= buf.length) {
      if (buf[i] !== 0xff) return null
      const marker = buf[i + 1]!
      if (marker === 0xff) { i += 1; continue } // fill byte
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue } // no length
      if (marker === 0xd9 || marker === 0xda) return null // end of image / scan data before any frame header
      const len = buf.readUInt16BE(i + 2)
      if (len < 2) return null
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
    return null
  }
  return null
}

/**
 * False for a PNG, JPEG, GIF or WebP (by its bytes, whatever type was declared) whose declared size is unreadable, zero
 * or above MAX_ICON_DIMENSION on a side. Other bytes (ICO, AVIF) are not decoded by nginx and pass.
 */
export function iconDimensionsAllowed(buf: Buffer): boolean {
  if (sniffRasterImageType(buf) === null) return true
  const d = imageDimensions(buf)
  return d !== null && d.width > 0 && d.height > 0 && d.width <= MAX_ICON_DIMENSION && d.height <= MAX_ICON_DIMENSION
}

/** The internal nginx location that resizes an icon (deploy/nginx.conf, `location = /internal/mint-icon`). */
export const ICON_RESIZE_LOCATION = '/internal/mint-icon'

/** True for the bytes nginx's image filter reads (PNG, JPEG, GIF, WebP by signature); an .ico or AVIF file is not. */
export function isResizableIcon(buf: Buffer): boolean {
  return sniffRasterImageType(buf) !== null
}

async function fetchMintIcon(mintUrl: string): Promise<MintIcon | null> {
  const result = await pool.query('SELECT icon_url FROM mints WHERE url = $1', [mintUrl])
  if (result.rows.length === 0) return null // not a known mint — refuse to proxy

  const iconUrl = result.rows[0]?.['icon_url'] as string | null | undefined
  if (typeof iconUrl !== 'string' || !iconUrl.startsWith('https://')) return null

  const res = await safeFetch(iconUrl, { timeoutMs: 5_000 })
  if (!res || !res.ok) return null

  const declaredType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()

  // Content-Length above the cap is refused up front; otherwise the cap is enforced while streaming.
  let body: Buffer
  try {
    body = await readBodyLimited(res, MAX_ICON_BYTES)
  } catch (err) {
    if (err instanceof ResponseTooLargeError) return null
    throw err
  }
  if (body.byteLength === 0) return null

  // Trust an allow-listed declared type; otherwise fall back to sniffing the
  // leading bytes (a mint serving a real image under application/octet-stream).
  let contentType: string | null
  if (ALLOWED_CONTENT_TYPES.has(declaredType)) {
    contentType = declaredType
  } else {
    contentType = sniffRasterImageType(body)
  }
  if (!contentType) return null
  if (!iconDimensionsAllowed(body)) return null

  return { body, contentType }
}

/**
 * Returns the proxied favicon for a mint, or null when there is nothing safe to
 * serve (unknown mint, no icon_url, non-image, oversized, unreachable, blocked).
 * Never throws. Results (including nulls) are cached in-process so upstream is
 * hit at most once per mint per TTL regardless of request volume.
 */
export async function getMintIcon(rawMintUrl: string): Promise<MintIcon | null> {
  const mintUrl = normalizeUrl(rawMintUrl)
  const now = Date.now()

  const cached = cache.get(mintUrl)
  if (cached && cached.expiresAt > now) return cached.icon

  let icon: MintIcon | null
  try {
    icon = await fetchMintIcon(mintUrl)
  } catch {
    icon = null
  }

  cache.set(mintUrl, { icon, expiresAt: now + (icon ? CACHE_TTL_MS : NEGATIVE_TTL_MS) })

  // Safety valve — there are ~100 mints, so this effectively never trips.
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }

  return icon
}
