import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools'
import type { Event as NostrEvent } from 'nostr-tools'
import { healthIdentifier, buildHealthEvent, ATTESTATION_PUBKEY_HEX, ATTESTATION_RELAYS, type HealthInput } from '../healthAssertions.js'
import { normalizeUrl } from '../discovery.js'
import { HEALTH_URL_TABLE } from './healthUrlTable.js'
// The example for wallet developers (dependency-light ESM, docs/examples/verify-health.mjs).
// @ts-expect-error plain JavaScript module outside the backend's TypeScript root; tests are not type-checked
import * as example from '../../../docs/examples/verify-health.mjs'

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0)
const nowS = Math.floor(NOW / 1000)
const sk = generateSecretKey()
const pk = getPublicKey(sk)

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    url: 'https://mint.example.com', status: 'online', score: 91, uptime24hPct: 100, uptime7dPct: 100, software: 'Nutshell/0.17.5',
    outdated: false, isTest: false, scoreCappedNew: false, audit: null, lastCheckedAt: new Date(NOW - 60_000).toISOString(), now: NOW, ...over,
  }
}
const sign = (over: Partial<HealthInput> = {}, key = sk): NostrEvent => finalizeEvent(buildHealthEvent(input(over))!, key)
const opts = { mintUrl: 'https://mint.example.com', pubkey: pk, now: nowS }

describe('the example normalisation equals the backend', () => {
  it.each(HEALTH_URL_TABLE)('%s', (raw, expected) => {
    expect(example.normalizeMintUrl(raw)).toBe(expected)
    expect(example.normalizeMintUrl(raw)).toBe(healthIdentifier(raw))
  })

  it('equals backend normalizeUrl for every URL without a fragment', () => {
    for (const [raw] of HEALTH_URL_TABLE.filter(([r]) => !r.includes('#'))) expect(example.normalizeMintUrl(raw)).toBe(normalizeUrl(raw))
  })
})

describe('the example constants equal the backend', () => {
  it('pins the same key and queries the same four relays', () => {
    expect(example.PINNED_PUBKEY).toBe(ATTESTATION_PUBKEY_HEX)
    expect(example.RELAYS).toEqual([...ATTESTATION_RELAYS])
    expect(example.KIND).toBe(30385)
  })
})

describe('verifyHealthEvent on events produced by the builder (no network)', () => {
  it('accepts a good event and reads the fields', () => {
    const res = example.verifyHealthEvent(sign(), opts)
    expect(res.ok).toBe(true)
    expect(res.health).toMatchObject({ rank: 91, status: 'online', isTest: false, newMintCapped: false, methodologyUrl: 'https://mintradar.org/methodology' })
    expect(res.health.expiration).toBe(nowS + 172_800)
  })

  it('accepts the mint URL in any equivalent spelling', () => {
    for (const url of ['https://MINT.example.com/', 'http://mint.example.com:443', 'https://mint.example.com/#x']) {
      expect(example.verifyHealthEvent(sign(), { ...opts, mintUrl: url }).ok).toBe(true)
    }
  })

  it('rejects an event signed by another key than the pinned one', () => {
    const other = generateSecretKey()
    expect(example.verifyHealthEvent(sign({}, other), opts)).toEqual({ ok: false, reason: 'not signed by the pinned key' })
    // and with the default pinned key (the real one) the throwaway key is not accepted either
    expect(example.verifyHealthEvent(sign(), { mintUrl: opts.mintUrl, now: nowS }).reason).toBe('not signed by the pinned key')
  })

  it('rejects a tampered event', () => {
    const e = JSON.parse(JSON.stringify(sign())) as NostrEvent
    e.tags = e.tags.map(t => (t[0] === 'rank' ? ['rank', '1'] : t))
    expect(example.verifyHealthEvent(e, opts)).toEqual({ ok: false, reason: 'bad signature or id' })
  })

  it('rejects the event of another mint', () => {
    expect(example.verifyHealthEvent(sign({ url: 'https://other.example.com' }), opts)).toEqual({ ok: false, reason: 'd does not match the mint URL' })
  })

  it('rejects an expired event and one created in the future', () => {
    expect(example.verifyHealthEvent(sign(), { ...opts, now: nowS + 172_800 })).toEqual({ ok: false, reason: 'expired' })
    expect(example.verifyHealthEvent(sign(), { ...opts, now: nowS + 172_799 }).ok).toBe(true)
    expect(example.verifyHealthEvent(sign(), { ...opts, now: nowS - 301 })).toEqual({ ok: false, reason: 'created_at in the future' })
  })

  it('rejects a wrong kind, a missing expiration and a bad rank', () => {
    const base = buildHealthEvent(input())!
    const wrongKind = finalizeEvent({ ...base, kind: 1 }, sk)
    expect(example.verifyHealthEvent(wrongKind, opts).reason).toBe('wrong kind')
    const noExp = finalizeEvent({ ...base, tags: base.tags.filter(t => t[0] !== 'expiration') }, sk)
    expect(example.verifyHealthEvent(noExp, opts).reason).toBe('no expiration')
    const badRank = finalizeEvent({ ...base, tags: base.tags.map(t => (t[0] === 'rank' ? ['rank', '101'] : t)) }, sk)
    expect(example.verifyHealthEvent(badRank, opts).reason).toBe('rank is not an integer from 0 to 100')
    const noK = finalizeEvent({ ...base, tags: base.tags.filter(t => t[0] !== 'k') }, sk)
    expect(example.verifyHealthEvent(noK, opts).reason).toBe('k is not "web"')
  })

  it('rejects garbage input without throwing', () => {
    for (const bad of [null, undefined, 'x', 5, {}, { tags: 'no' }]) expect(example.verifyHealthEvent(bad, opts).ok).toBe(false)
  })
})

describe('pickNewest', () => {
  it('returns the newest valid event and ignores newer invalid ones', () => {
    const older = finalizeEvent({ ...buildHealthEvent(input({ now: NOW - 3_600_000 }))! }, sk)
    const newer = finalizeEvent({ ...buildHealthEvent(input({ now: NOW - 60_000, score: 40 }))! }, sk)
    const forged = finalizeEvent({ ...buildHealthEvent(input({ now: NOW - 1000, score: 5 }))! }, generateSecretKey())
    const picked = example.pickNewest([older, forged, newer], opts)
    expect(picked.event.id).toBe(newer.id)
    expect(picked.health.rank).toBe(40)
  })

  it('returns null when nothing is valid or the list is empty', () => {
    expect(example.pickNewest([], opts)).toBeNull()
    expect(example.pickNewest([sign({}, generateSecretKey())], opts)).toBeNull()
  })
})

describe('fetchHealth uses the documented filter (stub pool, no network)', () => {
  it('queries the four relays with kinds, authors, #d and limit 5, closes the pool and returns the newest valid event', async () => {
    const calls: Array<{ relays: string[]; filter: unknown }> = []
    const closed: string[][] = []
    const event = sign()
    const pool = {
      querySync: async (relays: string[], filter: unknown) => { calls.push({ relays, filter }); return [event] },
      close: (relays: string[]) => { closed.push(relays) },
    }
    const found = await example.fetchHealth('https://MINT.example.com/', { pool, pubkey: pk, now: nowS })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.relays).toEqual([...ATTESTATION_RELAYS])
    expect(calls[0]!.filter).toEqual({ kinds: [30385], authors: [pk], '#d': ['https://mint.example.com'], limit: 5 })
    expect(closed).toHaveLength(1)
    expect(found.event.id).toBe(event.id)
    expect(found.health.rank).toBe(91)
  })
})
