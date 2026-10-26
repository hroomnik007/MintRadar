import { describe, it, expect } from 'vitest'
import { rowDiffers, visibleCompareRows } from '@/utils/compareDiff'

describe('rowDiffers', () => {
  it('equal keys: the row is the same for every mint', () => {
    expect(rowDiffers(['a', 'a'])).toBe(false)
    expect(rowDiffers(['x', 'x', 'x', 'x'])).toBe(false)
  })
  it('any differing key keeps the row', () => {
    expect(rowDiffers(['a', 'b'])).toBe(true)
    expect(rowDiffers(['a', 'a', 'b'])).toBe(true)
  })
  it('an unknown (still loading) key keeps the row, even if the others match', () => {
    expect(rowDiffers(['a', null])).toBe(true)
    expect(rowDiffers([null, null])).toBe(true)
  })
  it('fewer than two mints: nothing to compare, the row stays', () => {
    expect(rowDiffers([])).toBe(true)
    expect(rowDiffers(['a'])).toBe(true)
  })
  it('the empty string is a value, not a gap', () => {
    expect(rowDiffers(['', ''])).toBe(false)
    expect(rowDiffers(['', '-'])).toBe(true)
  })
})

describe('visibleCompareRows', () => {
  const rows = [
    { id: 'status', keys: ['on', 'on'] },
    { id: 'latency', keys: ['50', '120'] },
    { id: 'fee', keys: ['0', null] },
    { id: 'version', keys: ['v1', 'v1'] },
  ]
  it('off: every row, in order, as a new array', () => {
    const out = visibleCompareRows(rows, false)
    expect(out.map(r => r.id)).toEqual(['status', 'latency', 'fee', 'version'])
    expect(out).not.toBe(rows)
  })
  it('on: only rows that differ or are not known yet, in order', () => {
    expect(visibleCompareRows(rows, true).map(r => r.id)).toEqual(['latency', 'fee'])
  })
})
