// Dashboard payment-method filter (utils/methodFilter.ts): same meaning as the Wallet API method= filter
// (NUT-04 or NUT-05, any unit), plus a switched-off side (#168) not counting.
import { describe, it, expect } from 'vitest'
import { methodOptions, mintMatchesMethod, offeredMethods, parseMethodParam, sortMethods } from '@/utils/methodFilter'

const e = (method: string, unit = 'sat') => ({ method, unit })

describe('parseMethodParam', () => {
  it('lowercases a valid value and drops missing or malformed ones', () => {
    expect(parseMethodParam('BOLT12')).toBe('bolt12')
    expect(parseMethodParam(' onchain ')).toBe('onchain')
    expect(parseMethodParam(null)).toBeNull()
    expect(parseMethodParam('')).toBeNull()
    expect(parseMethodParam('bolt 11')).toBeNull()
    expect(parseMethodParam('<script>')).toBeNull()
  })
})

describe('offeredMethods / mintMatchesMethod', () => {
  const mint = { mintMethods: [e('bolt11'), e('bolt12', 'usd')], meltMethods: [e('onchain')], nutsLimits: { '4': {}, '5': {} } }
  it('a method on deposit or on withdrawal, in any unit, matches', () => {
    expect(mintMatchesMethod(mint, 'bolt12')).toBe(true)
    expect(mintMatchesMethod(mint, 'onchain')).toBe(true)
    expect(mintMatchesMethod(mint, 'bolt11')).toBe(true)
    expect(mintMatchesMethod(mint, 'other')).toBe(false)
  })
  it('no selection keeps every mint, unknown methods never match a selection', () => {
    expect(mintMatchesMethod({ mintMethods: null, meltMethods: null, nutsLimits: null }, null)).toBe(true)
    expect(mintMatchesMethod({ mintMethods: null, meltMethods: null, nutsLimits: null }, 'bolt11')).toBe(false)
  })
  it('a side switched off with disabled: true does not count, even if it still lists the method', () => {
    const off = { ...mint, nutsLimits: { '4': { methods: [], disabled: true }, '5': {} } }
    expect([...offeredMethods(off)]).toEqual(['onchain'])
    expect(mintMatchesMethod(off, 'bolt12')).toBe(false)
    expect(mintMatchesMethod({ ...mint, nutsLimits: { '4': {}, '5': { disabled: true } } }, 'onchain')).toBe(false)
    // Only the boolean counts, like isNutDisabled.
    expect(mintMatchesMethod({ ...mint, nutsLimits: { '4': { disabled: 'true' } } }, 'bolt12')).toBe(true)
  })
})

describe('methodOptions', () => {
  it('the methods mints offer, bolt11 / bolt12 / onchain first, then others alphabetically, no duplicates', () => {
    const mints = [
      { mintMethods: [e('zz'), e('bolt11')], meltMethods: [e('onchain')], nutsLimits: {} },
      { mintMethods: [e('bolt12'), e('aa')], meltMethods: [e('BOLT11')], nutsLimits: {} },
      { mintMethods: [e('switched')], meltMethods: [], nutsLimits: { '4': { disabled: true } } },
    ]
    expect(methodOptions(mints, null)).toEqual(['bolt11', 'bolt12', 'onchain', 'aa', 'zz'])
  })
  it('keeps a selected method nobody offers so it can be cleared', () => {
    expect(methodOptions([], 'bolt12')).toEqual(['bolt12'])
    expect(sortMethods(['onchain', 'bolt11', 'onchain'])).toEqual(['bolt11', 'onchain'])
  })
})
