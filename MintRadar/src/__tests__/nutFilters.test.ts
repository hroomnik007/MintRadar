import { describe, it, expect } from 'vitest'
import { passesWizardNutChecks, hasRequiredNuts, onlineMintsSupportingNut, offeredNutCount, WIZARD_NUT_CHECKS } from '@/utils/nutFilters'
import { NUT_SUPPORT_CASES } from './nutSupportCases'

// Tools (Best Mint wizard), Stats (NUT coverage modal) and the Dashboard ?nuts= filter all read the
// shared NUT-support rule: `{ supported: false }` is NOT support.
describe('nutFilters', () => {
  it('the wizard checks map to NUT-9 / 11 / 17', () => {
    expect(WIZARD_NUT_CHECKS).toEqual({ seed: '9', p2pk: '11', ws: '17' })
  })

  it.each(NUT_SUPPORT_CASES.map(c => [c.name, c] as const))('wizard + dashboard follow the shared table: %s', (_n, c) => {
    for (const [check, key] of Object.entries(WIZARD_NUT_CHECKS)) {
      expect(passesWizardNutChecks({ [key]: c.entry }, new Set([check]))).toBe(c.offered ?? c.declaredSupported)
    }
    expect(hasRequiredNuts({ '7': c.entry }, ['7'])).toBe(c.offered ?? c.declaredSupported)
  })

  it('wizard: supported:false on NUT-9/11/17 drops the mint, unrelated checks are ignored', () => {
    const nuts = { '9': { supported: false }, '11': { supported: true }, '17': {} }
    expect(passesWizardNutChecks(nuts, new Set(['seed']))).toBe(false)
    expect(passesWizardNutChecks(nuts, new Set(['p2pk', 'ws']))).toBe(true)
    expect(passesWizardNutChecks(nuts, new Set(['ln', 'fast']))).toBe(true)
    expect(passesWizardNutChecks(null, new Set(['ws']))).toBe(false)
    expect(passesWizardNutChecks(null, new Set())).toBe(true)
  })

  it('dashboard: every required NUT must be supported', () => {
    const nuts = { '7': {}, '12': { supported: false } }
    expect(hasRequiredNuts(nuts, ['7'])).toBe(true)
    expect(hasRequiredNuts(nuts, ['7', '12'])).toBe(false)
    expect(hasRequiredNuts(nuts, [])).toBe(true)
  })

  it('stats modal: online mints only, supported:false excluded', () => {
    const mints = [
      { url: 'a', online: true, nutsLimits: { '9': {} } },
      { url: 'b', online: true, nutsLimits: { '9': { supported: false } } },
      { url: 'c', online: false, nutsLimits: { '9': {} } },
      { url: 'd', online: true, nutsLimits: null },
      { url: 'e', online: true, nutsLimits: { '9': { supported: true, methods: [] } } },
    ]
    expect(onlineMintsSupportingNut(mints, '9').map(m => m.url)).toEqual(['a', 'e'])
  })

  it('a switched-off NUT-04/05 (disabled: true) is not offered: ?nuts=4 and the Stats modal drop it', () => {
    const lek = { '4': { methods: [], disabled: true }, '5': { methods: [], disabled: true }, '7': {} }
    expect(hasRequiredNuts(lek, ['4'])).toBe(false)
    expect(hasRequiredNuts(lek, ['7'])).toBe(true)
    expect(hasRequiredNuts({ '4': { methods: [], disabled: false } }, ['4'])).toBe(true)
    expect(onlineMintsSupportingNut([{ online: true, nutsLimits: lek }], '5')).toEqual([])
  })

  it('offeredNutCount: the stored count less the switched-off tracked NUTs; null stays null', () => {
    const lek = { '4': { methods: [], disabled: true }, '5': { methods: [], disabled: true }, '7': {}, '12': {} }
    expect(offeredNutCount({ nutCount: 4, nutsLimits: lek })).toBe(2)
    expect(offeredNutCount({ nutCount: 4, nutsLimits: null })).toBe(4)
    expect(offeredNutCount({ nutCount: null, nutsLimits: lek })).toBeNull()
    expect(offeredNutCount({ nutCount: 1, nutsLimits: lek })).toBe(0)
    expect(offeredNutCount({ nutCount: 4, nutsLimits: { '4': { supported: false, disabled: true } } })).toBe(4)
  })
})
