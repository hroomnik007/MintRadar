import { describe, it, expect } from 'vitest'
import { feeExamplesOf, inputFeeFor, FEE_EXAMPLE_PROOFS } from '../shared/feeExamples.js'

// NUT-02: fee = ceil(sum of input_fee_ppk of the spent proofs / 1000), in the keyset's unit.
describe('inputFeeFor rounds up', () => {
  it('ppk 100: 1, 10 and 11 proofs', () => {
    expect(inputFeeFor(100, 1)).toBe(1) // 100 / 1000 = 0.1 -> 1
    expect(inputFeeFor(100, 10)).toBe(1) // 1000 / 1000 = 1.0 -> 1
    expect(inputFeeFor(100, 11)).toBe(2) // 1100 / 1000 = 1.1 -> 2
  })
  it('ppk 0 is always 0', () => {
    for (const n of [1, 16, 100]) expect(inputFeeFor(0, n)).toBe(0)
  })
  it('ppk 1000 is one unit per proof', () => {
    expect(inputFeeFor(1000, 1)).toBe(1)
    expect(inputFeeFor(1000, 16)).toBe(16)
    expect(inputFeeFor(1000, 100)).toBe(100)
  })
  it('ppk 999: 1 proof costs 1, 1000 proofs cost 999', () => {
    expect(inputFeeFor(999, 1)).toBe(1)
    expect(inputFeeFor(999, 2)).toBe(2) // 1998 / 1000 -> 2
    expect(inputFeeFor(999, 1000)).toBe(999)
  })
  it('ppk 1 needs 1000 proofs for a fee of 1, and one proof already costs 1', () => {
    expect(inputFeeFor(1, 1)).toBe(1)
    expect(inputFeeFor(1, 1000)).toBe(1)
    expect(inputFeeFor(1, 1001)).toBe(2)
  })
})

describe('feeExamplesOf', () => {
  it('uses 1, 16 and 100 proofs', () => {
    expect(FEE_EXAMPLE_PROOFS).toEqual([1, 16, 100])
    const [e] = feeExamplesOf([{ unit: 'sat', active: true, inputFeePpk: 100 }])
    expect(e).toEqual({ unit: 'sat', inputFeePpk: 100, examples: [{ proofs: 1, fee: 1 }, { proofs: 16, fee: 2 }, { proofs: 100, fee: 10 }] })
  })

  it('the effective fee is the largest among ACTIVE keysets of the unit; inactive ones do not count', () => {
    const out = feeExamplesOf([
      { unit: 'sat', active: true, inputFeePpk: 100 },
      { unit: 'sat', active: true, inputFeePpk: 250 },
      { unit: 'sat', active: false, inputFeePpk: 5000 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.inputFeePpk).toBe(250)
    expect(out[0]?.examples.map(x => x.fee)).toEqual([1, 4, 25])
  })

  it('several units: one entry each, sat first then alphabetical, unit lower-cased', () => {
    const out = feeExamplesOf([
      { unit: 'USD', active: true, inputFeePpk: 0 },
      { unit: 'eur', active: true, inputFeePpk: 1000 },
      { unit: 'sat', active: true, inputFeePpk: 100 },
    ])
    expect(out.map(u => u.unit)).toEqual(['sat', 'eur', 'usd'])
    expect(out.map(u => u.examples.map(x => x.fee))).toEqual([[1, 2, 10], [1, 16, 100], [0, 0, 0]])
  })

  it('a keyset that states no fee uses the NUT-02 default 0', () => {
    const [e] = feeExamplesOf([{ unit: 'sat', active: true, inputFeePpk: null }])
    expect(e).toEqual({ unit: 'sat', inputFeePpk: 0, examples: [{ proofs: 1, fee: 0 }, { proofs: 16, fee: 0 }, { proofs: 100, fee: 0 }] })
    expect(feeExamplesOf([{ unit: 'sat', active: true, inputFeePpk: null }, { unit: 'usd', active: true, inputFeePpk: 100 }]).map(u => u.inputFeePpk)).toEqual([0, 100])
  })

  it('a unit with only inactive keysets is left out; nothing stored is an empty list', () => {
    expect(feeExamplesOf([{ unit: 'sat', active: false, inputFeePpk: null }, { unit: 'usd', active: false, inputFeePpk: 10 }])).toEqual([])
    expect(feeExamplesOf([])).toEqual([])
  })

  it('a missing fee on one active keyset does not lower the stated fee of another (max rule)', () => {
    expect(feeExamplesOf([{ unit: 'sat', active: true, inputFeePpk: null }, { unit: 'sat', active: true, inputFeePpk: 50 }])[0]?.inputFeePpk).toBe(50)
  })
})
