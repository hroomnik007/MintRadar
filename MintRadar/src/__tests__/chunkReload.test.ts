import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isChunkLoadError, claimAutoReload, reloadOnChunkError,
  CHUNK_RELOAD_KEY, CHUNK_RELOAD_WINDOW_MS,
} from '../utils/chunkReload'

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://mintradar.org/assets/Stats-abc.js',
    'error loading dynamically imported module: /assets/Stats-abc.js',
    'Importing a module script failed.',
    'ChunkLoadError: Loading chunk 7 failed',
  ])('matches %s', msg => {
    expect(isChunkLoadError(new TypeError(msg))).toBe(true)
    expect(isChunkLoadError(msg)).toBe(true)
  })

  it('matches by error name and plain objects', () => {
    const e = new Error('Loading chunk 3 failed')
    e.name = 'ChunkLoadError'
    expect(isChunkLoadError(e)).toBe(true)
    expect(isChunkLoadError({ message: 'Importing a module script failed' })).toBe(true)
  })

  it('rejects unrelated errors and empty values', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
    expect(isChunkLoadError(new Error('Network request failed'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError(42)).toBe(false)
  })
})

describe('claimAutoReload', () => {
  beforeEach(() => sessionStorage.clear())

  it('allows the first failure, blocks the second inside 60s, allows again after 60s', () => {
    const t0 = 1_000_000
    expect(claimAutoReload(t0)).toBe(true)
    expect(claimAutoReload(t0 + 5_000)).toBe(false)
    expect(claimAutoReload(t0 + CHUNK_RELOAD_WINDOW_MS - 1)).toBe(false)
    expect(claimAutoReload(t0 + CHUNK_RELOAD_WINDOW_MS)).toBe(true)
    expect(claimAutoReload(t0 + CHUNK_RELOAD_WINDOW_MS + 1)).toBe(false)
  })

  it('ignores a garbage stored value', () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, 'nope')
    expect(claimAutoReload(5_000)).toBe(true)
  })

  it('refuses (no loop) when sessionStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(claimAutoReload(1)).toBe(false)
    spy.mockRestore()
  })
})

describe('reloadOnChunkError', () => {
  const reload = vi.fn()
  beforeEach(() => {
    sessionStorage.clear()
    reload.mockClear()
    vi.stubGlobal('location', { ...window.location, reload })
  })

  it('reloads once for a chunk error, not again inside the window', () => {
    const err = new TypeError('Failed to fetch dynamically imported module: /assets/Stats-x.js')
    expect(reloadOnChunkError(err)).toBe(true)
    expect(reloadOnChunkError(err)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('never reloads for non-chunk errors', () => {
    expect(reloadOnChunkError(new Error('boom'))).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
