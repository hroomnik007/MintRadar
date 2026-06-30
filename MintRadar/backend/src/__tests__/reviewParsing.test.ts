import { describe, it, expect } from 'vitest'
import { parseReviewRatingAndComment } from '../reviews.js'

// Rating precedence: valid `rating` tag (1-5) > "[X/5]" content marker.
// The content fallback is NOT range-checked and uses an anchored regex.
describe('parseReviewRatingAndComment', () => {
  describe('content "[X/5]" fallback (no rating tag)', () => {
    it('parses "[3/5] Great mint" → rating 3, comment "Great mint"', () => {
      expect(parseReviewRatingAndComment([], '[3/5] Great mint')).toEqual({
        rating: 3,
        comment: 'Great mint',
      })
    })

    it('parses "[5/5]" alone → rating 5, comment ""', () => {
      expect(parseReviewRatingAndComment([], '[5/5]')).toEqual({ rating: 5, comment: '' })
    })

    it('returns rating null and full text for content with no marker', () => {
      expect(parseReviewRatingAndComment([], 'Just a comment')).toEqual({
        rating: null,
        comment: 'Just a comment',
      })
    })

    it('returns rating null and empty comment for empty content', () => {
      expect(parseReviewRatingAndComment([], '')).toEqual({ rating: null, comment: '' })
    })

    it('strips the marker even with no space before the comment', () => {
      expect(parseReviewRatingAndComment([], '[4/5]No space')).toEqual({
        rating: 4,
        comment: 'No space',
      })
    })

    it('trims surrounding whitespace from the comment', () => {
      expect(parseReviewRatingAndComment([], '[2/5]   spaced   ')).toEqual({
        rating: 2,
        comment: 'spaced',
      })
    })
  })

  describe('out-of-range and malformed markers (documented behavior)', () => {
    it('does NOT clamp "[6/5]" — content fallback yields rating 6', () => {
      // The 1-5 range check applies ONLY to the `rating` tag, not the content marker.
      expect(parseReviewRatingAndComment([], '[6/5] Out of range')).toEqual({
        rating: 6,
        comment: 'Out of range',
      })
    })

    it('accepts "[0/5]" from the content marker → rating 0', () => {
      expect(parseReviewRatingAndComment([], '[0/5] zero')).toEqual({
        rating: 0,
        comment: 'zero',
      })
    })

    it('does NOT match a multi-digit "[10/5]" (single-digit regex)', () => {
      expect(parseReviewRatingAndComment([], '[10/5] ten')).toEqual({
        rating: null,
        comment: '[10/5] ten',
      })
    })

    it('does NOT match a marker that is not at the start of the content', () => {
      expect(parseReviewRatingAndComment([], 'text [3/5] in middle')).toEqual({
        rating: null,
        comment: 'text [3/5] in middle',
      })
    })
  })

  describe('rating tag precedence', () => {
    it('uses a valid rating tag and ignores the content marker', () => {
      expect(parseReviewRatingAndComment([['rating', '4']], '[2/5] ignored')).toEqual({
        rating: 4,
        comment: 'ignored',
      })
    })

    it('uses the comment tag for the comment when present', () => {
      expect(
        parseReviewRatingAndComment([['rating', '4'], ['comment', 'Nice mint']], '[2/5] body')
      ).toEqual({ rating: 4, comment: 'Nice mint' })
    })

    it('discards an out-of-range rating tag and falls back to the content marker', () => {
      // tag 6 is out of range → nulled → content "[3/5]" fallback wins
      expect(parseReviewRatingAndComment([['rating', '6']], '[3/5] fallback')).toEqual({
        rating: 3,
        comment: 'fallback',
      })
    })

    it('discards a rating tag of 0 (below range) → null when no content marker', () => {
      expect(parseReviewRatingAndComment([['rating', '0']], 'plain')).toEqual({
        rating: null,
        comment: 'plain',
      })
    })

    it('takes rating from content but comment from the comment tag', () => {
      expect(
        parseReviewRatingAndComment([['comment', 'My comment']], '[4/5] body text')
      ).toEqual({ rating: 4, comment: 'My comment' })
    })
  })

  describe('malformed rating tag (documents current NaN behavior)', () => {
    it('yields NaN rating for a non-numeric rating tag with no content fallback', () => {
      // parseInt('abc') = NaN; NaN passes the range guard untouched and no
      // content marker matches. NaN serializes to null over JSON downstream.
      const result = parseReviewRatingAndComment([['rating', 'abc']], 'body')
      expect(Number.isNaN(result.rating)).toBe(true)
      expect(result.comment).toBe('body')
    })

    it('a non-numeric rating tag still allows a content marker to win', () => {
      expect(parseReviewRatingAndComment([['rating', 'abc']], '[2/5] real')).toEqual({
        rating: 2,
        comment: 'real',
      })
    })
  })
})
