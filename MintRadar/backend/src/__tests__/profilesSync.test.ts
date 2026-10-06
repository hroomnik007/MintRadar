import { describe, it, expect, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type Event as NostrEvent } from 'nostr-tools'

vi.mock('../db.js', () => ({ pool: { connect: vi.fn(), query: vi.fn() }, initDb: vi.fn() }))

import {
  PROFILE_FALLBACK_RELAY,
  PROFILE_PRIMARY_RELAY,
  cleanProfileName,
  cleanProfileNip05,
  contactKeysOf,
  parseProfileContent,
  pickNewestProfileEvents,
  profileFieldsForReview,
  runProfilesSync,
  selectAuthorsToFetch,
  type FoundProfileRow,
  type ProfilesSyncDeps,
  type StoredProfileState,
} from '../profilesSync.js'
import type { ConnectRelay, ProfileFilter, RelayConnection, RelayQueryResult } from '../reviewsRelayFetch.js'

const NOW_MS = 1_800_000_000_000
const NOW_S = NOW_MS / 1000
const DAY = 86_400
const key = (n: number) => n.toString(16).padStart(64, '0')

describe('selectAuthorsToFetch', () => {
  const rows = new Map<string, StoredProfileState>([
    [key(1), { fetchedAt: NOW_S - 8 * DAY, found: true }], // stale found
    [key(2), { fetchedAt: NOW_S - 6 * DAY, found: true }], // fresh found
    [key(3), { fetchedAt: NOW_S - 25 * 3600, found: false }], // not-found cache expired
    [key(4), { fetchedAt: NOW_S - 23 * 3600, found: false }], // not-found cache active
  ])

  it('takes authors with no row and due rows, skips fresh ones, missing first', () => {
    const out = selectAuthorsToFetch([key(1), key(2), key(3), key(4), key(5)], rows, NOW_S)
    expect(out).toEqual([key(5), key(1), key(3)])
  })

  it('caps the selection at 200 and prefers authors with no row', () => {
    const many = Array.from({ length: 300 }, (_, i) => key(1000 + i))
    const out = selectAuthorsToFetch([key(1), ...many], rows, NOW_S)
    expect(out).toHaveLength(200)
    expect(out).not.toContain(key(1))
  })

  it('ignores keys that are not 64 lowercase hex characters', () => {
    expect(selectAuthorsToFetch(['npub1xyz', key(0xabc).toUpperCase(), key(9)], new Map(), NOW_S)).toEqual([key(9)])
  })
})

describe('cleaning and parsing', () => {
  it('removes control, zero-width and bidi characters, collapses whitespace, normalises to NFC', () => {
    const hostile = '  Al‮ice​\u0000 \n\t  ⁦Smith⁩﻿ é '
    expect(cleanProfileName(hostile)).toBe('Alice Smith é')
  })

  it('caps names at 48 grapheme clusters, not code units', () => {
    const out = cleanProfileName('👨‍👩‍👧'.repeat(10) + 'x'.repeat(60))!
    expect([...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(out)]).toHaveLength(48)
    expect(cleanProfileName('x'.repeat(48))).toHaveLength(48)
    expect(cleanProfileName('x'.repeat(49))).toHaveLength(48)
  })

  it('returns null for non-strings and empty results', () => {
    for (const v of [undefined, null, 42, {}, ['a'], '', '   ', '​‮']) expect(cleanProfileName(v)).toBeNull()
  })

  it('removes lone surrogates', () => {
    expect(cleanProfileName('a\uD800b')).toBe('ab')
  })

  it('accepts name@domain and domain, drops everything else', () => {
    expect(cleanProfileNip05('alice@example.com')).toBe('alice@example.com')
    expect(cleanProfileNip05('_@example.com')).toBe('_@example.com')
    expect(cleanProfileNip05('example.com')).toBe('example.com')
    for (const bad of ['alice', 'a@b@c.com', '@example.com', 'alice@', 'alice@localhost', 'a b@example.com', 'javascript:alert(1)', 'http://example.com', 'alice@example.com/x', 5, null]) {
      expect(cleanProfileNip05(bad)).toBeNull()
    }
  })

  it('drops (does not cut) a nip05 longer than 100 characters', () => {
    expect(cleanProfileNip05(`${'a'.repeat(60)}@${'b'.repeat(20)}.example.com`)).not.toBeNull()
    expect(cleanProfileNip05(`${'a'.repeat(64)}@${'b'.repeat(40)}.example.com`)).toBeNull()
  })

  it('reads only name, display_name and nip05', () => {
    const p = parseProfileContent(JSON.stringify({ name: 'al', display_name: 'Alice', nip05: 'al@example.com', picture: 'https://x/y.png', about: 'hi', website: 'https://z' }))
    expect(p).toEqual({ name: 'al', displayName: 'Alice', nip05: 'al@example.com' })
  })

  it('ignores fields of the wrong type and missing fields', () => {
    expect(parseProfileContent(JSON.stringify({ name: 5, display_name: ['x'], nip05: { a: 1 } }))).toEqual({ name: null, displayName: null, nip05: null })
    expect(parseProfileContent('{}')).toEqual({ name: null, displayName: null, nip05: null })
  })

  it('rejects content of 8 KB or more, non-JSON and non-objects', () => {
    expect(parseProfileContent(JSON.stringify({ name: 'a', about: 'x'.repeat(8192) }))).toBeNull()
    const justUnder = JSON.stringify({ name: 'a', about: 'x'.repeat(8100) })
    expect(parseProfileContent(justUnder)).toMatchObject({ name: 'a' })
    for (const c of ['not json', '[]', 'null', '"str"', '42', undefined, 7]) expect(parseProfileContent(c)).toBeNull()
  })
})

