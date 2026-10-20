import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'

// The login readers in client.ts (fetchNostrProfile = subscribeFirstEvent, and bootstrapUserData for kind 0 and kind 10002)
// act on the FIRST VALID event: right kind, signed by the requested pubkey, valid signature. They never wait for slower
// relays, and a rejected event is ignored silently and does not end or consume the subscription. Unlike
// bootstrapUserData.test.ts, verifyEvent is NOT mocked here: events are really signed and really verified.

interface RelayHandlers {
  onevent: (ev: unknown) => void
  oneose: () => void
  onclose: () => void
}
let handlers: RelayHandlers
const close = vi.fn()
const { subscribeMany } = vi.hoisted(() => ({ subscribeMany: vi.fn() }))

vi.mock('nostr-tools/nip46', () => ({
  BunkerSigner: class {},
  parseBunkerInput: vi.fn(),
  createNostrConnectURI: vi.fn(),
  toBunkerURL: vi.fn(),
}))
vi.mock('nostr-tools/pool', () => ({ SimplePool: class {} }))
vi.mock('@/core/nostr/pool', () => ({ sharedPool: { subscribeMany } }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: { getState: vi.fn() } }))

import { bootstrapUserData, fetchNostrProfile } from '@/core/nostr/client'
import { useAuthStore } from '@/stores/auth.store'

const sk = generateSecretKey()
const skOther = generateSecretKey()
const PK = getPublicKey(sk)

const updateProfileMeta = vi.fn()
const setNip65Relays = vi.fn()

// What arrives from a relay is plain JSON without nostr-tools' internal "already verified" marker.
const wire = (ev: NostrEvent): NostrEvent => JSON.parse(JSON.stringify(ev)) as NostrEvent
// A forged copy is built field by field: a {...ev} spread would carry the marker (and so the verdict) along.
const forged = (ev: NostrEvent, content: string, tags: string[][] = ev.tags): NostrEvent => ({
  id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, sig: ev.sig, tags, content,
})
const profile = (name: string, secret = sk, kind = 0) =>
  wire(finalizeEvent({ kind, created_at: 1_700_000_000, tags: [], content: JSON.stringify({ name }) }, secret))
const relayList = (url: string, secret = sk, kind = 10002) =>
  wire(finalizeEvent({ kind, created_at: 1_700_000_000, tags: [['r', url]], content: '' }, secret))

beforeEach(() => {
  close.mockReset()
  subscribeMany.mockReset()
  subscribeMany.mockImplementation((_relays: string[], _filter: unknown, h: RelayHandlers) => {
    handlers = h
    return { close }
  })
  updateProfileMeta.mockClear()
  setNip65Relays.mockClear()
  ;(useAuthStore.getState as Mock).mockReturnValue({
    profile: { pubkey: PK }, nip65Relays: null, updateProfileMeta, setNip65Relays,
  })
})
afterEach(() => { vi.useRealTimers() })

