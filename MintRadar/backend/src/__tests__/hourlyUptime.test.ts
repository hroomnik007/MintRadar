import { describe, it, expect } from 'vitest'
import { buildHourlyBuckets, HOURLY_UPTIME_HOURS } from '../hourlyUptime.js'

const NOW = new Date('2026-11-22T15:30:00Z')

describe('buildHourlyBuckets', () => {
  it('gives 24 buckets per mint, oldest first, the current hour last, null for an hour without probes', () => {
    const m = buildHourlyBuckets([
      { url: 'https://a.example', hour: '2026-11-22T15:00:00Z', total: 6, up: 6 },
      { url: 'https://a.example', hour: '2026-11-21T16:00:00Z', total: 12, up: 6 },
    ], NOW)
    const a = m.get('https://a.example')!
    expect(a).toHaveLength(HOURLY_UPTIME_HOURS)
    expect(a[HOURLY_UPTIME_HOURS - 1]).toBe(100)
    expect(a[0]).toBe(50) // 16:00 yesterday is the oldest hour of the window
    expect(a.filter(v => v === null)).toHaveLength(HOURLY_UPTIME_HOURS - 2)
  })

  it('rounds down to one decimal, so an hour with one failed probe never reads 100', () => {
    const m = buildHourlyBuckets([{ url: 'u', hour: '2026-11-22T14:00:00Z', total: 12, up: 11 }], NOW)
    expect(m.get('u')![HOURLY_UPTIME_HOURS - 2]).toBe(91.6)
  })

  it('ignores hours outside the window, empty hours and accepts Date values', () => {
    const m = buildHourlyBuckets([
      { url: 'u', hour: '2026-11-21T15:00:00Z', total: 10, up: 10 },
      { url: 'u', hour: new Date('2026-11-22T03:00:00Z'), total: '12', up: '6' },
      { url: 'v', hour: '2026-11-22T15:00:00Z', total: 0, up: 0 },
    ], NOW)
    expect(m.get('u')!.filter(v => v !== null)).toEqual([50])
    expect(m.has('v')).toBe(false)
  })
})
