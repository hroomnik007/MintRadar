import { describe, it, expect, beforeEach } from 'vitest'
import sharp from 'sharp'
import { parseIconSize, pickIconFormat, resizeIcon, _resetIconResizeCache, _iconVariantCount } from '../iconResize.js'

describe('parseIconSize', () => {
  it('accepts exactly 64 and 128', () => {
    expect(parseIconSize('64')).toBe(64)
    expect(parseIconSize('128')).toBe(128)
    for (const v of [undefined, '', '32', '256', '64.0', ' 64', ['64'], 64]) expect(parseIconSize(v)).toBeNull()
  })
})

describe('pickIconFormat', () => {
  it('picks WebP only when Accept lists image/webp with q > 0', () => {
    expect(pickIconFormat('image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8')).toBe('webp') // Chrome
    expect(pickIconFormat('image/webp,image/avif,video/*;q=0.8,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5')).toBe('webp') // Safari
    expect(pickIconFormat('IMAGE/WEBP;q=0.9')).toBe('webp')
    expect(pickIconFormat('image/webp;q=0')).toBe('png')
    expect(pickIconFormat('*/*')).toBe('png')
    expect(pickIconFormat('image/*')).toBe('png')
    expect(pickIconFormat('')).toBe('png')
    expect(pickIconFormat(undefined)).toBe('png')
  })
})

describe('resizeIcon', () => {
  beforeEach(() => _resetIconResizeCache())

  async function png(w: number, h: number): Promise<Buffer> {
    const raw = Buffer.alloc(w * h * 4)
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24
    return sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
  }

  it('keeps the aspect ratio inside the box and never enlarges', async () => {
    const wide = await resizeIcon({ body: await png(400, 200), contentType: 'image/png' }, 128, 'webp')
    const meta = await sharp(wide.body).metadata()
    expect([meta.width, meta.height]).toEqual([128, 64])
  })

  it('never answers with more bytes than the original (a tiny source is served as it is)', async () => {
    for (const format of ['png', 'webp'] as const) {
      // 1×1 PNG: any re-encode carries at least as much container overhead.
      const tiny = { body: await sharp({ create: { width: 1, height: 1, channels: 3, background: '#f00' } }).png({ compressionLevel: 9 }).toBuffer(), contentType: 'image/png' }
      const out = await resizeIcon(tiny, 64, format)
      expect(out.body.length).toBeLessThanOrEqual(tiny.body.length)
      if (out.body.length === tiny.body.length) expect(out).toBe(tiny)
    }
  })

  it('de-duplicates concurrent requests and caches the variant', async () => {
    const icon = { body: await png(300, 300), contentType: 'image/png' }
    const [a, b] = await Promise.all([resizeIcon(icon, 64, 'webp'), resizeIcon(icon, 64, 'webp')])
    expect(a).toBe(b)
    expect(await resizeIcon(icon, 64, 'webp')).toBe(a)
    expect(_iconVariantCount()).toBe(1)
  })

  it('returns the original for input libvips cannot decode', async () => {
    const ico = { body: Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]), contentType: 'image/x-icon' }
    expect(await resizeIcon(ico, 64, 'webp')).toBe(ico)
  })
})
