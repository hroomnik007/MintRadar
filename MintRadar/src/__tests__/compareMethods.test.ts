// Compare modal: payment methods (NUT-04 / NUT-05), declared limits and units per mint (utils/compareMethods.ts).
import { describe, it, expect } from 'vitest'
import { compareMethods, disabledSides, limitsKey, methodNames, methodsCell, METHODS_DISABLED, METHODS_NONE } from '@/utils/compareMethods'

const m = (method: string, unit: string, min?: number, max?: number) => ({ method, unit, ...(min !== undefined ? { min_amount: min } : {}), ...(max !== undefined ? { max_amount: max } : {}) })

describe('methodNames', () => {
  it('distinct, lowercased, bolt11 / bolt12 / onchain first, then the rest alphabetically', () => {
    expect(methodNames([m('onchain', 'sat'), m('zap', 'sat'), m('BOLT11', 'sat'), m('bolt11', 'usd'), m('bolt12', 'sat'), m('abc', 'sat')]))
      .toEqual(['bolt11', 'bolt12', 'onchain', 'abc', 'zap'])
  })
  it('drops malformed method names and handles null', () => {
    expect(methodNames([m('bolt 11', 'sat'), m('', 'sat')])).toEqual([])
    expect(methodNames(null)).toEqual([])
  })
})

describe('methodsCell', () => {
  it('lists the methods, says when none are declared, and a switched-off side wins over its list', () => {
    expect(methodsCell([m('bolt11', 'sat'), m('bolt12', 'sat')], false)).toEqual({ text: 'bolt11, bolt12', state: 'list' })
    expect(methodsCell([], false)).toEqual({ text: METHODS_NONE, state: 'none' })
    expect(methodsCell([m('bolt11', 'sat')], true)).toEqual({ text: METHODS_DISABLED, state: 'disabled' })
  })
})

describe('disabledSides', () => {
  it('reads disabled: true on NUT-04 and NUT-05 only (the boolean, like isNutDisabled)', () => {
    expect(disabledSides({ nutsLimits: { '4': { methods: [], disabled: true }, '5': { disabled: 'true' } } })).toEqual({ mint: true, melt: false })
    expect(disabledSides({ nutsLimits: null })).toEqual({ mint: false, melt: false })
  })
})

describe('compareMethods', () => {
  it('builds every cell; limits reuse limitRows with short side names', () => {
    const c = compareMethods({
      nutsLimits: { '4': {}, '5': {} }, units: ['usd', 'sat'],
      mintMethods: [m('bolt11', 'sat', 1, 1_000_000), m('bolt12', 'sat', 1)],
      meltMethods: [m('bolt11', 'sat', 1, 500_000)],
    })
    expect(c.deposit.text).toBe('bolt11, bolt12')
    expect(c.withdrawal.text).toBe('bolt11')
    expect(c.units).toBe('SAT, USD')
    expect(c.limits.map(r => `${r.label}: ${r.value}`)).toEqual([
      'Deposit · bolt11 · sat: min 1, max 1,000,000',
      'Deposit · bolt12 · sat: min 1, max not declared',
      'Withdrawal · bolt11 · sat: min 1, max 500,000',
    ])
  })
  it('a mint that switched deposits and withdrawals off, with unknown units', () => {
    const c = compareMethods({ nutsLimits: { '4': { methods: [], disabled: true }, '5': { methods: [], disabled: true } }, units: null, mintMethods: [], meltMethods: [] })
    expect(c.deposit.state).toBe('disabled')
    expect(c.withdrawal.state).toBe('disabled')
    expect(c.limits.map(r => `${r.label}: ${r.value}`)).toEqual(['Deposit: disabled by the mint', 'Withdrawal: disabled by the mint'])
    expect(c.units).toBe('—')
  })
  it('limitsKey differs when any limit differs and matches for equal limits', () => {
    const a = compareMethods({ nutsLimits: {}, units: ['sat'], mintMethods: [m('bolt11', 'sat', 1, 10)], meltMethods: [] })
    const b = compareMethods({ nutsLimits: {}, units: ['sat'], mintMethods: [m('bolt11', 'sat', 1, 10)], meltMethods: [] })
    const c = compareMethods({ nutsLimits: {}, units: ['sat'], mintMethods: [m('bolt11', 'sat', 1, 11)], meltMethods: [] })
    expect(limitsKey(a.limits)).toBe(limitsKey(b.limits))
    expect(limitsKey(a.limits)).not.toBe(limitsKey(c.limits))
  })
})
