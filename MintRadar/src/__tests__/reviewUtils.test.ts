import { describe, it, expect } from 'vitest'
import {
  deduplicateByPubkey,
  mergeStoredAndLiveReviews,
  parseReviewEvent,
  sortReviewsByNewest,
  processReviewEvents,
  isEmptyReview,
  splitEmptyReviews,
  withServerProfileFallback,
  type ReviewAuthorProfile,
  type ReviewEvent,
  type ServerAuthorProfile,
} from '../utils/reviewUtils'

// ── Test helpers ────────────────────────────────────────────────

function makeEvent(overrides: Partial<ReviewEvent> & { pubkey: string }): ReviewEvent {
  return {
    id: overrides.pubkey + '-' + (overrides.created_at ?? 1000),
    pubkey: overrides.pubkey,
    created_at: overrides.created_at ?? 1000,
    tags: overrides.tags ?? [],
    content: overrides.content ?? '',
  }
}

// ── deduplicateByPubkey ────────────────────────────────────────

describe('deduplicateByPubkey', () => {
  it('keeps the single event when only one event per pubkey', () => {
    const e = makeEvent({ pubkey: 'alice' })
    expect(deduplicateByPubkey([e])).toEqual([e])
  })

  it('keeps the most recent event when pubkey has multiple reviews', () => {
    const old = makeEvent({ pubkey: 'alice', created_at: 1000 })
    const newest = makeEvent({ pubkey: 'alice', created_at: 2000 })
    const older = makeEvent({ pubkey: 'alice', created_at: 500 })
    const result = deduplicateByPubkey([old, newest, older])
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(newest)
  })

  it('keeps one event per distinct pubkey', () => {
    const a = makeEvent({ pubkey: 'alice', created_at: 1000 })
    const b = makeEvent({ pubkey: 'bob', created_at: 1000 })
    expect(deduplicateByPubkey([a, b])).toHaveLength(2)
  })

  it('returns an empty array for empty input', () => {
    expect(deduplicateByPubkey([])).toEqual([])
  })

  it('keeps the first-seen entry on a created_at tie (strict > means no replacement)', () => {
    const first = makeEvent({ pubkey: 'alice', created_at: 1000, content: 'first' })
    const second = makeEvent({ pubkey: 'alice', created_at: 1000, content: 'second' })
    // created_at equality → `e.created_at > existing.created_at` is false → first wins
    expect(deduplicateByPubkey([first, second])[0]!.content).toBe('first')
  })
})

// ── parseReviewEvent ───────────────────────────────────────────

describe('parseReviewEvent', () => {
  describe('content "[X/5]" fallback', () => {
    it('extracts rating 3 and comment from "[3/5] Great mint"', () => {
      const e = makeEvent({ pubkey: 'p', content: '[3/5] Great mint' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: 3, comment: 'Great mint' })
    })

    it('extracts rating 5 and empty comment from "[5/5]" alone', () => {
      const e = makeEvent({ pubkey: 'p', content: '[5/5]' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: 5, comment: '' })
    })

    it('returns null rating and full text when no marker present', () => {
      const e = makeEvent({ pubkey: 'p', content: 'Just a comment' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: null, comment: 'Just a comment' })
    })

    it('returns null rating and empty comment for empty content', () => {
      const e = makeEvent({ pubkey: 'p', content: '' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: null, comment: '' })
    })

    it('strips the marker even without a space after it', () => {
      const e = makeEvent({ pubkey: 'p', content: '[4/5]No space' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: 4, comment: 'No space' })
    })

    it('does NOT match a multi-digit marker "[10/5]"', () => {
      const e = makeEvent({ pubkey: 'p', content: '[10/5] ten' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: null, comment: '[10/5] ten' })
    })

    it('clamps "[9/5] great" — rating null, not 9', () => {
      const e = makeEvent({ pubkey: 'p', content: '[9/5] great' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: null, comment: 'great' })
    })

    it('clamps "[0/5]" from the content marker — rating null, not 0', () => {
      const e = makeEvent({ pubkey: 'p', content: '[0/5] zero' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: null, comment: 'zero' })
    })

    it('still parses "[3/5] good" → rating 3 (in-range, unchanged)', () => {
      const e = makeEvent({ pubkey: 'p', content: '[3/5] good' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: 3, comment: 'good' })
    })

    it('does NOT match a mid-string marker', () => {
      const e = makeEvent({ pubkey: 'p', content: 'text [3/5] here' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: null, comment: 'text [3/5] here' })
    })
  })

  describe('rating tag precedence', () => {
    it('uses a valid rating tag (1-5) and ignores content marker', () => {
      const e = makeEvent({ pubkey: 'p', tags: [['rating', '4']], content: '[2/5] ignored' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: 4, comment: 'ignored' })
    })

    it('uses the comment tag when present', () => {
      const e = makeEvent({ pubkey: 'p', tags: [['rating', '5'], ['comment', 'From tag']], content: '[1/5] body' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: 5, comment: 'From tag' })
    })

    it('discards a rating tag outside 1-5 and falls back to content marker', () => {
      const e = makeEvent({ pubkey: 'p', tags: [['rating', '6']], content: '[3/5] fallback' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: 3, comment: 'fallback' })
    })

    it('discards rating 0 from tag (out of range) with no content fallback', () => {
      const e = makeEvent({ pubkey: 'p', tags: [['rating', '0']], content: 'plain text' })
      expect(parseReviewEvent(e)).toMatchObject({ rating: null, comment: 'plain text' })
    })
  })

  it('preserves id, pubkey, createdAt from the event', () => {
    const e = makeEvent({ pubkey: 'alice', created_at: 9999, content: '[5/5] nice' })
    const result = parseReviewEvent(e)
    expect(result.id).toBe(e.id)
    expect(result.pubkey).toBe('alice')
    expect(result.createdAt).toBe(9999)
  })
})

