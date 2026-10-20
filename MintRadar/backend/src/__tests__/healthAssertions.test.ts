import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, nip19 } from 'nostr-tools'
import { bytesToHex } from 'nostr-tools/utils'
import { normalizeUrl } from '../discovery.js'
import { METHODOLOGY_VERSION } from '../shared/methodology.js'
import {
  ATTESTATION_AUDIT_MAX_AGE_MS, ATTESTATION_EXPIRY_S, ATTESTATION_MAX_EVENTS_PER_RUN, ATTESTATION_MIN_INTERVAL_MS,
  ATTESTATION_MIN_RANK_DELTA, ATTESTATION_STATE_CHANGE_MAX_PER_HOUR, ATTESTATION_STATE_CHANGE_MIN_GAP_MS, ATTESTATION_PROFILE, ATTESTATION_PROFILE_PICTURE_URL, ATTESTATION_PUBKEY_HEX, ATTESTATION_REFRESH_MS, ATTESTATION_RELAYS,
  HEALTH_CONTENT, HEALTH_KIND, METHODOLOGY_URL, buildHealthEvent, buildProfileTemplate, healthIdentifier,
  publishReason, resolveAttestationKey, sanitizeSoftware, shouldPublish,
  type HealthInput, type PublishedState,
} from '../healthAssertions.js'
import type { WalletKeyset } from '../walletApi.js'
import { HEALTH_URL_TABLE } from './healthUrlTable.js'

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0) // 2026-10-14T12:00:00Z

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    url: 'https://mint.example.com',
    status: 'online',
    score: 87,
    uptime24hPct: 100,
    uptime7dPct: 99,
    software: 'Nutshell/0.17.5',
    outdated: false,
    isTest: false,
    scoreCappedNew: false,
    audit: { swaps7d: 120, attributedFailures: 1, fetchedAt: new Date(NOW - 3_600_000).toISOString() },
    lastCheckedAt: new Date(NOW - 120_000).toISOString(),
    now: NOW,
    ...over,
  }
}

const tagMap = (tags: string[][]): Record<string, string> => Object.fromEntries(tags.map(t => [t[0], t[1]]))

