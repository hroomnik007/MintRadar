import { describe, it, expect } from 'vitest'
import { formatDate, DATE_MONTHS } from '../utils/formatDate'

describe('formatDate', () => {
  it('uses a fixed three-letter month: September is "Sep", never "Sept"', () => {
    expect(formatDate('2026-09-29T10:00:00Z')).toBe('29 Sep 2026')
    expect(DATE_MONTHS).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
    for (let m = 0; m < 12; m++) expect(formatDate(new Date(Date.UTC(2026, m, 15)))).toMatch(/^15 [A-Z][a-z]{2} 2026$/)
  })

  it('has no leading zero on the day', () => {
    expect(formatDate('2026-02-03T00:00:00Z')).toBe('3 Feb 2026')
    expect(formatDate('2026-10-09T12:00:00Z')).toBe('9 Oct 2026')
  })

  it('reads the UTC date: the midnight boundary does not depend on the machine time zone', () => {
    expect(formatDate('2026-09-30T23:59:59Z')).toBe('30 Sep 2026')
    expect(formatDate('2026-10-01T00:00:00Z')).toBe('1 Oct 2026')
    expect(formatDate('2026-01-01T00:00:00+02:00')).toBe('31 Dec 2025')
  })

  it('accepts a date-only string, a Date and epoch milliseconds', () => {
    expect(formatDate('2026-06-17')).toBe('17 Jun 2026')
    expect(formatDate(new Date(Date.UTC(2026, 5, 17)))).toBe('17 Jun 2026')
    expect(formatDate(Date.UTC(2026, 5, 17))).toBe('17 Jun 2026')
  })

  it('drops the year with { year: false }', () => {
    expect(formatDate('2026-09-29T10:00:00Z', { year: false })).toBe('29 Sep')
    expect(formatDate('2026-02-03T10:00:00Z', { year: false })).toBe('3 Feb')
  })

  it('{ local: true } uses the machine time zone, like the code it replaced', () => {
    const d = new Date(2026, 8, 29, 12, 0, 0)
    expect(formatDate(d, { local: true })).toBe('29 Sep 2026')
    expect(formatDate(d, { local: true, year: false })).toBe('29 Sep')
  })

  it('returns an empty string for a missing or invalid value', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
    expect(formatDate('')).toBe('')
    expect(formatDate('nonsense')).toBe('')
    expect(formatDate(new Date('x'))).toBe('')
    expect(formatDate(Number.NaN)).toBe('')
  })
})
