import { describe, it, expect } from 'vitest'
import { normalizeUrl } from '../discovery.js'

// normalizeUrl: enforce https, lowercase hostname, strip trailing slash on
// root-only paths. Invalid input is returned trimmed (never throws).
describe('normalizeUrl', () => {
  describe('hostname normalization', () => {
    it('lowercases an uppercase hostname (the coinos seed-bug case)', () => {
      expect(normalizeUrl('https://Mint.coinos.io')).toBe('https://mint.coinos.io')
    })

    it('lowercases mixed-case subdomains', () => {
      expect(normalizeUrl('https://API.Mint.Example.COM')).toBe('https://api.mint.example.com')
    })

    it('treats differently-cased hostnames as the same normalized URL', () => {
      expect(normalizeUrl('https://MINT.example.com')).toBe(normalizeUrl('https://mint.example.com'))
    })
  })

  describe('path case-sensitivity is preserved', () => {
    it('keeps the case of a non-root path', () => {
      expect(normalizeUrl('https://mint.example.com/Bitcoin')).toBe('https://mint.example.com/Bitcoin')
    })

    it('lowercases host but preserves path case simultaneously', () => {
      expect(normalizeUrl('https://API.Mint.com/V1/Info')).toBe('https://api.mint.com/V1/Info')
    })
  })

  describe('trailing slash handling', () => {
    it('strips a trailing slash on a root path', () => {
      expect(normalizeUrl('https://mint.example.com/')).toBe('https://mint.example.com')
    })

    it('strips the implicit root slash when no path is given', () => {
      expect(normalizeUrl('https://mint.example.com')).toBe('https://mint.example.com')
    })

    it('does NOT strip a trailing slash on a non-root path (only exact "/" path is stripped)', () => {
      // pathname is '/api/' (not exactly '/'), so the strip branch is skipped
      expect(normalizeUrl('https://mint.example.com/api/')).toBe('https://mint.example.com/api/')
    })

    it('leaves the root slash in place when a query string follows it', () => {
      // toString() ends with the query, not '/', so the end-anchored strip regex no-ops
      expect(normalizeUrl('https://mint.example.com/?foo=bar')).toBe('https://mint.example.com/?foo=bar')
    })
  })

  describe('scheme enforcement', () => {
    it('upgrades http to https', () => {
      expect(normalizeUrl('http://mint.example.com')).toBe('https://mint.example.com')
    })
  })

  describe('ports', () => {
    it('preserves a non-default port', () => {
      expect(normalizeUrl('https://mint.example.com:3338')).toBe('https://mint.example.com:3338')
    })

    it('preserves a non-default port together with a path', () => {
      expect(normalizeUrl('https://mint.example.com:3338/api')).toBe('https://mint.example.com:3338/api')
    })

    it('drops the default https port (443) per WHATWG URL', () => {
      expect(normalizeUrl('https://mint.example.com:443')).toBe('https://mint.example.com')
    })
  })

  describe('whitespace', () => {
    it('trims surrounding whitespace from a valid URL', () => {
      expect(normalizeUrl('  https://mint.example.com  ')).toBe('https://mint.example.com')
    })
  })

  describe('invalid input handling (never throws)', () => {
    it('returns the trimmed raw string for a non-URL', () => {
      expect(normalizeUrl('not a valid url')).toBe('not a valid url')
    })

    it('returns the trimmed raw string for garbage with whitespace', () => {
      expect(normalizeUrl('   garbage   ')).toBe('garbage')
    })

    it('returns empty string for empty input', () => {
      expect(normalizeUrl('')).toBe('')
    })

    it('does not throw on any of a range of malformed inputs', () => {
      for (const bad of ['', '://', 'ht!tp://x', 'mint.example.com', '   ']) {
        expect(() => normalizeUrl(bad)).not.toThrow()
      }
    })
  })
})
