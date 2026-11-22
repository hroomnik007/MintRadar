// P5 (UI/UX report 2026-11-22): a relay whose connection failed is skipped for a while in this page session.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { ensure } = vi.hoisted(() => ({ ensure: vi.fn() }))
vi.mock('nostr-tools/pool', () => ({
  SimplePool: class { ensureRelay = ensure },
}))

import { sharedPool, isRelaySkipped, noteRelayFailure, resetRelaySkips, RELAY_SKIP_MS } from '@/core/nostr/pool'

const fakeRelay = () => Object.assign(Object.create({ reconnect: async () => {} }) as object, {})

beforeEach(() => { resetRelaySkips(); ensure.mockReset() })

describe('relay skip after a failed connection', () => {
  it('a failed relay is not dialled again; the next query fails at once', async () => {
    ensure.mockRejectedValueOnce(new Error('502'))
    await expect(sharedPool.ensureRelay('wss://dead.example')).rejects.toThrow('502')
    await expect(sharedPool.ensureRelay('wss://dead.example/')).rejects.toThrow(/skipped/)
    expect(ensure).toHaveBeenCalledTimes(1)
  })

  it('a working relay is used as before', async () => {
    ensure.mockResolvedValue(fakeRelay())
    await sharedPool.ensureRelay('wss://ok.example')
    await sharedPool.ensureRelay('wss://ok.example')
    expect(ensure).toHaveBeenCalledTimes(2)
    expect(isRelaySkipped('wss://ok.example')).toBe(false)
  })

  it('an aborted attempt does not count as a failure', async () => {
    const ctrl = new AbortController(); ctrl.abort()
    ensure.mockRejectedValueOnce(new Error('aborted'))
    await expect(sharedPool.ensureRelay('wss://x.example', { abort: ctrl.signal })).rejects.toThrow('aborted')
    expect(isRelaySkipped('wss://x.example')).toBe(false)
  })

  it('the skip expires', () => {
    noteRelayFailure('wss://dead.example', 1_000)
    expect(isRelaySkipped('wss://dead.example', 1_000 + RELAY_SKIP_MS - 1)).toBe(true)
    expect(isRelaySkipped('wss://dead.example', 1_000 + RELAY_SKIP_MS)).toBe(false)
  })

  it('offline: nothing is skipped (every relay fails then)', () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    noteRelayFailure('wss://dead.example')
    expect(isRelaySkipped('wss://dead.example')).toBe(false)
    spy.mockRestore()
  })
})
