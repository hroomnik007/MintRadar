import { describe, it, expect } from 'vitest'
import { activeSectionId, tocScrollBehavior } from '@/utils/docToc'

describe('activeSectionId', () => {
  const tops = (...t: number[]) => t.map((top, i) => ({ id: `s${i}`, top }))
  it('no headings: null', () => { expect(activeSectionId([], 80)).toBeNull() })
  it('above the first heading: the first section', () => { expect(activeSectionId(tops(400, 900), 80)).toBe('s0') })
  it('the last heading that has reached the offset', () => {
    expect(activeSectionId(tops(-500, 60, 700), 80)).toBe('s1')
    expect(activeSectionId(tops(-900, -300, 81), 80)).toBe('s2') // 1px tolerance for sub-pixel scroll
    expect(activeSectionId(tops(-900, -300, 82), 80)).toBe('s1')
  })
  it('past the end: the last section', () => { expect(activeSectionId(tops(-900, -600, -10), 80)).toBe('s2') })
})

describe('tocScrollBehavior', () => {
  it('smooth by default, instant under reduced motion', () => {
    expect(tocScrollBehavior(false)).toBe('smooth')
    expect(tocScrollBehavior(true)).toBe('auto')
  })
})
