import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  hasIconFailedRecently,
  markIconFailed,
  _resetMintIconFailureCache,
} from '@/utils/mintIconFailureCache'

describe('mintIconFailureCache', () => {
  afterEach(() => {
    _resetMintIconFailureCache()
    vi.useRealTimers()
  })

  it('reports no failure for a url that was never marked', () => {
    expect(hasIconFailedRecently('https://never-tried.example')).toBe(false)
  })

  it('reports a failure immediately after marking', () => {
    markIconFailed('https://mint.example')
    expect(hasIconFailedRecently('https://mint.example')).toBe(true)
  })

  it('does not leak a failure to an unrelated url', () => {
    markIconFailed('https://a.example')
    expect(hasIconFailedRecently('https://b.example')).toBe(false)
  })

  it('persists the failure to localStorage so it survives a page reload', () => {
    markIconFailed('https://mint.example')
    const raw = localStorage.getItem('mintradar_icon_failures_v1')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as Record<string, number>
    expect(parsed['https://mint.example']).toBeGreaterThan(Date.now())
  })

  it('expires after the TTL and self-heals', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    markIconFailed('https://mint.example')
    expect(hasIconFailedRecently('https://mint.example')).toBe(true)

    vi.setSystemTime(24 * 60 * 60 * 1000 + 1)
    expect(hasIconFailedRecently('https://mint.example')).toBe(false)
  })
})
