import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { pickNewestProfileEvents } from '@/core/nostr/profileEvents'

// Only a kind:0 event with a valid signature from a requested pubkey counts; per pubkey the newest one wins.

const skA = generateSecretKey()
const skB = generateSecretKey()
const pkA = getPublicKey(skA)
const pkB = getPublicKey(skB)

const profile = (sk: Uint8Array, name: string, createdAt: number, kind = 0): NostrEvent =>
  finalizeEvent({ kind, created_at: createdAt, tags: [], content: JSON.stringify({ name }) }, sk)

// What arrives from a relay is plain JSON. A spread copy of a finalizeEvent() result would also copy nostr-tools'
// internal "already verified" symbol, so the forged copy is built field by field.
const withContent = (ev: NostrEvent, meta: object): NostrEvent => ({
  id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, sig: ev.sig,
  content: JSON.stringify(meta),
})

describe('pickNewestProfileEvents', () => {
  it('uses a valid profile of a requested pubkey', () => {
    const ev = profile(skA, 'alice', 100)
    expect(pickNewestProfileEvents([ev], new Set([pkA])).get(pkA)).toBe(ev)
  })

  it('ignores an event whose content was changed after signing', () => {
    const ev = withContent(profile(skA, 'alice', 100), { name: 'mallory' })
    expect(pickNewestProfileEvents([ev], new Set([pkA])).size).toBe(0)
  })

  it('ignores a validly signed event of a pubkey that was not requested', () => {
    const ev = profile(skB, 'bob', 100)
    expect(pickNewestProfileEvents([ev], new Set([pkA])).size).toBe(0)
  })

  it('ignores an event of another kind', () => {
    const ev = profile(skA, 'alice', 100, 1)
    expect(pickNewestProfileEvents([ev], new Set([pkA])).size).toBe(0)
  })

  it('keeps the newer of two valid events whatever the arrival order', () => {
    const older = profile(skA, 'old', 100)
    const newer = profile(skA, 'new', 200)
    expect(pickNewestProfileEvents([older, newer], new Set([pkA])).get(pkA)).toBe(newer)
    expect(pickNewestProfileEvents([newer, older], new Set([pkA])).get(pkA)).toBe(newer)
  })

  it('a forged newer event does not displace a valid older one', () => {
    const older = profile(skA, 'old', 100)
    const forged = withContent(profile(skA, 'new', 200), { name: 'forged' })
    expect(pickNewestProfileEvents([older, forged], new Set([pkA])).get(pkA)).toBe(older)
  })

  it('resolves several requested pubkeys independently', () => {
    const a = profile(skA, 'alice', 100)
    const b = profile(skB, 'bob', 100)
    const got = pickNewestProfileEvents([a, b], new Set([pkA, pkB]))
    expect([...got.keys()].sort()).toEqual([pkA, pkB].sort())
  })
})
