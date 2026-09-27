import { describe, it, expect, afterEach } from 'vitest'
import { isAllowlistMode, getAllowlistUrls, isAllowedUrl } from '../allowlist.js'

// The module memoizes on the raw env string, so each test can just set
// MINT_ALLOWLIST and call the functions — no import-order gymnastics.
describe('allowlist mode', () => {
  afterEach(() => {
    delete process.env['MINT_ALLOWLIST']
  })

  describe('mode detection', () => {
    it('is off when MINT_ALLOWLIST is unset', () => {
      expect(isAllowlistMode()).toBe(false)
    })

    it('is off for an empty string', () => {
      process.env['MINT_ALLOWLIST'] = ''
      expect(isAllowlistMode()).toBe(false)
    })

    it('is off when no entry survives normalization', () => {
      process.env['MINT_ALLOWLIST'] = 'not-a-url, ???'
      expect(isAllowlistMode()).toBe(false)
    })

    it('is on for at least one valid https URL', () => {
      process.env['MINT_ALLOWLIST'] = 'https://mint.example.com'
      expect(isAllowlistMode()).toBe(true)
    })
  })

  describe('isAllowedUrl', () => {
    it('allows any URL when the mode is off', () => {
      expect(isAllowedUrl('https://anything.example.com')).toBe(true)
    })

    it('allows a listed URL', () => {
      process.env['MINT_ALLOWLIST'] = 'https://mint.example.com,https://other.example.org'
      expect(isAllowedUrl('https://mint.example.com')).toBe(true)
      expect(isAllowedUrl('https://other.example.org')).toBe(true)
    })

    it('rejects an unlisted URL', () => {
      process.env['MINT_ALLOWLIST'] = 'https://mint.example.com'
      expect(isAllowedUrl('https://elsewhere.example.com')).toBe(false)
    })

    it('matches through normalizeUrl (uppercase host, trailing slash, http upgrade)', () => {
      process.env['MINT_ALLOWLIST'] = 'https://Mint.Example.com/'
      expect(isAllowedUrl('https://mint.example.com')).toBe(true)
      expect(isAllowedUrl('http://mint.example.com')).toBe(true)
      expect(isAllowedUrl('https://mint.example.com/')).toBe(true)
    })

    it('still distinguishes different hosts after normalization', () => {
      process.env['MINT_ALLOWLIST'] = 'http://mint.example.com'
      expect(isAllowedUrl('https://mint.example.com')).toBe(true)
      expect(isAllowedUrl('https://mint.example.net')).toBe(false)
    })
  })

  describe('getAllowlistUrls', () => {
    it('returns null when the mode is off', () => {
      expect(getAllowlistUrls()).toBeNull()
    })

    it('returns normalized, sorted, de-duplicated entries', () => {
      process.env['MINT_ALLOWLIST'] = 'https://b.example.com, https://A.example.com,https://b.example.com/'
      expect(getAllowlistUrls()).toEqual(['https://a.example.com', 'https://b.example.com'])
    })
  })
})
