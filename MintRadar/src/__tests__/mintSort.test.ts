import { describe, it, expect } from 'vitest'
import type { KnownMint } from '@/hooks/useKnownMints'
import { compareMintsForSort, type MintSortKey, type SortDir } from '@/utils/mintSort'

const mk = (name: string, o: Partial<KnownMint>): KnownMint => ({ url: `https://${name}.example`, name, online: true, ...o } as KnownMint)
const A = mk('a', { reviewAvgRating: 4.9, reviewRatedCount: 30, reviewCount: 30, latencyMs: 300 })
const B = mk('b', { reviewAvgRating: 3.0, reviewRatedCount: 30, reviewCount: 5, latencyMs: 100 })
const U = mk('u', { reviewAvgRating: null, reviewCount: 0, latencyMs: null })
const OFF = mk('off', { online: false, reviewAvgRating: null, reviewCount: null, latencyMs: 50 })

const order = (key: MintSortKey, dir: SortDir) =>
  [U, OFF, B, A].slice().sort((x, y) => compareMintsForSort(x, y, key, dir, m => m.name ?? '')).map(m => m.name)

describe('compareMintsForSort', () => {
  it('rating: unrated mints last in both directions', () => {
    expect(order('rating', 'desc')).toEqual(['a', 'b', 'u', 'off'])
    expect(order('rating', 'asc')).toEqual(['b', 'a', 'u', 'off'])
  })
  it('review count: mints without reviews last in both directions', () => {
    expect(order('reviewCount', 'desc')).toEqual(['a', 'b', 'u', 'off'])
    expect(order('reviewCount', 'asc')).toEqual(['b', 'a', 'u', 'off'])
  })
  it('latency: offline or unmeasured mints last in both directions', () => {
    expect(order('latency', 'asc')).toEqual(['b', 'a', 'u', 'off'])
    expect(order('latency', 'desc')).toEqual(['a', 'b', 'u', 'off'])
  })
  it('name flips with the direction', () => {
    expect(order('name', 'asc')).toEqual(['a', 'b', 'off', 'u'])
    expect(order('name', 'desc')).toEqual(['u', 'off', 'b', 'a'])
  })
})