describe('pickNewestProfileEvents', () => {
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)
  const ev = (content: string, created_at: number, kind = 0, secret = sk) => finalizeEvent({ kind, created_at, tags: [], content }, secret)
  const roundTrip = (e: NostrEvent) => JSON.parse(JSON.stringify(e)) as NostrEvent // drops nostr-tools' "already verified" marker

  it('keeps the highest created_at per author', () => {
    const out = pickNewestProfileEvents([ev('{"name":"old"}', 100), ev('{"name":"new"}', 300), ev('{"name":"mid"}', 200)].map(roundTrip), new Set([pk]))
    expect(JSON.parse(out.get(pk)!.content)).toEqual({ name: 'new' })
  })

  it('drops a bad signature, a wrong kind and an author that was not asked for', () => {
    const forged = roundTrip(ev('{"name":"real"}', 500))
    forged.content = '{"name":"forged"}'
    const other = generateSecretKey()
    const out = pickNewestProfileEvents(
      [forged, roundTrip(ev('{"name":"k1"}', 600, 1)), roundTrip(ev('{"name":"x"}', 700, 0, other))],
      new Set([pk]),
    )
    expect(out.size).toBe(0)
  })

  it('a newer forged event does not displace a valid older one', () => {
    const good = roundTrip(ev('{"name":"good"}', 100))
    const forged = roundTrip(ev('{"name":"real"}', 900))
    forged.content = '{"name":"evil"}'
    const out = pickNewestProfileEvents([good, forged], new Set([pk]))
    expect(JSON.parse(out.get(pk)!.content)).toEqual({ name: 'good' })
  })
})

describe('contactKeysOf', () => {
  const hex = key(77)
  it('reads hex, npub and nprofile, ignores NIP-05 and junk, at most 3 entries', () => {
    const npub = nip19.npubEncode(hex)
    const nprofile = nip19.nprofileEncode({ pubkey: key(78) })
    expect(contactKeysOf([`nostr:${npub}`, 'alice@example.com', nprofile, hex, key(79)])).toEqual([hex, key(78)])
    expect(contactKeysOf(null)).toEqual([])
    expect(contactKeysOf([5, 'x'.repeat(400)])).toEqual([])
  })
})

describe('profileFieldsForReview', () => {
  it('display_name wins over name; nothing unless found', () => {
    expect(profileFieldsForReview({ found: true, name: 'al', display_name: 'Alice', nip05: 'a@b.co' })).toEqual({ authorName: 'Alice', authorNip05: 'a@b.co' })
    expect(profileFieldsForReview({ found: true, name: 'al', display_name: null, nip05: null })).toEqual({ authorName: 'al' })
    expect(profileFieldsForReview({ found: false, name: 'al' })).toEqual({})
    expect(profileFieldsForReview({})).toEqual({})
  })
})

// ── the run ────────────────────────────────────────────────────────────────────────────────

interface RelayStub { events?: NostrEvent[]; fail?: 'connect' | RelayQueryResult }

function profileEvent(sk: Uint8Array, content: Record<string, unknown>, created_at = NOW_S - 1000): NostrEvent {
  return JSON.parse(JSON.stringify(finalizeEvent({ kind: 0, created_at, tags: [], content: JSON.stringify(content) }, sk))) as NostrEvent
}

