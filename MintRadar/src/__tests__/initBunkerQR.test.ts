import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'

// L2 (2026-09-07 audit): initBunkerQR's success path had no abort check, so a
// QR pairing cancelled in the same tick the signer's connect-ack resolved still
// installed the window.nostr shim + wrote bunker credentials to sessionStorage —
// leaving a live signer and silently re-logging the user in on the next load.

const { pools } = vi.hoisted(() => ({ pools: [] as Array<{ destroy: Mock }> }))

vi.mock('nostr-tools/nip46', () => ({
  BunkerSigner: { fromURI: vi.fn(), fromBunker: vi.fn() },
  parseBunkerInput: vi.fn(),
  createNostrConnectURI: vi.fn(() => 'nostrconnect://abc?relay=wss://r.example&secret=deadbeef'),
  toBunkerURL: vi.fn(() => 'bunker://a'.repeat(1) + '?relay=wss://r.example'),
}))
vi.mock('nostr-tools/pool', () => ({
  SimplePool: class {
    destroy = vi.fn()
    constructor() { pools.push(this as unknown as { destroy: Mock }) }
  },
}))
vi.mock('@/core/nostr/pool', () => ({ sharedPool: { subscribeMany: vi.fn(), querySync: vi.fn() } }))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: { getState: vi.fn(() => ({ logout: vi.fn() })) },
}))

import { initBunkerQR, restoreBunkerSession } from '@/core/nostr/client'
import { BunkerSigner } from 'nostr-tools/nip46'

const PK = 'a'.repeat(64)

function makeFakeSigner() {
  return {
    getPublicKey: vi.fn(async () => PK),
    close: vi.fn(async () => {}),
    bp: { relays: ['wss://r.example'] },
  }
}

beforeEach(() => {
  pools.length = 0
  ;(BunkerSigner.fromURI as Mock).mockReset()
  if (typeof window !== 'undefined') delete (window as { nostr?: unknown }).nostr
  sessionStorage.clear()
})

afterEach(() => {
  if (typeof window !== 'undefined') delete (window as { nostr?: unknown }).nostr
  sessionStorage.clear()
})

describe('initBunkerQR — cancel / signer-ack race (audit finding L2)', () => {
  it('cancel just before the ack lands leaves NO live signer, shim, or bunker credentials', async () => {
    let resolveSigner!: (s: unknown) => void
    ;(BunkerSigner.fromURI as Mock).mockReturnValue(new Promise(r => { resolveSigner = r }))
    const signer = makeFakeSigner()

    const { loginPromise, cancel } = initBunkerQR()

    // User backs out (Cancel button / modal close)...
    cancel()
    // ...and the signer's connect-ack arrives in the same tick.
    resolveSigner(signer)

    await expect(loginPromise).rejects.toMatchObject({ name: 'AbortError' })

    // No window.nostr shim installed.
    expect((window as { nostr?: unknown }).nostr).toBeUndefined()
    // No bunker session persisted → restoreBunkerSession() has nothing to act on.
    expect(sessionStorage.getItem('bunkerURI')).toBeNull()
    expect(sessionStorage.getItem('bunkerClientSecretKey')).toBeNull()
    expect(sessionStorage.getItem('bunkerPubkey')).toBeNull()
    // The signer was torn down and the pairing pool destroyed.
    expect(signer.close).toHaveBeenCalled()
    expect(pools[0]!.destroy).toHaveBeenCalled()
  })

  it('cancel during the post-ack getPublicKey() await also bails cleanly', async () => {
    let resolveSigner!: (s: unknown) => void
    ;(BunkerSigner.fromURI as Mock).mockReturnValue(new Promise(r => { resolveSigner = r }))
    const signer = makeFakeSigner()
    let releasePubkey: (() => void) | undefined
    signer.getPublicKey.mockImplementation(() => new Promise<string>(r => { releasePubkey = () => r(PK) }))

    const { loginPromise, cancel } = initBunkerQR()
    resolveSigner(signer)
    // Flush microtasks so the .then runs past the first (not-yet-aborted) bail
    // check and parks on `await signer.getPublicKey()`.
    await new Promise(r => setTimeout(r, 0))
    expect(releasePubkey).toBeDefined() // proves we're inside the getPublicKey await

    cancel()
    releasePubkey!()

    await expect(loginPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect((window as { nostr?: unknown }).nostr).toBeUndefined()
    expect(sessionStorage.getItem('bunkerPubkey')).toBeNull()
    expect(signer.close).toHaveBeenCalled()
  })

  it('restoreBunkerSession() is a no-op after a cancelled QR pairing (no silent re-login)', async () => {
    let resolveSigner!: (s: unknown) => void
    ;(BunkerSigner.fromURI as Mock).mockReturnValue(new Promise(r => { resolveSigner = r }))
    const signer = makeFakeSigner()

    const { loginPromise, cancel } = initBunkerQR()
    cancel()
    resolveSigner(signer)
    await loginPromise.catch(() => {})

    await restoreBunkerSession()

    expect((window as { nostr?: unknown }).nostr).toBeUndefined()
    expect(BunkerSigner.fromBunker as Mock).not.toHaveBeenCalled()
  })

  it('a normal (uncancelled) pairing still installs the shim and persists the session', async () => {
    const signer = makeFakeSigner()
    ;(BunkerSigner.fromURI as Mock).mockResolvedValue(signer)

    const { loginPromise } = initBunkerQR()
    const profile = await loginPromise

    expect(profile.pubkey).toBe(PK)
    expect((window as { nostr?: unknown }).nostr).toBeDefined()
    expect(sessionStorage.getItem('bunkerPubkey')).toBe(PK)
    expect(sessionStorage.getItem('bunkerURI')).not.toBeNull()
    // The live signer owns the pool now — it must NOT have been destroyed.
    expect(pools[0]!.destroy).not.toHaveBeenCalled()
  })
})

describe('initBunkerQR — signer acks but never answers get_public_key', () => {
  afterEach(() => { vi.useRealTimers() })

  it('times out with a visible error and commits no session instead of waiting forever', async () => {
    vi.useFakeTimers()
    const signer = makeFakeSigner()
    signer.getPublicKey = vi.fn(() => new Promise<string>(() => {})) // never answers
    ;(BunkerSigner.fromURI as Mock).mockResolvedValue(signer)

    const { loginPromise } = initBunkerQR()
    const settled = loginPromise.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(120_000)
    const err = await settled

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/timed out/i)
    expect(signer.getPublicKey).toHaveBeenCalled()
    expect((window as { nostr?: unknown }).nostr).toBeUndefined()
    expect(sessionStorage.getItem('bunkerPubkey')).toBeNull()
    expect(pools[0]!.destroy).toHaveBeenCalled()
  })
})

