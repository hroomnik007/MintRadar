import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStatsCache, STATS_CACHE_TTL, STATS_STALE_LIMIT, STATS_REFRESH_INTERVAL } from '../statsCache.js'

// Stale-while-revalidate holder behind /api/stats. Fake timers and a mocked compute: no database, no real sleeping.

type Deferred = { promise: Promise<object>; resolve: (v: object) => void; reject: (e: Error) => void }
function deferred(): Deferred {
  let resolve!: (v: object) => void
  let reject!: (e: Error) => void
  const promise = new Promise<object>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const V1 = { totalMints: 1 }
const V2 = { totalMints: 2 }

let compute: ReturnType<typeof vi.fn>
let log: ReturnType<typeof vi.fn>
let cache: ReturnType<typeof createStatsCache>

beforeEach(() => {
  vi.useFakeTimers()
  compute = vi.fn()
  log = vi.fn()
  cache = createStatsCache(() => compute(), line => log(line))
})
afterEach(() => { vi.useRealTimers() })

async function prime(value: object = V1): Promise<void> {
  compute.mockResolvedValueOnce(value)
  await cache.get()
  compute.mockClear()
}

describe('constants', () => {
  it('has the documented values and the timer below the TTL', () => {
    expect(STATS_CACHE_TTL).toBe(60_000)
    expect(STATS_STALE_LIMIT).toBe(300_000)
    expect(STATS_REFRESH_INTERVAL).toBe(45_000)
    expect(STATS_REFRESH_INTERVAL).toBeLessThan(STATS_CACHE_TTL)
  })
})

describe('fresh window', () => {
  it('a fresh hit does not recompute', async () => {
    await prime()
    vi.advanceTimersByTime(STATS_CACHE_TTL - 1)
    expect(await cache.get()).toBe(V1)
    expect(compute).not.toHaveBeenCalled()
  })
})

describe('stale-while-revalidate', () => {
  it('a stale hit returns the old payload at once and starts exactly one refresh for 20 concurrent requests', async () => {
    await prime()
    vi.advanceTimersByTime(STATS_CACHE_TTL + 1)
    const d = deferred()
    compute.mockReturnValueOnce(d.promise)
    const results = await Promise.all(Array.from({ length: 20 }, () => cache.get()))
    expect(results.every(r => r === V1)).toBe(true)
    expect(compute).toHaveBeenCalledTimes(1)
    d.resolve(V2)
    await vi.advanceTimersByTimeAsync(0)
    expect(await cache.get()).toBe(V2)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('a failing refresh keeps serving the stale payload and logs one line without the message', async () => {
    await prime()
    vi.advanceTimersByTime(STATS_CACHE_TTL + 1)
    compute.mockRejectedValue(Object.assign(new Error('postgres://user:secret@db/x'), { code: 'ECONNREFUSED' }))
    expect(await cache.get()).toBe(V1)
    await vi.advanceTimersByTimeAsync(0)
    expect(await cache.get()).toBe(V1)
    await vi.advanceTimersByTimeAsync(0)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toBe('[stats] background refresh failed: Error (ECONNREFUSED)')
    expect(log.mock.calls[0][0]).not.toContain('secret')
  })

  it('beyond the stale limit it recomputes synchronously and the caller gets the new payload', async () => {
    await prime()
    vi.advanceTimersByTime(STATS_STALE_LIMIT + 1)
    const d = deferred()
    compute.mockReturnValueOnce(d.promise)
    let settled = false
    const p = cache.get().then(v => { settled = true; return v })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    d.resolve(V2)
    expect(await p).toBe(V2)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('beyond the stale limit a failing compute surfaces to the caller', async () => {
    await prime()
    vi.advanceTimersByTime(STATS_STALE_LIMIT + 1)
    compute.mockRejectedValueOnce(new Error('down'))
    await expect(cache.get()).rejects.toThrow('down')
  })
})

describe('start-up warm-up', () => {
  it('start() returns at once even while the first computation is still running, then the timer refreshes', async () => {
    const d = deferred()
    compute.mockReturnValueOnce(d.promise)
    const stop = cache.start()
    expect(compute).toHaveBeenCalledTimes(1)
    d.resolve(V1)
    await vi.advanceTimersByTimeAsync(0)
    compute.mockResolvedValue(V2)
    await vi.advanceTimersByTimeAsync(STATS_REFRESH_INTERVAL)
    expect(compute).toHaveBeenCalledTimes(2)
    stop()
    await vi.advanceTimersByTimeAsync(STATS_REFRESH_INTERVAL * 2)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('a failing warm-up does not throw and is logged', async () => {
    compute.mockRejectedValueOnce(new Error('boom'))
    const stop = cache.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(log).toHaveBeenCalledTimes(1)
    stop()
  })
})
