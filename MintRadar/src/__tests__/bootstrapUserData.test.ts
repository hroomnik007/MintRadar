import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────
// client.ts drags in nip46 / SimplePool and the (circular) auth store.
// Stub everything except the pieces bootstrapUserData / subscribeFirstEvent
// actually exercise: verifyEvent, sharedPool.subscribeMany, useAuthStore.getState.

interface RelayHandlers {
  onevent: (ev: unknown) => void
  oneose: () => void
  onclose: () => void
}
let capturedHandlers: RelayHandlers | null = null
const { subscribeMany } = vi.hoisted(() => ({ subscribeMany: vi.fn() }))

vi.mock('nostr-tools', async (importOriginal) => {
  const real = await importOriginal<typeof import('nostr-tools')>()
  return { ...real, verifyEvent: vi.fn(() => true) }
})
vi.mock('nostr-tools/nip46', () => ({
  BunkerSigner: class {},
  parseBunkerInput: vi.fn(),
  createNostrConnectURI: vi.fn(),
  toBunkerURL: vi.fn(),
}))
vi.mock('nostr-tools/pool', () => ({ SimplePool: class {} }))
vi.mock('@/core/nostr/pool', () => ({ sharedPool: { subscribeMany } }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: { getState: vi.fn() } }))

import { bootstrapUserData, fetchNostrProfile, parseDmRelayTags } from '@/core/nostr/client'
import { useAuthStore } from '@/stores/auth.store'

const PK = 'a'.repeat(64)
const OTHER_PK = 'b'.repeat(64)

const updateProfileMeta = vi.fn()
const setNip65Relays = vi.fn()
const setDmRelays = vi.fn()

function baseEvent(over: Record<string, unknown>) {
  return { id: 'x'.repeat(64), created_at: 1_700_000_000, tags: [] as string[][], sig: '0'.repeat(128), content: '', ...over }
}

