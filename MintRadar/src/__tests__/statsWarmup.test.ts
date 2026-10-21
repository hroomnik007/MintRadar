// The idle warm-up of the Stats page starts after the mint list has settled, not at app start (Task P2 part 2).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { scheduleStatsWarmup, STATS_WARMUP_FALLBACK_MS } from '../core/mint/prefetch'
import { KNOWN_MINTS_QUERY_KEY } from '../hooks/useKnownMints'

let qc: QueryClient
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 16) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => setTimeout(cb, 1) as unknown as number)
  vi.stubGlobal('cancelIdleCallback', (id: number) => clearTimeout(id))
  qc = new QueryClient()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); qc.clear() })

describe('scheduleStatsWarmup', () => {
  it('does not start while the mint list is still loading, however many idle moments pass', async () => {
    const warm = vi.fn()
    const pending = new Promise<never>(() => undefined)
    void qc.prefetchQuery({ queryKey: KNOWN_MINTS_QUERY_KEY, queryFn: () => pending })
    scheduleStatsWarmup(qc, warm)
    await vi.advanceTimersByTimeAsync(STATS_WARMUP_FALLBACK_MS - 100)
    expect(warm).not.toHaveBeenCalled()
  })

  it('keeps waiting past the fallback delay while the list is being fetched', async () => {
    const warm = vi.fn()
    void qc.prefetchQuery({ queryKey: KNOWN_MINTS_QUERY_KEY, queryFn: () => new Promise<never>(() => undefined) })
    scheduleStatsWarmup(qc, warm)
    await vi.advanceTimersByTimeAsync(STATS_WARMUP_FALLBACK_MS * 3)
    expect(warm).not.toHaveBeenCalled()
  })

  it('starts one frame and one idle moment after the list arrived', async () => {
    const warm = vi.fn()
    let resolve!: (v: unknown[]) => void
    void qc.prefetchQuery({ queryKey: KNOWN_MINTS_QUERY_KEY, queryFn: () => new Promise<unknown[]>(r => { resolve = r }) })
    scheduleStatsWarmup(qc, warm)
    resolve([])
    await vi.advanceTimersByTimeAsync(0)
    expect(warm).not.toHaveBeenCalled() // the frame has not been painted yet
    await vi.advanceTimersByTimeAsync(16)
    expect(warm).not.toHaveBeenCalled() // idle callback not yet
    await vi.advanceTimersByTimeAsync(1)
    expect(warm).toHaveBeenCalledTimes(1)
  })

  it('a failed list request also counts as settled (the page shows its error state, the warm-up still runs)', async () => {
    const warm = vi.fn()
    void qc.prefetchQuery({ queryKey: KNOWN_MINTS_QUERY_KEY, queryFn: () => Promise.reject(new Error('x')), retry: false })
    scheduleStatsWarmup(qc, warm)
    await vi.advanceTimersByTimeAsync(100)
    expect(warm).toHaveBeenCalledTimes(1)
  })

  it('starts once when the list was already cached', async () => {
    const warm = vi.fn()
    qc.setQueryData(KNOWN_MINTS_QUERY_KEY, [])
    scheduleStatsWarmup(qc, warm)
    await vi.advanceTimersByTimeAsync(100)
    qc.setQueryData(KNOWN_MINTS_QUERY_KEY, [{}])
    await vi.advanceTimersByTimeAsync(100)
    expect(warm).toHaveBeenCalledTimes(1)
  })

  it('on a route that never asks for the list it starts after the fallback delay, not before', async () => {
    const warm = vi.fn()
    scheduleStatsWarmup(qc, warm)
    await vi.advanceTimersByTimeAsync(STATS_WARMUP_FALLBACK_MS - 1)
    expect(warm).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1 + 16 + 1)
    expect(warm).toHaveBeenCalledTimes(1)
  })

  it('waitForList=false (the /stats route) starts at the next idle moment without waiting for the list', async () => {
    const warm = vi.fn()
    void qc.prefetchQuery({ queryKey: KNOWN_MINTS_QUERY_KEY, queryFn: () => new Promise<never>(() => undefined) })
    scheduleStatsWarmup(qc, warm, false)
    await vi.advanceTimersByTimeAsync(100)
    expect(warm).toHaveBeenCalledTimes(1)
  })

  it('the cancel function stops it at every stage', async () => {
    const warm = vi.fn()
    const cancelEarly = scheduleStatsWarmup(qc, warm)
    cancelEarly()
    await vi.advanceTimersByTimeAsync(STATS_WARMUP_FALLBACK_MS * 2)
    expect(warm).not.toHaveBeenCalled()

    qc.setQueryData(KNOWN_MINTS_QUERY_KEY, [])
    const cancelLate = scheduleStatsWarmup(qc, warm)
    await vi.advanceTimersByTimeAsync(16) // frame painted, idle callback pending
    cancelLate()
    await vi.advanceTimersByTimeAsync(100)
    expect(warm).not.toHaveBeenCalled()
  })
})
