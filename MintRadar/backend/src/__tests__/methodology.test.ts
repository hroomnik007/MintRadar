import { describe, it, expect } from 'vitest'
import { METHODOLOGY_VERSION, METHODOLOGY_CHANGES } from '../shared/methodology.js'

describe('methodology version', () => {
  it('is an integer and equals the newest entry of the change list', () => {
    expect(Number.isInteger(METHODOLOGY_VERSION)).toBe(true)
    expect(METHODOLOGY_CHANGES[METHODOLOGY_CHANGES.length - 1]?.version).toBe(METHODOLOGY_VERSION)
  })
  it('lists consecutive versions from 1 with ISO dates in ascending order and a summary each', () => {
    METHODOLOGY_CHANGES.forEach((c, i) => {
      expect(c.version).toBe(i + 1)
      expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(c.summary.length).toBeGreaterThan(20)
      if (i > 0) expect(c.date >= METHODOLOGY_CHANGES[i - 1]!.date).toBe(true)
    })
  })
})
