import { describe, it, expect } from 'vitest'
import { mintMeltCondition, versionCondition, nutLossTransition } from '../alertTriggers.js'

const NOW = new Date('2026-10-10T12:00:00Z')
const FRESH = new Date('2026-10-10T06:00:00Z')

describe('mintMeltCondition (7d blamed ratio)', () => {
  it('is active at >= 50% blamed with a real sample, clear below', () => {
    expect(mintMeltCondition(20, 10, FRESH, NOW)).toBe('active')
    expect(mintMeltCondition(20, 9, FRESH, NOW)).toBe('clear')
  })
  it('is unknown for a tiny sample, missing data or a stale aggregate', () => {
    expect(mintMeltCondition(9, 9, FRESH, NOW)).toBe('unknown')
    expect(mintMeltCondition(null, null, null, NOW)).toBe('unknown')
    expect(mintMeltCondition(50, 40, new Date('2026-10-01T00:00:00Z'), NOW)).toBe('unknown')
  })
})

describe('versionCondition', () => {
  const latest = { nutshell: { major: 0, minor: 21 } }
  it('is active when two or more minors behind, clear otherwise, unknown without a version', () => {
    expect(versionCondition('Nutshell/0.19.0', latest)).toBe('active')
    expect(versionCondition('Nutshell/0.20.3', latest)).toBe('clear')
    expect(versionCondition(null, latest)).toBe('unknown')
  })
})

describe('nutLossTransition', () => {
  const both = { '4': { methods: [] }, '5': { methods: [] } }
  it('detects a lost NUT-04 or NUT-05 once and a restore', () => {
    expect(nutLossTransition(both, { '4': { methods: [] } })).toBe('lost')
    expect(nutLossTransition(both, { '4': { methods: [] }, '5': { disabled: true } })).toBe('lost')
    expect(nutLossTransition({ '4': {} }, both)).toBe('restored')
  })
  it('does not fire for a mint that never had them, for no prior data, or when still missing', () => {
    expect(nutLossTransition(null, {})).toBeNull()
    expect(nutLossTransition({}, {})).toBeNull()
    expect(nutLossTransition({ '4': {} }, { '4': {} })).toBeNull()
  })
})
