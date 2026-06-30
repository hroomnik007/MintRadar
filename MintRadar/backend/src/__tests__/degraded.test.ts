import { describe, it, expect } from 'vitest'
import { computeDegraded } from '../degraded.js'

// degraded = (total >= 4 && onlineCount === 0) || isStaleOffline
// isStaleOffline = latestOnline === false && latestCheckedAt !== null
//                  && (now - checkedAt) > 24h
//
// `now` is injected for determinism.
const NOW = Date.parse('2026-06-30T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60 * 1000).toISOString()

describe('computeDegraded', () => {
  describe('rule 1: total >= 4 && onlineCount === 0', () => {
    it('is degraded when 4 probes all failed', () => {
      expect(computeDegraded(4, 0, false, hoursAgo(1), NOW)).toBe(true)
    })

    it('is degraded at exactly the total === 4 boundary', () => {
      expect(computeDegraded(4, 0, null, null, NOW)).toBe(true)
    })

    it('is NOT degraded with only 3 failed probes (and not stale)', () => {
      expect(computeDegraded(3, 0, false, hoursAgo(1), NOW)).toBe(false)
    })

    it('is NOT degraded when total === 4 but one probe was online', () => {
      expect(computeDegraded(4, 1, true, hoursAgo(1), NOW)).toBe(false)
    })

    it('is NOT degraded with many probes where some are online', () => {
      expect(computeDegraded(10, 5, true, hoursAgo(1), NOW)).toBe(false)
    })
  })

  describe('rule 2: isStaleOffline (last state offline, older than 24h)', () => {
    it('is degraded when last known state is offline and 25h old, even with few probes', () => {
      expect(computeDegraded(1, 0, false, hoursAgo(25), NOW)).toBe(true)
    })

    it('is NOT degraded when last offline probe is only 1h old', () => {
      expect(computeDegraded(1, 0, false, hoursAgo(1), NOW)).toBe(false)
    })

    it('is NOT stale-degraded exactly at the 24h boundary (strict greater-than)', () => {
      expect(computeDegraded(1, 0, false, hoursAgo(24), NOW)).toBe(false)
    })

    it('is stale-degraded just past the 24h boundary', () => {
      const justOver = new Date(NOW - (24 * 60 * 60 * 1000 + 1000)).toISOString()
      expect(computeDegraded(1, 0, false, justOver, NOW)).toBe(true)
    })

    it('is NOT stale when last state is online (even if old)', () => {
      expect(computeDegraded(1, 1, true, hoursAgo(48), NOW)).toBe(false)
    })

    it('is NOT stale when latestCheckedAt is null', () => {
      expect(computeDegraded(1, 0, false, null, NOW)).toBe(false)
    })
  })

  describe('new mint never probed', () => {
    it('is NOT degraded and does not crash (total 0, all null)', () => {
      expect(computeDegraded(0, 0, null, null, NOW)).toBe(false)
    })
  })

  it('defaults `now` to the current time when omitted', () => {
    // a fresh offline probe (now) is never stale, few probes → not degraded
    expect(computeDegraded(1, 0, false, new Date().toISOString())).toBe(false)
  })
})
