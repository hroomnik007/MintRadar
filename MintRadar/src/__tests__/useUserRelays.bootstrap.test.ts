import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Real order of events end to end: REAL auth store, REAL bootstrapUserData, only the relay pool is faked. The kind
// 10002 event arrives first (the hook sees a new nip65Relays object), the kind 10050 event after it. Before the fix
// the effect re-ran on the 10002 write, closed the subscription via finish(false) and dmRelays was never written.
interface RelayHandlers { onevent: (ev: unknown) => void; oneose: () => void; onclose: () => void }
const pool = vi.hoisted(() => ({ subscribeMany: vi.fn() }))

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
vi.mock('@/core/nostr/pool', () => ({ sharedPool: { subscribeMany: pool.subscribeMany } }))

import { useUserRelays } from '@/hooks/useUserRelays'
import { useAuthStore } from '@/stores/auth.store'

const PK = 'a'.repeat(64)
// Only the bootstrap subscription (kinds 0/10002/10050); the profile fallback after a 10002 is a separate kind:0 lookup.
const subs: { handlers: RelayHandlers; close: ReturnType<typeof vi.fn> }[] = []

const sub = () => subs[0]!

function ev(over: Record<string, unknown>) {
  return { id: 'x'.repeat(64), created_at: 1_700_000_000, tags: [] as string[][], sig: '0'.repeat(128), content: '', pubkey: PK, ...over }
}

beforeEach(() => {
  subs.length = 0
  pool.subscribeMany.mockReset()
  pool.subscribeMany.mockImplementation((_r: string[], filter: { kinds?: number[] }, handlers: RelayHandlers) => {
    const sub = { handlers, close: vi.fn() }
    if (filter.kinds?.includes(10050)) subs.push(sub)
    return sub
  })
  useAuthStore.setState({ profile: { pubkey: PK, npub: 'npub-test' }, nip65Relays: null, dmRelays: null })
})

afterEach(() => { vi.useRealTimers() })

describe('useUserRelays + bootstrapUserData — kind 10002 before kind 10050', () => {
  it('writes the kind 10050 relays after the NIP-65 list arrived first', async () => {
    renderHook(() => useUserRelays())
    await waitFor(() => expect(subs).toHaveLength(1))

    act(() => {
      sub().handlers.onevent(ev({ kind: 10002, tags: [['r', 'wss://nip65.example']] }))
    })
    expect(useAuthStore.getState().nip65Relays).toEqual({ read: ['wss://nip65.example'], write: ['wss://nip65.example'] })
    await act(async () => { await Promise.resolve() })

    // The subscription is still open and no second one was started.
    expect(subs).toHaveLength(1)
    expect(sub().close).not.toHaveBeenCalled()

    act(() => {
      sub().handlers.onevent(ev({ kind: 10050, tags: [['relay', 'wss://auth.nostr1.com'], ['relay', 'wss://relay.0xchat.com']] }))
    })
    // Profile (kind 0) never came: the subscription ends on EOSE and settles the 10050 result.
    act(() => { sub().handlers.oneose() })

    expect(useAuthStore.getState().dmRelays).toEqual(['wss://auth.nostr1.com', 'wss://relay.0xchat.com'])
    expect(subs).toHaveLength(1)
  })
})
