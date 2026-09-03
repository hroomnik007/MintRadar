import { describe, it, expect } from 'vitest'
import {
  mintAgeBadge,
  trustScoreColor,
  trustScoreInfo,
  trustColor,
  latencyColor,
  formatTimeAgo,
  formatAuditErrorRatio,
} from '../utils/mintFormatting'

// Inject a fixed `now` so tests are deterministic regardless of when they run.
const NOW = Date.parse('2026-06-30T12:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString()
// 30.44 days per month (as used in the implementation)
const monthsAgo = (m: number) => new Date(NOW - m * 30.44 * 24 * 60 * 60 * 1000).toISOString()

// ── mintAgeBadge ───────────────────────────────────────────────
// NOTE: thresholds are in months (< 1 / < 6 / < 12 / ≥ 12),
// not days as in some external docs.
describe('mintAgeBadge', () => {
  it('returns null for null discoveredAt', () => {
    expect(mintAgeBadge(null, NOW)).toBeNull()
  })

  it('returns null for undefined discoveredAt', () => {
    expect(mintAgeBadge(undefined, NOW)).toBeNull()
  })

  describe('Fresh — discovered < 1 month ago', () => {
    it('labels a mint discovered today as Fresh', () => {
      expect(mintAgeBadge(daysAgo(0), NOW)?.label).toBe('Fresh')
    })

    it('labels a mint discovered 29 days ago as Fresh', () => {
      expect(mintAgeBadge(daysAgo(29), NOW)?.label).toBe('Fresh')
    })

    it('Fresh has the correct amber colour', () => {
      expect(mintAgeBadge(daysAgo(1), NOW)?.color).toBe('#d3a446')
    })
  })

  describe('Established — 1 month ≤ age < 6 months', () => {
    it('labels a mint discovered 1 month + 1 day ago as Established', () => {
      // Just past the 1-month boundary
      expect(mintAgeBadge(daysAgo(32), NOW)?.label).toBe('Established')
    })

    it('labels a mint 3 months old as Established', () => {
      expect(mintAgeBadge(monthsAgo(3), NOW)?.label).toBe('Established')
    })

    it('labels a mint just under 6 months old as Established', () => {
      // 5 months and ~28 days → still < 6 months
      expect(mintAgeBadge(monthsAgo(5.9), NOW)?.label).toBe('Established')
    })

    it('Established has the correct green colour', () => {
      expect(mintAgeBadge(monthsAgo(3), NOW)?.color).toBe('#5cc9a3')
    })
  })

  describe('Veteran — 6 months ≤ age < 12 months', () => {
    it('labels a mint 6 months + 1 day old as Veteran', () => {
      expect(mintAgeBadge(daysAgo(6 * 31), NOW)?.label).toBe('Veteran')
    })

    it('labels a mint 9 months old as Veteran', () => {
      expect(mintAgeBadge(monthsAgo(9), NOW)?.label).toBe('Veteran')
    })

    it('labels a mint just under 12 months old as Veteran', () => {
      expect(mintAgeBadge(monthsAgo(11.9), NOW)?.label).toBe('Veteran')
    })

    it('Veteran has the correct orange colour', () => {
      expect(mintAgeBadge(monthsAgo(9), NOW)?.color).toBe('#ffa500')
    })
  })

  describe('OG — age ≥ 12 months', () => {
    it('labels a mint exactly 12 months old as OG', () => {
      expect(mintAgeBadge(monthsAgo(12), NOW)?.label).toBe('OG')
    })

    it('labels a mint 2 years old as OG', () => {
      expect(mintAgeBadge(monthsAgo(24), NOW)?.label).toBe('OG')
    })

    it('OG has the correct purple colour', () => {
      expect(mintAgeBadge(monthsAgo(24), NOW)?.color).toBe('#a78bfa')
    })
  })

  it('uses Date.now() when `now` is omitted (smoke test — just must not throw)', () => {
    expect(() => mintAgeBadge(daysAgo(10))).not.toThrow()
  })
})

// ── trustScoreColor (MintDetail raw colour) ────────────────────
// Thresholds: ≥ 75 → green, ≥ 50 → orange, < 50 → red
describe('trustScoreColor', () => {
  it('returns green for score 75', () => {
    expect(trustScoreColor(75)).toBe('#4ade80')
  })

  it('returns green for score 100', () => {
    expect(trustScoreColor(100)).toBe('#4ade80')
  })

  it('returns orange for score 74 (just below green)', () => {
    expect(trustScoreColor(74)).toBe('#ffa500')
  })

  it('returns orange for score 50', () => {
    expect(trustScoreColor(50)).toBe('#ffa500')
  })

  it('returns red for score 49 (just below orange)', () => {
    expect(trustScoreColor(49)).toBe('#ff4d4d')
  })

  it('returns red for score 0', () => {
    expect(trustScoreColor(0)).toBe('#ff4d4d')
  })
})

// ── trustScoreInfo (MintDetail badge) ─────────────────────────
// Thresholds: ≥ 70 → High Trust, ≥ 40 → Moderate Trust, < 40 → Low Trust
describe('trustScoreInfo', () => {
  it('returns High Trust for score 70', () => {
    expect(trustScoreInfo(70).label).toBe('High Trust')
  })

  it('returns High Trust for score 100', () => {
    expect(trustScoreInfo(100).label).toBe('High Trust')
  })

  it('returns Moderate Trust for score 69 (just below High Trust)', () => {
    expect(trustScoreInfo(69).label).toBe('Moderate Trust')
  })

  it('returns Moderate Trust for score 40', () => {
    expect(trustScoreInfo(40).label).toBe('Moderate Trust')
  })

  it('returns Low Trust for score 39 (just below Moderate Trust)', () => {
    expect(trustScoreInfo(39).label).toBe('Low Trust')
  })

  it('returns Low Trust for score 0', () => {
    expect(trustScoreInfo(0).label).toBe('Low Trust')
  })

  it('High Trust badge has a green color', () => {
    expect(trustScoreInfo(90).color).toBe('#4ade80')
  })

  it('Low Trust badge has a red color', () => {
    expect(trustScoreInfo(20).color).toBe('#ff4d4d')
  })
})

// ── trustColor (Dashboard list view) ──────────────────────────
// Same thresholds as trustScoreInfo (≥ 70 / ≥ 40 / else)
describe('trustColor', () => {
  it('returns green for score ≥ 70', () => {
    expect(trustColor(70)).toBe('#4ade80')
    expect(trustColor(100)).toBe('#4ade80')
  })

  it('returns orange for 40 ≤ score < 70', () => {
    expect(trustColor(69)).toBe('#ffa500')
    expect(trustColor(40)).toBe('#ffa500')
  })

  it('returns red for score < 40', () => {
    expect(trustColor(39)).toBe('#ff4d4d')
    expect(trustColor(0)).toBe('#ff4d4d')
  })
})

// ── latencyColor ───────────────────────────────────────────────
// null / 0 / negative → var(--t3) (muted)
// < 500 ms  → var(--fast) | < 2000 ms → var(--med) | ≥ 2000 ms → var(--slow)
describe('latencyColor', () => {
  it('returns muted colour for null (mint offline)', () => {
    expect(latencyColor(null)).toBe('var(--t3)')
  })

  it('returns muted colour for undefined', () => {
    expect(latencyColor(undefined)).toBe('var(--t3)')
  })

  it('returns muted colour for 0', () => {
    expect(latencyColor(0)).toBe('var(--t3)')
  })

  it('returns muted colour for a negative value', () => {
    expect(latencyColor(-1)).toBe('var(--t3)')
  })

  it('returns fast colour for 1 ms', () => {
    expect(latencyColor(1)).toBe('var(--fast)')
  })

  it('returns fast colour for 499 ms (just below 500)', () => {
    expect(latencyColor(499)).toBe('var(--fast)')
  })

  it('returns medium colour for 500 ms', () => {
    expect(latencyColor(500)).toBe('var(--med)')
  })

  it('returns medium colour for 1999 ms (just below 2000)', () => {
    expect(latencyColor(1999)).toBe('var(--med)')
  })

  it('returns slow colour for 2000 ms', () => {
    expect(latencyColor(2000)).toBe('var(--slow)')
  })

  it('returns slow colour for very high latency', () => {
    expect(latencyColor(30000)).toBe('var(--slow)')
  })
})

// ── formatTimeAgo (Audit strip "Last checked") ─────────────────
describe('formatTimeAgo', () => {
  const REF = Date.parse('2026-09-03T12:00:00.000Z')
  const ago = (ms: number) => new Date(REF - ms)

  it('renders an em dash for null', () => {
    expect(formatTimeAgo(null, REF)).toBe('—')
  })

  it('renders seconds under a minute', () => {
    expect(formatTimeAgo(ago(5_000), REF)).toBe('5s ago')
  })

  it('renders minutes under an hour', () => {
    expect(formatTimeAgo(ago(5 * 60_000), REF)).toBe('5 min ago')
  })

  it('renders hours under a day', () => {
    expect(formatTimeAgo(ago(6 * 3_600_000), REF)).toBe('6h ago')
  })

  it('renders days past 24h (typical 6h-cron staleness lands here)', () => {
    expect(formatTimeAgo(ago(2 * 86_400_000), REF)).toBe('2d ago')
  })

  it('floors partial units', () => {
    expect(formatTimeAgo(ago(119 * 60_000), REF)).toBe('1h ago')
  })
})

// ── formatAuditErrorRatio (Audit strip "Recent errors") ────────
describe('formatAuditErrorRatio', () => {
  it('renders an em dash when there is no rolling-window sample', () => {
    expect(formatAuditErrorRatio(null, null)).toBe('—')
    expect(formatAuditErrorRatio(undefined, 3)).toBe('—')
  })

  it('renders "<errors> / <total>"', () => {
    expect(formatAuditErrorRatio(100, 3)).toBe('3 / 100')
  })

  it('treats a null/undefined error count as zero', () => {
    expect(formatAuditErrorRatio(100, null)).toBe('0 / 100')
    expect(formatAuditErrorRatio(100, undefined)).toBe('0 / 100')
  })

  it('still renders a below-threshold sample (adequacy is a separate concern)', () => {
    expect(formatAuditErrorRatio(2, 0)).toBe('0 / 2')
  })

  it('renders a zero-swap total literally', () => {
    expect(formatAuditErrorRatio(0, 0)).toBe('0 / 0')
  })
})
