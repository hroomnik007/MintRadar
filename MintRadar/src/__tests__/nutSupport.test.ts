import { describe, it, expect } from 'vitest'
import { isNutSupported, isNutDeclaredSupported, supportedNutKeys } from '../utils/nutSupport'
import { NUT_SUPPORT_CASES } from './nutSupportCases'

describe('the shared table of cases', () => {
  it.each(NUT_SUPPORT_CASES.map(c => [c.name, c] as const))('%s', (_n, c) => {
    expect(isNutSupported(c.entry)).toBe(c.supported)
    expect(isNutDeclaredSupported(c.entry)).toBe(c.declaredSupported)
    expect(supportedNutKeys({ '7': c.entry }).has('7')).toBe(c.inKeys)
  })
})

describe('isNutSupported', () => {
  it('supported:false is not supported', () => {
    expect(isNutSupported({ supported: false })).toBe(false)
    expect(isNutSupported({ supported: false, methods: [] })).toBe(false)
  })
  it('supported:true, a presence-only object (settings, no supported key) and an empty object are supported', () => {
    expect(isNutSupported({ supported: true })).toBe(true)
    expect(isNutSupported({ methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false })).toBe(true)
    expect(isNutSupported({})).toBe(true)
  })
  it('only the boolean false counts as "not supported" (a string or 0 does not)', () => {
    expect(isNutSupported({ supported: 'false' })).toBe(true)
    expect(isNutSupported({ supported: 0 })).toBe(true)
    expect(isNutSupported(true)).toBe(true)
  })
})

describe('supportedNutKeys', () => {
  it('keeps the four shapes apart; an absent key is simply not there', () => {
    const keys = supportedNutKeys({ '7': { supported: false }, '10': { supported: true }, '11': { methods: [] }, '4': {} })
    expect([...keys].sort()).toEqual(['10', '11', '4'])
    expect(keys.has('12')).toBe(false)
    expect(keys.has('7')).toBe(false)
  })
  it('a null value is not declared: it is not in the set (same rule as isNutDeclaredSupported)', () => {
    const keys = supportedNutKeys({ '4': {}, '7': null, '10': { supported: true } })
    expect([...keys].sort()).toEqual(['10', '4'])
    expect(keys.has('7')).toBe(false)
  })
  it('null and undefined give an empty set', () => {
    expect(supportedNutKeys(null).size).toBe(0)
    expect(supportedNutKeys(undefined).size).toBe(0)
  })
})
