import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
const safeFetch = vi.fn()
vi.mock('../db.js', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }))
vi.mock('../ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssrf.js')>()
  return {
    ...actual,
    safeFetch: (...a: unknown[]) => safeFetch(...a),
    // The test responses have headers + arrayBuffer() (no stream): same two cap rules as the real reader.
    readBodyLimited: async (res: { headers: { get: (k: string) => string | null }; arrayBuffer: () => Promise<ArrayBuffer> }, max: number) => {
      const declared = res.headers.get('content-length')
      if (declared !== null && Number(declared) > max) throw new actual.ResponseTooLargeError(max)
      const body = Buffer.from(await res.arrayBuffer())
      if (body.byteLength > max) throw new actual.ResponseTooLargeError(max)
      return body
    },
  }
})
vi.mock('../discovery.js', () => ({ normalizeUrl: (u: string) => u.trim() }))

import { getMintIcon, _resetMintIconCache, sniffRasterImageType, iconEtag, imageDimensions, iconDimensionsAllowed, isResizableIcon, MAX_ICON_DIMENSION } from '../mintIcon.js'
import { pngOf, jpegOf, gifOf, webpOf } from './helpers/iconFixtures.js'

const MINT = 'https://mint.example'
const PNG = pngOf(64, 64)
const JPEG = jpegOf(64, 64)
const GIF = gifOf(64, 64)
const WEBP = webpOf(64, 64)
const OVERSIZE = 600 * 1024 // over the 512 KB cap

function fakeRes(opts: { ok?: boolean; contentType?: string; contentLength?: string; body?: Buffer }) {
  const headers = new Map<string, string>()
  if (opts.contentType !== undefined) headers.set('content-type', opts.contentType)
  if (opts.contentLength !== undefined) headers.set('content-length', opts.contentLength)
  const body = opts.body ?? Buffer.alloc(0)
  return {
    ok: opts.ok ?? true,
    status: (opts.ok ?? true) ? 200 : 502,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  }
}

beforeEach(() => {
  query.mockReset()
  safeFetch.mockReset()
  _resetMintIconCache()
})