function harness(stubs: Record<string, RelayStub>, candidates: string[], rows: Record<string, StoredProfileState> = {}, over: Partial<ProfilesSyncDeps> = {}) {
  const requests: Array<{ relay: string; filter: ProfileFilter; at: number }> = []
  const connects: string[] = []
  const sleeps: number[] = []
  let clock = NOW_MS
  const saved: { found: FoundProfileRow[]; notFound: string[]; fetchedAt: number }[] = []
  const cleanups: Array<{ keep: ReadonlySet<string>; olderThan: number }> = []
  const logs: string[] = []
  const connect: ConnectRelay = async relay => {
    connects.push(relay)
    const stub = stubs[relay]!
    if (stub.fail === 'connect') throw new Error('connect')
    const conn: RelayConnection = {
      async query(f) {
        const filter = f as ProfileFilter
        requests.push({ relay, filter, at: clock })
        if (stub.fail) return stub.fail
        return { status: 'ok', events: (stub.events ?? []).filter(e => filter.authors.includes(e.pubkey)) }
      },
      close() {},
    }
    return conn
  }
  const deps: ProfilesSyncDeps = {
    primaryRelay: PROFILE_PRIMARY_RELAY,
    fallbackRelay: PROFILE_FALLBACK_RELAY,
    loadCandidates: async () => new Set(candidates),
    loadRows: async () => new Map(Object.entries(rows)),
    save: async (found, notFound, fetchedAt) => { saved.push({ found, notFound, fetchedAt }) },
    cleanup: async (keep, olderThan) => { cleanups.push({ keep, olderThan }); return 0 },
    connect,
    now: () => clock,
    sleep: async ms => { sleeps.push(ms); clock += ms },
    random: () => 0.5,
    log: l => logs.push(l),
    deadlineMs: NOW_MS + 10 * 60 * 1000,
    ...over,
  }
  return { deps, requests, connects, sleeps, saved, cleanups, logs }
}

