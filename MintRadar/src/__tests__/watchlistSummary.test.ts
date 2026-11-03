import { describe, it, expect } from 'vitest'
import { watchlistSummary, watchlistSummaryText } from '@/utils/watchlistSummary'

const on = (url: string) => ({ url, online: true, degraded: false })
const off = (url: string) => ({ url, online: false, degraded: false })
const deg = (url: string) => ({ url, online: false, degraded: true })
const arch = (url: string) => ({ url, online: false, degraded: false, archived: true })
const sum = (s: ReturnType<typeof watchlistSummary>) => s.online + s.degraded + s.offline + s.archived + s.untracked

describe('watchlistSummary', () => {
  it('counts every status', () => {
    const known = [on('a'), on('b'), off('c'), deg('d'), arch('e')]
    expect(watchlistSummary(['a', 'b', 'c', 'd', 'e'], known)).toEqual({ total: 5, online: 2, degraded: 1, offline: 1, archived: 1, untracked: 0 })
  })

  it('degraded and archived are separate from offline, whatever the online flag says', () => {
    const known = [{ url: 'a', online: true, degraded: true }, { url: 'b', online: true, archived: true }, { url: 'c', online: null }]
    expect(watchlistSummary(['a', 'b', 'c'], known)).toMatchObject({ degraded: 1, archived: 1, offline: 1, online: 0 })
  })

  it('a watched URL that is not in the known list is untracked, in the total, in no status count', () => {
    const s = watchlistSummary(['a', 'gone'], [on('a'), on('other')])
    expect(s).toEqual({ total: 2, online: 1, degraded: 0, offline: 0, archived: 0, untracked: 1 })
  })

  it('only watched URLs count, not the whole known list', () => {
    expect(watchlistSummary(['a'], [on('a'), on('b'), off('c')]).total).toBe(1)
  })

  it('an empty watchlist and an empty known list', () => {
    expect(watchlistSummary([], [on('a')])).toEqual({ total: 0, online: 0, degraded: 0, offline: 0, archived: 0, untracked: 0 })
    expect(watchlistSummary(['a', 'b'], [])).toMatchObject({ total: 2, untracked: 2, online: 0, offline: 0 })
  })

  it('the five counts always add up to the total', () => {
    const known = [on('a'), off('b'), deg('c'), arch('d'), on('e')]
    for (const urls of [[], ['a'], ['a', 'x'], ['a', 'b', 'c', 'd', 'e', 'x', 'y'], ['x']]) {
      const s = watchlistSummary(urls, known)
      expect(sum(s)).toBe(s.total)
      expect(s.total).toBe(urls.length)
    }
  })
})

describe('watchlistSummaryText', () => {
  it('lists only the statuses that have a mint, in the order online, degraded, offline, archived', () => {
    expect(watchlistSummaryText({ total: 5, online: 4, degraded: 0, offline: 1, archived: 0, untracked: 0 })).toBe('5 mints watched · 4 online · 1 offline')
    expect(watchlistSummaryText({ total: 10, online: 1, degraded: 2, offline: 3, archived: 4, untracked: 0 })).toBe('10 mints watched · 1 online · 2 degraded · 3 offline · 4 archived')
  })

  it('singular for one mint', () => {
    expect(watchlistSummaryText({ total: 1, online: 1, degraded: 0, offline: 0, archived: 0, untracked: 0 })).toBe('1 mint watched · 1 online')
    expect(watchlistSummaryText({ total: 1, online: 0, degraded: 0, offline: 0, archived: 0, untracked: 1 })).toBe('1 mint watched · 1 not tracked')
  })

  it('"not tracked" is the last segment', () => {
    expect(watchlistSummaryText({ total: 3, online: 1, degraded: 0, offline: 1, archived: 0, untracked: 1 })).toBe('3 mints watched · 1 online · 1 offline · 1 not tracked')
  })

  it('from a real list: the words come from the status rule', () => {
    const s = watchlistSummary(['a', 'b', 'c', 'd', 'x'], [on('a'), off('b'), deg('c'), arch('d')])
    expect(watchlistSummaryText(s)).toBe('5 mints watched · 1 online · 1 degraded · 1 offline · 1 archived · 1 not tracked')
  })
})