describe('getMintIcon — SSRF-safe favicon proxy (audit finding: icon_url tracking beacon)', () => {
  it('refuses to proxy an unknown mint (never fetches an arbitrary URL)', async () => {
    query.mockResolvedValue({ rows: [] })
    expect(await getMintIcon(MINT)).toBeNull()
    expect(safeFetch).not.toHaveBeenCalled()
  })

  it('returns null when the mint has no icon_url', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: null }] })
    expect(await getMintIcon(MINT)).toBeNull()
    expect(safeFetch).not.toHaveBeenCalled()
  })

  it('returns null for a non-https icon_url (defence in depth over the prober check)', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'http://mint.example/icon.png' }] })
    expect(await getMintIcon(MINT)).toBeNull()
    expect(safeFetch).not.toHaveBeenCalled()
  })

  it('returns null when safeFetch blocks the request (SSRF guard / unreachable)', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://evil.example/track.png' }] })
    safeFetch.mockResolvedValue(null)
    expect(await getMintIcon(MINT)).toBeNull()
    expect(safeFetch).toHaveBeenCalledWith('https://evil.example/track.png', expect.objectContaining({ timeoutMs: 5000 }))
  })

  it('returns null on a non-2xx upstream response', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.png' }] })
    safeFetch.mockResolvedValue(fakeRes({ ok: false }))
    expect(await getMintIcon(MINT)).toBeNull()
  })

  it('rejects a non-image content-type (e.g. an HTML tracker endpoint)', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.png' }] })
    safeFetch.mockResolvedValue(fakeRes({ contentType: 'text/html', body: Buffer.from('<h1>hi</h1>') }))
    expect(await getMintIcon(MINT)).toBeNull()
  })

  it('rejects SVG (would be script-executing XSS on a direct navigation)', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.svg' }] })
    safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/svg+xml', body: Buffer.from('<svg onload="alert(1)"/>') }))
    expect(await getMintIcon(MINT)).toBeNull()
  })

  it('rejects an oversized icon via the Content-Length header', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.png' }] })
    safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/png', contentLength: String(OVERSIZE), body: PNG }))
    expect(await getMintIcon(MINT)).toBeNull()
  })

  it('rejects an oversized icon body even when Content-Length is absent/lying', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.png' }] })
    safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/png', body: Buffer.alloc(OVERSIZE, 1) }))
    expect(await getMintIcon(MINT)).toBeNull()
  })

  it('accepts an icon between the old 256 KB and new 512 KB limit', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.png' }] })
    const body = Buffer.concat([PNG, Buffer.alloc(400 * 1024, 1)])
    safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/png', body }))
    const icon = await getMintIcon(MINT)
    expect(icon?.contentType).toBe('image/png')
    expect(icon!.body.byteLength).toBe(body.byteLength)
  })

  it('returns the bytes + normalised content-type for a valid raster icon', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.png' }] })
    safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/png; charset=binary', body: PNG }))
    const icon = await getMintIcon(MINT)
    expect(icon).not.toBeNull()
    expect(icon!.contentType).toBe('image/png')
    expect(Buffer.compare(icon!.body, PNG)).toBe(0)
  })

  it('accepts .ico favicons', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/favicon.ico' }] })
    safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/vnd.microsoft.icon', body: PNG }))
    const icon = await getMintIcon(MINT)
    expect(icon?.contentType).toBe('image/vnd.microsoft.icon')
  })

  it('caches a resolved icon — a second call hits neither the DB nor the network', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.png' }] })
    safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/png', body: PNG }))
    await getMintIcon(MINT)
    await getMintIcon(MINT)
    expect(query).toHaveBeenCalledTimes(1)
    expect(safeFetch).toHaveBeenCalledTimes(1)
  })

  it('caches a negative result too (no retry storm on a broken/hostile icon_url)', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://evil.example/track.png' }] })
    safeFetch.mockResolvedValue(null)
    await getMintIcon(MINT)
    await getMintIcon(MINT)
    expect(query).toHaveBeenCalledTimes(1)
    expect(safeFetch).toHaveBeenCalledTimes(1)
  })

  it('never throws — a DB error resolves to null', async () => {
    query.mockRejectedValue(new Error('db down'))
    await expect(getMintIcon(MINT)).resolves.toBeNull()
  })

  // ── Magic-bytes fallback (2026-09-08) ──────────────────────────────
  // A mint serving a real raster image under a wrong/generic Content-Type
  // (application/octet-stream) — e.g. cashu.cz (.webp) / mint.chorus.community
  // (.jpg) in the diagnostic run — should still be accepted via a signature
  // check, but SVG / corrupt payloads must still be rejected.

  it('accepts a real PNG served as application/octet-stream (magic-bytes fallback)', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.png' }] })
    safeFetch.mockResolvedValue(fakeRes({ contentType: 'application/octet-stream', body: PNG }))
    const icon = await getMintIcon(MINT)
    expect(icon?.contentType).toBe('image/png')
    expect(Buffer.compare(icon!.body, PNG)).toBe(0)
  })

  it('accepts a real WebP served with no Content-Type header at all', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.webp' }] })
    safeFetch.mockResolvedValue(fakeRes({ body: WEBP }))
    const icon = await getMintIcon(MINT)
    expect(icon?.contentType).toBe('image/webp')
  })

  it('still rejects SVG even when served as application/octet-stream', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.svg' }] })
    safeFetch.mockResolvedValue(
      fakeRes({ contentType: 'application/octet-stream', body: Buffer.from('<svg onload="alert(1)"/>') }),
    )
    expect(await getMintIcon(MINT)).toBeNull()
  })

  it('still rejects SVG with a leading XML declaration served as octet-stream', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.svg' }] })
    safeFetch.mockResolvedValue(
      fakeRes({
        contentType: 'application/octet-stream',
        body: Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'),
      }),
    )
    expect(await getMintIcon(MINT)).toBeNull()
  })

  it('rejects a corrupt/undetectable payload served as application/octet-stream', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.png' }] })
    safeFetch.mockResolvedValue(
      fakeRes({ contentType: 'application/octet-stream', body: Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]) }),
    )
    expect(await getMintIcon(MINT)).toBeNull()
  })
})

describe('sniffRasterImageType', () => {
  it('detects PNG', () => {
    expect(sniffRasterImageType(PNG)).toBe('image/png')
  })
  it('detects JPEG', () => {
    expect(sniffRasterImageType(JPEG)).toBe('image/jpeg')
  })
  it('detects GIF (GIF8 prefix)', () => {
    expect(sniffRasterImageType(GIF)).toBe('image/gif')
  })
  it('detects WebP (RIFF....WEBP)', () => {
    expect(sniffRasterImageType(WEBP)).toBe('image/webp')
  })
  it('returns null for an SVG payload', () => {
    expect(sniffRasterImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
  })
  it('returns null for an XML-declared SVG payload', () => {
    expect(sniffRasterImageType(Buffer.from('  <?xml version="1.0"?><svg/>'))).toBeNull()
  })
  it('returns null for HTML', () => {
    expect(sniffRasterImageType(Buffer.from('<!doctype html><html></html>'))).toBeNull()
  })
  it('returns null for random bytes', () => {
    expect(sniffRasterImageType(Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11]))).toBeNull()
  })
  it('returns null for a too-short buffer', () => {
    expect(sniffRasterImageType(Buffer.from([0x89, 0x50]))).toBeNull()
  })
})

