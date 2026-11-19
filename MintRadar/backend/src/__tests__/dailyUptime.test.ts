import { describe, it, expect } from 'vitest'
import { buildDailyBuckets, DAILY_UPTIME_DAYS } from '../dailyUptime.js'

const NOW = new Date('2026-11-19T15:30:00Z')

describe('buildDailyBuckets', () => {
  it('gives 30 buckets per mint, oldest first, today last, null for a day without probes', () => {
    const m = buildDailyBuckets([
      { url: 'https://a.example', day: '2026-11-19', total: 182, up: 182 },
      { url: 'https://a.example', day: '2026-10-21', total: 288, up: 144 },
    ], NOW)
    const a = m.get('https://a.example')!
    expect(a).toHaveLength(DAILY_UPTIME_DAYS)
    expect(a[DAILY_UPTIME_DAYS - 1]).toBe(100)
    expect(a[0]).toBe(50) // 2026-10-21 is the oldest day of the window
    expect(a.filter(v => v === null)).toHaveLength(DAILY_UPTIME_DAYS - 2)
  })

  it('rounds down to one decimal, so a day with one failed probe never reads 100', () => {
    const m = buildDailyBuckets([{ url: 'u', day: '2026-11-18', total: 288, up: 287 }], NOW)
    expect(m.get('u')![DAILY_UPTIME_DAYS - 2]).toBe(99.6)
  })

  it('ignores days outside the window, empty days and accepts Date values', () => {
    const m = buildDailyBuckets([
      { url: 'u', day: '2026-10-20', total: 10, up: 10 },
      { url: 'u', day: new Date('2026-11-01T00:00:00Z'), total: '20', up: '10' },
      { url: 'v', day: '2026-11-19', total: 0, up: 0 },
    ], NOW)
    const u = m.get('u')!
    expect(u.filter(v => v !== null)).toEqual([50])
    expect(m.has('v')).toBe(false)
  })
})
