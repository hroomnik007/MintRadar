import { describe, it, expect } from 'vitest'
import { wizardOffersUnit } from '@/utils/wizardUnits'

describe('wizardOffersUnit', () => {
  it('offers sat, msat and three-letter currency codes', () => {
    for (const u of ['sat', 'SAT', 'msat', 'usd', 'eur', 'chf']) expect(wizardOffersUnit(u), u).toBe(true)
  })
  it('leaves out TIH and a mint\'s own token units', () => {
    for (const u of ['tih', 'chf-employee', 'chf-musician', 'points', 'x']) expect(wizardOffersUnit(u), u).toBe(false)
  })
})