describe('initBunkerQR — timer and late-answer cleanup', () => {
  afterEach(() => { vi.useRealTimers() })

  it('timely success commits the session and clears the pairing timer', async () => {
    vi.useFakeTimers()
    const signer = makeFakeSigner()
    ;(BunkerSigner.fromURI as Mock).mockResolvedValue(signer)
    const { loginPromise } = initBunkerQR()
    await expect(loginPromise).resolves.toMatchObject({ pubkey: PK })
    expect(sessionStorage.getItem('bunkerPubkey')).toBe(PK)
    expect(vi.getTimerCount()).toBe(0)
    expect(pools[0]!.destroy).not.toHaveBeenCalled()
  })

  it('a get_public_key answer arriving after the timeout commits nothing and closes the signer', async () => {
    vi.useFakeTimers()
    let answer!: (pk: string) => void
    const signer = makeFakeSigner()
    signer.getPublicKey = vi.fn(() => new Promise<string>(r => { answer = r }))
    ;(BunkerSigner.fromURI as Mock).mockResolvedValue(signer)
    const { loginPromise } = initBunkerQR()
    const settled = loginPromise.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(120_000)
    expect((await settled as Error).message).toMatch(/timed out/i)
    answer(PK)
    await vi.advanceTimersByTimeAsync(0)
    expect(signer.close).toHaveBeenCalled()
    expect((window as { nostr?: unknown }).nostr).toBeUndefined()
    expect(sessionStorage.getItem('bunkerPubkey')).toBeNull()
  })
})

describe('initBunkerQR — Amber interoperability', () => {
  afterEach(() => { vi.useRealTimers() })

  it('re-sends get_public_key when the first request is dropped, and logs in on the retry answer', async () => {
    vi.useFakeTimers()
    const signer = makeFakeSigner()
    let calls = 0
    signer.getPublicKey = vi.fn(() => (++calls === 1 ? new Promise<string>(() => {}) : Promise.resolve(PK)))
    ;(BunkerSigner.fromURI as Mock).mockResolvedValue(signer)
    const { loginPromise } = initBunkerQR()
    const settled = loginPromise.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(8_000)
    await expect(settled).resolves.toMatchObject({ pubkey: PK })
    expect(signer.getPublicKey).toHaveBeenCalledTimes(2)
    expect(sessionStorage.getItem('bunkerPubkey')).toBe(PK)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a signer rejection of get_public_key fails fast with that error and commits nothing', async () => {
    const signer = makeFakeSigner()
    signer.getPublicKey = vi.fn(() => Promise.reject(new Error('user rejected')))
    ;(BunkerSigner.fromURI as Mock).mockResolvedValue(signer)
    await expect(initBunkerQR().loginPromise).rejects.toThrow('user rejected')
    expect(signer.close).toHaveBeenCalled()
    expect(sessionStorage.getItem('bunkerPubkey')).toBeNull()
  })

  it('pairs with skipSwitchRelays so the signer cannot move relays mid-handshake', () => {
    ;(BunkerSigner.fromURI as Mock).mockReturnValue(new Promise(() => {}))
    initBunkerQR().cancel()
    expect((BunkerSigner.fromURI as Mock).mock.calls[0]![2]).toMatchObject({ skipSwitchRelays: true })
  })
})
