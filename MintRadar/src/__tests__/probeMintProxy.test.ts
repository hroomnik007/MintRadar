import { describe, it, expect, vi, afterEach } from 'vitest'
import { probeMint } from '@core/mint/api'

// A failed call to OUR /api/mint/probe is "we could not ask", never a mint state: probeMint rejects instead of
// returning { online: false, error: 'Mint unreachable' }. A mint that is down arrives as a 200 with online:false.

const URL_ = 'https://mint.example.com'

afterEach(() => { vi.unstubAllGlobals() })

describe('probeMint (browser, via /api/mint/probe)', () => {
  it('rejects on an HTTP error from our API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    await expect(probeMint(URL_)).rejects.toThrow('HTTP 500')
  })

  it('rejects when there is no network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(probeMint(URL_)).rejects.toThrow()
  })

  it('rejects on a malformed answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 200 })))
    await expect(probeMint(URL_)).rejects.toThrow()
  })

  it('returns a mint that answered 200 with online:false as offline, with its errorKind', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ url: URL_, online: false, latencyMs: null, info: null, keysets: null, checkedAt: '2026-10-17T10:00:00.000Z', error: 'Mint unreachable', errorKind: 'timeout' })))
    const r = await probeMint(URL_)
    expect(r.online).toBe(false)
    expect(r.error).toBe('Mint unreachable')
    expect(r.errorKind).toBe('timeout')
  })

  it('keeps lastInfo of a known offline mint; absent lastInfo stays absent', async () => {
    const base = { url: URL_, online: false, latencyMs: null, info: null, keysets: null, checkedAt: '2026-10-25T10:00:00.000Z' }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...base, lastInfo: { motd: 'Back soon', description: 'Test mint', seenAt: '2026-10-23T19:15:01.246Z' } })))
    expect((await probeMint(URL_)).lastInfo).toEqual({ motd: 'Back soon', description: 'Test mint', seenAt: '2026-10-23T19:15:01.246Z' })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(base)))
    expect(await probeMint(URL_)).not.toHaveProperty('lastInfo')
  })
})
