// Server-side resize of proxied mint icons (Stage 2 perf, 2026-10-25). A card shows the icon at 28–40 CSS px, but
// mints ship favicons/logos up to 512 KB (MAX_ICON_BYTES in mintIcon.ts); on the home page they were ~444 KB of the
// ~1 MB mobile transfer. `GET /api/mint/icon?url=…&s=64|128` now answers with a square-bounded copy of at most
// 64 or 128 px (the 1x / 2x of the largest card slot), as WebP when the request's Accept lists image/webp, else PNG.
//
// Dependency: `sharp` (libvips, prebuilt binaries in @img/* optional packages, no install script). Node has no
// image codec, and decoding PNG/JPEG/WebP/GIF/AVIF plus encoding WebP in pure JS would need several packages and be
// far slower. It is loaded lazily and failure-safe: if the native binary is missing or broken, or an input cannot be
// decoded (ICO, which libvips does not read; a corrupt file), the ORIGINAL bytes are served as before, so the change
// can only make icons smaller, never break them. Variants are cached in-process per (source ETag, size, format),
// bounded, with in-flight de-duplication and at most ICON_RESIZE_CONCURRENCY encodes at a time.
import pLimit from 'p-limit'
import type { MintIcon } from './mintIcon.js'
import { iconEtag } from './mintIcon.js'

export const ICON_SIZES = [64, 128] as const
export type IconSize = (typeof ICON_SIZES)[number]
export type IconFormat = 'webp' | 'png'

/** `s` query value → a supported size, or null (no resize: the original icon, the pre-2026-10-25 behaviour). */
export function parseIconSize(raw: unknown): IconSize | null {
  return raw === '64' ? 64 : raw === '128' ? 128 : null
}

/** WebP only when the client says it takes it (every current browser's <img> Accept does); PNG otherwise. */
export function pickIconFormat(accept: string | undefined): IconFormat {
  for (const part of (accept ?? '').split(',')) {
    const [type, ...params] = part.split(';').map(p => p.trim().toLowerCase())
    if (type !== 'image/webp') continue
    const q = params.find(p => p.startsWith('q='))
    return q === undefined || Number(q.slice(2)) > 0 ? 'webp' : 'png'
  }
  return 'png'
}

const MAX_VARIANTS = 1000
// 4096² px: a 512 KB PNG can declare a huge canvas (decompression bomb); libvips refuses anything larger.
const MAX_INPUT_PIXELS = 4096 * 4096
export const ICON_RESIZE_CONCURRENCY = 2

type SharpFn = typeof import('sharp')
let sharpLoad: Promise<SharpFn | null> | null = null
let sharpOverride: SharpFn | null | undefined

function loadSharp(): Promise<SharpFn | null> {
  if (sharpOverride !== undefined) return Promise.resolve(sharpOverride)
  sharpLoad ??= import('sharp')
    .then(m => {
      const fn = ((m as unknown as { default?: SharpFn }).default ?? m) as SharpFn
      fn.cache(false) // our own variant cache below; libvips' operation cache would only hold decoded inputs
      return fn
    })
    .catch((err: unknown) => {
      console.warn('[icon] sharp unavailable, serving original icons:', err instanceof Error ? err.message : String(err))
      return null
    })
  return sharpLoad
}

const variants = new Map<string, MintIcon>()
const inFlight = new Map<string, Promise<MintIcon>>()
const limit = pLimit(ICON_RESIZE_CONCURRENCY)

async function encode(icon: MintIcon, size: IconSize, format: IconFormat): Promise<MintIcon> {
  const sharp = await loadSharp()
  if (!sharp) return icon
  try {
    const pipeline = sharp(icon.body, { limitInputPixels: MAX_INPUT_PIXELS, animated: false, failOn: 'error' })
      .rotate() // honour EXIF orientation of JPEG logos
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    const body = format === 'webp'
      ? await pipeline.webp({ quality: 82, effort: 4 }).toBuffer()
      : await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    // A tiny source can come out larger than it went in: then the original is the better answer.
    if (body.length >= icon.body.length) return icon
    return { body, contentType: format === 'webp' ? 'image/webp' : 'image/png' }
  } catch {
    return icon // undecodable for libvips (ICO, corrupt, too many pixels): serve it as it is, as before
  }
}

/**
 * The icon bounded to `size`×`size` px in `format`, or the original when resizing is impossible or not smaller.
 * Never throws. The key is the source's ETag, so a mint that changes its icon gets fresh variants.
 */
export function resizeIcon(icon: MintIcon, size: IconSize, format: IconFormat): Promise<MintIcon> {
  const key = `${iconEtag(icon.body)}:${size}:${format}`
  const hit = variants.get(key)
  if (hit) {
    variants.delete(key) // LRU: re-insert as newest
    variants.set(key, hit)
    return Promise.resolve(hit)
  }
  const running = inFlight.get(key)
  if (running) return running
  const job = limit(() => encode(icon, size, format)).then(out => {
    variants.set(key, out)
    while (variants.size > MAX_VARIANTS) {
      const oldest = variants.keys().next().value
      if (oldest === undefined) break
      variants.delete(oldest)
    }
    return out
  }).finally(() => inFlight.delete(key))
  inFlight.set(key, job)
  return job
}

/** Test hooks. `_setSharpForTests(null)` simulates a missing native binary; `undefined` restores the real loader. */
export function _resetIconResizeCache(): void {
  variants.clear()
  inFlight.clear()
}
export function _setSharpForTests(fn: SharpFn | null | undefined): void {
  sharpOverride = fn
}
export function _iconVariantCount(): number {
  return variants.size
}