// ── sortReviewsByNewest ────────────────────────────────────────

describe('sortReviewsByNewest', () => {
  it('keeps reviews with a rating even if comment is empty', () => {
    const r = { id: '1', pubkey: 'a', rating: 5, comment: '', createdAt: 1 }
    expect(sortReviewsByNewest([r])).toHaveLength(1)
  })

  it('keeps reviews with a non-empty comment even if rating is null', () => {
    const r = { id: '1', pubkey: 'a', rating: null, comment: 'Nice', createdAt: 1 }
    expect(sortReviewsByNewest([r])).toHaveLength(1)
  })

  it('keeps rating-less, comment-less endorsement events (counted as reviews)', () => {
    const empty = { id: '1', pubkey: 'a', rating: null, comment: '', createdAt: 1 }
    const good  = { id: '2', pubkey: 'b', rating: 4, comment: '', createdAt: 2 }
    expect(sortReviewsByNewest([empty, good])).toHaveLength(2)
  })

  it('sorts by createdAt descending (newest first)', () => {
    const old  = { id: '1', pubkey: 'a', rating: 3, comment: '', createdAt: 100 }
    const mid  = { id: '2', pubkey: 'b', rating: 4, comment: '', createdAt: 200 }
    const newest = { id: '3', pubkey: 'c', rating: 5, comment: '', createdAt: 300 }
    const result = sortReviewsByNewest([old, newest, mid])
    expect(result.map(r => r.createdAt)).toEqual([300, 200, 100])
  })

  it('does not mutate the input array', () => {
    const input = [
      { id: '1', pubkey: 'a', rating: 3, comment: '', createdAt: 100 },
      { id: '2', pubkey: 'b', rating: 4, comment: '', createdAt: 200 },
    ]
    sortReviewsByNewest(input)
    expect(input.map(r => r.createdAt)).toEqual([100, 200])
  })
})

// ── processReviewEvents (end-to-end pipeline) ──────────────────

describe('processReviewEvents', () => {
  it('returns an empty array for no events', () => {
    expect(processReviewEvents([])).toEqual([])
  })

  it('deduplicates, parses, sorts, and drops empty events', () => {
    const events: ReviewEvent[] = [
      makeEvent({ pubkey: 'alice', created_at: 100, content: '[3/5] old alice' }),
      makeEvent({ pubkey: 'alice', created_at: 300, content: '[5/5] new alice' }),
      makeEvent({ pubkey: 'bob', created_at: 200, content: '' }),
      makeEvent({ pubkey: 'carol', created_at: 150, content: 'Just text, no rating' }),
    ]

    const result = processReviewEvents(events)

    expect(result).toHaveLength(2)
    expect(result[0]!.pubkey).toBe('alice')
    expect(result[0]!.rating).toBe(5)
    expect(result[0]!.comment).toBe('new alice')
    expect(result[1]!.pubkey).toBe('carol')
    expect(result[1]!.rating).toBeNull()
    expect(result[1]!.comment).toBe('Just text, no rating')
  })

  it('keeps reviews from many distinct pubkeys', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ pubkey: `user${i}`, created_at: i * 100, content: `[${i + 1}/5] comment ${i}` })
    )
    expect(processReviewEvents(events)).toHaveLength(5)
  })
})

