import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createHash } from 'node:crypto'
import { pngOf } from '../helpers/iconFixtures.js'

// GET /api/mint/icon — SSRF-safe favicon proxy (see backend/src/mintIcon.ts).
// The frontend routes every mint <img> here instead of fetching a mint-supplied
// icon_url directly, closing the IP/User-Agent tracking-beacon leak from the
// 2026-09-07 audit. We mock the db.js pool and ssrf.js safeFetch at their
// boundaries so the real route + mintIcon.getMintIcon run end-to-end with no DB
// and no outbound network.

vi.mock('../../db.js', () => ({ pool: { query: vi.fn() }, initDb: vi.fn() }))
vi.mock('../../ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ssrf.js')>()
  return {
    ...actual,
    safeFetch: vi.fn(),
    // Test responses have headers + arrayBuffer() (no stream): same two cap rules as the real reader.
    readBodyLimited: async (res: { headers: { get: (k: string) => string | null }; arrayBuffer: () => Promise<ArrayBuffer> }, max: number) => {
      const declared = res.headers.get('content-length')
      if (declared !== null && Number(declared) > max) throw new actual.ResponseTooLargeError(max)
      const body = Buffer.from(await res.arrayBuffer())
      if (body.byteLength > max) throw new actual.ResponseTooLargeError(max)
      return body
    },
  }
})

let app: Express
let query: ReturnType<typeof vi.fn>
let safeFetch: ReturnType<typeof vi.fn>

const PNG = pngOf(64, 64)

function fakeRes(opts: { ok?: boolean; contentType?: string; body?: Buffer }) {
  const headers = new Map<string, string>()
  if (opts.contentType) headers.set('content-type', opts.contentType)
  const body = opts.body ?? Buffer.alloc(0)
  return {
    ok: opts.ok ?? true,
    status: (opts.ok ?? true) ? 200 : 502,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  }
}

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../../db.js')
  const ssrf = await import('../../ssrf.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  safeFetch = ssrf.safeFetch as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  safeFetch.mockReset()
  ;({ app } = await import('../../index.js'))
})

