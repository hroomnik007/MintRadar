import { describe, it, expect } from 'vitest'
import { nip87AnnouncementOf, pubkeyShaped } from '../shared/nip87Announcement.js'
import { toWalletMint, type KnownMintLike } from '../walletApi.js'

const PK = '02' + 'ab'.repeat(32)
const OTHER = '03' + 'cd'.repeat(32)
const AT = '2026-03-14T09:20:00.000Z'

describe('nip87AnnouncementOf', () => {
  it('not seen: no stored event time → not_seen, nothing comparable', () => {
    expect(nip87AnnouncementOf({ announcedAt: null, announceD: PK, infoPubkey: PK })).toEqual({ announcement: 'not_seen', dMatchesInfoPubkey: null, eventCreatedAt: null })
    expect(nip87AnnouncementOf({})).toEqual({ announcement: 'not_seen', dMatchesInfoPubkey: null, eventCreatedAt: null })
    expect(nip87AnnouncementOf({ announcedAt: 'garbage' }).announcement).toBe('not_seen')
  })
  it('seen, d equals the /v1/info pubkey (case and spaces ignored) → true', () => {
    expect(nip87AnnouncementOf({ announcedAt: AT, announceD: ` ${PK.toUpperCase()} `, infoPubkey: PK })).toEqual({ announcement: 'seen', dMatchesInfoPubkey: true, eventCreatedAt: AT })
  })
  it('seen, d is another mint pubkey → false', () => {
    expect(nip87AnnouncementOf({ announcedAt: new Date(AT), announceD: OTHER, infoPubkey: PK }).dMatchesInfoPubkey).toBe(false)
  })
  it('seen, d missing → null (not comparable)', () => {
    expect(nip87AnnouncementOf({ announcedAt: AT, announceD: null, infoPubkey: PK })).toEqual({ announcement: 'seen', dMatchesInfoPubkey: null, eventCreatedAt: AT })
  })
  it('seen, d not pubkey-shaped → null, never false', () => {
    for (const d of ['some-uuid-1234', 'ab'.repeat(32), '04' + 'ab'.repeat(32), PK + '00', PK.slice(0, 64), '']) {
      expect(nip87AnnouncementOf({ announcedAt: AT, announceD: d, infoPubkey: PK }).dMatchesInfoPubkey, d).toBeNull()
    }
  })
  it('seen, mint pubkey unknown → null', () => {
    expect(nip87AnnouncementOf({ announcedAt: AT, announceD: PK, infoPubkey: null }).dMatchesInfoPubkey).toBeNull()
  })
  it('pubkeyShaped: 66 hex with a 02/03 prefix only', () => {
    expect(pubkeyShaped(PK)).toBe(PK)
    expect(pubkeyShaped('npub1xyz')).toBeNull()
    expect(pubkeyShaped(undefined)).toBeNull()
  })
})

describe('wallet API nip87 field', () => {
  const base: KnownMintLike = {
    url: 'https://a.example.com', name: 'A', archived: false, degraded: false, online: true, version: null, softwareLatest: null,
    nutsLimits: null, units: null, auditCzTotal: null, auditCzBlamed: null, auditCzFetchedAt: null, discoveredAt: null,
    reliabilityScore: null, uptimePct24h: null, uptimePct7d: null, lastCheckedAt: null, reviewCount: null, reviewRatedCount: null,
    reviewAvgRating: null, operatorReviewCount: null, latencyMs: null, pubkey: PK,
  }
  it('carries the stored announcement; no checkedAt key (the discovery run time is not stored)', () => {
    const w = toWalletMint({ ...base, nostrAnnouncedAt: AT, nostrAnnounceD: PK })
    expect(w.nip87).toEqual({ announcement: 'seen', dMatchesInfoPubkey: true, eventCreatedAt: AT })
    expect(Object.keys(w.nip87).sort()).toEqual(['announcement', 'dMatchesInfoPubkey', 'eventCreatedAt'])
  })
  it('not seen when nothing is stored', () => {
    expect(toWalletMint(base).nip87).toEqual({ announcement: 'not_seen', dMatchesInfoPubkey: null, eventCreatedAt: null })
  })
  it('differs / not comparable', () => {
    expect(toWalletMint({ ...base, nostrAnnouncedAt: AT, nostrAnnounceD: OTHER }).nip87.dMatchesInfoPubkey).toBe(false)
    expect(toWalletMint({ ...base, nostrAnnouncedAt: AT, nostrAnnounceD: 'not-a-key' }).nip87.dMatchesInfoPubkey).toBeNull()
    expect(toWalletMint({ ...base, nostrAnnouncedAt: AT }).nip87.dMatchesInfoPubkey).toBeNull()
  })
})
