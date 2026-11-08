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

import { initBunkerQR, restoreBunkerSession, isTransientSignerError } from '@/core/nostr/client'
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

describe('initBunkerQR — relay drop vs cancel, and progress stages', () => {
  afterEach(() => { vi.useRealTimers() })

  it('every pairing relay dropping (e.g. browser backgrounded) surfaces a typed, actionable error, not an endless wait', async () => {
    vi.useFakeTimers()
    ;(BunkerSigner.fromURI as Mock).mockRejectedValue(new Error('subscription closed before connection was established.'))
    const err = await initBunkerQR().loginPromise.catch((e: Error) => e)
    expect(err).toMatchObject({ name: 'PairingConnectionLost' })
    expect((err as Error).message).toMatch(/new link/i)
    expect(vi.getTimerCount()).toBe(0)
    expect(pools[0]!.destroy).toHaveBeenCalled()
    expect(sessionStorage.getItem('bunkerPubkey')).toBeNull()
  })

  it('a user cancel is still an AbortError even though nostr-tools reports it as "subscription closed"', async () => {
    let rejectSub!: (e: Error) => void
    ;(BunkerSigner.fromURI as Mock).mockReturnValue(new Promise((_, r) => { rejectSub = r }))
    const { loginPromise, cancel } = initBunkerQR()
    cancel()
    rejectSub(new Error('subscription closed before connection was established.'))
    await expect(loginPromise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reports awaiting-signer, then awaiting-pubkey after the ack — never with URI/secret/key data', async () => {
    const signer = makeFakeSigner()
    ;(BunkerSigner.fromURI as Mock).mockResolvedValue(signer)
    const stages: unknown[][] = []
    await initBunkerQR((...a: unknown[]) => { stages.push(a) }).loginPromise
    expect(stages).toEqual([['awaiting-signer'], ['awaiting-pubkey']])
  })
})

// get_public_key: which errors of ONE attempt are transient (the schedule goes on) and which are terminal.
// Messages are the exact nostr-tools 2.25.x texts (lib/esm/nip46.js).
const TRANSIENT = [
  'nostr-tools/nip46: failed to send "get_public_key" to any relay: connection failure: connection failed; publish timed out',
  'nostr-tools/nip46: timeout after 30000ms waiting for "get_public_key"',
  'nostr-tools/nip46: subscription to the remote signer was closed',
]
const TERMINAL = [
  'this signer is not open anymore, create a new one',
  'nostr-tools/nip46: signer was closed',
  'user rejected', // the signer's own error text (no nostr-tools prefix)
  'nostr-tools/nip46: remote signer aa requires auth to answer "get_public_key" but there was no onauth() callback configured',
  'nostr-tools/nip46: remote signer response has neither result nor error',
]

describe('isTransientSignerError', () => {
  it.each(TRANSIENT)('transient: %s', m => { expect(isTransientSignerError(new Error(m))).toBe(true) })
  it.each(TERMINAL)('terminal: %s', m => { expect(isTransientSignerError(new Error(m))).toBe(false) })
  it('terminal: an abort, a non-Error value, an empty message', () => {
    expect(isTransientSignerError(new DOMException('Pairing cancelled', 'AbortError'))).toBe(false)
    expect(isTransientSignerError('nostr-tools/nip46: timeout after 30000ms waiting for "x"')).toBe(false)
    expect(isTransientSignerError(undefined)).toBe(false)
    expect(isTransientSignerError(new Error(''))).toBe(false)
  })
})

describe('initBunkerQR — get_public_key attempts: transient vs terminal errors', () => {
  afterEach(() => { vi.useRealTimers() })
  const noSession = () => {
    expect((window as { nostr?: unknown }).nostr).toBeUndefined()
    expect(sessionStorage.getItem('bunkerPubkey')).toBeNull()
    expect(sessionStorage.getItem('bunkerURI')).toBeNull()
    expect(sessionStorage.getItem('bunkerClientSecretKey')).toBeNull()
  }

  it.each(TRANSIENT)('a transient failure of the first attempt does not end the login; the next tick (8 s) sends a new one: %s', async msg => {
    vi.useFakeTimers()
    const signer = makeFakeSigner()
    let calls = 0
    signer.getPublicKey = vi.fn(() => (++calls === 1 ? Promise.reject(new Error(msg)) : Promise.resolve(PK)))
    ;(BunkerSigner.fromURI as Mock).mockResolvedValue(signer)
    const { loginPromise } = initBunkerQR()
    const settled = loginPromise.then(p => ({ ok: p }), (e: Error) => ({ err: e }))
    await vi.advanceTimersByTimeAsync(7_999)
    expect(signer.getPublicKey).toHaveBeenCalledTimes(1)       // no early retry: the schedule is kept
    expect(await Promise.race([settled, Promise.resolve('pending')])).toBe('pending')
    noSession()                                                // nothing stored before success
    await vi.advanceTimersByTimeAsync(1)
    expect(await settled).toMatchObject({ ok: { pubkey: PK } })
    expect(signer.getPublicKey).toHaveBeenCalledTimes(2)
    expect(sessionStorage.getItem('bunkerPubkey')).toBe(PK)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(signer.getPublicKey).toHaveBeenCalledTimes(2)       // the schedule stopped
  })

  it('every earlier attempt failing never skips a tick: calls at 0, 8, 16, 24 s, the fourth is answered', async () => {
    vi.useFakeTimers()
    const signer = makeFakeSigner()
    signer.getPublicKey = vi.fn()
      .mockRejectedValueOnce(new Error(TRANSIENT[1]!))
      .mockRejectedValueOnce(new Error(TRANSIENT[0]!))
      .mockRejectedValueOnce(new Error(TRANSIENT[2]!))
      .mockResolvedValue(PK)
    ;(BunkerSigner.fromURI as Mock).mockResolvedValue(signer)
    const { loginPromise } = initBunkerQR()
    const settled = loginPromise.then(p => ({ ok: p }), (e: Error) => ({ err: e }))
    await vi.advanceTimersByTimeAsync(0)
    expect(signer.getPublicKey).toHaveBeenCalledTimes(1)
    let now = 0
    for (const [t, n] of [[7_999, 1], [8_000, 2], [15_999, 2], [16_000, 3], [23_999, 3]] as const) {
      await vi.advanceTimersByTimeAsync(t - now)
      now = t
      expect(signer.getPublicKey).toHaveBeenCalledTimes(n)
    }
    expect(await Promise.race([settled, Promise.resolve('pending')])).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(await settled).toMatchObject({ ok: { pubkey: PK } })
    expect(signer.getPublicKey).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(TERMINAL)('a terminal error ends the login at once and is not retried: %s', async msg => {
    vi.useFakeTimers()
    const signer = makeFakeSigner()
    signer.getPublicKey = vi.fn(() => Promise.reject(new Error(msg)))
    ;(BunkerSigner.fromURI as Mock).mockResolvedValue(signer)
    const { loginPromise } = initBunkerQR()
    const settled = loginPromise.catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(0)
    expect((await settled as Error).message).toBe(msg)          // the existing message, unchanged
    expect(signer.getPublicKey).toHaveBeenCalledTimes(1)
    expect(signer.close).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(signer.getPublicKey).toHaveBeenCalledTimes(1)
    noSession()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('only transient errors until the deadline: the existing 2-minute message, 15 bounded attempts, no timers left, nothing stored', async () => {
    vi.useFakeTimers()
    const signer = makeFakeSigner()
    signer.getPublicKey = vi.fn(() => Promise.reject(new Error(TRANSIENT[0]!)))
    ;(BunkerSigner.fromURI as Mock).mockResolvedValue(signer)
    const { loginPromise } = initBunkerQR()
    const settled = loginPromise.catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(120_000)
    const err = await settled as Error
    expect(err.message).toMatch(/timed out/i)
    expect(err.message).not.toMatch(/nostr-tools/)               // no library internals in the user-visible text
    expect(signer.getPublicKey).toHaveBeenCalledTimes(15)        // now, then every 8 s up to 112 s; the tick at 120 s finds the login over
    expect(signer.close).toHaveBeenCalled()
    expect(pools[0]!.destroy).toHaveBeenCalled()
    noSession()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(signer.getPublicKey).toHaveBeenCalledTimes(15)
  })

  it('cancel while an attempt is pending and another already failed: no session from the late answer, nothing retried afterwards', async () => {
    vi.useFakeTimers()
    const signer = makeFakeSigner()
    let answer!: (pk: string) => void
    let calls = 0
    signer.getPublicKey = vi.fn(() => (++calls === 1
      ? Promise.reject(new Error(TRANSIENT[0]!))
      : new Promise<string>(r => { answer = r })))
    ;(BunkerSigner.fromURI as Mock).mockResolvedValue(signer)
    const { loginPromise, cancel } = initBunkerQR()
    const settled = loginPromise.catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(8_000)
    expect(signer.getPublicKey).toHaveBeenCalledTimes(2)
    cancel()
    expect(await settled).toMatchObject({ name: 'AbortError' })
    answer(PK)                                                   // late answer
    await vi.advanceTimersByTimeAsync(120_000)
    expect(signer.getPublicKey).toHaveBeenCalledTimes(2)
    expect(signer.close).toHaveBeenCalled()
    noSession()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a NEW login after the old one was cancelled: the old pairing\'s late answer changes neither window.nostr nor the stored session', async () => {
    vi.useFakeTimers()
    const PK2 = 'b'.repeat(64)
    const oldSigner = makeFakeSigner()
    let oldAnswer!: (pk: string) => void
    oldSigner.getPublicKey = vi.fn(() => new Promise<string>(r => { oldAnswer = r }))
    const newSigner = makeFakeSigner()
    newSigner.getPublicKey = vi.fn(async () => PK2)
    ;(BunkerSigner.fromURI as Mock).mockResolvedValueOnce(oldSigner).mockResolvedValueOnce(newSigner)
    const first = initBunkerQR()
    const firstSettled = first.loginPromise.catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(8_000)
    first.cancel()
    expect(await firstSettled).toMatchObject({ name: 'AbortError' })
    await expect(initBunkerQR().loginPromise).resolves.toMatchObject({ pubkey: PK2 })
    oldAnswer(PK)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sessionStorage.getItem('bunkerPubkey')).toBe(PK2)
    expect(await (window as unknown as { nostr: { getPublicKey(): Promise<string> } }).nostr.getPublicKey()).toBe(PK2)
    expect(oldSigner.close).toHaveBeenCalled()
    expect(oldSigner.getPublicKey.mock.calls.length).toBeLessThanOrEqual(2) // not retried after the cancel
  })
})