beforeEach(() => {
  capturedHandlers = null
  subscribeMany.mockReset()
  subscribeMany.mockImplementation((_relays: string[], _filter: unknown, handlers: RelayHandlers) => {
    capturedHandlers = handlers
    return { close: vi.fn() }
  })
  updateProfileMeta.mockClear()
  setNip65Relays.mockClear()
  setDmRelays.mockClear()
  ;(useAuthStore.getState as Mock).mockReturnValue({
    profile: { pubkey: PK },
    nip65Relays: null,
    dmRelays: null,
    updateProfileMeta,
    setNip65Relays,
    setDmRelays,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('bootstrapUserData — pubkey binding (audit finding M6)', () => {
  it('drops a kind:0 profile event signed by a DIFFERENT pubkey', () => {
    const dispose = bootstrapUserData(PK)
    capturedHandlers!.onevent(baseEvent({
      kind: 0, pubkey: OTHER_PK,
      content: JSON.stringify({ name: 'MintRadar Official ✓', picture: 'https://track.evil/x.png' }),
    }))
    expect(updateProfileMeta).not.toHaveBeenCalled()
    dispose()
  })

  it('applies a kind:0 profile event signed by the user', () => {
    const dispose = bootstrapUserData(PK)
    capturedHandlers!.onevent(baseEvent({
      kind: 0, pubkey: PK,
      content: JSON.stringify({ name: 'Real Name', picture: 'https://real.example/p.png' }),
    }))
    expect(updateProfileMeta).toHaveBeenCalledWith(PK, { name: 'Real Name', picture: 'https://real.example/p.png' })
    dispose()
  })

  it('drops a kind:10002 NIP-65 relay list signed by a DIFFERENT pubkey', () => {
    const dispose = bootstrapUserData(PK)
    capturedHandlers!.onevent(baseEvent({
      kind: 10002, pubkey: OTHER_PK,
      tags: [['r', 'wss://relay.attacker.example']],
    }))
    expect(setNip65Relays).not.toHaveBeenCalled()
    dispose()
  })

  it('applies a kind:10002 NIP-65 relay list signed by the user', () => {
    const dispose = bootstrapUserData(PK)
    capturedHandlers!.onevent(baseEvent({
      kind: 10002, pubkey: PK,
      tags: [['r', 'wss://relay.user.example']],
    }))
    expect(setNip65Relays).toHaveBeenCalledWith({
      read: ['wss://relay.user.example'],
      write: ['wss://relay.user.example'],
    })
    dispose()
  })

  it('a forged event does not consume the slot — the real event that follows still applies', () => {
    const dispose = bootstrapUserData(PK)
    capturedHandlers!.onevent(baseEvent({ kind: 0, pubkey: OTHER_PK, content: JSON.stringify({ name: 'Evil' }) }))
    capturedHandlers!.onevent(baseEvent({ kind: 0, pubkey: PK, content: JSON.stringify({ name: 'Real' }) }))
    expect(updateProfileMeta).toHaveBeenCalledTimes(1)
    expect(updateProfileMeta).toHaveBeenCalledWith(PK, { name: 'Real' })
    dispose()
  })
})

describe('bootstrapUserData — kind:10050 DM relays (NIP-17)', () => {
  it('subscribes once, on the same relays, with kinds 0, 10002 and 10050', () => {
    const dispose = bootstrapUserData(PK)
    expect(subscribeMany).toHaveBeenCalledTimes(1)
    expect(subscribeMany.mock.calls[0]![1]).toEqual({ kinds: [0, 10002, 10050], authors: [PK] })
    dispose()
  })

  it('drops a kind:10050 list signed by a DIFFERENT pubkey, even when the subscription ends', () => {
    bootstrapUserData(PK)
    capturedHandlers!.onevent(baseEvent({ kind: 10050, pubkey: OTHER_PK, tags: [['relay', 'wss://relay.attacker.example']] }))
    capturedHandlers!.oneose()
    expect(setDmRelays).toHaveBeenCalledTimes(1)
    expect(setDmRelays).toHaveBeenCalledWith([])
  })

  it('applies the first accepted kind:10050 list when the subscription ends, with the relay tags sanitised', () => {
    bootstrapUserData(PK)
    capturedHandlers!.onevent(baseEvent({ kind: 10050, pubkey: PK, tags: [['relay', 'wss://dm.user.example.com'], ['relay', 'ws://insecure.example.com']] }))
    capturedHandlers!.onevent(baseEvent({ kind: 10050, pubkey: PK, tags: [['relay', 'wss://second.example.com']] }))
    expect(setDmRelays).not.toHaveBeenCalled() // written when the bootstrap is done, not before
    capturedHandlers!.oneose()
    expect(setDmRelays).toHaveBeenCalledTimes(1)
    expect(setDmRelays).toHaveBeenCalledWith(['wss://dm.user.example.com'])
  })

  it('no kind:10050 at all: dmRelays becomes [] at EOSE (so it is not refetched on every mount)', () => {
    bootstrapUserData(PK)
    // kind:0 first: without it the 10002 handler starts the (separate) profile fallback look-up
    capturedHandlers!.onevent(baseEvent({ kind: 0, pubkey: PK, content: JSON.stringify({ name: 'N' }) }))
    capturedHandlers!.onevent(baseEvent({ kind: 10002, pubkey: PK, tags: [['r', 'wss://relay.user.example']] }))
    capturedHandlers!.oneose()
    expect(setDmRelays).toHaveBeenCalledWith([])
  })

  it('no kind:10050 on timeout: dmRelays becomes []', () => {
    vi.useFakeTimers()
    bootstrapUserData(PK)
    vi.advanceTimersByTime(6100)
    expect(setDmRelays).toHaveBeenCalledWith([])
  })

  it('finishes as soon as profile, relay list and DM list have all arrived', () => {
    bootstrapUserData(PK)
    capturedHandlers!.onevent(baseEvent({ kind: 0, pubkey: PK, content: JSON.stringify({ name: 'N' }) }))
    capturedHandlers!.onevent(baseEvent({ kind: 10002, pubkey: PK, tags: [['r', 'wss://relay.user.example']] }))
    expect(setDmRelays).not.toHaveBeenCalled()
    capturedHandlers!.onevent(baseEvent({ kind: 10050, pubkey: PK, tags: [['relay', 'wss://dm.user.example.com']] }))
    expect(setDmRelays).toHaveBeenCalledWith(['wss://dm.user.example.com'])
  })

  it('the profile name is applied the moment kind:0 arrives, not after the DM list', () => {
    const dispose = bootstrapUserData(PK)
    capturedHandlers!.onevent(baseEvent({ kind: 0, pubkey: PK, content: JSON.stringify({ name: 'Early' }) }))
    expect(updateProfileMeta).toHaveBeenCalledWith(PK, { name: 'Early' })
    dispose()
  })

  it('the disposer (effect cleanup) does not mark the DM list as loaded', () => {
    const dispose = bootstrapUserData(PK)
    dispose()
    expect(setDmRelays).not.toHaveBeenCalled()
  })

  it('runs for a persisted NIP-65 list without a DM list, and not when both are cached', () => {
    ;(useAuthStore.getState as Mock).mockReturnValue({
      profile: { pubkey: PK }, nip65Relays: { read: [], write: [] }, dmRelays: null, updateProfileMeta, setNip65Relays, setDmRelays,
    })
    bootstrapUserData(PK)()
    expect(subscribeMany).toHaveBeenCalledTimes(1)
    ;(useAuthStore.getState as Mock).mockReturnValue({
      profile: { pubkey: PK }, nip65Relays: { read: [], write: [] }, dmRelays: [], updateProfileMeta, setNip65Relays, setDmRelays,
    })
    bootstrapUserData(PK)()
    expect(subscribeMany).toHaveBeenCalledTimes(1)
  })
})

describe('parseDmRelayTags', () => {
  it('keeps valid wss relays from ["relay", url] tags and ignores other tags', () => {
    expect(parseDmRelayTags([['relay', 'wss://a.example.com'], ['r', 'wss://not-a-dm.example.com'], ['relay', 'wss://b.example.com/']]))
      .toEqual(['wss://a.example.com', 'wss://b.example.com'])
  })
  it('drops other schemes, credentials, non-public hosts and malformed values', () => {
    expect(parseDmRelayTags([
      ['relay', 'ws://a.example.com'], ['relay', 'https://a.example.com'], ['relay', 'wss://user:pw@a.example.com'],
      ['relay', 'wss://127.0.0.1'], ['relay', 'wss://localhost'], ['relay', 'nonsense'], ['relay'], ['relay', ''],
    ])).toEqual([])
  })
  it('de-duplicates and caps at 10', () => {
    expect(parseDmRelayTags([['relay', 'wss://a.example.com'], ['relay', 'WSS://A.example.com/']])).toEqual(['wss://a.example.com'])
    const many = Array.from({ length: 15 }, (_, i) => ['relay', `wss://r${i}.example.com`])
    expect(parseDmRelayTags(many)).toHaveLength(10)
  })
})

describe('subscribeFirstEvent (via fetchNostrProfile) — pubkey binding (audit finding M6)', () => {
  it('ignores an event from the wrong pubkey and resolves empty on timeout', async () => {
    vi.useFakeTimers()
    const promise = fetchNostrProfile(PK)
    capturedHandlers!.onevent(baseEvent({ kind: 0, pubkey: OTHER_PK, content: JSON.stringify({ name: 'Evil', picture: 'https://evil/p' }) }))
    await vi.advanceTimersByTimeAsync(6100) // past USER_BOOTSTRAP_TIMEOUT_MS
    await expect(promise).resolves.toEqual({})
  })

  it('resolves with the profile when the pubkey matches', async () => {
    const promise = fetchNostrProfile(PK)
    capturedHandlers!.onevent(baseEvent({ kind: 0, pubkey: PK, content: JSON.stringify({ name: 'Real', picture: 'https://real/p' }) }))
    await expect(promise).resolves.toEqual({ name: 'Real', picture: 'https://real/p' })
  })
})
