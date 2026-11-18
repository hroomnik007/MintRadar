import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAuthStore } from '@/stores/auth.store'
import { deriveUserRelays, waitForRelayLists, RELAY_LISTS_WAIT_MS } from '@/core/nostr/userRelayLists'

beforeEach(() => {
  useAuthStore.getState().logout()
  sessionStorage.clear()
})
afterEach(() => { vi.useRealTimers() })

describe('deriveUserRelays', () => {
  it('sanitises each list and turns an empty or missing one into null', () => {
    expect(deriveUserRelays({ read: ['wss://r.example.com', 'ws://bad.example.com'], write: [] }, ['wss://dm.example.com', 'wss://127.0.0.1']))
      .toEqual({ read: ['wss://r.example.com'], write: null, dm: ['wss://dm.example.com'] })
    expect(deriveUserRelays(null, null)).toEqual({ read: null, write: null, dm: null })
    expect(deriveUserRelays(null, [])).toEqual({ read: null, write: null, dm: null })
  })
})

describe('auth store — dmRelays', () => {
  it('starts as null (not loaded), is set by setDmRelays and persisted', () => {
    expect(useAuthStore.getState().dmRelays).toBeNull()
    useAuthStore.getState().setDmRelays(['wss://dm.example.com'])
    expect(useAuthStore.getState().dmRelays).toEqual(['wss://dm.example.com'])
    const stored = JSON.parse(sessionStorage.getItem('mintradar_session') ?? '{}') as { state?: Record<string, unknown> }
    expect(stored.state?.['dmRelays']).toEqual(['wss://dm.example.com'])
  })
  it('[] means loaded and none; logout clears it back to null together with nip65Relays', () => {
    useAuthStore.setState({ nip65Relays: { read: [], write: [] }, dmRelays: [] })
    expect(useAuthStore.getState().dmRelays).toEqual([])
    useAuthStore.getState().logout()
    expect(useAuthStore.getState().dmRelays).toBeNull()
    expect(useAuthStore.getState().nip65Relays).toBeNull()
  })
  it('a session persisted before dmRelays existed hydrates with dmRelays = null', async () => {
    sessionStorage.setItem('mintradar_session', JSON.stringify({
      state: { profile: { pubkey: 'a'.repeat(64), npub: 'npub1x' }, method: 'nip07', nip65Relays: { read: ['wss://r.example.com'], write: [] } },
      version: 0,
    }))
    await useAuthStore.persist.rehydrate()
    const s = useAuthStore.getState()
    expect(s.profile?.pubkey).toBe('a'.repeat(64))
    expect(s.nip65Relays).toEqual({ read: ['wss://r.example.com'], write: [] })
    expect(s.dmRelays).toBeNull()
  })
})

describe('waitForRelayLists', () => {
  it('resolves at once when the lists are settled (dmRelays [] counts)', async () => {
    useAuthStore.setState({ dmRelays: [] })
    await expect(waitForRelayLists()).resolves.toBeUndefined()
  })
  it('waits until the bootstrap writes dmRelays', async () => {
    let done = false
    const p = waitForRelayLists().then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    useAuthStore.getState().setDmRelays([])
    await p
    expect(done).toBe(true)
  })
  it('never blocks forever: resolves after the timeout when nothing arrives', async () => {
    vi.useFakeTimers()
    let done = false
    void waitForRelayLists().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(RELAY_LISTS_WAIT_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(done).toBe(true)
  })
})
