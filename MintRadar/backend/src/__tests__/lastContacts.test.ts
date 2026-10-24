import { describe, it, expect } from 'vitest'
import { extractLastContacts, readStoredLastContacts } from '../lastContacts.js'

describe('extractLastContacts', () => {
  it('keeps method + info, max 10, strips control chars', () => {
    const raw = [
      { method: 'email', info: 'ops@example.com' },
      { method: 'twitter', info: '@mint\u0000ops' },
      { method: 'nostr', info: '  npub1abc  ' },
      null,
      { method: '', info: 'skip' },
      { method: 'telegram', info: '' },
      { method: 'signal', info: 'ok' },
      { method: 'url', info: 'https://x.com' },
      { method: 'other', info: 'a' },
      { method: 'other', info: 'b' },
      { method: 'other', info: 'c' },
      { method: 'other', info: 'd' },
    ]
    const out = extractLastContacts(raw)
    expect(out.length).toBe(7) // first 10 raw entries, only 8 valid
    expect(out[0]).toEqual({ method: 'email', info: 'ops@example.com' })
    expect(out[1]).toEqual({ method: 'twitter', info: '@mintops' })
    expect(out[2]).toEqual({ method: 'nostr', info: 'npub1abc' })
    expect(out.some(c => c.method === 'telegram')).toBe(false)
  })

  it('returns [] for non-array', () => {
    expect(extractLastContacts(null)).toEqual([])
    expect(extractLastContacts('nope')).toEqual([])
  })
})

describe('readStoredLastContacts', () => {
  it('round-trips valid stored data', () => {
    const stored = [{ method: 'email', info: 'a@b.com' }]
    expect(readStoredLastContacts(stored)).toEqual(stored)
  })
  it('returns null for malformed', () => {
    expect(readStoredLastContacts([{ method: 'email' }])).toBeNull()
    expect(readStoredLastContacts('x')).toBeNull()
  })
})
