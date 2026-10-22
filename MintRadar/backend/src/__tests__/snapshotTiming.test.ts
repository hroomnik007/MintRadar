import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { timedSnapshot } from '../snapshotTiming.js'

// Timing line of the snapshot computations (task E2b): the first 3 are logged, afterwards only a slow one, at most one
// per 5 minutes; the line holds nothing but the label and the milliseconds.

let lines: string[]
beforeEach(() => { vi.useFakeTimers(); lines = [] })
afterEach(() => { vi.useRealTimers() })

function run(ms: number) {
  const timed = (state.fn ??= timedSnapshot('known-mints', () => new Promise<string>(res => { setTimeout(() => res('secret-row-data'), state.next) }), l => lines.push(l)))
  state.next = ms
  const p = timed()
  return vi.advanceTimersByTimeAsync(ms).then(() => p)
}
const state: { fn: (() => Promise<string>) | null; next: number } = { fn: null, next: 0 }
beforeEach(() => { state.fn = null })

describe('timedSnapshot', () => {
  it('returns the value and logs the first 3 computations, however fast', async () => {
    expect(await run(40)).toBe('secret-row-data')
    await run(50); await run(60); await run(70); await run(80)
    expect(lines).toEqual([
      '[known-mints] snapshot computed in 40 ms',
      '[known-mints] snapshot computed in 50 ms',
      '[known-mints] snapshot computed in 60 ms',
    ])
  })

  it('afterwards logs only a computation slower than 1500 ms', async () => {
    for (let i = 0; i < 3; i++) await run(10)
    lines.length = 0
    await run(1500)
    expect(lines).toEqual([])
    await run(1501)
    expect(lines).toEqual(['[known-mints] snapshot computed in 1501 ms'])
  })

  it('logs at most one slow line per 5 minutes', async () => {
    for (let i = 0; i < 3; i++) await run(10)
    lines.length = 0
    await run(2000)
    await run(2000)
    expect(lines).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await run(2000)
    expect(lines).toHaveLength(2)
  })

  it('logs nothing but the label and the number, and passes an error through unlogged', async () => {
    await run(25)
    expect(lines[0]).toMatch(/^\[known-mints\] snapshot computed in \d+ ms$/)
    const failing = timedSnapshot('stats', () => Promise.reject(new Error('postgres://u:p@h/db')), l => lines.push(l))
    await expect(failing()).rejects.toThrow()
    expect(lines).toHaveLength(1)
  })
})