describe('constants', () => {
  it('match the owner decisions', () => {
    expect(HEALTH_KIND).toBe(30385)
    expect(ATTESTATION_MIN_INTERVAL_MS).toBe(6 * 3_600_000)
    expect(ATTESTATION_MIN_RANK_DELTA).toBe(2)
    expect(ATTESTATION_REFRESH_MS).toBe(24 * 3_600_000)
    expect(ATTESTATION_EXPIRY_S).toBe(172_800)
    expect(ATTESTATION_MAX_EVENTS_PER_RUN).toBe(200)
    expect(ATTESTATION_STATE_CHANGE_MIN_GAP_MS).toBe(5 * 60_000)
    expect(ATTESTATION_STATE_CHANGE_MAX_PER_HOUR).toBe(30)
    expect(ATTESTATION_AUDIT_MAX_AGE_MS).toBe(168 * 3_600_000)
    expect([...ATTESTATION_RELAYS]).toEqual(['wss://nostr.mintradar.org', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'])
    expect(ATTESTATION_PUBKEY_HEX).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('buildHealthEvent — exact tags', () => {
  it('builds the full tag set in the fixed order', () => {
    const ev = buildHealthEvent(input())!
    expect(ev.kind).toBe(30385)
    expect(ev.created_at).toBe(Math.floor(NOW / 1000))
    expect(ev.content).toBe(HEALTH_CONTENT)
    expect(ev.content).toBe("Operational health signal, not solvency, not a recommendation to deposit funds. Based on MintRadar's probes and third-party audit data; it can be wrong or out of date.")
    expect(ev.tags).toEqual([
      ['d', 'https://mint.example.com'],
      ['k', 'web'],
      ['rank', '87'],
      ['mint_status', 'online'],
      ['mint_uptime_24h', '100'],
      ['mint_uptime_7d', '99'],
      ['mint_software', 'Nutshell/0.17.5'],
      ['mint_outdated', '0'],
      ['mint_audit_swaps_7d', '120'],
      ['mint_audit_attributed_7d', '1'],
      ['mint_audit_at', String(Math.floor((NOW - 3_600_000) / 1000))],
      ['mint_test', '0'],
      ['mint_new_capped', '0'],
      ['mint_checked_at', String(Math.floor((NOW - 120_000) / 1000))],
      ['methodology', String(METHODOLOGY_VERSION)],
      ['methodology_url', 'https://mintradar.org/methodology'],
      ['expiration', String(Math.floor(NOW / 1000) + 172_800)],
    ])
    expect(METHODOLOGY_URL).toBe('https://mintradar.org/methodology')
  })

  it('expiration equals created_at + 172800', () => {
    const ev = buildHealthEvent(input())!
    expect(Number(tagMap(ev.tags)['expiration'])).toBe(ev.created_at + 172_800)
  })

  it('flags test mints, new-mint cap, outdated and offline/degraded status', () => {
    const t = tagMap(buildHealthEvent(input({ isTest: true, scoreCappedNew: true, outdated: true, status: 'offline' }))!.tags)
    expect(t['mint_test']).toBe('1')
    expect(t['mint_new_capped']).toBe('1')
    expect(t['mint_outdated']).toBe('1')
    expect(t['mint_status']).toBe('offline')
    expect(tagMap(buildHealthEvent(input({ status: 'degraded' }))!.tags)['mint_status']).toBe('degraded')
  })

  it('leaves out tags whose value is unknown instead of guessing', () => {
    const names = buildHealthEvent(input({ uptime24hPct: null, uptime7dPct: null, outdated: null, lastCheckedAt: null, software: null, audit: null }))!.tags.map(t => t[0])
    for (const gone of ['mint_uptime_24h', 'mint_uptime_7d', 'mint_outdated', 'mint_checked_at', 'mint_software', 'mint_audit_swaps_7d', 'mint_audit_attributed_7d', 'mint_audit_at']) {
      expect(names).not.toContain(gone)
    }
    expect(names).toEqual(['d', 'k', 'rank', 'mint_status', 'mint_test', 'mint_new_capped', 'methodology', 'methodology_url', 'expiration'])
  })
})

const keyset = (over: Partial<WalletKeyset> = {}): WalletKeyset => ({
  id: '00abcdef01234567', unit: 'sat', active: true, inputFeePpk: 0, finalExpiry: null, idVersion: 'v1', idValid: true, ...over,
})
const CHECKED = new Date(NOW - 600_000).toISOString()

describe('buildHealthEvent — probe, outage and keyset tags (added 2026-10-20)', () => {
  const tags = (over: Partial<HealthInput>) => buildHealthEvent(input(over))!.tags
  const names = (over: Partial<HealthInput>) => tags(over).map(t => t[0])

  it('are absent when the input carries no such data (an event looks exactly like before)', () => {
    const n = names({})
    for (const gone of ['mint_probes_24h', 'mint_down_since', 'mint_keysets_verified', 'mint_keysets_legacy', 'mint_keysets_id_invalid', 'mint_keyset_final_expiry', 'mint_keysets_checked_at']) {
      expect(n).not.toContain(gone)
    }
  })

  it('the existing tags keep their names, values and order next to the new ones (compatibility)', () => {
    const old = buildHealthEvent(input())!.tags
    const extended = buildHealthEvent(input({
      probes24h: 288, downSince: null, keysets: [keyset()], keysetsCheckedAt: CHECKED,
    }))!.tags
    const newNames = new Set(['mint_probes_24h', 'mint_down_since', 'mint_keysets_verified', 'mint_keysets_legacy', 'mint_keysets_id_invalid', 'mint_keyset_final_expiry', 'mint_keysets_checked_at'])
    expect(extended.filter(t => !newNames.has(t[0]!))).toEqual(old)
    // the new tags sit between mint_checked_at and methodology
    const order = extended.map(t => t[0])
    expect(order.indexOf('mint_probes_24h')).toBe(order.indexOf('mint_checked_at') + 1)
    expect(order.indexOf('methodology')).toBe(order.indexOf('mint_keysets_checked_at') + 1)
  })

  it('mint_probes_24h is the integer probe count (0 is a real value), omitted when unknown', () => {
    expect(tagMap(tags({ probes24h: 288 }))['mint_probes_24h']).toBe('288')
    expect(tagMap(tags({ probes24h: 0 }))['mint_probes_24h']).toBe('0')
    for (const bad of [null, undefined, -1, 1.5, Number.NaN]) expect(names({ probes24h: bad as number | null })).not.toContain('mint_probes_24h')
  })

  it('mint_down_since: the wallet API value, only while the mint is not online', () => {
    const since = '2026-10-14T09:10:03.876Z'
    // UNIX seconds as a plain decimal string (the wallet API keeps the ISO text), milliseconds dropped
    expect(tagMap(tags({ status: 'degraded', downSince: since }))['mint_down_since']).toBe('1791969003')
    expect(tagMap(tags({ status: 'offline', downSince: since }))['mint_down_since']).toBe('1791969003')
    expect(names({ status: 'online', downSince: since })).not.toContain('mint_down_since')
    expect(names({ status: 'offline', downSince: null })).not.toContain('mint_down_since')
    expect(names({ status: 'offline', downSince: 'not a date' })).not.toContain('mint_down_since')
  })

  it('keyset counts are over the active keysets: verified, legacy, invalid; unknown (null) is none of them', () => {
    const t = tagMap(tags({
      keysetsCheckedAt: CHECKED,
      keysets: [
        keyset({ id: '00a' }), keyset({ id: '00b' }), keyset({ id: '01c', idVersion: 'v2' }),
        keyset({ id: 'legacy1', idVersion: 'legacy', idValid: null }),
        keyset({ id: '00bad', idValid: false }),
        keyset({ id: 'unk', idVersion: 'unknown', idValid: null }),
        keyset({ id: '00old', active: false, idValid: false }), // inactive: not counted anywhere
        keyset({ id: 'oldlegacy', active: false, idVersion: 'legacy', idValid: null }),
      ],
    }))
    expect(t['mint_keysets_verified']).toBe('3')
    expect(t['mint_keysets_legacy']).toBe('1')
    expect(t['mint_keysets_id_invalid']).toBe('1')
    expect(t['mint_keysets_checked_at']).toBe(String(Math.floor((NOW - 600_000) / 1000)))
  })

  it('mint_keyset_final_expiry is the earliest of the ACTIVE keysets, UNIX seconds, only when one has it', () => {
    const t = tagMap(tags({
      keysetsCheckedAt: CHECKED,
      keysets: [
        keyset({ finalExpiry: '2027-03-01T00:00:00Z' }), keyset({ finalExpiry: '2027-01-15T12:30:00Z' }),
        keyset({ finalExpiry: '2026-11-01T00:00:00Z', active: false }), keyset(),
      ],
    }))
    expect(t['mint_keyset_final_expiry']).toBe('1800016200')
    expect(names({ keysetsCheckedAt: CHECKED, keysets: [keyset(), keyset({ finalExpiry: '2026-11-01T00:00:00Z', active: false })] })).not.toContain('mint_keyset_final_expiry')
  })

  it('a mint whose keysets were never checked gets none of the keyset tags; a checked mint with no keyset gets zeros', () => {
    const none = names({ keysets: [], keysetsCheckedAt: null })
    expect(none.filter(n => n.startsWith('mint_keyset'))).toEqual([])
    expect(names({ keysets: [keyset()], keysetsCheckedAt: null }).filter(n => n.startsWith('mint_keyset'))).toEqual([])
    const zero = tagMap(tags({ keysets: [], keysetsCheckedAt: CHECKED }))
    expect([zero['mint_keysets_verified'], zero['mint_keysets_legacy'], zero['mint_keysets_id_invalid']]).toEqual(['0', '0', '0'])
    expect(zero['mint_keyset_final_expiry']).toBeUndefined()
  })

  it('every time tag of a full event is a plain integer of UNIX seconds', () => {
    const t = tagMap(tags({ probes24h: 3, keysets: [keyset({ finalExpiry: '2027-01-15T12:30:00Z' })], keysetsCheckedAt: CHECKED, status: 'offline', downSince: CHECKED, lastCheckedAt: CHECKED }))
    for (const name of ['mint_checked_at', 'mint_down_since', 'mint_keyset_final_expiry', 'mint_keysets_checked_at', 'expiration']) {
      expect(t[name], name).toMatch(/^[0-9]{10}$/)
    }
  })

  it('there is no verdict or low-sample tag', () => {
    const all = names({ probes24h: 3, keysets: [keyset()], keysetsCheckedAt: CHECKED, status: 'offline', downSince: CHECKED })
    expect(all.filter(n => /low|sample|verdict|trust|safe/i.test(n))).toEqual([])
  })
})

describe('buildHealthEvent — mint_last_change (added 2026-10-20)', () => {
  const tags = (over: Partial<HealthInput>) => buildHealthEvent(input(over))!.tags
  const names = (over: Partial<HealthInput>) => tags(over).map(t => t[0])
  const CHANGE = new Date(NOW - 5 * 86_400_000).toISOString()

  it('is present only when the mint has a confirmed change, absent otherwise (an event looks exactly like before)', () => {
    expect(names({})).not.toContain('mint_last_change')
    expect(names({ lastChangeAt: null })).not.toContain('mint_last_change')
    expect(names({ lastChangeAt: 'not a date' })).not.toContain('mint_last_change')
    expect(names({ lastChangeAt: CHANGE })).toContain('mint_last_change')
    expect(buildHealthEvent(input({ lastChangeAt: null }))).toEqual(buildHealthEvent(input()))
  })

  it('is UNIX seconds: a 10-digit integer equal to the change time (the API writes the same moment as ISO)', () => {
    const v = tagMap(tags({ lastChangeAt: CHANGE }))['mint_last_change']!
    expect(v).toMatch(/^\d{10}$/)
    expect(Number(v)).toBe(Math.floor(Date.parse(CHANGE) / 1000))
  })

  it('sits after the keyset tags and before methodology; all other tags keep their names, values and order', () => {
    const extra = { probes24h: 288, keysets: [keyset()], keysetsCheckedAt: CHECKED }
    const without = buildHealthEvent(input(extra))!.tags
    const withTag = buildHealthEvent(input({ ...extra, lastChangeAt: CHANGE }))!.tags
    expect(withTag.filter(t => t[0] !== 'mint_last_change')).toEqual(without)
    const order = withTag.map(t => t[0])
    expect(order.indexOf('mint_last_change')).toBe(order.indexOf('mint_keysets_checked_at') + 1)
    expect(order.indexOf('methodology')).toBe(order.indexOf('mint_last_change') + 1)
    // and without keyset data it still precedes methodology
    const bare = names({ lastChangeAt: CHANGE })
    expect(bare.indexOf('methodology')).toBe(bare.indexOf('mint_last_change') + 1)
  })

  it('a mint that is archived still gets no event, with or without a change', () => {
    expect(buildHealthEvent(input({ status: 'archived', lastChangeAt: CHANGE }))).toBeNull()
  })

  it('the signed event stays about 1.0 to 1.2 kB with every tag present', () => {
    const full = buildHealthEvent(input({
      status: 'degraded', probes24h: 288, downSince: CHECKED, keysets: [keyset({ finalExpiry: '2027-01-15T12:30:00Z' })], keysetsCheckedAt: CHECKED, lastChangeAt: CHANGE,
    }))!
    const signed = finalizeEvent(full, generateSecretKey())
    const bytes = new TextEncoder().encode(JSON.stringify(signed)).length
    expect(bytes).toBeGreaterThan(900)
    expect(bytes).toBeLessThan(1300)
  })
})

describe('buildHealthEvent — skipped mints', () => {
  it('null score, NaN score and archived mints get no event', () => {
    expect(buildHealthEvent(input({ score: null }))).toBeNull()
    expect(buildHealthEvent(input({ score: Number.NaN }))).toBeNull()
    expect(buildHealthEvent(input({ status: 'archived' }))).toBeNull()
  })

  it('a score of 0 is a real score and is published', () => {
    expect(tagMap(buildHealthEvent(input({ score: 0 }))!.tags)['rank']).toBe('0')
  })

  it('onion hosts, IP-literal hosts and non-URLs get no event (no onion or IP in an event)', () => {
    for (const url of ['http://abcdefghijklmnop.onion', 'https://abcdefghijklmnop.onion/Bitcoin', 'https://203.0.113.7', 'https://203.0.113.7:3338/x', 'https://[2001:db8::1]', 'not a url', '']) {
      expect(buildHealthEvent(input({ url }))).toBeNull()
    }
  })
})

describe('buildHealthEvent — rank and percentages', () => {
  it('rounds and clamps rank to 0..100', () => {
    const rank = (score: number) => tagMap(buildHealthEvent(input({ score }))!.tags)['rank']
    expect(rank(87.5)).toBe('88')
    expect(rank(49.4)).toBe('49')
    expect(rank(100.6)).toBe('100')
    expect(rank(250)).toBe('100')
    expect(rank(-3)).toBe('0')
  })

  it('clamps and rounds uptime values to integers 0..100', () => {
    const t = tagMap(buildHealthEvent(input({ uptime24hPct: 100.4, uptime7dPct: -2 }))!.tags)
    expect(t['mint_uptime_24h']).toBe('100')
    expect(t['mint_uptime_7d']).toBe('0')
  })
})

describe('buildHealthEvent — audit tags', () => {
  const audit = (ageMs: number) => ({ swaps7d: 50, attributedFailures: 0, fetchedAt: new Date(NOW - ageMs).toISOString() })
  const has = (i: HealthInput) => buildHealthEvent(i)!.tags.some(t => t[0] === 'mint_audit_at')

  it('are present while the audit data is at most 168 hours old', () => {
    expect(has(input({ audit: audit(0) }))).toBe(true)
    expect(has(input({ audit: audit(167 * 3_600_000) }))).toBe(true)
    expect(has(input({ audit: audit(168 * 3_600_000) }))).toBe(true)
  })

  it('are all three omitted when older than 168 hours', () => {
    const tags = buildHealthEvent(input({ audit: audit(168 * 3_600_000 + 1000) }))!.tags.map(t => t[0])
    expect(tags).not.toContain('mint_audit_swaps_7d')
    expect(tags).not.toContain('mint_audit_attributed_7d')
    expect(tags).not.toContain('mint_audit_at')
  })

  it('are omitted for an unreadable, far-future or non-integer audit', () => {
    expect(has(input({ audit: { swaps7d: 5, attributedFailures: 0, fetchedAt: 'garbage' } }))).toBe(false)
    expect(has(input({ audit: audit(-3_600_000) }))).toBe(false)
    expect(has(input({ audit: { swaps7d: 5.5, attributedFailures: 0, fetchedAt: new Date(NOW).toISOString() } }))).toBe(false)
    expect(has(input({ audit: { swaps7d: -1, attributedFailures: 0, fetchedAt: new Date(NOW).toISOString() } }))).toBe(false)
  })
})

describe('d tag — the repository normalizeUrl, fragment dropped', () => {
  const table = HEALTH_URL_TABLE
  it.each(table)('%s -> %s', (raw, expected) => {
    expect(healthIdentifier(raw)).toBe(expected)
    expect(tagMap(buildHealthEvent(input({ url: raw }))!.tags)['d']).toBe(expected)
  })

  it('equals normalizeUrl output whenever the URL has no fragment', () => {
    for (const [raw] of table.filter(([r]) => !r.includes('#'))) expect(healthIdentifier(raw)).toBe(normalizeUrl(raw))
  })
})

describe('mint_software sanitising (the only mint-controlled text in an event)', () => {
  const accepted = ['Nutshell/0.17.5', 'cdk-mintd/0.13.0', 'nutshell/0.16.0-rc.1', 'LNbits 0.12.8', 'Mint_x+build.4', '  Nutshell/0.17.5  ']
  it.each(accepted)('keeps %j', raw => {
    expect(sanitizeSoftware(raw)).toBe(raw.trim())
  })

  const hostile: Array<[string, string]> = [
    ['phishing sentence', 'Claim your sats now at https://evil.example/claim!'],
    ['nostr: reference', 'nostr:npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'],
    ['70 characters', 'a'.repeat(70)],
    ['65 characters', 'b'.repeat(65)],
    ['control character', 'Nutshell/0.17.5\u0007'],
    ['NUL', 'Nut\u0000shell'],
    ['RTL override', 'Nutshell/‮0.17.5'],
    ['zero-width space', 'Nut​shell/0.17.5'],
    ['zero-width joiner', 'Nut‍shell'],
    ['markdown link', '[click](https://evil.example)'],
    ['markdown emphasis', '**Nutshell**'],
    ['newline', 'Nutshell/0.17.5\nSend funds to bc1qxyz'],
    ['tab', 'Nutshell\t0.17.5'],
    ['html', '<script>alert(1)</script>'],
    ['non-ASCII letters', 'Nütshell/0.17.5'],
    ['empty', ''],
    ['only spaces', '    '],
  ]
  it.each(hostile)('omits %s', (_name, raw) => {
    expect(sanitizeSoftware(raw)).toBeNull()
    const ev = buildHealthEvent(input({ software: raw }))!
    expect(ev.tags.some(t => t[0] === 'mint_software')).toBe(false)
    // and nothing of the hostile text is anywhere else in the event
    expect(JSON.stringify(ev)).not.toContain(raw.trim() === '' ? '\u0000\u0000' : raw.trim())
  })

  it('exactly 64 characters is the longest accepted value', () => {
    expect(sanitizeSoftware('c'.repeat(64))).toBe('c'.repeat(64))
    expect(sanitizeSoftware('c'.repeat(65))).toBeNull()
  })

  it('null and non-strings are omitted', () => {
    expect(sanitizeSoftware(null)).toBeNull()
    expect(sanitizeSoftware(undefined)).toBeNull()
    expect(sanitizeSoftware(42 as unknown as string)).toBeNull()
  })
})

describe('no forbidden fields in an event', () => {
  const ALLOWED_NAMES = new Set(['d', 'k', 'rank', 'mint_status', 'mint_uptime_24h', 'mint_uptime_7d', 'mint_software', 'mint_outdated', 'mint_audit_swaps_7d', 'mint_audit_attributed_7d', 'mint_audit_at', 'mint_test', 'mint_new_capped', 'mint_checked_at', 'methodology', 'methodology_url', 'expiration'])

  function strings(v: unknown): string[] {
    if (typeof v === 'string') return [v]
    if (Array.isArray(v)) return v.flatMap(strings)
    if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)])
    return []
  }

  it('contains no IP-like string, .onion, npub, nsec, nostr: reference, review, name or contact — even when the input object carries them', () => {
    const dirty = {
      ...input({ software: 'Nutshell/0.17.5' }),
      name: 'Secret Mint Name', ip: '203.0.113.7', ipAddress: '198.51.100.9', onion: 'abcdefghijklmnop.onion',
      pubkey: 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', contact: 'ops@secret.example',
      reviews: [{ comment: 'Great mint, trust it', rating: 5 }], reviewCount: 17, lastError: 'ECONNREFUSED 10.0.0.1:3338',
    } as HealthInput
    const ev = buildHealthEvent(dirty)!
    const all = strings(ev)
    for (const s of all) {
      expect(s).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)
      expect(s).not.toMatch(/\.onion/i)
      expect(s).not.toMatch(/npub|nsec|nprofile|nostr:/i)
      expect(s).not.toMatch(/Secret Mint Name|secret\.example|Great mint|ECONNREFUSED|review/i)
    }
    // the content mentions reviews nowhere, and the tag names are exactly the fixed v1 set
    expect(ev.tags.every(t => ALLOWED_NAMES.has(t[0] as string))).toBe(true)
    expect(new Set(ev.tags.map(t => t[0])).size).toBe(ev.tags.length)
  })

  it('has no tag named p, e, a, i or t (no pubkeys, no references)', () => {
    const names = buildHealthEvent(input())!.tags.map(t => t[0])
    for (const n of ['p', 'e', 'a', 'i', 't', 'r']) expect(names).not.toContain(n)
  })
})

describe('signed event', () => {
  it('verifies with nostr-tools and carries the signing key as author', () => {
    const sk = generateSecretKey()
    const signed = finalizeEvent(buildHealthEvent(input())!, sk)
    expect(verifyEvent(signed)).toBe(true)
    expect(signed.pubkey).toBe(getPublicKey(sk))
    expect(signed.kind).toBe(30385)
    // a plain copy (verifyEvent caches its result on the object it was given)
    const tampered = JSON.parse(JSON.stringify(signed)) as typeof signed
    tampered.tags.push(['rank', '1'])
    expect(verifyEvent(tampered)).toBe(false)
  })
})

describe('shouldPublish (fake clock)', () => {
  const H = 3_600_000
  const prev = (over: Partial<PublishedState> = {}): PublishedState => ({
    lastCreatedAt: Math.floor(NOW / 1000), lastRank: 80, lastStatus: 'online', lastMethodology: METHODOLOGY_VERSION, ...over,
  })
  const next = (over: Partial<{ rank: number; status: string; methodology: number }> = {}) => ({
    rank: 80, status: 'online', methodology: METHODOLOGY_VERSION, ...over,
  })

  it('a never-published mint publishes immediately', () => {
    expect(shouldPublish(null, next(), NOW)).toBe(true)
    expect(shouldPublish(undefined, next(), NOW)).toBe(true)
  })

  it('nothing publishes inside the 6 hour minimum, however big the change', () => {
    const p = prev()
    expect(shouldPublish(p, next({ rank: 10, status: 'offline', methodology: METHODOLOGY_VERSION + 1 }), NOW + 6 * H - 1000)).toBe(false)
    expect(shouldPublish(p, next({ rank: 10 }), NOW)).toBe(false)
  })

  it('a rank delta of 1 does not publish, a delta of 2 does (up and down)', () => {
    const p = prev()
    const t = NOW + 6 * H
    expect(shouldPublish(p, next({ rank: 81 }), t)).toBe(false)
    expect(shouldPublish(p, next({ rank: 79 }), t)).toBe(false)
    expect(shouldPublish(p, next({ rank: 82 }), t)).toBe(true)
    expect(shouldPublish(p, next({ rank: 78 }), t)).toBe(true)
  })

  it('a status flip publishes after the interval, not before', () => {
    const p = prev()
    expect(shouldPublish(p, next({ status: 'offline' }), NOW + 6 * H - 1)).toBe(false)
    expect(shouldPublish(p, next({ status: 'offline' }), NOW + 6 * H)).toBe(true)
    expect(shouldPublish(p, next({ status: 'degraded' }), NOW + 7 * H)).toBe(true)
  })

  it('a methodology bump refreshes every mint (still after the 6 hour pacing)', () => {
    const bumped = next({ methodology: METHODOLOGY_VERSION + 1 })
    expect(shouldPublish(prev(), bumped, NOW + 1 * H)).toBe(false)
    expect(shouldPublish(prev(), bumped, NOW + 6 * H)).toBe(true)
    expect(shouldPublish(prev({ lastRank: 5, lastStatus: 'offline' }), bumped, NOW + 6 * H)).toBe(true)
  })

  it('an unchanged mint publishes only at the 24 hour hard refresh', () => {
    const p = prev()
    expect(shouldPublish(p, next(), NOW + 6 * H)).toBe(false)
    expect(shouldPublish(p, next(), NOW + 23 * H)).toBe(false)
    expect(shouldPublish(p, next(), NOW + 24 * H - 1)).toBe(false)
    expect(shouldPublish(p, next(), NOW + 24 * H)).toBe(true)
    expect(shouldPublish(p, next(), NOW + 40 * H)).toBe(true)
  })

  it('the 24 hour refresh keeps the 48 hour expiration from lapsing', () => {
    expect(ATTESTATION_REFRESH_MS * 2).toBeLessThanOrEqual(ATTESTATION_EXPIRY_S * 1000)
  })
})

describe('publishReason (state changes skip the 6 hour minimum)', () => {
  const H = 3_600_000
  const MIN = 60_000
  const prev = (over: Partial<PublishedState> = {}): PublishedState => ({
    lastCreatedAt: Math.floor(NOW / 1000), lastRank: 80, lastStatus: 'online', lastMethodology: METHODOLOGY_VERSION, ...over,
  })
  const next = (over: Partial<{ rank: number; status: string; methodology: number }> = {}) => ({
    rank: 80, status: 'online', methodology: METHODOLOGY_VERSION, ...over,
  })

  it('never published: first', () => {
    expect(publishReason(null, next(), NOW)).toBe('first')
  })
  it('a status change publishes after 5 minutes, not before, and long before the 6 hours', () => {
    expect(publishReason(prev(), next({ status: 'degraded' }), NOW + 5 * MIN - 1)).toBeNull()
    expect(publishReason(prev(), next({ status: 'degraded' }), NOW + 5 * MIN)).toBe('state-change')
    expect(publishReason(prev(), next({ status: 'offline' }), NOW + 15 * MIN)).toBe('state-change')
    expect(publishReason(prev(), next({ status: 'offline' }), NOW + 6 * H - 1)).toBe('state-change')
  })
  it('after the 6 hours a status change is the periodic rule, as before', () => {
    expect(publishReason(prev(), next({ status: 'offline' }), NOW + 6 * H)).toBe('periodic')
  })
  it('nothing else is faster: a rank change or a methodology bump inside the 6 hours waits', () => {
    expect(publishReason(prev(), next({ rank: 10 }), NOW + 3 * H)).toBeNull()
    expect(publishReason(prev(), next({ methodology: METHODOLOGY_VERSION + 1 }), NOW + 3 * H)).toBeNull()
    expect(publishReason(prev(), next(), NOW + 3 * H)).toBeNull()
  })
  it('periodic rules are exactly shouldPublish', () => {
    for (const at of [6 * H, 7 * H, 23 * H, 24 * H, 40 * H]) {
      for (const n of [next(), next({ rank: 90 }), next({ status: 'offline' })]) {
        const expected = shouldPublish(prev(), n, NOW + at)
        expect(publishReason(prev(), n, NOW + at) === 'periodic').toBe(expected)
      }
    }
  })
})

describe('profile (kind 0)', () => {
  it('has exactly the agreed fields, the site logo as picture and no banner', () => {
    const t = buildProfileTemplate(NOW)
    expect(t.kind).toBe(0)
    expect(t.tags).toEqual([])
    expect(t.created_at).toBe(Math.floor(NOW / 1000))
    const profile = JSON.parse(t.content) as Record<string, string>
    expect(profile).toEqual({
      name: 'MintRadar Health',
      display_name: 'MintRadar Health',
      about: 'Operational health signals for Cashu mints, computed by MintRadar. Not solvency, not advice. Method: https://mintradar.org/methodology',
      website: 'https://mintradar.org',
      nip05: 'health@mintradar.org',
      picture: ATTESTATION_PROFILE_PICTURE_URL,
    })
    expect(profile['picture']).toBe('https://mintradar.org/icons/icon-512x512.png')
    expect(profile).not.toHaveProperty('banner')
    expect(ATTESTATION_PROFILE.nip05).toBe('health@mintradar.org')
  })

  it('keeps the fields before the picture byte-for-byte as published before', () => {
    const before = JSON.stringify({
      name: 'MintRadar Health', display_name: 'MintRadar Health',
      about: 'Operational health signals for Cashu mints, computed by MintRadar. Not solvency, not advice. Method: https://mintradar.org/methodology',
      website: 'https://mintradar.org', nip05: 'health@mintradar.org',
    })
    expect(buildProfileTemplate(NOW).content).toBe(before.slice(0, -1) + `,"picture":${JSON.stringify(ATTESTATION_PROFILE_PICTURE_URL)}}`)
  })

  it('the picture is an https URL on mintradar.org', () => {
    const u = new URL(ATTESTATION_PROFILE_PICTURE_URL)
    expect(u.protocol).toBe('https:')
    expect(u.hostname).toBe('mintradar.org')
    expect(u.search).toBe('')
    expect(u.hash).toBe('')
    expect(ATTESTATION_PROFILE_PICTURE_URL.startsWith('data:')).toBe(false)
  })

  it('the picture file exists in public/ and is a square PNG of at least 256 px under 150 KB', () => {
    const rel = new URL(ATTESTATION_PROFILE_PICTURE_URL).pathname.replace(/^\//, '')
    const bytes = readFileSync(resolve(__dirname, '../../../public', rel))
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a') // PNG signature
    expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR')
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    expect(width).toBe(height)
    expect(width).toBeGreaterThanOrEqual(256)
    expect(bytes.length).toBeLessThan(150 * 1024)
  })

  it('the signed profile event verifies with a throwaway key', () => {
    const sk = generateSecretKey()
    const signed = finalizeEvent(buildProfileTemplate(NOW), sk)
    expect(verifyEvent(signed)).toBe(true)
    expect(signed.kind).toBe(0)
    expect(signed.pubkey).toBe(getPublicKey(sk))
    expect((JSON.parse(signed.content) as Record<string, string>)['picture']).toBe(ATTESTATION_PROFILE_PICTURE_URL)
  })
})

describe('wording rules', () => {
  it('the texts we write never use the forbidden claims', () => {
    const texts = [HEALTH_CONTENT, JSON.stringify(ATTESTATION_PROFILE)].join(' ')
    expect(texts).not.toMatch(/\b(safe|secure|trusted|guaranteed|recommended|first|only)\b/i)
  })
})

describe('resolveAttestationKey', () => {
  function logs() {
    const lines: string[] = []
    return { lines, log: { info: (l: string) => { lines.push(`info:${l}`) }, error: (l: string) => { lines.push(`error:${l}`) } } }
  }

  it('missing, empty and blank values disable the feature with exactly one info line', () => {
    for (const raw of [undefined, '', '   ']) {
      const { lines, log } = logs()
      expect(resolveAttestationKey(raw, undefined, log)).toBeNull()
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/^info:\[attestations\] disabled: no signing key is configured$/)
    }
  })

  it('an invalid value disables the feature with exactly one error line and no key material', () => {
    const sk = generateSecretKey()
    const npub = nip19.npubEncode(getPublicKey(sk))
    const garbage = ['not-a-key', 'nsec1invalid', npub, bytesToHex(sk), nip19.nsecEncode(sk).slice(0, -3)]
    for (const raw of garbage) {
      const { lines, log } = logs()
      expect(resolveAttestationKey(raw, undefined, log)).toBeNull()
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/^error:\[attestations\] disabled: the configured signing key is not a valid nsec$/)
      expect(lines[0]).not.toContain(raw)
    }
  })

  it('a valid nsec of the wrong identity disables the feature with one error line and no key material', () => {
    const sk = generateSecretKey()
    const nsec = nip19.nsecEncode(sk)
    const { lines, log } = logs()
    expect(resolveAttestationKey(nsec, ATTESTATION_PUBKEY_HEX, log)).toBeNull() // the throwaway key is not the real one
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^error:\[attestations\] disabled: the configured signing key does not match the attestation public key$/)
    const out = lines.join('\n')
    expect(out).not.toContain(nsec)
    expect(out).not.toContain(nsec.slice(5, 25))
    expect(out).not.toContain(bytesToHex(sk))
    expect(out).not.toContain(getPublicKey(sk))
  })

  it('the right key is returned and nothing is logged', () => {
    const sk = generateSecretKey()
    const { lines, log } = logs()
    const got = resolveAttestationKey(nip19.nsecEncode(sk), getPublicKey(sk), log)
    expect(got).not.toBeNull()
    expect(bytesToHex(got!)).toBe(bytesToHex(sk))
    expect(lines).toEqual([])
  })
})
