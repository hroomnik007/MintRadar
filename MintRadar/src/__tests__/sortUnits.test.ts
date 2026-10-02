import { describe, it, expect } from 'vitest'
import { sortUnits } from '@/utils/sortUnits'

describe('sortUnits', () => {
  it('orders sat, usd, eur', () => {
    expect(sortUnits(['eur', 'usd', 'sat'])).toEqual(['sat', 'usd', 'eur'])
    expect(sortUnits(['usd', 'sat'])).toEqual(['sat', 'usd'])
  })
  it('removes duplicates case-insensitively', () => {
    expect(sortUnits(['sat', 'SAT', 'usd', 'sat'])).toEqual(['sat', 'usd'])
  })
  it('is case-insensitive for ranking and keeps original casing', () => {
    expect(sortUnits(['EUR', 'Usd', 'SAT'])).toEqual(['SAT', 'Usd', 'EUR'])
  })
  it('tolerates null, undefined and empty input', () => {
    expect(sortUnits(null)).toEqual([])
    expect(sortUnits(undefined)).toEqual([])
    expect(sortUnits([])).toEqual([])
  })
  it('drops blank and non-string entries', () => {
    expect(sortUnits(['', '  ', 'sat', null as unknown as string])).toEqual(['sat'])
  })
  it('puts msat and unknown units after eur, alphabetically', () => {
    expect(sortUnits(['xyz', 'msat', 'eur', 'abc', 'sat'])).toEqual(['sat', 'eur', 'abc', 'msat', 'xyz'])
  })
  it('does not mutate the input and returns a new array', () => {
    const input = ['eur', 'usd', 'sat']
    const out = sortUnits(input)
    expect(input).toEqual(['eur', 'usd', 'sat'])
    expect(out).not.toBe(input)
  })
})
