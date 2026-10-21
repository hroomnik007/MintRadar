import { describe, it, expect } from 'vitest'
import { isNutSupported, isNutDeclaredSupported, supportedNutKeys } from '../shared/nutSupport.js'

// The same table as src/__tests__/nutSupportCases.ts; src/__tests__/sharedModules.test.ts runs both helper copies
// against that one, so the two cannot drift apart.
const CASES: Array<[string, unknown, boolean, boolean]> = [
  ['supported: false', { supported: false }, false, false],
  ['supported: false with settings', { supported: false, methods: [] }, false, false],
  ['supported: true', { supported: true }, true, true],
  ['settings without a supported key', { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false }, true, true],
  ['empty object', {}, true, true],
  ['supported: "false" (a string) is not the boolean', { supported: 'false' }, true, true],
  ['supported: 0 is not the boolean', { supported: 0 }, true, true],
  ['true (non-object, non-null)', true, true, true],
  ['false (non-object)', false, true, true],
  ['a number', 5, true, true],
  ['an array', [], true, true],
  ['null', null, true, false],
  ['undefined (absent)', undefined, true, false],
]

describe('nutSupport (backend)', () => {
  it.each(CASES)('%s', (_name, entry, supported, declaredSupported) => {
    expect(isNutSupported(entry)).toBe(supported)
    expect(isNutDeclaredSupported(entry)).toBe(declaredSupported)
  })
  it('supportedNutKeys drops supported:false', () => {
    expect([...supportedNutKeys({ '7': { supported: false }, '4': {}, '11': { supported: true } })].sort()).toEqual(['11', '4'])
  })
})
