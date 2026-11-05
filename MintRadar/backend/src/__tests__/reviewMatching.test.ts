import { describe, it, expect } from 'vitest'
import {
  buildMintReviewIndex,
  isPreferredReplaceable,
  isReviewMintPubkey,
  mintUrlsForReviewEvent,
  reviewFiltersForMintBatch,
  reviewUrlCandidate,
} from '../reviewMatching.js'

const MINT_KEY = '02' + 'ab'.repeat(32)
const ANNOUNCER = 'cd'.repeat(32)

describe('reviewUrlCandidate', () => {
  it('normalizes scheme, host case and bare trailing slash', () => {
    expect(reviewUrlCandidate(' HTTP://Mint.Example/ ')).toBe('https://mint.example')
    expect(reviewUrlCandidate('https://mint.example/Path/')).toBe('https://mint.example/Path/')
  })
  it('rejects non-http, userinfo, query, fragment and junk', () => {
    for (const v of ['javascript:alert(1)', 'https://u:p@mint.example', 'https://mint.example?x=1', 'https://mint.example#x', 'junk', '']) {
      expect(reviewUrlCandidate(v)).toBeNull()
    }
  })
})

describe('isReviewMintPubkey', () => {
  it('accepts 64-hex and compressed 66-hex', () => {
    expect(isReviewMintPubkey(ANNOUNCER)).toBe(true)
    expect(isReviewMintPubkey(MINT_KEY)).toBe(true)
    expect(isReviewMintPubkey('not-a-key')).toBe(false)
  })
})

describe('mintUrlsForReviewEvent', () => {
  const index = buildMintReviewIndex([
    { url: 'https://a.example', pubkey: MINT_KEY, announcePubkey: ANNOUNCER, announceD: MINT_KEY },
    { url: 'https://b.example' },
  ])

  it('matches u with trailing slash and skips fedimint-typed u', () => {
    expect([...mintUrlsForReviewEvent([['u', 'https://a.example/', 'cashu']], index)]).toEqual(['https://a.example'])
    expect([...mintUrlsForReviewEvent([['u', 'https://a.example', 'fedimint']], index)]).toEqual([])
  })

  it('matches legacy d=URL and d=mint pubkey', () => {
    expect([...mintUrlsForReviewEvent([['d', 'https://b.example/']], index)]).toEqual(['https://b.example'])
    expect([...mintUrlsForReviewEvent([['d', MINT_KEY.toUpperCase()]], index)]).toEqual(['https://a.example'])
  })

  it('matches a=38172:announcer:mintpubkey', () => {
    expect([...mintUrlsForReviewEvent([['a', `38172:${ANNOUNCER}:${MINT_KEY}`]], index)]).toEqual(['https://a.example'])
  })

  it('ignores unrelated free-text d values', () => {
    expect([...mintUrlsForReviewEvent([['d', 'unrelated']], index)]).toEqual([])
  })
})

describe('reviewFiltersForMintBatch', () => {
  it('builds #u, #d and #a OR filters', () => {
    const filters = reviewFiltersForMintBatch(
      [{ url: 'https://a.example', pubkey: MINT_KEY, announcePubkey: ANNOUNCER, announceD: MINT_KEY }],
      50,
      10,
    )
    expect(filters).toHaveLength(3)
    expect(filters[0]).toMatchObject({ '#u': ['https://a.example'], since: 10, limit: 50 })
    expect(filters[1]!['#d']).toEqual(expect.arrayContaining(['https://a.example', MINT_KEY]))
    expect(filters[2]!['#a']).toEqual([`38172:${ANNOUNCER}:${MINT_KEY}`])
  })
})

describe('isPreferredReplaceable', () => {
  it('prefers higher created_at, then lower event id', () => {
    expect(isPreferredReplaceable({ id: 'a', created_at: 2 }, { id: 'b', created_at: 1 })).toBe(true)
    expect(isPreferredReplaceable({ id: 'fff', created_at: 1 }, { id: 'aaa', created_at: 1 })).toBe(false)
    expect(isPreferredReplaceable({ id: 'aaa', created_at: 1 }, { id: 'fff', created_at: 1 })).toBe(true)
  })
})