describe('iconEtag', () => {
  it('is a strong, quoted 32-hex hash of the bytes: equal bytes equal ETag, other bytes other ETag', () => {
    const a = iconEtag(Buffer.from(PNG))
    expect(a).toMatch(/^"[0-9a-f]{32}"$/)
    expect(iconEtag(Buffer.from(PNG))).toBe(a)
    expect(iconEtag(Buffer.from(JPEG))).not.toBe(a)
  })
})

describe('imageDimensions / iconDimensionsAllowed (2026-11-13: nginx resizes icons and decodes the whole bitmap)', () => {
  it('reads the declared size of each format nginx decodes', () => {
    expect(imageDimensions(pngOf(256, 128))).toEqual({ width: 256, height: 128 })
    expect(imageDimensions(jpegOf(1024, 768))).toEqual({ width: 1024, height: 768 })
    expect(imageDimensions(gifOf(300, 200))).toEqual({ width: 300, height: 200 })
    expect(imageDimensions(webpOf(960, 540))).toEqual({ width: 960, height: 540 })
  })

  it('reads lossy (VP8) and lossless (VP8L) WebP headers too', () => {
    const lossy = Buffer.alloc(30)
    lossy.write('RIFF', 0, 'latin1'); lossy.write('WEBP', 8, 'latin1'); lossy.write('VP8 ', 12, 'latin1')
    lossy.writeUInt16LE(160, 26); lossy.writeUInt16LE(120, 28)
    expect(imageDimensions(lossy)).toEqual({ width: 160, height: 120 })
    const lossless = Buffer.alloc(30)
    lossless.write('RIFF', 0, 'latin1'); lossless.write('WEBP', 8, 'latin1'); lossless.write('VP8L', 12, 'latin1')
    lossless[20] = 0x2f
    lossless.writeUInt32LE((648 - 1) | ((480 - 1) << 14), 21)
    expect(imageDimensions(lossless)).toEqual({ width: 648, height: 480 })
  })

  it('skips the segments before the JPEG frame header, including a progressive one (SOF2)', () => {
    const j = jpegOf(400, 300)
    const progressive = Buffer.from(j)
    progressive[progressive.indexOf(Buffer.from([0xff, 0xc0])) + 1] = 0xc2
    expect(imageDimensions(progressive)).toEqual({ width: 400, height: 300 })
  })

  it('is null for a cut-short or malformed header and for bytes that are none of the four', () => {
    expect(imageDimensions(pngOf(64, 64).subarray(0, 20))).toBeNull()
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]))).toBeNull()
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6]))).toBeNull()
    expect(imageDimensions(Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0]))).toBeNull()
    expect(imageDimensions(Buffer.from('not an image at all'))).toBeNull()
  })

  it('allows up to MAX_ICON_DIMENSION on a side and refuses more, zero, or an unreadable size', () => {
    expect(iconDimensionsAllowed(pngOf(MAX_ICON_DIMENSION, MAX_ICON_DIMENSION))).toBe(true)
    expect(iconDimensionsAllowed(pngOf(MAX_ICON_DIMENSION + 1, 16))).toBe(false)
    expect(iconDimensionsAllowed(pngOf(16, 16000))).toBe(false)
    expect(iconDimensionsAllowed(jpegOf(16000, 16000))).toBe(false)
    expect(iconDimensionsAllowed(webpOf(5000, 16))).toBe(false)
    expect(iconDimensionsAllowed(gifOf(0, 16))).toBe(false)
    expect(iconDimensionsAllowed(pngOf(64, 64).subarray(0, 20))).toBe(false)
  })

  it('lets bytes nginx does not decode pass (an .ico file), and they are not offered for resizing', () => {
    const ico = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0])
    expect(iconDimensionsAllowed(ico)).toBe(true)
    expect(isResizableIcon(ico)).toBe(false)
    expect(isResizableIcon(pngOf(64, 64))).toBe(true)
  })

  it('getMintIcon gives no icon for a small file that declares a huge bitmap, whatever type the mint declares', async () => {
    for (const contentType of ['image/png', 'image/x-icon', 'application/octet-stream']) {
      query.mockReset(); safeFetch.mockReset(); _resetMintIconCache()
      query.mockResolvedValueOnce({ rows: [{ icon_url: 'https://cdn.example/icon.png' }] })
      safeFetch.mockResolvedValueOnce(fakeRes({ contentType, body: pngOf(16000, 16000) }))
      expect(await getMintIcon(MINT)).toBeNull()
    }
  })
})
