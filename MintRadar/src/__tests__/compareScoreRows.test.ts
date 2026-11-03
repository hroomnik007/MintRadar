import { describe, it, expect } from 'vitest'
import type { KnownMint } from '@/hooks/useKnownMints'
import {
  SCORE_PART_ROWS, scorePointsText, contactKindsOf, contactMethodsText, cleanContactKind, nip87RowText,
  CONTACT_KIND_MAX_CHARS, CONTACT_KINDS_MAX,
} from '@/utils/compareScoreRows'
import { UPTIME_POINTS, AUDIT_POINTS, NUT_POINTS, VERSION_POINTS, CONTACT_POINTS } from '@/utils/tooltipTexts'

const NOW = Date.parse('2026-11-03T12:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const BASE: KnownMint = { url: 'https://a.mint.example', name: 'A', iconUrl: null, degraded: false, online: true, latencyMs: 1, version: null, nutCount: 1, tosUrl: null, descriptionLong: null, nutsLimits: null }
const stored = { uptime: { points: 38.4, max: 40 }, audit: { points: 25, max: 25 }, nuts: { points: 12, max: 15 }, version: { points: 15, max: 15 }, contact: { points: 3, max: 5 }, newMintCap: { points: 0, cap: 70 }, sum: 93 }
const SCORED: KnownMint = { ...BASE, reliabilityScore: 93, scoreBreakdown: stored, auditCzBlamed: 0, auditCzTotal: 40, auditCzFetchedAt: iso(3_600_000) }

describe('scorePointsText', () => {
  it('"<points> / <max>" from the stored breakdown, max from the shared constants', () => {
    expect(scorePointsText(SCORED, 'uptime', NOW)).toBe(`38.4 / ${UPTIME_POINTS}`)
    expect(scorePointsText(SCORED, 'audit', NOW)).toBe(`25 / ${AUDIT_POINTS}`)
    expect(scorePointsText(SCORED, 'nuts', NOW)).toBe(`12 / ${NUT_POINTS}`)
    expect(scorePointsText(SCORED, 'version', NOW)).toBe(`15 / ${VERSION_POINTS}`)
    expect(scorePointsText(SCORED, 'contact', NOW)).toBe(`3 / ${CONTACT_POINTS}`)
    expect(SCORE_PART_ROWS.map(r => r.max)).toEqual([UPTIME_POINTS, AUDIT_POINTS, NUT_POINTS, VERSION_POINTS, CONTACT_POINTS])
  })

  it('the five rows in the specified order with the specified labels', () => {
    expect(SCORE_PART_ROWS.map(r => r.label)).toEqual(['Uptime points', 'Audit points', 'NUT support points', 'Version points', 'Contact points'])
    expect(SCORE_PART_ROWS.map(r => r.id)).toEqual(['uptime-points', 'audit-points', 'nut-points', 'version-points', 'contact-points'])
  })

  it('a mint without a stored score (or without the stored record) shows "—"', () => {
    for (const part of ['uptime', 'audit', 'nuts', 'version', 'contact'] as const) {
      expect(scorePointsText({ ...SCORED, reliabilityScore: null }, part, NOW)).toBe('—')
      expect(scorePointsText({ ...BASE }, part, NOW)).toBe('—')
      expect(scorePointsText({ ...SCORED, scoreBreakdown: null }, part, NOW)).toBe('—')
    }
  })

  it('the audit part says "neutral" while its data is too thin, too old or missing; the other parts never do', () => {
    expect(scorePointsText({ ...SCORED, auditCzTotal: 2, auditCzBlamed: 0 }, 'audit', NOW)).toBe(`25 / ${AUDIT_POINTS} · neutral`)
    expect(scorePointsText({ ...SCORED, auditCzFetchedAt: iso(30 * 86_400_000) }, 'audit', NOW)).toMatch(/ · neutral$/)
    expect(scorePointsText({ ...SCORED, auditCzTotal: null, auditCzBlamed: null, auditCzFetchedAt: null }, 'audit', NOW)).toMatch(/ · neutral$/)
    expect(scorePointsText({ ...SCORED, auditCzTotal: 2 }, 'uptime', NOW)).not.toContain('neutral')
  })
})

describe('contact kinds', () => {
  it('fixed order: Email, Twitter, Nostr, then other kinds as stated (alphabetical), each once', () => {
    expect(contactKindsOf(['nostr', 'email', 'twitter'])).toEqual(['Email', 'Twitter', 'Nostr'])
    expect(contactKindsOf(['Nostr', 'EMAIL', 'email', 'telegram', 'signal'])).toEqual(['Email', 'Nostr', 'signal', 'telegram'])
  })

  it('"Email · Twitter · Nostr", "None listed", never an address', () => {
    expect(contactMethodsText({ online: true, info: { contact: [{ method: 'nostr', info: 'npub1secret' } as { method: string }, { method: 'email', info: 'me@secret.example' } as { method: string }] } })).toBe('Email · Nostr')
    expect(contactMethodsText({ online: true, info: { contact: [] } })).toBe('None listed')
    expect(contactMethodsText({ online: true, info: {} })).toBe('None listed')
    expect(contactMethodsText({ online: true, info: { contact: [{ method: 'email' }] } })).not.toMatch(/@/)
  })

  it('offline mint: the last published contacts, then the last contact checks; with neither it is unknown (null), not "None listed"', () => {
    expect(contactMethodsText({ online: false, info: null, lastContacts: [{ method: 'twitter' }] })).toBe('Twitter')
    expect(contactMethodsText({ online: false, info: null, contactChecks: [{ kind: 'nostr' }, { kind: 'email' }] })).toBe('Email · Nostr')
    expect(contactMethodsText({ online: false, info: null })).toBeNull()
  })

  it('hostile kind names stay plain, short text: control and bidi characters out, capped, count capped', () => {
    expect(cleanContactKind('<b onclick=x>')).toBe('<b onclick=x>') // kept as text, React escapes it
    expect(cleanContactKind('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=aler…') // capped
    expect(cleanContactKind('a\u0000b‮c\nd')).toBe('a b c d')
    expect(cleanContactKind('x'.repeat(500)).length).toBe(CONTACT_KIND_MAX_CHARS)
    expect(cleanContactKind(42)).toBe('')
    expect(cleanContactKind('   ')).toBe('')
    expect(contactKindsOf(Array.from({ length: 500 }, (_, i) => `kind${i}`)).length).toBeLessThanOrEqual(CONTACT_KINDS_MAX)
    expect(contactKindsOf([null, undefined, '', 5 as unknown as string])).toEqual([])
  })
})

describe('nip87RowText', () => {
  it('a stored announcement: "Seen · event dated 14 Mar 2026"; no key match, no check time', () => {
    const t = nip87RowText({ nostrAnnouncedAt: '2026-03-14T09:30:00.000Z', nostrAnnounceD: '02' + 'ab'.repeat(32), pubkey: '02' + 'cd'.repeat(32), nostrCheckedAt: '2026-11-03T11:00:00.000Z' })
    expect(t).toBe('Seen · event dated 14 Mar 2026')
  })
  it('nothing stored: "Not seen on our relays", with or without a discovery time', () => {
    expect(nip87RowText({})).toBe('Not seen on our relays')
    expect(nip87RowText({ nostrAnnouncedAt: null, nostrCheckedAt: '2026-11-03T11:00:00.000Z' })).toBe('Not seen on our relays')
    expect(nip87RowText({ nostrAnnouncedAt: 'garbage' })).toBe('Not seen on our relays')
  })
})