describe('GET /api/mint/icon', () => {
  it('400s a missing / malformed url param', async () => {
    await request(app).get('/api/mint/icon').expect(400)
    await request(app).get('/api/mint/icon?url=').expect(400)
    await request(app).get(`/api/mint/icon?url=${'x'.repeat(600)}`).expect(400)
  })

  it('proxies a valid raster favicon from our own origin with a long cache + hardening headers', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.png' }] })
    safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/png', body: PNG }))

    const res = await request(app).get('/api/mint/icon?url=https://mint.example').expect(200)

    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('public, max-age=604800, stale-while-revalidate=86400')
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0)
    // safeFetch (SSRF guard) is what actually reached out — never the browser.
    expect(safeFetch).toHaveBeenCalledWith('https://mint.example/icon.png', expect.objectContaining({ timeoutMs: 5000 }))
  })

  describe('ETag and conditional requests (Task P2 part 3)', () => {
    const ICON_URL = '/api/mint/icon?url=https://mint.example'
    const arrange = (body: Buffer = PNG) => {
      query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.png' }] })
      safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/png', body }))
    }
    const etagOf = (body: Buffer) => `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`

    it('a 200 carries a strong ETag that is the hash of the bytes, and the 7-day Cache-Control', async () => {
      arrange()
      const res = await request(app).get(ICON_URL).expect(200)
      expect(res.headers['etag']).toBe(etagOf(PNG))
      expect(res.headers['etag']).toMatch(/^"[0-9a-f]{32}"$/) // strong: no W/ prefix
      expect(res.headers['cache-control']).toBe('public, max-age=604800, stale-while-revalidate=86400')
      expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0)
    })

    it('different bytes give a different ETag', async () => {
      arrange()
      const a = await request(app).get(ICON_URL).expect(200)
      arrange(Buffer.concat([PNG, Buffer.from([9, 9])]))
      const b = await request(app).get('/api/mint/icon?url=https://other.example').expect(200)
      expect(a.headers['etag']).not.toBe(b.headers['etag'])
    })

    it('If-None-Match with the current ETag answers 304 with no body, keeping ETag and Cache-Control', async () => {
      arrange()
      const first = await request(app).get(ICON_URL).expect(200)
      const res = await request(app).get(ICON_URL).set('If-None-Match', first.headers['etag'] as string).expect(304)
      expect(res.text).toBe('')
      expect(res.headers['etag']).toBe(first.headers['etag'])
      expect(res.headers['cache-control']).toBe('public, max-age=604800, stale-while-revalidate=86400')
      expect(res.headers['content-type']).toBeUndefined()
      expect(res.headers['content-security-policy']).toContain("default-src 'none'")
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin')
    })

    it('a list of ETags that contains the current one is a match too', async () => {
      arrange()
      const first = await request(app).get(ICON_URL).expect(200)
      await request(app).get(ICON_URL).set('If-None-Match', `"nope", ${first.headers['etag'] as string}`).expect(304)
    })

    it('a matching (weak) ETag is a 304 even with Cache-Control: no-cache, as fetch() sends it', async () => {
      arrange()
      const first = await request(app).get(ICON_URL).expect(200)
      const res = await request(app).get(ICON_URL).set('If-None-Match', `W/${first.headers['etag'] as string}`)
        .set('Cache-Control', 'no-cache').set('Pragma', 'no-cache').expect(304)
      expect(res.headers['etag']).toBe(first.headers['etag'])
      expect(res.headers['cache-control']).toBe('public, max-age=604800, stale-while-revalidate=86400')
    })

    it('a non-matching ETag with Cache-Control: no-cache answers 200', async () => {
      arrange()
      await request(app).get(ICON_URL).set('If-None-Match', '"0000000000000000000000000000000f"').set('Cache-Control', 'no-cache').expect(200)
    })

    it('If-None-Match with another ETag answers 200 with the full body', async () => {
      arrange()
      const res = await request(app).get(ICON_URL).set('If-None-Match', '"0000000000000000000000000000000f"').expect(200)
      expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0)
      expect(res.headers['etag']).toBe(etagOf(PNG))
    })

    it('the 204 "no icon" answer keeps its 30 minutes, has no ETag and is never turned into a 304', async () => {
      query.mockResolvedValue({ rows: [] })
      const res = await request(app).get('/api/mint/icon?url=https://unknown.example').set('If-None-Match', '*').expect(204)
      expect(res.headers['cache-control']).toBe('public, max-age=1800')
      expect(res.headers['etag']).toBeUndefined()
    })
  })

  it('answers an unknown mint with 204 and no body, without any outbound fetch', async () => {
    query.mockResolvedValue({ rows: [] })
    const res = await request(app).get('/api/mint/icon?url=https://unknown.example').expect(204)
    expect(res.text).toBe('')
    expect(safeFetch).not.toHaveBeenCalled()
  })

  // The Date header differs between requests by design; everything else must match.
  const withoutDate = (h: Record<string, unknown>) => Object.fromEntries(Object.entries(h).filter(([k]) => k !== 'date'))

  // Every reason an icon cannot be served must look exactly the same from outside: status, body and headers.
  const BIG = Buffer.concat([PNG, Buffer.alloc(512 * 1024)])
  const REASONS: { reason: string; arrange: () => void }[] = [
    { reason: 'unknown mint', arrange: () => { query.mockResolvedValue({ rows: [] }) } },
    { reason: 'no icon_url', arrange: () => { query.mockResolvedValue({ rows: [{ icon_url: null }] }) } },
    { reason: 'icon_url is not https', arrange: () => { query.mockResolvedValue({ rows: [{ icon_url: 'http://mint.example/i.png' }] }) } },
    { reason: 'blocked address / DNS / TLS / timeout (safeFetch returns null)', arrange: () => { query.mockResolvedValue({ rows: [{ icon_url: 'https://10.0.0.1/i.png' }] }); safeFetch.mockResolvedValue(null) } },
    { reason: 'upstream status 404', arrange: () => { query.mockResolvedValue({ rows: [{ icon_url: 'https://h.example/i.png' }] }); safeFetch.mockResolvedValue(fakeRes({ ok: false })) } },
    { reason: 'over the 512 KiB limit', arrange: () => { query.mockResolvedValue({ rows: [{ icon_url: 'https://h.example/i.png' }] }); safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/png', body: BIG })) } },
    { reason: 'wrong content type', arrange: () => { query.mockResolvedValue({ rows: [{ icon_url: 'https://h.example/i.png' }] }); safeFetch.mockResolvedValue(fakeRes({ contentType: 'text/html', body: Buffer.from('<img>') })) } },
    { reason: 'SVG', arrange: () => { query.mockResolvedValue({ rows: [{ icon_url: 'https://h.example/i.svg' }] }); safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/svg+xml', body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') })) } },
    { reason: 'empty body', arrange: () => { query.mockResolvedValue({ rows: [{ icon_url: 'https://h.example/i.png' }] }); safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/png', body: Buffer.alloc(0) })) } },
    { reason: 'internal error (database throws)', arrange: () => { query.mockRejectedValue(new Error('db down')) } },
    { reason: 'internal error (safeFetch throws)', arrange: () => { query.mockResolvedValue({ rows: [{ icon_url: 'https://h.example/i.png' }] }); safeFetch.mockRejectedValue(new Error('boom')) } },
  ]

  it('answers every unservable-icon reason with the identical 204: no body, same headers (no oracle)', async () => {
    const seen: { reason: string; status: number; text: string; headers: Record<string, unknown> }[] = []
    for (const { reason, arrange } of REASONS) {
      query.mockReset(); safeFetch.mockReset()
      const { _resetMintIconCache } = await import('../../mintIcon.js')
      _resetMintIconCache()
      arrange()
      const res = await request(app).get('/api/mint/icon?url=https://mint.example')
      seen.push({ reason, status: res.status, text: res.text, headers: withoutDate(res.headers) })
    }
    for (const s of seen) {
      expect(s.status, s.reason).toBe(204)
      expect(s.text, s.reason).toBe('')
      expect(s.headers['cache-control'], s.reason).toBe('public, max-age=1800')
      expect(s.headers['content-type'], s.reason).toBeUndefined()
      expect(s.headers['content-length'], s.reason).toBeUndefined()
      expect(s.headers, s.reason).toEqual(seen[0]!.headers)
    }
  })

  it('answers a mint whose icon host is SSRF-blocked exactly like a mint without an icon', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://127.0.0.1/i.png' }] })
    // The real safeFetch is stubbed (it returns null for a blocked address, never throws).
    safeFetch.mockResolvedValue(null)
    const blocked = await request(app).get('/api/mint/icon?url=https://blocked.example').expect(204)

    query.mockResolvedValue({ rows: [{ icon_url: null }] })
    const missing = await request(app).get('/api/mint/icon?url=https://missing.example').expect(204)

    expect(withoutDate(blocked.headers)).toEqual(withoutDate(missing.headers))
    expect(blocked.text).toBe(missing.text)
  })

  it('keeps the 512 KiB limit: exactly 512 KiB is served, one byte more is not', async () => {
    const atLimit = Buffer.concat([PNG, Buffer.alloc(512 * 1024 - PNG.length)])
    query.mockResolvedValue({ rows: [{ icon_url: 'https://h.example/i.png' }] })
    safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/png', body: atLimit }))
    await request(app).get('/api/mint/icon?url=https://limit-ok.example').expect(200)
    safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/png', body: Buffer.concat([atLimit, Buffer.alloc(1)]) }))
    await request(app).get('/api/mint/icon?url=https://limit-over.example').expect(204)
  })

  it('is exempt from the per-IP rate limit (favicons burst on a dashboard load)', async () => {
    query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon.png' }] })
    safeFetch.mockResolvedValue(fakeRes({ contentType: 'image/png', body: PNG }))
    // Far more than RATE_LIMIT_MAX (60) — all succeed, none 429.
    for (let i = 0; i < 70; i++) {
      await request(app).get(`/api/mint/icon?url=https://mint.example?i=${i}`).expect(res => {
        expect(res.status).not.toBe(429)
      })
    }
  })
  describe('resizing hand-off to nginx (X-Icon-Resize, 2026-11-13)', () => {
    const ICON_URL = '/api/mint/icon?url=https://mint.example'
    const arrange = (body: Buffer, contentType = 'image/png') => {
      query.mockResolvedValue({ rows: [{ icon_url: 'https://mint.example/icon' }] })
      safeFetch.mockResolvedValue(fakeRes({ contentType, body }))
    }
    const ICO = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0])

    it('asked by nginx for a readable image: no body, an internal redirect that carries the encoded mint URL', async () => {
      arrange(PNG)
      const res = await request(app).get(ICON_URL).set('X-Icon-Resize', '1').expect(200)
      expect(res.headers['x-accel-redirect']).toBe('/internal/mint-icon?url=https%3A%2F%2Fmint.example')
      expect(res.headers['content-type']).toBeUndefined()
      expect(res.headers['etag']).toBeUndefined()
      // nginx copies Cache-Control (and Content-Type) of this response onto the resized one: neither may be set here.
      expect(res.headers['cache-control']).toBeUndefined()
      expect(res.headers['expires']).toBeUndefined()
      expect(res.headers['set-cookie']).toBeUndefined()
      expect(res.text ?? '').toBe('')
    })

    it('the mint URL cannot add a header or a second query parameter to the redirect', async () => {
      arrange(PNG)
      const hostile = 'https://mint.example/a b&x=1\r\nX-Evil: 1'
      const res = await request(app).get('/api/mint/icon').query({ url: hostile }).set('X-Icon-Resize', '1')
      const loc = res.headers['x-accel-redirect'] as string | undefined
      if (loc !== undefined) {
        expect(loc.startsWith('/internal/mint-icon?url=')).toBe(true)
        expect(loc.slice('/internal/mint-icon?url='.length)).toMatch(/^[A-Za-z0-9%._~!*'()-]+$/)
      }
      expect(res.headers['x-evil']).toBeUndefined()
    })

    it('without the header (the internal location, local development, e2e) the bytes are served as before', async () => {
      arrange(PNG)
      const res = await request(app).get(ICON_URL).expect(200)
      expect(res.headers['x-accel-redirect']).toBeUndefined()
      expect(res.headers['content-type']).toBe('image/png')
      expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0)
    })

    it('an .ico file is not handed to the filter: served as it is even when nginx asks', async () => {
      arrange(ICO, 'image/x-icon')
      const res = await request(app).get(ICON_URL).set('X-Icon-Resize', '1').expect(200)
      expect(res.headers['x-accel-redirect']).toBeUndefined()
      expect(res.headers['content-type']).toBe('image/x-icon')
    })

    it('no icon stays a 204, a matching If-None-Match stays a 304, and HEAD is not redirected', async () => {
      arrange(PNG)
      const first = await request(app).get(ICON_URL).expect(200)
      await request(app).get(ICON_URL).set('X-Icon-Resize', '1').set('If-None-Match', `W/${first.headers['etag']}`).expect(304)
      const head = await request(app).head(ICON_URL).set('X-Icon-Resize', '1').expect(200)
      expect(head.headers['x-accel-redirect']).toBeUndefined()
      query.mockResolvedValue({ rows: [] })
      const none = await request(app).get('/api/mint/icon?url=https://unknown.example').set('X-Icon-Resize', '1').expect(204)
      expect(none.headers['x-accel-redirect']).toBeUndefined()
    })

    it('a small file that declares a 16000 x 16000 bitmap is no icon at all (it never reaches the filter)', async () => {
      arrange(pngOf(16000, 16000))
      const res = await request(app).get(ICON_URL).set('X-Icon-Resize', '1').expect(204)
      expect(res.headers['x-accel-redirect']).toBeUndefined()
    })
  })
})
