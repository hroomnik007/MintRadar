import { describe, it, expect } from 'vitest'
import { revealTarget } from '@/utils/revealResult'

// Tools (owner, 2026-11-28): after Inspect / a paste the page moves to the result, unless its top is already in view.
describe('revealTarget', () => {
  it('stays when the top is under the navbar and in the upper part of the screen', () => {
    expect(revealTarget(200, 0, 800, 50)).toBeNull()
    expect(revealTarget(440, 0, 800, 50)).toBeNull()
  })
  it('moves a result below the fold to 12 px under the navbar', () => {
    expect(revealTarget(900, 100, 800, 50)).toBe(100 + 900 - 50 - 12)
  })
  it('moves a result hidden under the navbar back into view, never above the page top', () => {
    expect(revealTarget(20, 300, 800, 50)).toBe(300 + 20 - 62)
    expect(revealTarget(20, 10, 800, 50)).toBe(0)
  })
})
