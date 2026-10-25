import { describe, it, expect } from 'vitest'
import { historyLatencyPercentilesSql, latencyPercentilesOf } from '../latencyPercentiles.js'
import { latency24hOf } from '../walletApi.js'

describe('history latency percentiles', () => {
  it('the SQL takes percentile_cont 0.5 / 0.95 over successful probes with a latency in the period window', () => {
    const sql = historyLatencyPercentilesSql(7)
    expect(sql).toContain('percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)')
    expect(sql).toContain('percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)')
    expect(sql).toMatch(/AND online\s+AND latency_ms IS NOT NULL/)
    expect(sql).toContain("INTERVAL '7 days'")
  })

  it('bounds the period to 1..90 days and whole numbers', () => {
    expect(historyLatencyPercentilesSql(0)).toContain("INTERVAL '1 days'")
    expect(historyLatencyPercentilesSql(1000)).toContain("INTERVAL '90 days'")
    expect(historyLatencyPercentilesSql(7.9)).toContain("INTERVAL '7 days'")
  })

  it('rounds to whole milliseconds; null without data', () => {
    expect(latencyPercentilesOf({ p50: 300, p95: '880.4' })).toEqual({ p50LatencyMs: 300, p95LatencyMs: 880 })
    expect(latencyPercentilesOf({ p50: null, p95: null })).toEqual({ p50LatencyMs: null, p95LatencyMs: null })
    expect(latencyPercentilesOf(undefined)).toEqual({ p50LatencyMs: null, p95LatencyMs: null })
    expect(latencyPercentilesOf({ p50: 'x', p95: 12.5 })).toEqual({ p50LatencyMs: null, p95LatencyMs: 13 })
  })
})

describe('latency24hOf (wallet API include=facts)', () => {
  it('builds { p50Ms, p95Ms, samples } from the snapshot columns', () => {
    expect(latency24hOf(300, '879.6', '5')).toEqual({ p50Ms: 300, p95Ms: 880, samples: 5 })
  })
  it('is null without samples or without percentiles', () => {
    expect(latency24hOf(null, null, 0)).toBeNull()
    expect(latency24hOf(300, 880, 0)).toBeNull()
    expect(latency24hOf(null, 880, 3)).toBeNull()
    expect(latency24hOf(300, 880, null)).toBeNull()
  })
})
