import { describe, it, expect } from 'vitest'
import { TRACKED_NUTS, TRACKED_NUT_KEYS, NUT_META, nutSpecUrl } from '../constants/nuts'
import { TRACKED_NUT_COUNT } from '../utils/trustScore'

describe('TRACKED_NUTS', () => {
  it('is the denominator the Trust Score actually divides by', () => {
    // If a NUT is ever added or removed, TRACKED_NUT_COUNT in trustScore.ts (and
    // its backend twin) must move with it, or every mint's NUT-support component
    // silently changes meaning.
    expect(TRACKED_NUTS.length).toBe(TRACKED_NUT_COUNT)
  })

  it('contains no duplicates', () => {
    expect(new Set(TRACKED_NUTS).size).toBe(TRACKED_NUTS.length)
  })

  it('excludes the mandatory NUTs (00-03, 06) and the wallet-only NUTs', () => {
    for (const excluded of [
      'NUT-00', 'NUT-01', 'NUT-02', 'NUT-03', 'NUT-06',
      'NUT-13', 'NUT-16', 'NUT-18', 'NUT-24', 'NUT-26', 'NUT-27', 'NUT-28',
    ]) {
      expect(TRACKED_NUTS).not.toContain(excluded)
    }
  })

  it('excludes auth (21/22) and payment-method (23/25/30) NUTs — real mint features, shown elsewhere, not part of the NUT-support score', () => {
    for (const excluded of ['NUT-21', 'NUT-22', 'NUT-23', 'NUT-25', 'NUT-30']) {
      expect(TRACKED_NUTS).not.toContain(excluded)
    }
  })

  it('has exactly 14 entries', () => {
    expect(TRACKED_NUTS.length).toBe(14)
  })

  it('is in ascending spec order', () => {
    const nums = TRACKED_NUTS.map(n => parseInt(n.slice(4), 10))
    expect(nums).toEqual([...nums].sort((a, b) => a - b))
  })
})

describe('NUT_META', () => {
  it('has an entry for every tracked NUT and nothing else', () => {
    expect(Object.keys(NUT_META).sort()).toEqual([...TRACKED_NUTS].sort())
  })

  it('gives every entry a non-empty label and description', () => {
    for (const nut of TRACKED_NUTS) {
      expect(NUT_META[nut]?.short).toBeTruthy()
      expect(NUT_META[nut]?.desc).toBeTruthy()
    }
  })

  it('uses a zero-padded specNum matching the NUT number', () => {
    for (const nut of TRACKED_NUTS) {
      expect(NUT_META[nut]?.specNum).toBe(nut.slice(4))
    }
  })
})

describe('TRACKED_NUT_KEYS', () => {
  it('is the unpadded numeric form used by /v1/info and nuts_limits', () => {
    expect(TRACKED_NUT_KEYS).toEqual(TRACKED_NUTS.map(n => String(parseInt(n.slice(4), 10))))
    expect(TRACKED_NUT_KEYS[0]).toBe('4')
  })
})

describe('nutSpecUrl', () => {
  it('builds a cashubtc/nuts link for a tracked NUT', () => {
    expect(nutSpecUrl('NUT-04')).toBe('https://github.com/cashubtc/nuts/blob/main/04.md')
  })

  it('returns null for an untracked NUT', () => {
    expect(nutSpecUrl('NUT-13')).toBeNull()
  })
})