describe('fetchNostrProfile — first VALID event', () => {
  it('uses a valid first event', async () => {
    const promise = fetchNostrProfile(PK)
    handlers.onevent(profile('Real'))
    await expect(promise).resolves.toEqual({ name: 'Real' })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('a tampered event followed by a valid one: the valid one is used and the tampered one did not end the subscription', async () => {
    const promise = fetchNostrProfile(PK)
    handlers.onevent(forged(profile('Real'), JSON.stringify({ name: 'Evil' })))
    expect(close).not.toHaveBeenCalled()
    handlers.onevent(profile('Real'))
    await expect(promise).resolves.toEqual({ name: 'Real' })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('ignores a validly signed event of another pubkey', async () => {
    vi.useFakeTimers()
    const promise = fetchNostrProfile(PK)
    handlers.onevent(profile('Evil', skOther))
    expect(close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(6100)
    await expect(promise).resolves.toEqual({})
  })

  it('ignores a validly signed event of the wrong kind', async () => {
    vi.useFakeTimers()
    const promise = fetchNostrProfile(PK)
    handlers.onevent(profile('Note', sk, 1))
    expect(close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(6100)
    await expect(promise).resolves.toEqual({})
  })

  it('settles at the arrival time of the first valid event, without waiting for any other relay', async () => {
    vi.useFakeTimers()
    const start = Date.now()
    let settledAt = -1
    void fetchNostrProfile(PK).then(() => { settledAt = Date.now() - start })
    await vi.advanceTimersByTimeAsync(150)
    expect(settledAt).toBe(-1)
    handlers.onevent(profile('Real'))
    await vi.advanceTimersByTimeAsync(0) // no EOSE from any relay, no further time passes
    expect(settledAt).toBe(150)
  })
})

describe('bootstrapUserData — first VALID event', () => {
  it('kind 0: a valid first event is applied at once', () => {
    const dispose = bootstrapUserData(PK)
    handlers.onevent(profile('Real'))
    expect(updateProfileMeta).toHaveBeenCalledWith(PK, { name: 'Real' })
    dispose()
  })

  it('kind 10002: a valid first event is applied at once', () => {
    const dispose = bootstrapUserData(PK)
    handlers.onevent(relayList('wss://relay.user.example'))
    expect(setNip65Relays).toHaveBeenCalledWith({ read: ['wss://relay.user.example'], write: ['wss://relay.user.example'] })
    dispose()
  })

  it('a tampered kind 0 followed by a valid one: the valid one is used', () => {
    const dispose = bootstrapUserData(PK)
    handlers.onevent(forged(profile('Real'), JSON.stringify({ name: 'Evil' })))
    expect(updateProfileMeta).not.toHaveBeenCalled()
    handlers.onevent(profile('Real'))
    expect(updateProfileMeta).toHaveBeenCalledTimes(1)
    expect(updateProfileMeta).toHaveBeenCalledWith(PK, { name: 'Real' })
    dispose()
  })

  it('a tampered kind 10002 followed by a valid one: the valid one is used', () => {
    const dispose = bootstrapUserData(PK)
    const good = relayList('wss://relay.user.example')
    handlers.onevent(forged(good, '', [['r', 'wss://relay.attacker.example']]))
    expect(setNip65Relays).not.toHaveBeenCalled()
    handlers.onevent(good)
    expect(setNip65Relays).toHaveBeenCalledTimes(1)
    expect(setNip65Relays).toHaveBeenCalledWith({ read: ['wss://relay.user.example'], write: ['wss://relay.user.example'] })
    dispose()
  })

  it('ignores validly signed events of another pubkey (kind 0 and 10002)', () => {
    const dispose = bootstrapUserData(PK)
    handlers.onevent(profile('Evil', skOther))
    handlers.onevent(relayList('wss://relay.attacker.example', skOther))
    expect(updateProfileMeta).not.toHaveBeenCalled()
    expect(setNip65Relays).not.toHaveBeenCalled()
    dispose()
  })

  it('ignores validly signed events of a kind it did not ask for', () => {
    const dispose = bootstrapUserData(PK)
    handlers.onevent(profile('Note', sk, 1))
    handlers.onevent(relayList('wss://relay.user.example', sk, 3))
    expect(updateProfileMeta).not.toHaveBeenCalled()
    expect(setNip65Relays).not.toHaveBeenCalled()
    dispose()
  })

  it('rejected events do not end the subscription; it closes only once both valid events arrived', () => {
    const dispose = bootstrapUserData(PK)
    handlers.onevent(forged(profile('Real'), JSON.stringify({ name: 'Evil' })))
    handlers.onevent(profile('Evil', skOther))
    expect(close).not.toHaveBeenCalled()
    handlers.onevent(profile('Real'))
    expect(close).not.toHaveBeenCalled() // still waiting for the relay list
    handlers.onevent(relayList('wss://relay.user.example'))
    expect(close).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('applies the first valid event at its arrival time, without waiting for the other relays', async () => {
    vi.useFakeTimers()
    const dispose = bootstrapUserData(PK)
    await vi.advanceTimersByTimeAsync(120)
    handlers.onevent(profile('Real')) // no EOSE from any relay, no further time passes
    expect(updateProfileMeta).toHaveBeenCalledWith(PK, { name: 'Real' })
    dispose()
  })
})
