import { describe, it, expect } from 'vitest'
import { summarizeOutages, type OutageRow } from '../outages.js'

const T = (min: number) => new Date(Date.parse('2026-10-25T10:00:00Z') + min * 60_000)
const rows = (spec: string): OutageRow[] => [...spec].map((c, i) => ({ online: c === '+', checked_at: T(i * 5) }))
const MIN = 60_000

describe('summarizeOutages', () => {
  it('(a) a block still offline at the newest check is ongoing: duration to now, currentOutage, no "since last outage"', () => {
    const now = T(60).getTime()
    const s = summarizeOutages(rows('+++--+++---'), now) // recovered 10..25, ongoing from 40
    expect(s.ongoing).toBe(true)
    expect(s.outageCount).toBe(2)
    expect(s.recoveredCount).toBe(1)
    expect(s.currentOutage).toEqual({ startedAt: T(40).toISOString(), durationMs: 20 * MIN })
    expect(s.outages.map(o => o.ongoing)).toEqual([false, true])
    expect(s.outages[1]!.durationMs).toBe(20 * MIN)
    expect(s.sinceLastOutageMs).toBeNull()
  })

  it('(b) the ongoing outage is excluded from the average recovery time; null when nothing recovered', () => {
    const now = T(200).getTime()
    const s = summarizeOutages(rows('+--+---+--'), now) // recovered 10 min and 15 min, then ongoing
    expect(s.avgRecoveryMs).toBe(Math.round((10 + 15) / 2 * MIN))
    expect(summarizeOutages(rows('++---'), now).avgRecoveryMs).toBeNull()
    expect(summarizeOutages(rows('++---'), now).recoveredCount).toBe(0)
  })

  it('(c) a block starting at the window start is flagged truncatedAtWindowStart, later ones are not', () => {
    const s = summarizeOutages(rows('---+--+'), T(100).getTime())
    expect(s.outages.map(o => o.truncatedAtWindowStart)).toEqual([true, false])
    expect(s.outages.every(o => !o.ongoing)).toBe(true)
    expect(s.ongoing).toBe(false)
  })

  it('recovered only: sinceLastOutageMs runs from the recovery, single failed checks are ignored', () => {
    const now = T(100).getTime()
    const s = summarizeOutages(rows('+-+--++-+'), now)
    expect(s.outageCount).toBe(1)
    expect(s.outages[0]).toMatchObject({ startedAt: T(15).toISOString(), durationMs: 10 * MIN, error: 'offline', ongoing: false, truncatedAtWindowStart: false })
    expect(s.sinceLastOutageMs).toBe(now - T(25).getTime())
    expect(s.currentOutage).toBeNull()
  })

  it('no rows: all empty', () => {
    expect(summarizeOutages([], 0)).toEqual({ sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, recoveredCount: 0, ongoing: false, currentOutage: null, outages: [] })
  })
})
