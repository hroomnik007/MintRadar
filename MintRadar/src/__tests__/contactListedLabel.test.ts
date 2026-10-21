import { describe, it, expect } from 'vitest'
import { contactListedKeys, showContactLabel, CONTACT_LISTED_LABEL, mergeStoredAndLiveReviews } from '@/utils/reviewUtils'

const A = 'ab'.repeat(32), B = 'cd'.repeat(32), OP = 'ef'.repeat(32)

describe('the neutral "Key listed as this mint\'s contact" label', () => {
  it('has the agreed text', () => {
    expect(CONTACT_LISTED_LABEL).toBe("Key listed as this mint's contact")
  })
  it('collects the keys the server flagged, lower-case; unflagged and missing items are not listed', () => {
    const keys = contactListedKeys([{ pubkey: A.toUpperCase(), listedAsContact: true }, { pubkey: B, listedAsContact: false }, { pubkey: OP }])
    expect([...keys]).toEqual([A])
    expect(contactListedKeys(undefined).size).toBe(0)
  })
  it('a flagged review is labelled', () => {
    expect(showContactLabel(A, new Set([A]), new Set())).toBe(true)
    expect(showContactLabel(A.toUpperCase(), new Set([A]), new Set())).toBe(true)
  })
  it('an unflagged review is not labelled', () => {
    expect(showContactLabel(B, new Set([A]), new Set())).toBe(false)
  })
  it('an operator review keeps its own treatment: no contact label next to the Operator badge', () => {
    expect(showContactLabel(OP, new Set([OP]), new Set([OP]))).toBe(false)
  })
  it('the label is display only: the merged list and the counts built from it do not depend on it', () => {
    const stored = [
      { id: '1', pubkey: A, rating: 5, comment: 'x', createdAt: 1, source: 'nostr' as const },
      { id: '2', pubkey: B, rating: 3, comment: 'y', createdAt: 2, source: 'nostr' as const },
    ]
    const merged = mergeStoredAndLiveReviews(stored, [], null)
    expect(merged.map(r => r.pubkey).sort()).toEqual([A, B].sort())
    // labelling every author changes nothing about the list
    const labelled = merged.filter(r => showContactLabel(r.pubkey, new Set([A, B]), new Set()))
    expect(labelled).toHaveLength(2)
    expect(merged).toHaveLength(2)
  })
})
