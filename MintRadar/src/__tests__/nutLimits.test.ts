import { describe, it, expect } from 'vitest'
import { groupNutLimits, formatNutLimitRange, type NutLimitMethod } from '../utils/nutLimits'

// Mirrors testnut.cashu.space's real nuts.4.methods shape (verified live during
// the NUT Limits investigation): 4 payment methods per unit, all sharing one
// range — the case that used to render "1 – 500,000 sat" four times unlabelled.
const TESTNUT_MINT_METHODS: NutLimitMethod[] = [
  { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500000 },
  { method: 'bolt12', unit: 'sat', min_amount: 1, max_amount: 500000 },
  { method: 'onchain', unit: 'sat', min_amount: 1, max_amount: 500000 },
  { method: 'paypal', unit: 'sat', min_amount: 1, max_amount: 500000 },
  { method: 'bolt11', unit: 'usd', min_amount: 1, max_amount: 500000 },
  { method: 'bolt12', unit: 'usd', min_amount: 1, max_amount: 500000 },
  { method: 'onchain', unit: 'usd', min_amount: 1, max_amount: 500000 },
  { method: 'venmo', unit: 'usd', min_amount: 1, max_amount: 500000 },
]

describe('groupNutLimits', () => {
  describe('(a) methods sharing one identical limit', () => {
    it('collapses 8 entries into one group per unit, listing every method', () => {
      const groups = groupNutLimits(TESTNUT_MINT_METHODS)

      expect(groups).toHaveLength(2)
      expect(groups[0]).toEqual({
        min: 1, max: 500000, unit: 'sat',
        methods: ['bolt11', 'bolt12', 'onchain', 'paypal'],
      })
      expect(groups[1]).toEqual({
        min: 1, max: 500000, unit: 'usd',
        methods: ['bolt11', 'bolt12', 'onchain', 'venmo'],
      })
    })

    it('keeps a single method un-grouped and still labelled', () => {
      const groups = groupNutLimits([
        { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 1000 },
      ])
      expect(groups).toEqual([{ min: 1, max: 1000, unit: 'sat', methods: ['bolt11'] }])
    })
  })

  describe('(b) methods with genuinely different limits', () => {
    it('keeps different ranges in the same unit as separate labelled groups', () => {
      // The case a naive dedupe on (unit, min, max) would be fine with, but a
      // dedupe that dropped `method` would render as two unexplained ranges.
      const groups = groupNutLimits([
        { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500000 },
        { method: 'bolt12', unit: 'sat', min_amount: 1, max_amount: 500000 },
        { method: 'onchain', unit: 'sat', min_amount: 10000, max_amount: 500000 },
      ])

      expect(groups).toEqual([
        { min: 1, max: 500000, unit: 'sat', methods: ['bolt11', 'bolt12'] },
        { min: 10000, max: 500000, unit: 'sat', methods: ['onchain'] },
      ])
    })

    it('separates groups differing only in max_amount', () => {
      const groups = groupNutLimits([
        { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500000 },
        { method: 'onchain', unit: 'sat', min_amount: 1, max_amount: 100000 },
      ])
      expect(groups).toHaveLength(2)
      expect(groups.map(g => g.max)).toEqual([500000, 100000])
    })

    it('separates the same range across different units', () => {
      const groups = groupNutLimits([
        { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500000 },
        { method: 'bolt11', unit: 'usd', min_amount: 1, max_amount: 500000 },
      ])
      expect(groups).toHaveLength(2)
      expect(groups.map(g => g.unit)).toEqual(['sat', 'usd'])
    })

    it('preserves the mint\'s declared order of first appearance', () => {
      const groups = groupNutLimits([
        { method: 'onchain', unit: 'sat', min_amount: 10000, max_amount: 500000 },
        { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500000 },
      ])
      expect(groups.map(g => g.min)).toEqual([10000, 1])
    })
  })

  describe('(c) empty / missing input keeps the "—" fallback path', () => {
    it('returns no groups for an empty array', () => {
      expect(groupNutLimits([])).toEqual([])
    })

    it('returns no groups for undefined', () => {
      expect(groupNutLimits(undefined)).toEqual([])
    })

    it('returns no groups for null', () => {
      expect(groupNutLimits(null)).toEqual([])
    })
  })

  describe('partial / malformed entries', () => {
    it('represents a missing min_amount or max_amount as null', () => {
      const groups = groupNutLimits([{ method: 'bolt11', unit: 'sat', max_amount: 500000 }])
      expect(groups).toEqual([{ min: null, max: 500000, unit: 'sat', methods: ['bolt11'] }])
    })

    it('groups entries with no amounts at all rather than dropping them', () => {
      const groups = groupNutLimits([
        { method: 'bolt11', unit: 'sat' },
        { method: 'bolt12', unit: 'sat' },
      ])
      expect(groups).toEqual([{ min: null, max: null, unit: 'sat', methods: ['bolt11', 'bolt12'] }])
    })

    it('omits a missing method name from the label list', () => {
      const groups = groupNutLimits([
        { unit: 'sat', min_amount: 1, max_amount: 500000 },
        { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500000 },
      ])
      expect(groups).toEqual([{ min: 1, max: 500000, unit: 'sat', methods: ['bolt11'] }])
    })

    it('does not repeat a method name listed twice in the same range', () => {
      const groups = groupNutLimits([
        { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500000 },
        { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500000 },
      ])
      expect(groups[0]!.methods).toEqual(['bolt11'])
    })

    it('treats a missing unit as its own group without inventing a label', () => {
      const groups = groupNutLimits([{ method: 'bolt11', min_amount: 1, max_amount: 500000 }])
      expect(groups).toEqual([{ min: 1, max: 500000, unit: '', methods: ['bolt11'] }])
    })
  })
})

describe('formatNutLimitRange', () => {
  it('formats with thousands separators and an en dash', () => {
    expect(formatNutLimitRange({ min: 1, max: 500000, unit: 'sat', methods: [] }))
      .toBe('1 – 500,000 sat')
  })

  it('renders a missing bound as an em dash', () => {
    expect(formatNutLimitRange({ min: null, max: 500000, unit: 'sat', methods: [] }))
      .toBe('— – 500,000 sat')
    expect(formatNutLimitRange({ min: 1, max: null, unit: 'sat', methods: [] }))
      .toBe('1 – — sat')
  })

  it('omits the unit suffix when there is no unit', () => {
    expect(formatNutLimitRange({ min: 1, max: 1000, unit: '', methods: [] }))
      .toBe('1 – 1,000')
  })

  it('keeps zero as a real bound rather than treating it as missing', () => {
    expect(formatNutLimitRange({ min: 0, max: 1000, unit: 'sat', methods: [] }))
      .toBe('0 – 1,000 sat')
  })
})
