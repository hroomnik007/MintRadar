import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createSwrCache, makeRefreshErrorLogger,
  KNOWN_MINTS_CACHE_TTL, KNOWN_MINTS_STALE_LIMIT, KNOWN_MINTS_REFRESH_INTERVAL,
} from '../knownMintsCache.js'

// Stale-while-revalidate holder behind loadKnownMints. Fake timers and a mocked compute: no database, no real sleeping.

type Deferred = { promise: Promise<string>; resolve: (v: string) => void; reject: (e: Error) => void }
function deferred(): Deferred {
  let resolve!: (v: string) => void
  let reject!: (e: Error) => void
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const TTL = KNOWN_MINTS_CACHE_TTL
const STALE = KNOWN_MINTS_STALE_LIMIT

let compute: ReturnType<typeof vi.fn>
let onRefreshError: ReturnType<typeof vi.fn>
let cache: ReturnType<typeof createSwrCache<string>>

beforeEach(() => {
  vi.useFakeTimers()
  compute = vi.fn()
  onRefreshError = vi.fn()
  cache = createSwrCache<string>({ compute: () => compute(), onRefreshError })
})
afterEach(() => { vi.useRealTimers() })

async function prime(value = 'v1'): Promise<void> {
  compute.mockResolvedValueOnce(value)
  await cache.get()
  compute.mockClear()
}

describe('constants', () => {
  it('has the documented values and the timer below the TTL', () => {
    expect(TTL).toBe(60_000)
    expect(STALE).toBe(600_000)
    expect(KNOWN_MINTS_REFRESH_INTERVAL).toBe(45_000)
    expect(KNOWN_MINTS_REFRESH_INTERVAL).toBeLessThan(TTL)
  })
})

describe('fresh window', () => {
  it('a fresh hit does not recompute', async () => {
    await prime()
    vi.advanceTimersByTime(TTL - 1)
    expect(await cache.get()).toBe('v1')
    expect(compute).not.toHaveBeenCalled()
  })

  it('with no snapshot the request computes and concurrent requests share one computation', async () => {
    const d = deferred()
    compute.mockReturnValueOnce(d.promise)
    const all = Promise.all([cache.get(), cache.get(), cache.get()])
    d.resolve('v1')
    expect(await all).toEqual(['v1', 'v1', 'v1'])
    expect(compute).toHaveBeenCalledTimes(1)
  })
})

describe('stale-while-revalidate', () => {
  it('a stale hit returns the old snapshot at once and starts exactly one refresh for 20 concurrent requests', async () => {
    await prime()
    vi.advanceTimersByTime(TTL + 1)
    const d = deferred()
    compute.mockReturnValueOnce(d.promise)
    const results = await Promise.all(Array.from({ length: 20 }, () => cache.get()))
    expect(results.every(r => r === 'v1')).toBe(true)
    expect(compute).toHaveBeenCalledTimes(1)
    d.resolve('v2')
    await vi.advanceTimersByTimeAsync(0)
    expect(await cache.get()).toBe('v2')
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('a failing refresh keeps the stale snapshot, does not throw and reports the error', async () => {
    await prime()
    vi.advanceTimersByTime(TTL + 1)
    compute.mockRejectedValueOnce(new Error('db down'))
    expect(await cache.get()).toBe('v1')
    await vi.advanceTimersByTimeAsync(0)
    expect(onRefreshError).toHaveBeenCalledTimes(1)
    compute.mockRejectedValueOnce(new Error('db down'))
    expect(await cache.get()).toBe('v1') // still served until the stale limit
  })

  it('beyond the stale limit the request recomputes synchronously and an error propagates', async () => {
    await prime()
    vi.advanceTimersByTime(STALE + 1)
    compute.mockResolvedValueOnce('v2')
    expect(await cache.get()).toBe('v2')
    vi.advanceTimersByTime(STALE + 1)
    compute.mockRejectedValueOnce(new Error('db down'))
    await expect(cache.get()).rejects.toThrow('db down')
    expect(onRefreshError).not.toHaveBeenCalled()
  })
})

describe('invalidation', () => {
  it('makes the next request compute fresh data, never the stale snapshot', async () => {
    await prime()
    cache.invalidate()
    compute.mockResolvedValueOnce('v2')
    expect(await cache.get()).toBe('v2')
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('a refresh in flight during an invalidation does not overwrite the newer data', async () => {
    await prime()
    vi.advanceTimersByTime(TTL + 1)
    const old = deferred()
    compute.mockReturnValueOnce(old.promise)
    await cache.get() // starts the background refresh (will return OLD data)
    cache.invalidate()
    compute.mockResolvedValueOnce('new')
    expect(await cache.get()).toBe('new')
    old.resolve('old')
    await vi.advanceTimersByTimeAsync(0)
    expect(await cache.get()).toBe('new')
    expect(compute).toHaveBeenCalledTimes(2)
  })
})

describe('timer and warm-up', () => {
  it('start() warms up without blocking and refreshes every interval, never overlapping a running refresh', async () => {
    const d = deferred()
    compute.mockReturnValueOnce(d.promise)
    const stop = cache.start(45_000)
    expect(compute).toHaveBeenCalledTimes(1) // warm-up fired, nothing awaited
    await vi.advanceTimersByTimeAsync(45_000 * 3) // refresh still running: ticks join it
    expect(compute).toHaveBeenCalledTimes(1)
    d.resolve('v1')
    await vi.advanceTimersByTimeAsync(0)
    compute.mockResolvedValue('v2')
    await vi.advanceTimersByTimeAsync(45_000)
    expect(compute).toHaveBeenCalledTimes(2)
    expect(await cache.get()).toBe('v2')
    stop()
    await vi.advanceTimersByTimeAsync(45_000 * 3)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('a failing warm-up does not throw or crash and the next tick retries', async () => {
    compute.mockRejectedValueOnce(new Error('db down'))
    const stop = cache.start(45_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(onRefreshError).toHaveBeenCalledTimes(1)
    compute.mockResolvedValueOnce('v1')
    await vi.advanceTimersByTimeAsync(45_000)
    expect(await cache.get()).toBe('v1')
    stop()
  })

  it('the timer keeps the snapshot fresh so a request after 5 minutes does not compute', async () => {
    compute.mockResolvedValue('v1')
    const stop = cache.start()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    compute.mockClear()
    expect(await cache.get()).toBe('v1')
    expect(compute).not.toHaveBeenCalled()
    stop()
  })
})

describe('refresh error log', () => {
  it('writes one concise line per interval, without the error message', () => {
    const log = vi.fn()
    const logger = makeRefreshErrorLogger(log)
    const err = Object.assign(new Error('postgres://user:secret@host/db'), { code: 'ECONNREFUSED' })
    for (let i = 0; i < 50; i++) logger(err)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toBe('[known-mints] background refresh failed: Error (ECONNREFUSED)')
    expect(log.mock.calls[0][0]).not.toContain('secret')
    vi.advanceTimersByTime(5 * 60_000 + 1)
    logger(err)
    expect(log).toHaveBeenCalledTimes(2)
  })
})