describe('runProfilesSync', () => {
  const alice = generateSecretKey()
  const bob = generateSecretKey()
  const carol = generateSecretKey()
  const A = getPublicKey(alice)
  const B = getPublicKey(bob)
  const C = getPublicKey(carol)

  it('asks the primary, then the fallback only for authors still not found, and stores found / not found', async () => {
    const h = harness(
      {
        [PROFILE_PRIMARY_RELAY]: { events: [profileEvent(alice, { name: 'alice', picture: 'https://x/a.png', about: 'secret' })] },
        [PROFILE_FALLBACK_RELAY]: { events: [profileEvent(bob, { display_name: 'Bob', nip05: 'bob@example.com' })] },
      },
      [A, B, C],
    )
    const s = await runProfilesSync(h.deps)
    expect(h.requests.map(r => [r.relay, [...r.filter.authors].sort()])).toEqual([
      [PROFILE_PRIMARY_RELAY, [A, B, C].sort()],
      [PROFILE_FALLBACK_RELAY, [B, C].sort()],
    ])
    expect(h.requests.every(r => r.filter.kinds.length === 1 && r.filter.kinds[0] === 0)).toBe(true)
    expect(h.saved).toHaveLength(1)
    const byKey = new Map(h.saved[0]!.found.map(f => [f.pubkey, f]))
    expect(byKey.get(A)).toMatchObject({ name: 'alice', displayName: null, nip05: null })
    expect(byKey.get(B)).toMatchObject({ name: null, displayName: 'Bob', nip05: 'bob@example.com' })
    expect(Object.keys(byKey.get(A)!).sort()).toEqual(['displayName', 'eventCreatedAt', 'name', 'nip05', 'pubkey'])
    expect(h.saved[0]!.notFound).toEqual([C])
    expect(h.saved[0]!.fetchedAt).toBe(NOW_S)
    expect(s).toMatchObject({ selected: 3, found: 2, notFound: 1, reqs: 2 })
    expect(h.logs).toHaveLength(1)
    expect(h.logs[0]).toMatch(/^\[profiles-sync\] done: selected=3 found=2 not_found=1 reqs=2 /)
    expect(h.logs[0]).not.toContain(A)
    expect(h.logs[0]).not.toContain('alice')
  })

  it('batches 50 authors per REQ, one REQ at a time, 1 to 2 s apart, at most 8 REQs over both relays', async () => {
    const many = Array.from({ length: 200 }, (_, i) => key(5000 + i))
    const h = harness({ [PROFILE_PRIMARY_RELAY]: {}, [PROFILE_FALLBACK_RELAY]: {} }, many)
    const s = await runProfilesSync(h.deps)
    expect(h.requests.map(r => [r.relay === PROFILE_PRIMARY_RELAY ? 'primary' : 'fallback', r.filter.authors.length])).toEqual([
      ['primary', 50], ['primary', 50], ['primary', 50], ['primary', 50],
      ['fallback', 50], ['fallback', 50], ['fallback', 50], ['fallback', 50],
    ])
    expect(s.reqs).toBe(8)
    expect(h.connects).toEqual([PROFILE_PRIMARY_RELAY, PROFILE_FALLBACK_RELAY]) // one connection per relay
    expect(h.sleeps).toHaveLength(6) // between batches of one relay only
    for (const ms of h.sleeps) { expect(ms).toBeGreaterThanOrEqual(1000); expect(ms).toBeLessThanOrEqual(2000) }
    expect(s.notFound).toBe(200)
  })

  it('never sends more than 8 REQs even when configured batches would need more', async () => {
    const many = Array.from({ length: 200 }, (_, i) => key(9000 + i))
    const h = harness({ [PROFILE_PRIMARY_RELAY]: {}, [PROFILE_FALLBACK_RELAY]: {} }, many, {}, { config: { batchSize: 10 } })
    const s = await runProfilesSync(h.deps)
    expect(s.reqs).toBe(8)
    expect(h.requests).toHaveLength(8)
  })

  it('skips fresh rows and does nothing (no connection) when nobody is due', async () => {
    const h = harness({ [PROFILE_PRIMARY_RELAY]: {}, [PROFILE_FALLBACK_RELAY]: {} }, [A], { [A]: { fetchedAt: NOW_S - 100, found: true } })
    const s = await runProfilesSync(h.deps)
    expect(h.connects).toEqual([])
    expect(h.saved).toEqual([])
    expect(s).toMatchObject({ selected: 0, reqs: 0 })
    expect(h.cleanups).toHaveLength(1)
  })

  it('does not mark authors not found when no relay answered for them', async () => {
    const h = harness({ [PROFILE_PRIMARY_RELAY]: { fail: 'connect' }, [PROFILE_FALLBACK_RELAY]: { fail: { status: 'failed', reason: 'timeout' } } }, [A, B])
    const s = await runProfilesSync(h.deps)
    expect(h.saved).toEqual([])
    expect(s).toMatchObject({ selected: 2, found: 0, notFound: 0, relaysFailed: 2 })
  })

  it('backs off a relay that pushes back: no further REQs to it, authors go to the fallback', async () => {
    const many = Array.from({ length: 120 }, (_, i) => key(7000 + i))
    const h = harness(
      { [PROFILE_PRIMARY_RELAY]: { fail: { status: 'blocked', reason: 'closed-pushback' } }, [PROFILE_FALLBACK_RELAY]: {} },
      many,
    )
    const s = await runProfilesSync(h.deps)
    expect(h.requests.filter(r => r.relay === PROFILE_PRIMARY_RELAY)).toHaveLength(1)
    expect(h.requests.filter(r => r.relay === PROFILE_FALLBACK_RELAY).length).toBeGreaterThan(0)
    expect(s.relaysFailed).toBe(1)
  })

  it('stops a relay after 3 failed batches in a row', async () => {
    const many = Array.from({ length: 200 }, (_, i) => key(3000 + i))
    const h = harness({ [PROFILE_PRIMARY_RELAY]: { fail: { status: 'failed', reason: 'timeout' } }, [PROFILE_FALLBACK_RELAY]: { fail: 'connect' } }, many)
    await runProfilesSync(h.deps)
    expect(h.requests.filter(r => r.relay === PROFILE_PRIMARY_RELAY)).toHaveLength(3)
  })

  it('stops at the deadline (the reviews sync maximum run time)', async () => {
    const many = Array.from({ length: 200 }, (_, i) => key(4000 + i))
    const h = harness({ [PROFILE_PRIMARY_RELAY]: {}, [PROFILE_FALLBACK_RELAY]: {} }, many, {}, { deadlineMs: NOW_MS + 2500 })
    const s = await runProfilesSync(h.deps)
    expect(s.reqs).toBeLessThan(8)
    expect(s.reqs).toBeGreaterThan(0)
  })

  it('an unusable (oversized) newest event is stored as found with no fields', async () => {
    const h = harness({ [PROFILE_PRIMARY_RELAY]: { events: [profileEvent(alice, { name: 'a', about: 'x'.repeat(9000) })] }, [PROFILE_FALLBACK_RELAY]: {} }, [A])
    await runProfilesSync(h.deps)
    expect(h.saved[0]!.found[0]).toMatchObject({ pubkey: A, name: null, displayName: null, nip05: null })
  })

  it('cleans up rows of authors that are no candidates any more after 30 days', async () => {
    const h = harness({ [PROFILE_PRIMARY_RELAY]: {}, [PROFILE_FALLBACK_RELAY]: {} }, [A])
    await runProfilesSync(h.deps)
    expect(h.cleanups).toHaveLength(1)
    expect([...h.cleanups[0]!.keep]).toEqual([A])
    expect(h.cleanups[0]!.olderThan).toBe(NOW_S - 30 * DAY)
  })

  it('never throws: a database error is logged and the run still ends with one summary line', async () => {
    const h = harness({ [PROFILE_PRIMARY_RELAY]: {}, [PROFILE_FALLBACK_RELAY]: {} }, [A], {}, { loadRows: async () => { throw new Error('db down') } })
    await expect(runProfilesSync(h.deps)).resolves.toMatchObject({ selected: 0 })
    expect(h.logs.some(l => l.includes('db down'))).toBe(true)
  })
})
