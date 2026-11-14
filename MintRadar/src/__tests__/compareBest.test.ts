import { describe, it, expect } from 'vitest'
import { bestFlags } from '@/utils/compareBest'

describe('bestFlags (Compare "BEST" tag)', () => {
  it('higher is better: the single highest value gets the tag', () => {
    expect(bestFlags([92, 88], 'higher')).toEqual([true, false])
    expect(bestFlags([70, 99.5, 99.4, 10], 'higher')).toEqual([false, true, false, false])
  })
  it('lower is better: the single lowest value gets the tag (latency)', () => {
    expect(bestFlags([120, 85, 300], 'lower')).toEqual([false, true, false])
  })
  it('equal values: no tag (100% vs 100%)', () => {
    expect(bestFlags([100, 100], 'higher')).toEqual([false, false])
  })
  it('a tie at the top among three or four mints: no tag for anyone', () => {
    expect(bestFlags([100, 100, 97], 'higher')).toEqual([false, false, false])
    expect(bestFlags([50, 80, 50, 50], 'lower')).toEqual([false, false, false, false])
  })
  it('a tie below the top does not matter', () => {
    expect(bestFlags([90, 80, 80], 'higher')).toEqual([true, false, false])
  })
  it('a missing or pending value (null) anywhere: no tag', () => {
    expect(bestFlags([99, null], 'higher')).toEqual([false, false])
    expect(bestFlags([null, 40, 300], 'lower')).toEqual([false, false, false])
  })
  it('a non-finite value counts as missing', () => {
    expect(bestFlags([Number.NaN, 5], 'lower')).toEqual([false, false])
  })
  it('fewer than two mints: no tag', () => {
    expect(bestFlags([100], 'higher')).toEqual([false])
    expect(bestFlags([], 'higher')).toEqual([])
  })
  it('zero is a value, not a missing one', () => {
    expect(bestFlags([0, 12], 'higher')).toEqual([false, true])
    expect(bestFlags([0, 12], 'lower')).toEqual([true, false])
  })
})
