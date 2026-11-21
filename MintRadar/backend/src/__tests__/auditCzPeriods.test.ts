import { describe, it, expect } from 'vitest'
import { buildAuditCzPeriodView, periodFromDetail, periodFromNetwork30d } from '../auditCz.js'

describe('buildAuditCzPeriodView', () => {
  it('splits succeeded, failed elsewhere and blamed so they add up to swaps', () => {
    const v = buildAuditCzPeriodView({
      days: 7, total: 10, failed: 3, blamed: 1, avgMs: 400, amount: 90,
      deposits: { paid: 4, failed: 1 }, withdrawals: { paid: 3, failed: 2 },
      fetchedAt: '2026-11-21T10:00:00.000Z',
    })
    expect(v).toEqual({
      days: 7, swaps: 10, succeeded: 7, failedElsewhere: 2, attributedFailures: 1,
      avgMs: 400, amount: 90,
      deposits: { success: 4, total: 5, failed: 1 },
      withdrawals: { success: 3, total: 5, failed: 2 },
      fetchedAt: '2026-11-21T10:00:00.000Z',
    })
    expect(v.succeeded + v.failedElsewhere + v.attributedFailures).toBe(v.swaps)
    // The tab's success rate is succeeded / swaps (failed elsewhere lowers it): 7/10 → 70.0
    expect(Math.round((v.succeeded / v.swaps) * 1000) / 10).toBe(70)
  })

  it('clamps blamed and failed so they cannot exceed swaps', () => {
    const v = buildAuditCzPeriodView({
      days: 30, total: 5, failed: 2, blamed: 9, avgMs: null, amount: null,
      deposits: null, withdrawals: null, fetchedAt: null,
    })
    expect(v).toMatchObject({ swaps: 5, succeeded: 0, failedElsewhere: 0, attributedFailures: 5 })
  })
})

describe('periodFromDetail', () => {
  it('builds the 7-day view from swaps7d and is null without total and blamed', () => {
    const v = periodFromDetail({
      swaps7d: {
        all: { total: 20, success: 17, failed: 3, avgMs: 250, amount: 800 },
        asDest: { total: 8, success: 7, failed: 1 },
        asSource: { total: 12, success: 10, failed: 2 },
        errorsBlamed: 1,
      },
    }, '2026-11-21T08:00:00.000Z')
    expect(v).toMatchObject({
      days: 7, swaps: 20, succeeded: 17, failedElsewhere: 2, attributedFailures: 1,
      avgMs: 250, amount: 800,
      deposits: { success: 7, total: 8, failed: 1 },
      withdrawals: { success: 10, total: 12, failed: 2 },
      fetchedAt: '2026-11-21T08:00:00.000Z',
    })
    expect(periodFromDetail({ swaps7d: { all: { total: 4 } } }, null)).toBeNull()
    expect(periodFromDetail(null, null)).toBeNull()
  })
})

describe('periodFromNetwork30d', () => {
  const row = {
    network30_paid: 40,
    network30_failed: 6,
    network30_amount: 900,
    network30_avg_ms: 300,
    network30_dest_paid: 18,
    network30_dest_failed: 2,
    network30_dest_amount: 400,
    network30_source_paid: 22,
    network30_source_failed: 4,
    network30_source_amount: 500,
    network30_fetched_at: new Date('2026-11-21T10:18:00Z'),
    attributed_failures: 3,
  }

  it('builds the 30-day view from the stored graph plus the list feed blamed count', () => {
    const v = periodFromNetwork30d(row)
    expect(v).toEqual({
      days: 30, swaps: 46, succeeded: 40, failedElsewhere: 3, attributedFailures: 3,
      avgMs: 300, amount: 900,
      deposits: { success: 18, total: 20, failed: 2 },
      withdrawals: { success: 22, total: 26, failed: 4 },
      fetchedAt: '2026-11-21T10:18:00.000Z',
    })
    expect(v!.succeeded + v!.failedElsewhere + v!.attributedFailures).toBe(v!.swaps)
  })

  it('is null until the first successful store, and a quiet mint with zeros is present', () => {
    expect(periodFromNetwork30d({ attributed_failures: 1 })).toBeNull()
    expect(periodFromNetwork30d({ network30_paid: 0, network30_failed: 0 })).toBeNull()
    const quiet = periodFromNetwork30d({
      network30_paid: 0, network30_failed: 0,
      network30_dest_paid: 0, network30_dest_failed: 0,
      network30_source_paid: 0, network30_source_failed: 0,
      network30_fetched_at: '2026-11-21T10:18:00.000Z',
      attributed_failures: 0,
    })
    expect(quiet).toMatchObject({ days: 30, swaps: 0, succeeded: 0, failedElsewhere: 0, attributedFailures: 0 })
  })
})
