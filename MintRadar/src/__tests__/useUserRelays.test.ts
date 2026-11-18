import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Hook-level test with the REAL auth store and a mocked client loader: the effect in useUserRelays must not close
// (or restart) the bootstrap when the NIP-65 list object changes while the kind:10050 list is still missing.
const client = vi.hoisted(() => {
  const stop = vi.fn()
  const bootstrapUserData = vi.fn<(pubkey: string) => () => void>(() => stop)
  return { stop, bootstrapUserData }
})
vi.mock('@/core/nostr/lazy', () => ({
  loadNostrClient: () => Promise.resolve({ bootstrapUserData: client.bootstrapUserData }),
}))

import { useUserRelays } from '@/hooks/useUserRelays'
import { useAuthStore } from '@/stores/auth.store'

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)
const profile = (pubkey: string) => ({ pubkey, npub: `npub-${pubkey.slice(0, 4)}` })
const list = (u: string) => ({ read: [`wss://${u}`], write: [`wss://${u}`] })

function login(pubkey: string, nip65Relays: { read: string[]; write: string[] } | null, dmRelays: string[] | null) {
  useAuthStore.setState({ profile: profile(pubkey), nip65Relays, dmRelays })
}

beforeEach(() => {
  client.stop.mockClear()
  client.bootstrapUserData.mockClear()
  useAuthStore.setState({ profile: null, nip65Relays: null, dmRelays: null })
})

describe('useUserRelays — bootstrap lifecycle', () => {
  it('(a) a new nip65Relays object while dmRelays is null neither stops nor restarts the bootstrap', async () => {
    login(PK_A, null, null)
    renderHook(() => useUserRelays())
    await waitFor(() => expect(client.bootstrapUserData).toHaveBeenCalledTimes(1))

    act(() => { useAuthStore.getState().setNip65Relays(list('one.example')) })
    act(() => { useAuthStore.getState().setNip65Relays(list('two.example')) })  // another new object, same content shape
    await Promise.resolve()

    expect(client.stop).not.toHaveBeenCalled()
    expect(client.bootstrapUserData).toHaveBeenCalledTimes(1)
  })

  it('a dmRelays result with a still-missing NIP-65 list (no kind:10002 exists) does not restart it either', async () => {
    login(PK_A, null, null)
    renderHook(() => useUserRelays())
    await waitFor(() => expect(client.bootstrapUserData).toHaveBeenCalledTimes(1))

    act(() => { useAuthStore.getState().setDmRelays([]) })
    await Promise.resolve()

    expect(client.bootstrapUserData).toHaveBeenCalledTimes(1)
  })

  it('(b) a pubkey change stops the old bootstrap and starts one for the new pubkey', async () => {
    login(PK_A, null, null)
    renderHook(() => useUserRelays())
    await waitFor(() => expect(client.bootstrapUserData).toHaveBeenCalledWith(PK_A))

    act(() => { login(PK_B, null, null) })
    await waitFor(() => expect(client.bootstrapUserData).toHaveBeenCalledWith(PK_B))

    expect(client.stop).toHaveBeenCalledTimes(1)
    expect(client.bootstrapUserData).toHaveBeenCalledTimes(2)
  })

  it('(b) unmount stops the bootstrap', async () => {
    login(PK_A, null, null)
    const { unmount } = renderHook(() => useUserRelays())
    await waitFor(() => expect(client.bootstrapUserData).toHaveBeenCalledTimes(1))

    unmount()
    expect(client.stop).toHaveBeenCalledTimes(1)
  })

  it('(b) the cleanup also runs once both lists are loaded', async () => {
    login(PK_A, null, null)
    renderHook(() => useUserRelays())
    await waitFor(() => expect(client.bootstrapUserData).toHaveBeenCalledTimes(1))

    act(() => { useAuthStore.getState().setNip65Relays(list('one.example')) })
    expect(client.stop).not.toHaveBeenCalled()
    act(() => { useAuthStore.getState().setDmRelays(['wss://relay.0xchat.com']) })

    expect(client.stop).toHaveBeenCalledTimes(1)
    expect(client.bootstrapUserData).toHaveBeenCalledTimes(1)
  })

  it('(c) with both lists loaded no bootstrap starts', async () => {
    login(PK_A, list('one.example'), ['wss://relay.0xchat.com'])
    const { result } = renderHook(() => useUserRelays())
    await Promise.resolve()
    await Promise.resolve()

    expect(client.bootstrapUserData).not.toHaveBeenCalled()
    expect(result.current.dm).toEqual(['wss://relay.0xchat.com'])
  })

  it('(c) a loaded empty kind:10050 list ([]) counts as loaded', async () => {
    login(PK_A, list('one.example'), [])
    renderHook(() => useUserRelays())
    await Promise.resolve()
    await Promise.resolve()

    expect(client.bootstrapUserData).not.toHaveBeenCalled()
  })

  it('(d) a persisted nip65Relays with dmRelays null starts exactly one bootstrap', async () => {
    login(PK_A, list('one.example'), null)
    renderHook(() => useUserRelays())
    await waitFor(() => expect(client.bootstrapUserData).toHaveBeenCalledTimes(1))
    await Promise.resolve()

    expect(client.bootstrapUserData).toHaveBeenCalledWith(PK_A)
    expect(client.bootstrapUserData).toHaveBeenCalledTimes(1)
    expect(client.stop).not.toHaveBeenCalled()
  })
})
