import { describe, it, expect } from 'vitest'
import { extractLastContacts, readStoredLastContacts } from '../lastContacts.js'

describe('extractLastContacts', () => {
  it('keeps method + info, max 10, strips control chars, truncates', () => {
    const raw = [
      { method: 'email', info: 'ops@example.com' },
      { method: 'twitter', info: '@mint\u0000ops' },
      { method: 'nostr', info: '  npub1abc  ' },
      null,
      { method: '', info: 'skip' },
      { method: 'telegram', info: '' },
      ...Array.from({ length: 15 }, (_, i) => ({ method: 'other', info: `item${i}` })),
    ]
    const out = extractLastContacts(raw)
    expect(out).toHaveLength(10)
    expect(out[0]).toEqual({ method: 'email', info: 'ops@example.com' })
    expect(out[1]).toEqual({ method: 'twitter', info: '@mintops' })
    expect(out[2]).toEqual({ method: 'nostr', info: 'npub1abc' })
    expect(out.find(c => c.method === 'telegram')).toBeUndefined()
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
