import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  REVIEWS_SYNC_JITTER_MAX_MS,
  REVIEWS_SYNC_PERIOD_MS,
  REVIEWS_SYNC_START_OFFSET_MS,
  startReviewsSyncTimer,
} from '../reviewsSchedule.js'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

const MIN = 60_000

describe('constants', () => {
  it('period is 60 minutes, start offset a few minutes, jitter up to 5 minutes', () => {
    expect(REVIEWS_SYNC_PERIOD_MS).toBe(60 * MIN)
    expect(REVIEWS_SYNC_START_OFFSET_MS).toBeGreaterThanOrEqual(2 * MIN)
    expect(REVIEWS_SYNC_START_OFFSET_MS).toBeLessThanOrEqual(5 * MIN)
    expect(REVIEWS_SYNC_JITTER_MAX_MS).toBe(5 * MIN)
  })
})

describe('startReviewsSyncTimer', () => {
  it('first run falls inside [offset, offset + jitter max)', async () => {
    for (const r of [0, 0.5, 0.999999]) {
      const run = vi.fn().mockResolvedValue(undefined)
      const t = startReviewsSyncTimer({ run, isRunning: () => false, random: () => r, log: () => {} })
      await vi.advanceTimersByTimeAsync(REVIEWS_SYNC_START_OFFSET_MS - 1)
      expect(run).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(REVIEWS_SYNC_JITTER_MAX_MS + 1)
      expect(run).toHaveBeenCalledTimes(1)
      t.stop()
    }
  })

  it('every later run is one period after the previous nominal slot, within the jitter bound', async () => {
    const values = [0.2, 0.9, 0.0, 0.6]
    let i = 0
    const run = vi.fn().mockResolvedValue(undefined)
    const calls: number[] = []
    run.mockImplementation(async () => { calls.push(Date.now()) })
    const start = Date.now()
    const t = startReviewsSyncTimer({ run, isRunning: () => false, random: () => values[i++ % values.length]!, log: () => {} })
    await vi.advanceTimersByTimeAsync(4 * REVIEWS_SYNC_PERIOD_MS)
    t.stop()
    expect(calls.length).toBeGreaterThanOrEqual(4)
    calls.slice(0, 4).forEach((at, k) => {
      const nominal = start + REVIEWS_SYNC_START_OFFSET_MS + k * REVIEWS_SYNC_PERIOD_MS
      expect(at - nominal).toBeGreaterThanOrEqual(0)
      expect(at - nominal).toBeLessThan(REVIEWS_SYNC_JITTER_MAX_MS)
    })
  })

  it('a tick that finds the previous run still going is skipped with one log line', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const log = vi.fn()
    let running = true
    const t = startReviewsSyncTimer({ run, isRunning: () => running, random: () => 0, log })
    await vi.advanceTimersByTimeAsync(REVIEWS_SYNC_START_OFFSET_MS + 1)
    expect(run).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    running = false
    await vi.advanceTimersByTimeAsync(REVIEWS_SYNC_PERIOD_MS)
    expect(run).toHaveBeenCalledTimes(1) // the skipped tick did not stop the schedule
    t.stop()
  })

  it('does nothing on a tick when shouldSkip says so (allowlist mode)', async () => {
    const run = vi.fn()
    const log = vi.fn()
    const t = startReviewsSyncTimer({ run, isRunning: () => false, shouldSkip: () => true, random: () => 0, log })
    await vi.advanceTimersByTimeAsync(2 * REVIEWS_SYNC_PERIOD_MS)
    t.stop()
    expect(run).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('a failing run does not stop later ticks', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = vi.fn().mockRejectedValue(new Error('boom'))
    const t = startReviewsSyncTimer({ run, isRunning: () => false, random: () => 0, log: () => {} })
    await vi.advanceTimersByTimeAsync(REVIEWS_SYNC_START_OFFSET_MS + 2 * REVIEWS_SYNC_PERIOD_MS)
    t.stop()
    expect(run).toHaveBeenCalledTimes(3)
    err.mockRestore()
  })

  it('stop() cancels the schedule', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const t = startReviewsSyncTimer({ run, isRunning: () => false, random: () => 0, log: () => {} })
    t.stop()
    await vi.advanceTimersByTimeAsync(3 * REVIEWS_SYNC_PERIOD_MS)
    expect(run).not.toHaveBeenCalled()
  })
})
