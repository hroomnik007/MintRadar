import { describe, it, expect } from 'vitest'
import { keysetExpiry, keysetExpiryMs, KEYSET_EXPIRY_SOON_DAYS, MAX_KEYSET_EXPIRY_S } from '@/utils/keysetExpiry'

const DAY = 86_400_000
// Noon UTC so the local date is the same day in every time zone between -11 and +11.
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0)
const secs = (ms: number) => Math.floor(ms / 1000)

describe('keysetExpiryMs', () => {
  it('reads UNIX seconds and ISO strings', () => {
    expect(keysetExpiryMs(1_800_000_000)).toBe(1_800_000_000_000)
    expect(keysetExpiryMs('2027-03-12T12:00:00Z')).toBe(Date.UTC(2027, 2, 12, 12))
  })
  it('no expiry for null, missing, 0, negative, fractional, non-numeric text and above year 3000', () => {
    for (const v of [null, undefined, 0, -5, 1.5, 'soon', '', {}, MAX_KEYSET_EXPIRY_S + 1, Number.MAX_SAFE_INTEGER + 2]) {
      expect(keysetExpiryMs(v)).toBeNull()
    }
    expect(keysetExpiryMs(MAX_KEYSET_EXPIRY_S)).toBe(MAX_KEYSET_EXPIRY_S * 1000)
  })
})

describe('keysetExpiry', () => {
  it('null when the mint states no expiry: the row does not change', () => {
    expect(keysetExpiry(null, NOW)).toBeNull()
    expect(keysetExpiry(undefined, NOW)).toBeNull()
  })
  it('far away: "Expires <date>", not highlighted', () => {
    const x = keysetExpiry(secs(Date.UTC(2027, 2, 12, 12)), NOW)
    expect(x).toMatchObject({ text: 'Expires 12 Mar 2027', soon: false, expired: false })
    expect(x?.title).toMatch(/^12 Mar 2027, \d{2}:\d{2} \(your time\) · 12 Mar 2027, 12:00 UTC$/)
  })
  it('the year is always shown, also for this year', () => {
    expect(keysetExpiry(secs(Date.UTC(2026, 11, 20, 12)), NOW)?.text).toBe('Expires 20 Dec 2026')
  })
  it(`highlighted under ${KEYSET_EXPIRY_SOON_DAYS} days, not at or above`, () => {
    expect(keysetExpiry(secs(NOW + 10 * DAY), NOW)).toMatchObject({ text: 'Expires 5 Nov 2026', soon: true, expired: false })
    expect(keysetExpiry(secs(NOW + 30 * DAY - 1000), NOW)?.soon).toBe(true)
    expect(keysetExpiry(secs(NOW + 30 * DAY), NOW)?.soon).toBe(false)
  })
  it('past: "Expired <date>", highlighted', () => {
    expect(keysetExpiry(secs(NOW - 3 * DAY), NOW)).toMatchObject({ text: 'Expired 23 Oct 2026', soon: true, expired: true })
    expect(keysetExpiry(secs(NOW), NOW)).toMatchObject({ expired: true })
  })
  it('the stored ISO copy (/api/mints/known lastKeysets) reads the same as the live seconds', () => {
    expect(keysetExpiry('2026-11-05T12:00:00.000Z', NOW)).toEqual(keysetExpiry(secs(NOW + 10 * DAY), NOW))
  })
})
