import { describe, it, expect } from 'vitest'
import { latencyScale } from '@/utils/chartScale'

describe('latencyScale', () => {
  it('ticks are distinct, ascending and cover the data (the 160-240 ms case that used to read 300/200/200/200)', () => {
    const { domain, ticks } = latencyScale([160, 190, 240, null, 210])
    expect(new Set(ticks).size).toBe(ticks.length)
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks)
    expect(domain[0]).toBeLessThanOrEqual(160)
    expect(domain[1]).toBeGreaterThanOrEqual(240)
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    expect(ticks.length).toBeLessThanOrEqual(7)
  })
  it('a flat series and an empty one still give a usable axis', () => {
    const flat = latencyScale([300, 300, 300])
    expect(flat.domain[1]).toBeGreaterThan(flat.domain[0])
    expect(new Set(flat.ticks).size).toBe(flat.ticks.length)
    expect(latencyScale([null, null]).ticks.length).toBeGreaterThan(1)
  })
  it('large spreads use a coarser step and never exceed a handful of ticks', () => {
    const { ticks } = latencyScale([80, 2900, 1500])
    expect(ticks.length).toBeLessThanOrEqual(7)
    expect(ticks[0]).toBeGreaterThanOrEqual(0)
  })
})
