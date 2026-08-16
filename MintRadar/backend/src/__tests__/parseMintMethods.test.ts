import { describe, it, expect } from 'vitest'
import { parseMintMethods } from '../prober.js'

// parseMintMethods() derives units/mint_methods/melt_methods from a mint's
// `nuts` object (NUT-04 = mint methods, NUT-05 = melt methods) — the exact
// same object already stored verbatim in nuts_limits, so this is pure
// re-parsing with no network dependency.
describe('parseMintMethods', () => {
  it('returns all-null for a null/undefined nuts object', () => {
    expect(parseMintMethods(null)).toEqual({ units: null, mintMethods: null, meltMethods: null })
    expect(parseMintMethods(undefined)).toEqual({ units: null, mintMethods: null, meltMethods: null })
  })

  it('extracts methods and deduplicated units from a multi-unit, multi-method mint', () => {
    // Shape matches a real cdk-mintd /v1/info response (e.g. mint.sortug.com, testnut.cashu.space)
    const nuts = {
      '4': {
        methods: [
          { method: 'bolt11', unit: 'usd', min_amount: 1, max_amount: 500000 },
          { method: 'bolt12', unit: 'usd', min_amount: 1, max_amount: 500000 },
          { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500000 },
        ],
        disabled: false,
      },
      '5': {
        methods: [
          { method: 'bolt11', unit: 'usd', min_amount: 1, max_amount: 500000 },
          { method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 500000 },
        ],
        disabled: false,
      },
      '7': { supported: true },
    }

    const result = parseMintMethods(nuts)
    expect(result.units).toEqual(['usd', 'sat'])
    expect(result.mintMethods).toEqual(nuts['4'].methods)
    expect(result.meltMethods).toEqual(nuts['5'].methods)
  })

  it('handles a single-unit mint (common case, e.g. Nutshell sat-only)', () => {
    const nuts = {
      '4': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
      '5': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
    }
    const result = parseMintMethods(nuts)
    expect(result.units).toEqual(['sat'])
    expect(result.mintMethods).toHaveLength(1)
    expect(result.meltMethods).toHaveLength(1)
  })

  it('returns null fields when nuts["4"]/["5"] are missing entirely', () => {
    const result = parseMintMethods({ '7': { supported: true } })
    expect(result).toEqual({ units: null, mintMethods: null, meltMethods: null })
  })

  it('returns null for a malformed methods array (missing method/unit keys)', () => {
    const nuts = { '4': { methods: [{ foo: 'bar' }] }, '5': { methods: 'not-an-array' } }
    const result = parseMintMethods(nuts)
    expect(result.mintMethods).toBeNull()
    expect(result.meltMethods).toBeNull()
    expect(result.units).toBeNull()
  })

  it('handles nut-04 present but nut-05 absent (asymmetric mint/melt support)', () => {
    const nuts = { '4': { methods: [{ method: 'bolt11', unit: 'sat' }] } }
    const result = parseMintMethods(nuts)
    expect(result.mintMethods).toEqual([{ method: 'bolt11', unit: 'sat' }])
    expect(result.meltMethods).toBeNull()
    expect(result.units).toEqual(['sat'])
  })
})
