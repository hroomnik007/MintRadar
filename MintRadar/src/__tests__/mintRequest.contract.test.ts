import { describe, it, expect, vi, afterEach } from 'vitest'
import { Mint } from '@cashu/cashu-ts'
import { createMintWallet } from '../utils/mintRequest'
import { startTokenRun, classifyRunError } from '../utils/tokenRun'

// Guards our dependency on cashu-ts's PRIVATE field `Mint._request` (see mintRequest.ts).
// This uses the REAL library with only `fetch` mocked, so a cashu-ts upgrade that removes or
// renames the field, or stops honouring an AbortSignal, fails here instead of silently turning
// cancellation off in production (the adapter would quietly fall back to a plain Wallet).
// If this fails after an upgrade: re-verify against the new source, then update mintRequest.ts.

const MINT_URL = 'https://mint.example'

// A fetch that never resolves but honours the signal, like a real one.
function stubHangingFetch() {
  const calls: { url: string; signal: AbortSignal }[] = []
  vi.stubGlobal('fetch', vi.fn((url: string, init: { signal: AbortSignal }) => {
    calls.push({ url: String(url), signal: init.signal })
    return new Promise((_, reject) => {
      const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'))
      if (init.signal.aborted) abort()
      else init.signal.addEventListener('abort', abort, { once: true })
    })
  }))
  return calls
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('cashu-ts private-field contract (Mint._request)', () => {
  it('a real Mint still exposes _request as a function', () => {
    const mint = new Mint(MINT_URL) as unknown as { _request?: unknown }
    expect(typeof mint._request).toBe('function')
  })

  it('a real Mint still accepts a customRequest option', () => {
    const seen: unknown[] = []
    const mint = new Mint(MINT_URL, { customRequest: (async (a: unknown) => { seen.push(a); return { keysets: [] } }) as never })
    return mint.getKeySets().then(() => expect(seen).toHaveLength(1))
  })

  it('loadMint(): aborting rejects with name CallerAbortError and aborts all three requests', async () => {
    const calls = stubHangingFetch()
    const run = startTokenRun()
    const wallet = createMintWallet(MINT_URL, 'sat', run)
    const p = wallet.loadMint().catch(e => e)
    await vi.waitFor(() => expect(calls.length).toBe(3))
    expect(calls.map(c => new URL(c.url).pathname).sort()).toEqual(['/v1/info', '/v1/keys', '/v1/keysets'])
    run.cancel()
    const err = await p
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).toBe('CallerAbortError')
    expect(classifyRunError(err, run)).toBe('ignore')
    expect(calls.every(c => c.signal.aborted)).toBe(true)
  })

  it('checkProofsStates(): aborting rejects with name CallerAbortError and aborts the POST', async () => {
    const calls = stubHangingFetch()
    const run = startTokenRun()
    const wallet = createMintWallet(MINT_URL, 'sat', run)
    const p = wallet.checkProofsStates([{ secret: 'deadbeef' }]).catch(e => e)
    await vi.waitFor(() => expect(calls.length).toBe(1))
    expect(new URL(calls[0]!.url).pathname).toBe('/v1/checkstate')
    run.cancel()
    const err = await p
    expect((err as Error).name).toBe('CallerAbortError')
    expect(calls[0]!.signal.aborted).toBe(true)
  })

  it('our per-request timeout rejects with CallerAbortError and reads as a timeout, not an edit', async () => {
    vi.useFakeTimers()
    stubHangingFetch()
    const run = startTokenRun()
    const wallet = createMintWallet(MINT_URL, 'sat', run)
    const p = wallet.checkProofsStates([{ secret: 'deadbeef' }]).catch(e => e)
    await vi.advanceTimersByTimeAsync(10_000)
    const err = await p
    expect((err as Error).name).toBe('CallerAbortError')
    expect(classifyRunError(err, run)).toBe('timeout')
  })
})
