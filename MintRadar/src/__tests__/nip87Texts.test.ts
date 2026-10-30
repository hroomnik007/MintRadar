import { describe, it, expect } from 'vitest'
import { nip87AnnouncementOf } from '@/utils/nip87Announcement'
import { NIP87_ANNOUNCEMENT_LABEL, NIP87_NOT_SEEN_TEXT, nip87KeyText, nip87SeenSuffix, nip87CheckedLabel } from '@/utils/nip87Texts'

const PK = '02' + 'ab'.repeat(32)
const AT = '2026-03-14T09:20:00.000Z'
const line = (f: ReturnType<typeof nip87AnnouncementOf>) =>
  (f.announcement === 'seen' ? NIP87_ANNOUNCEMENT_LABEL + nip87SeenSuffix(f.eventCreatedAt) : NIP87_NOT_SEEN_TEXT) + (nip87KeyText(f) ? ` | ${nip87KeyText(f)}` : '')

describe('Mint Detail NIP-87 line', () => {
  it('seen + key matches', () => {
    expect(line(nip87AnnouncementOf({ announcedAt: AT, announceD: PK, infoPubkey: PK })))
      .toBe("NIP-87 announcement (kind:38172) · seen on our relays · 14 Mar 2026 | Announcement key matches the mint's /v1/info pubkey")
  })
  it('seen + key differs', () => {
    expect(line(nip87AnnouncementOf({ announcedAt: AT, announceD: '03' + 'cd'.repeat(32), infoPubkey: PK })))
      .toBe("NIP-87 announcement (kind:38172) · seen on our relays · 14 Mar 2026 | Announcement key differs from the mint's /v1/info pubkey")
  })
  it('seen + d missing or not pubkey-shaped: no key sentence at all', () => {
    for (const d of [null, 'f3a1-uuid', 'ab'.repeat(32)]) {
      expect(line(nip87AnnouncementOf({ announcedAt: AT, announceD: d, infoPubkey: PK }))).toBe('NIP-87 announcement (kind:38172) · seen on our relays · 14 Mar 2026')
    }
  })
  it('not seen: "not seen on our relays", never "does not exist" or "verified"', () => {
    const t = line(nip87AnnouncementOf({ announcedAt: null, announceD: PK, infoPubkey: PK }))
    expect(t).toBe('No NIP-87 announcement seen on our relays')
  })
  it('no text says "verified" or "does not exist"', () => {
    for (const t of [NIP87_ANNOUNCEMENT_LABEL, NIP87_NOT_SEEN_TEXT, nip87SeenSuffix(AT), nip87KeyText({ dMatchesInfoPubkey: true })!, nip87KeyText({ dMatchesInfoPubkey: false })!]) {
      expect(t).not.toMatch(/verified|does not exist/i)
    }
  })
})

describe('"checked {time}" (last discovery run that reached our relays)', () => {
  const NOW = Date.parse('2026-10-31T06:05:00Z')
  const full = (f: ReturnType<typeof nip87AnnouncementOf>) => {
    const c = nip87CheckedLabel(f.checkedAt, NOW)
    return (f.announcement === 'seen' ? NIP87_ANNOUNCEMENT_LABEL + nip87SeenSuffix(f.eventCreatedAt) : NIP87_NOT_SEEN_TEXT) + (c ? `${c.text}${c.label}` : '')
  }
  it('found: "... · seen on our relays · {event date} · checked {time}"', () => {
    expect(full(nip87AnnouncementOf({ announcedAt: AT, announceD: PK, infoPubkey: PK, checkedAt: '2026-10-31T06:00:00Z' })))
      .toBe('NIP-87 announcement (kind:38172) · seen on our relays · 14 Mar 2026 · checked 5 min ago')
  })
  it('not found: "No NIP-87 announcement seen on our relays · checked {time}"', () => {
    expect(full(nip87AnnouncementOf({ announcedAt: null, checkedAt: '2026-10-31T06:00:00Z' }))).toBe('No NIP-87 announcement seen on our relays · checked 5 min ago')
  })
  it('exact UTC time as title', () => {
    expect(nip87CheckedLabel('2026-10-31T06:00:00Z', NOW)).toEqual({ text: ' · checked ', label: '5 min ago', title: '31 Oct 2026, 06:00 UTC' })
  })
  it('key missing: no "checked" and no placeholder', () => {
    for (const f of [nip87AnnouncementOf({ announcedAt: AT }), nip87AnnouncementOf({})]) {
      expect(full(f)).not.toMatch(/checked|—|n\/a|unknown/i)
    }
    expect(nip87CheckedLabel(undefined, NOW)).toBeNull()
    expect(nip87CheckedLabel('garbage', NOW)).toBeNull()
  })
})
