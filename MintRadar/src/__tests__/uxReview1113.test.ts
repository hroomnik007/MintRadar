import { describe, it, expect } from 'vitest'
import { auditScoredLine, uptime30dOutageNote } from '@/utils/mintDetailFacts'
import { AUDIT_WINDOW_DAYS } from '@/utils/tooltipTexts'

describe('auditScoredLine: the sentence above the Audit tiles', () => {
  it('names the swaps and failures that count, from the stored cashu.info window figures', () => {
    expect(auditScoredLine(12, 0)).toBe(`Counted in the Reliability Score: 12 swaps of the last ${AUDIT_WINDOW_DAYS} days, none failed because of this mint. The figures below also show older swaps and failures caused elsewhere.`)
    expect(auditScoredLine(12, 2)).toContain('12 swaps of the last')
    expect(auditScoredLine(12, 2)).toContain('2 failed because of this mint')
    expect(auditScoredLine(1, 0)).toContain('1 swap of the last')
  })
  it('never says more failures than swaps, and is absent without a total', () => {
    expect(auditScoredLine(3, 9)).toContain('3 failed because of this mint')
    expect(auditScoredLine(null, 0)).toBeNull()
    expect(auditScoredLine(undefined, undefined)).toBeNull()
    expect(auditScoredLine(0, 0)).toBeNull()
  })
})

describe('uptime30dOutageNote: a rounded 100 % that still had outages', () => {
  it('adds the outage count only next to 100 %', () => {
    expect(uptime30dOutageNote(100, 1)).toBe(' · 1 outage')
    expect(uptime30dOutageNote(100, 3)).toBe(' · 3 outages')
    expect(uptime30dOutageNote(100, 0)).toBe('')
    expect(uptime30dOutageNote(100, undefined)).toBe('')
    expect(uptime30dOutageNote(99, 2)).toBe('')
    expect(uptime30dOutageNote(null, 2)).toBe('')
  })
})
