import { describe, it, expect } from 'vitest'
import { pluralize } from '@/utils/plural'
import { hiddenMintsText } from '@/utils/tooltipTexts'

describe('pluralize', () => {
  it('uses the singular for exactly 1 and the plural otherwise (0 included)', () => {
    expect(pluralize(1, 'mint')).toBe('1 mint')
    expect(pluralize(2, 'mint')).toBe('2 mints')
    expect(pluralize(0, 'mint')).toBe('0 mints')
    expect(pluralize(41, 'mint')).toBe('41 mints')
  })
  it('takes an irregular plural', () => {
    expect(pluralize(1, 'city', 'cities')).toBe('1 city')
    expect(pluralize(3, 'city', 'cities')).toBe('3 cities')
  })
})

describe('hiddenMintsText', () => {
  it('reads "1 mint hidden", "2 mints hidden", "0 mints hidden"', () => {
    expect(hiddenMintsText(1, 24)).toBe('1 mint hidden (offline 24h+)')
    expect(hiddenMintsText(2, 24)).toBe('2 mints hidden (offline 24h+)')
    expect(hiddenMintsText(0, 24)).toBe('0 mints hidden (offline 24h+)')
  })
})
