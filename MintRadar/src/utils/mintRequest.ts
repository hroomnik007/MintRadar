import { Mint, Wallet } from '@cashu/cashu-ts'
import { REQUEST_TIMEOUT_MS, type TokenRun } from '@/utils/tokenRun'

// The only place that touches cashu-ts's private `Mint._request`.
//
// cashu-ts has no public way to cancel a mint request: `Wallet.loadMint()` and
// `checkProofsStates()` take no signal. The supported hook is `new Mint(url, { customRequest })`,
// but the library's default request function (the one that parses big-integer JSON, maps mint
// errors and honours a `signal`) is not exported and is reachable only through the private
// field `mint._request`. We wrap that field and add our own AbortSignal per request.
//
// Verified against @cashu/cashu-ts 4.11.0 (the installed version; package.json declares ^4.11.0):
// aborting closes the connection, including a stall after the response headers, and rejects with
// an error named "CallerAbortError". src/__tests__/mintRequest.contract.test.ts fails loudly if a
// cashu-ts upgrade renames or removes the field. If `_request` is missing at runtime we fall back
// to a plain Wallet: nothing is cancellable then, and only TokenRun.race() + the overall timer
// recover the UI (the request itself may keep running in the background).

type MintCtor = typeof Mint
type WalletCtor = typeof Wallet
type RequestFn = NonNullable<ConstructorParameters<MintCtor>[1]>['customRequest']

export interface MintRequestDeps {
  MintCtor?: MintCtor
  WalletCtor?: WalletCtor
  requestTimeoutMs?: number
}

/**
 * Builds a Wallet whose mint requests are tied to `run`: each request aborts when the run does,
 * and after `requestTimeoutMs` (the run is marked timed out first, then everything in flight is
 * aborted, so the sibling requests of loadMint stop too). Without a run it is a plain Wallet.
 */
export function createMintWallet(mintUrl: string, unit: string, run?: TokenRun, deps: MintRequestDeps = {}): Wallet {
  const { MintCtor = Mint, WalletCtor = Wallet, requestTimeoutMs = REQUEST_TIMEOUT_MS } = deps
  if (!run) return new WalletCtor(mintUrl, { unit })

  const base = new MintCtor(mintUrl) as unknown as { _request?: unknown }
  const defaultRequest = base._request
  if (typeof defaultRequest !== 'function') return new WalletCtor(mintUrl, { unit })

  const customRequest = (async args => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (run.signal.aborted) abort()
    else run.signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => run.timeout(), requestTimeoutMs)
    try {
      return await (defaultRequest as NonNullable<RequestFn>)({ ...args, signal: controller.signal })
    } finally {
      clearTimeout(timer)
      run.signal.removeEventListener('abort', abort)
    }
  }) as NonNullable<RequestFn>

  return new WalletCtor(new MintCtor(mintUrl, { customRequest }), { unit })
}
