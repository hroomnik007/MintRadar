import { describe, it, expect } from 'vitest'
import { mintMatchesUnits, parseUnitParam, buildUnitParam, normalizeUnitSelection, countUnitHidden, unitHiddenNote } from '@/utils/unitFilter'

const m = (units: string[] | null) => ({ units })

describe('mintMatchesUnits', () => {
  it('empty selection means no filtering (even for units: null)', () => {
    expect(mintMatchesUnits(m(['sat']), [])).toBe(true)
    expect(mintMatchesUnits(m(null), [])).toBe(true)
  })
  it('single unit', () => {
    expect(mintMatchesUnits(m(['sat']), ['sat'])).toBe(true)
    expect(mintMatchesUnits(m(['sat']), ['usd'])).toBe(false)
  })
  it('multiple selected = at least one advertised', () => {
    expect(mintMatchesUnits(m(['usd']), ['sat', 'usd'])).toBe(true)
    expect(mintMatchesUnits(m(['eur']), ['sat', 'usd'])).toBe(false)
  })
  it('is case-insensitive on the mint side', () => {
    expect(mintMatchesUnits(m(['USD']), ['usd'])).toBe(true)
    expect(mintMatchesUnits(m([' Sat ']), ['sat'])).toBe(true)
  })
  it('mint with several units passes on any one', () => {
    expect(mintMatchesUnits(m(['sat', 'usd']), ['usd'])).toBe(true)
    expect(mintMatchesUnits(m(['sat', 'usd']), ['eur'])).toBe(false)
  })
  it('units outside the three are never matched; null/empty units fail an active filter', () => {
    expect(mintMatchesUnits(m(['msat', 'auth']), ['sat'])).toBe(false)
    expect(mintMatchesUnits(m(['msat']), ['sat', 'usd', 'eur'])).toBe(false)
    expect(mintMatchesUnits(m(null), ['sat'])).toBe(false)
    expect(mintMatchesUnits(m([]), ['sat'])).toBe(false)
  })
  it('all three selected still filters', () => {
    const all = ['sat', 'usd', 'eur'] as const
    expect(mintMatchesUnits(m(['eur']), all)).toBe(true)
    expect(mintMatchesUnits(m(['msat']), all)).toBe(false)
  })
})

describe('parseUnitParam / buildUnitParam', () => {
  it('parses valid values in canonical order', () => {
    expect(parseUnitParam('sat,usd')).toEqual(['sat', 'usd'])
    expect(parseUnitParam('eur,sat')).toEqual(['sat', 'eur'])
    expect(parseUnitParam('USD')).toEqual(['usd'])
  })
  it('ignores invalid/malformed values', () => {
    expect(parseUnitParam('btc,<script>,msat,,')).toEqual([])
    expect(parseUnitParam('sat,../x,usd')).toEqual(['sat', 'usd'])
    expect(parseUnitParam('constructor,__proto__')).toEqual([])
  })
  it('collapses duplicates', () => {
    expect(parseUnitParam('sat,sat,SAT,usd')).toEqual(['sat', 'usd'])
    expect(normalizeUnitSelection(['usd', 'usd'])).toEqual(['usd'])
  })
  it('empty/missing → no selection and no param', () => {
    expect(parseUnitParam(null)).toEqual([])
    expect(parseUnitParam('')).toEqual([])
    expect(buildUnitParam([])).toBeNull()
  })
  it('builds a lowercase comma-separated value', () => {
    expect(buildUnitParam(['sat', 'usd'])).toBe('sat,usd')
    expect(buildUnitParam(['eur', 'sat'])).toBe('sat,eur')
  })
})

describe('countUnitHidden / unitHiddenNote', () => {
  const pool = [m(['sat']), m(['usd']), m(['msat']), m(['MSAT', 'auth']), m(null), m([]), m(['sat', 'msat'])]
  it('counts unknown (null/empty) and other (no SAT/USD/EUR at all); other-of-three is plain filtering', () => {
    expect(countUnitHidden(pool, ['sat'])).toEqual({ unknown: 2, other: 2 })
    expect(countUnitHidden(pool, ['sat', 'usd', 'eur'])).toEqual({ unknown: 2, other: 2 })
  })
  it('is zero with no unit selected', () => {
    expect(countUnitHidden(pool, [])).toEqual({ unknown: 0, other: 0 })
  })
  it('wording follows the real cause', () => {
    expect(unitHiddenNote({ unknown: 16, other: 0 })).toBe('16 hidden: units unknown')
    expect(unitHiddenNote({ unknown: 0, other: 3 })).toBe('3 hidden: other units')
    expect(unitHiddenNote({ unknown: 2, other: 1 })).toBe('3 hidden: units unknown or other')
    expect(unitHiddenNote({ unknown: 0, other: 0 })).toBeNull()
  })
})
