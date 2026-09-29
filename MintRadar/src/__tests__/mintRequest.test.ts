import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMintWallet } from '../utils/mintRequest'
import { startTokenRun, classifyRunError, REQUEST_TIMEOUT_MS } from '../utils/tokenRun'

afterEach(() => { vi.useRealTimers() })

// A fake Mint that exposes `_request` (like cashu-ts 4.x) and records what it was given.
function makeFakeMint(defaultRequest?: unknown) {
  type Opts = { customRequest?: (a: Record<string, unknown>) => Promise<unknown> }
  const created: { url: string; opts: Opts | undefined }[] = []
  class FakeMint {
    _request?: unknown
    constructor(url: string, opts?: Opts) {
      created.push({ url, opts })
      if (defaultRequest) this._request = defaultRequest
    }
  }
  return { FakeMint: FakeMint as never, created }
}

const walletCalls: unknown[][] = []
class FakeWallet { constructor(...args: unknown[]) { walletCalls.push(args) } }

describe('createMintWallet', () => {
  afterEach(() => { walletCalls.length = 0 })

  it('without a run it is a plain Wallet built from the URL', () => {
    const { FakeMint, created } = makeFakeMint(() => Promise.resolve())
    createMintWallet('https://m.example', 'sat', undefined, { MintCtor: FakeMint, WalletCtor: FakeWallet as never })
    expect(created).toHaveLength(0)
    expect(walletCalls).toEqual([['https://m.example', { unit: 'sat' }]])
  })

  it('falls back to the plain Wallet (no cancellation) when _request is missing', () => {
    const { FakeMint } = makeFakeMint(undefined)
    createMintWallet('https://m.example', 'sat', startTokenRun(), { MintCtor: FakeMint, WalletCtor: FakeWallet as never })
    expect(walletCalls).toEqual([['https://m.example', { unit: 'sat' }]])
  })

  it('falls back when _request is not a function', () => {
    const { FakeMint } = makeFakeMint('nope')
    createMintWallet('https://m.example', 'sat', startTokenRun(), { MintCtor: FakeMint, WalletCtor: FakeWallet as never })
    expect(walletCalls).toEqual([['https://m.example', { unit: 'sat' }]])
  })

  it('with _request present, builds a Mint with a customRequest and hands that Mint to the Wallet', () => {
    const { FakeMint, created } = makeFakeMint(() => Promise.resolve())
    createMintWallet('https://m.example', 'usd', startTokenRun(), { MintCtor: FakeMint, WalletCtor: FakeWallet as never })
    expect(created).toHaveLength(2)
    expect(typeof created[1]!.opts?.customRequest).toBe('function')
    expect(walletCalls[0]![0]).toBeInstanceOf(FakeMint as never)
    expect(walletCalls[0]![1]).toEqual({ unit: 'usd' })
  })

  it('the customRequest forwards the args plus a signal, and returns the result', async () => {
    const seen: Record<string, unknown>[] = []
    const { FakeMint, created } = makeFakeMint((args: Record<string, unknown>) => { seen.push(args); return Promise.resolve({ ok: 1 }) })
    const run = startTokenRun()
    createMintWallet('https://m.example', 'sat', run, { MintCtor: FakeMint, WalletCtor: FakeWallet as never })
    const out = await created[1]!.opts!.customRequest!({ endpoint: 'https://m.example/v1/info' })
    expect(out).toEqual({ ok: 1 })
    expect(seen[0]!.endpoint).toBe('https://m.example/v1/info')
    expect(seen[0]!.signal).toBeInstanceOf(AbortSignal)
    run.finish()
  })

  // A request function that honours its signal, like cashu-ts's, rejecting with an abort error.
  const signalAware = (args: { signal: AbortSignal }) => new Promise((_, reject) => {
    const abort = () => { const e = new Error('aborted'); e.name = 'CallerAbortError'; reject(e) }
    if (args.signal.aborted) abort()
    else args.signal.addEventListener('abort', abort, { once: true })
  })

  it('aborting the run aborts an in-flight request, and it reads as an edit-abort', async () => {
    const { FakeMint, created } = makeFakeMint(signalAware)
    const run = startTokenRun()
    createMintWallet('https://m.example', 'sat', run, { MintCtor: FakeMint, WalletCtor: FakeWallet as never })
    const p = created[1]!.opts!.customRequest!({ endpoint: 'x' }).catch(e => e)
    run.cancel()
    expect(classifyRunError(await p, run)).toBe('ignore')
  })

  it('a request that takes longer than the per-request limit marks the run timed out and aborts it', async () => {
    vi.useFakeTimers()
    const { FakeMint, created } = makeFakeMint(signalAware)
    const run = startTokenRun()
    createMintWallet('https://m.example', 'sat', run, { MintCtor: FakeMint, WalletCtor: FakeWallet as never })
    const p = created[1]!.opts!.customRequest!({ endpoint: 'x' }).catch(e => e)
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS)
    const err = await p
    expect(run.timedOut).toBe(true)
    expect(classifyRunError(err, run)).toBe('timeout')
  })

  it('a timeout aborts the sibling requests too (loadMint fires three at once)', async () => {
    vi.useFakeTimers()
    const { FakeMint, created } = makeFakeMint(signalAware)
    const run = startTokenRun()
    createMintWallet('https://m.example', 'sat', run, { MintCtor: FakeMint, WalletCtor: FakeWallet as never })
    const call = created[1]!.opts!.customRequest!
    const all = Promise.all([call({}).catch(e => e), call({}).catch(e => e), call({}).catch(e => e)])
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS)
    const errs = await all
    expect(errs.map(e => classifyRunError(e, run))).toEqual(['timeout', 'timeout', 'timeout'])
  })

  it('a request that finishes in time leaves no timer behind and does not time the run out', async () => {
    vi.useFakeTimers()
    const { FakeMint, created } = makeFakeMint(() => Promise.resolve('done'))
    const run = startTokenRun()
    createMintWallet('https://m.example', 'sat', run, { MintCtor: FakeMint, WalletCtor: FakeWallet as never })
    await created[1]!.opts!.customRequest!({})
    run.finish()
    vi.advanceTimersByTime(60_000)
    expect(run.timedOut).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