describe('mergeStoredAndLiveReviews', () => {
  const row = (pubkey: string, createdAt: number, id = pubkey + createdAt) => ({
    id, pubkey, createdAt, rating: 5 as number | null, comment: '',
  })

  it('does not add a live review from someone who is not in the stored set', () => {
    const stored = [row('a', 1), row('b', 2), row('c', 3), row('d', 4)]
    const live = [row('e', 9)]
    const merged = mergeStoredAndLiveReviews(stored, live, null)
    expect(merged.map(r => r.pubkey).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps one row when the same pubkey has a different event id live and stored', () => {
    const stored = [row('a', 1, 'old'), row('b', 2), row('c', 3), row('d', 4)]
    const live = [row('a', 5, 'new')]
    const merged = mergeStoredAndLiveReviews(stored, live, null)
    expect(merged).toHaveLength(4)
    expect(merged.find(r => r.pubkey === 'a')!.id).toBe('new')
  })

  it('adds the viewer\'s own review when the sync has not stored it yet', () => {
    const stored = [row('a', 1)]
    const live = [row('me', 9)]
    const merged = mergeStoredAndLiveReviews(stored, live, 'me')
    expect(merged.map(r => r.pubkey)).toEqual(['me', 'a'])
  })

  it('does not let an older live event replace the stored one', () => {
    const stored = [row('a', 10, 'stored')]
    const live = [row('a', 2, 'stale')]
    const merged = mergeStoredAndLiveReviews(stored, live, null)
    expect(merged[0]!.id).toBe('stored')
  })
})

describe('isEmptyReview / splitEmptyReviews', () => {
  const rated = { id: 'a', rating: 4, comment: 'good' }
  const ratedOnly = { id: 'b', rating: 5, comment: '' }
  const textOnly = { id: 'c', rating: null, comment: 'nice' }
  const neither = { id: 'd', rating: null, comment: '' }
  const blank = { id: 'e', rating: null, comment: '  \n\t ' }
  const missing = { id: 'f', rating: null }

  it('empty only when rating is null AND text is empty/whitespace', () => {
    expect([rated, ratedOnly, textOnly].some(r => isEmptyReview(r))).toBe(false)
    expect([neither, blank, missing].every(r => isEmptyReview(r))).toBe(true)
  })
  it('splits preserving order', () => {
    const { visible, empty } = splitEmptyReviews([neither, rated, blank, textOnly, ratedOnly, missing])
    expect(visible.map(r => r.id)).toEqual(['a', 'c', 'b'])
    expect(empty.map(r => r.id)).toEqual(['d', 'e', 'f'])
  })
  it('handles empty input', () => {
    expect(splitEmptyReviews([])).toEqual({ visible: [], empty: [] })
  })
})

describe('withServerProfileFallback', () => {
  type R = { pubkey: string; profile?: ReviewAuthorProfile }
  const server = new Map<string, ServerAuthorProfile>([
    ['a', { authorName: 'Server A', authorNip05: 'a@example.com' }],
    ['b', { authorName: 'Server B', authorNip05: 'b@example.com' }],
    ['c', { authorNip05: 'c@example.com' }],
  ])

  it('gives a reviewer with no browser profile the server name and NIP-05 claim, marked fromServer', () => {
    const [r] = withServerProfileFallback<R>([{ pubkey: 'a' }], server)
    expect(r!.profile).toEqual({ name: 'Server A', nip05: 'a@example.com', fromServer: true })
  })

  it('never overrides a browser profile that has a name', () => {
    const own = { name: 'Browser B', nip05: 'own@example.com' }
    const [r] = withServerProfileFallback([{ pubkey: 'b', profile: own }], server)
    expect(r!.profile).toBe(own)
  })

  it('keeps a browser-only picture / NIP-05 when the browser has no name and the server supplies one', () => {
    const [r] = withServerProfileFallback([{ pubkey: 'b', profile: { picture: 'https://x/p.png', nip05: 'own@example.com' } }], server)
    expect(r!.profile).toEqual({ picture: 'https://x/p.png', nip05: 'own@example.com', name: 'Server B', fromServer: true })
  })

  it('does nothing without a server name (a NIP-05 alone is not a name) or an unknown author', () => {
    const input: R[] = [{ pubkey: 'c' }, { pubkey: 'zzz' }]
    const out = withServerProfileFallback(input, server)
    expect(out[0]).toBe(input[0])
    expect(out[1]).toBe(input[1])
  })

  it('ignores a non-string or blank server name, keeps the text untouched otherwise', () => {
    const odd = new Map<string, ServerAuthorProfile>([
      ['x', { authorName: '   ' }],
      ['y', { authorName: 42 as unknown as string }],
      ['z', { authorName: '<b>x</b>' }],
    ])
    const out = withServerProfileFallback<R>([{ pubkey: 'x' }, { pubkey: 'y' }, { pubkey: 'z' }], odd)
    expect(out[0]!.profile).toBeUndefined()
    expect(out[1]!.profile).toBeUndefined()
    expect(out[2]!.profile!.name).toBe('<b>x</b>')
  })
})
