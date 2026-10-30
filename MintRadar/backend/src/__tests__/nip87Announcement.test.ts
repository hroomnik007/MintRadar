import { describe, it, expect } from 'vitest'
import { nip87AnnouncementOf, pubkeyShaped } from '../shared/nip87Announcement.js'
import { toWalletMint, type KnownMintLike } from '../walletApi.js'
import { discoveryReachedRelays } from '../discovery.js'
import { appStateTimeIso } from '../appState.js'

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

describe('checkedAt (app_state discovery_last_success_at)', () => {
  const CHECKED = '2026-10-31T06:00:12.000Z'
  it('present when the key is stored for not seen; omitted for seen', () => {
    expect('checkedAt' in nip87AnnouncementOf({ announcedAt: AT, announceD: PK, infoPubkey: PK, checkedAt: CHECKED })).toBe(false)
    expect(nip87AnnouncementOf({ checkedAt: new Date(CHECKED) })).toEqual({ announcement: 'not_seen', dMatchesInfoPubkey: null, eventCreatedAt: null, checkedAt: CHECKED })
  })
  it('the key is omitted (not null, not empty) when the value is missing or not a date', () => {
    for (const c of [undefined, null, '', 'garbage']) {
      const f = nip87AnnouncementOf({ checkedAt: c })
      expect('checkedAt' in f, String(c)).toBe(false)
    }
  })
  it('wallet API: present for not seen, omitted for seen and without the key', () => {
    const base = { url: 'https://a.example.com', name: 'A', archived: false, degraded: false, online: true, version: null, softwareLatest: null,
      nutsLimits: null, units: null, auditCzTotal: null, auditCzBlamed: null, auditCzFetchedAt: null, discoveredAt: null,
      reliabilityScore: null, uptimePct24h: null, uptimePct7d: null, lastCheckedAt: null, reviewCount: null, reviewRatedCount: null,
      reviewAvgRating: null, operatorReviewCount: null, latencyMs: null, pubkey: PK, nostrAnnouncedAt: AT, nostrAnnounceD: PK } as KnownMintLike
    expect('checkedAt' in toWalletMint({ ...base, nostrCheckedAt: CHECKED }).nip87).toBe(false)
    const unannounced = { ...base, nostrAnnouncedAt: null, nostrAnnounceD: null }
    expect(toWalletMint({ ...unannounced, nostrCheckedAt: CHECKED }).nip87).toEqual({ announcement: 'not_seen', dMatchesInfoPubkey: null, eventCreatedAt: null, checkedAt: CHECKED })
    expect('checkedAt' in toWalletMint(unannounced).nip87).toBe(false)
    expect('checkedAt' in toWalletMint({ ...unannounced, nostrCheckedAt: null }).nip87).toBe(false)
  })
  it('appStateTimeIso normalises a stored value and returns null otherwise', () => {
    expect(appStateTimeIso('2026-10-31T06:00:12Z')).toBe(CHECKED)
    expect(appStateTimeIso(null)).toBeNull()
    expect(appStateTimeIso('x')).toBeNull()
  })
})

describe('discoveryReachedRelays (decides whether discovery_last_success_at is written)', () => {
  it('a relay delivered events: reached', () => expect(discoveryReachedRelays(true, 3, 2, 10)).toBe(true))
  it('no events but at least one relay did not fail (EOSE with nothing): reached', () => expect(discoveryReachedRelays(true, 0, 9, 10)).toBe(true))
  it('every relay failed to connect: not reached', () => expect(discoveryReachedRelays(true, 0, 10, 10)).toBe(false))
  it('the query timed out or rejected: not reached', () => expect(discoveryReachedRelays(false, 0, 0, 10)).toBe(false))
})
