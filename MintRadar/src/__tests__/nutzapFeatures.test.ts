import { describe, it, expect } from 'vitest'
import { nutzapRows, NUTZAP_NUTS } from '../utils/nutzapFeatures'

describe('nutzapRows', () => {
  it('lists NUT-07, NUT-10, NUT-11 and NUT-12 in that order, each on its own', () => {
    expect(NUTZAP_NUTS.map(n => n.nut)).toEqual([7, 10, 11, 12])
    expect(nutzapRows(new Set()).map(r => r.label)).toEqual([
      'NUT-07 · Spent check', 'NUT-10 · Spending conditions', 'NUT-11 · P2PK locking', 'NUT-12 · DLEQ proofs',
    ])
  })

  it('"supported" only for a number the mint lists; the rest is "not declared"', () => {
    const rows = nutzapRows(new Set(['4', '5', '7', '12']))
    expect(rows.map(r => [r.nut, r.value])).toEqual([[7, 'supported'], [10, 'not declared'], [11, 'not declared'], [12, 'supported']])
  })

  it('NUT-11 is not reported as supported when it is not declared (also when 111 or 1 are)', () => {
    expect(nutzapRows(new Set(['1', '111', '110'])).find(r => r.nut === 11)?.value).toBe('not declared')
  })

  it('claims nothing while the mint\'s NUT list is not known', () => {
    expect(nutzapRows(null).map(r => r.value)).toEqual(['—', '—', '—', '—'])
  })
})
