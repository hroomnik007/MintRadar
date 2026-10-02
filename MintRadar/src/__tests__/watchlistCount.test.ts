import { describe, it, expect } from 'vitest'
import { showWatchlistCount } from '@/utils/watchlistCount'

describe('showWatchlistCount', () => {
  it('is hidden when everything is shown', () => {
    expect(showWatchlistCount(3, 3)).toBe(false)
    expect(showWatchlistCount(20, 20)).toBe(false)
  })
  it('is shown when fewer are shown than exist', () => {
    expect(showWatchlistCount(20, 25)).toBe(true)
    expect(showWatchlistCount(0, 1)).toBe(true)
  })
  it('is hidden for an empty list', () => {
    expect(showWatchlistCount(0, 0)).toBe(false)
  })
})
