import { describe, it, expect } from 'vitest'
import { nip87AnnouncementOf } from '@/utils/nip87Announcement'
import { NIP87_ANNOUNCEMENT_LABEL, NIP87_NOT_SEEN_TEXT, nip87KeyText, nip87StoredSuffix } from '@/utils/nip87Texts'

const PK = '02' + 'ab'.repeat(32)
const AT = '2026-03-14T09:20:00.000Z'
const line = (f: ReturnType<typeof nip87AnnouncementOf>) =>
  (f.announcement === 'seen' ? NIP87_ANNOUNCEMENT_LABEL + nip87StoredSuffix(f.eventCreatedAt) : NIP87_NOT_SEEN_TEXT) + (nip87KeyText(f) ? ` | ${nip87KeyText(f)}` : '')

describe('Mint Detail NIP-87 line', () => {
  it('seen + key matches', () => {
    expect(line(nip87AnnouncementOf({ announcedAt: AT, announceD: PK, infoPubkey: PK })))
      .toBe("NIP-87 announcement (kind:38172) · event dated 14 Mar 2026 | Announcement key matches the mint's /v1/info pubkey")
  })
  it('seen + key differs', () => {
    expect(line(nip87AnnouncementOf({ announcedAt: AT, announceD: '03' + 'cd'.repeat(32), infoPubkey: PK })))
      .toBe("NIP-87 announcement (kind:38172) · event dated 14 Mar 2026 | Announcement key differs from the mint's /v1/info pubkey")
  })
  it('seen + d missing or not pubkey-shaped: no key sentence at all', () => {
    for (const d of [null, 'f3a1-uuid', 'ab'.repeat(32)]) {
      expect(line(nip87AnnouncementOf({ announcedAt: AT, announceD: d, infoPubkey: PK }))).toBe('NIP-87 announcement (kind:38172) · event dated 14 Mar 2026')
    }
  })
  it('found text never says "seen on our relays", "checked" or "stored when first seen"; no date: nothing after the label', () => {
    expect(NIP87_ANNOUNCEMENT_LABEL + nip87StoredSuffix(AT)).not.toMatch(/seen on our relays|checked|stored when first seen/)
    expect(nip87StoredSuffix(null)).toBe('')
  })
  it('not seen: "not seen on our relays", never "does not exist" or "verified"', () => {
    const t = line(nip87AnnouncementOf({ announcedAt: null, announceD: PK, infoPubkey: PK }))
    expect(t).toBe('No NIP-87 announcement seen on our relays')
  })
  it('no text says "verified" or "does not exist"', () => {
    for (const t of [NIP87_ANNOUNCEMENT_LABEL, NIP87_NOT_SEEN_TEXT, nip87StoredSuffix(AT), nip87KeyText({ dMatchesInfoPubkey: true })!, nip87KeyText({ dMatchesInfoPubkey: false })!]) {
      expect(t).not.toMatch(/verified|does not exist/i)
    }
  })
})

describe('no "checked {time}" (removed 2026-11-15)', () => {
  it('not found: exactly "No NIP-87 announcement seen on our relays", also when a discovery time is stored', () => {
    const f = nip87AnnouncementOf({ announcedAt: null, checkedAt: '2026-10-31T06:00:00Z' })
    expect(f.announcement).toBe('not_seen')
    expect(NIP87_NOT_SEEN_TEXT).toBe('No NIP-87 announcement seen on our relays')
    expect(NIP87_NOT_SEEN_TEXT).not.toMatch(/checked|ago/)
  })
})
