import { describe, it, expect } from 'vitest'
import { uptimeDayReadouts } from '@/utils/uptimeBars'

// The hover readout of the 30 daily bars on Mint Detail (owner, 2026-11-20).
const NOW = Date.UTC(2026, 10, 20, 12, 0) // 20 Nov 2026, 12:00 UTC
const H = 3_600_000

describe('uptimeDayReadouts', () => {
  const days = [100, 98.6, null, 99.8]

  it('dates the bars oldest first, the last one is today', () => {
    expect(uptimeDayReadouts(days, [], NOW).map(r => r.date)).toEqual(['17 Nov', '18 Nov', '19 Nov', 'Today, 20 Nov'])
  })

  it('a fine day reads its uptime, a day without checks says so', () => {
    const r = uptimeDayReadouts(days, [], NOW)
    expect(r[0]!.text).toBe('100% uptime')
    expect(r[2]!.text).toBe('No checks this day')
  })

  it('adds the time down from the outages of that day', () => {
    const r = uptimeDayReadouts(days, [{ startedAt: new Date(Date.UTC(2026, 10, 18, 9, 0)).toISOString(), durationMs: 20 * 60_000 }], NOW)
    expect(r[1]!.text).toBe('98.6% uptime, down 20 min')
  })

  it('cuts an outage at midnight UTC and counts several on one day', () => {
    const r = uptimeDayReadouts(days, [
      { startedAt: new Date(Date.UTC(2026, 10, 17, 23, 0)).toISOString(), durationMs: 2 * H },
      { startedAt: new Date(Date.UTC(2026, 10, 18, 10, 0)).toISOString(), durationMs: 30 * 60_000 },
    ], NOW)
    expect(r[0]!.text).toBe('100% uptime, down 1h')
    expect(r[1]!.text).toBe('98.6% uptime, down 1h 30m in 2 outages')
  })

  it('an ongoing outage today is marked as still down', () => {
    const r = uptimeDayReadouts(days, [{ startedAt: new Date(NOW - 2 * H).toISOString(), durationMs: 2 * H, ongoing: true }], NOW)
    expect(r[3]!.text).toBe('99.8% uptime, down 2h, still down')
  })
})
