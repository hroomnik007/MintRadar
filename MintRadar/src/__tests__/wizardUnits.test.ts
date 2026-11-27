import { describe, it, expect } from 'vitest'
import { wizardOffersUnit } from '@/utils/wizardUnits'

describe('wizardOffersUnit', () => {
  it('offers sat, usd, eur and msat', () => {
    for (const u of ['sat', 'SAT', 'usd', 'eur', 'msat']) expect(wizardOffersUnit(u), u).toBe(true)
  })
  it('leaves out every other unit a mint lists', () => {
    for (const u of ['tih', 'chf', 'chf-employee', 'chf-musician', 'gbp', 'points']) expect(wizardOffersUnit(u), u).toBe(false)
  })
})
