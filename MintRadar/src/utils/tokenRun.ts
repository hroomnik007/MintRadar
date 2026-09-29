// Cancellation + deadline plumbing for the Token Inspector's network operations
// (Inspect & Verify, Check if spent). Pure logic, no React: Tools.tsx owns the refs.

/** Per HTTP request to the token's mint (each of /v1/info, /v1/keysets, /v1/keys, /v1/checkstate). */
export const REQUEST_TIMEOUT_MS = 10_000
/** Whole operation, Inspect and Check each on their own: loadMint plus, for Check, every checkstate chunk. */
export const OPERATION_TIMEOUT_MS = 30_000

/** Thrown by TokenRun.race() when the run is aborted, so a path where the library cannot be
 *  cancelled (see mintRequest.ts fallback) still settles. The name is what classifyRunError reads. */
export class RunAbortError extends Error {
  constructor() {
    super('Run aborted')
    this.name = 'RunAbortError'
  }
}

export interface TokenRun {
  readonly signal: AbortSignal
  /** True once OUR timer (per-request or overall) fired. Set before the abort, so an abort
   *  error can be told apart from an edit-triggered one. */
  readonly timedOut: boolean
  /** Textarea edit, new run of the same kind, unmount: abort silently. */
  cancel(): void
  /** A deadline passed: mark timedOut first, then abort everything still in flight. */
  timeout(): void
  /** The operation settled: stop the overall timer and abort any stragglers (e.g. the sibling
   *  requests of a loadMint whose Promise.all already rejected). */
  finish(): void
  /** Settles with `p`, or rejects with RunAbortError as soon as the run is aborted. */
  race<T>(p: Promise<T>): Promise<T>
}

export function startTokenRun(overallMs: number = OPERATION_TIMEOUT_MS): TokenRun {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => run.timeout(), overallMs)

  const run: TokenRun = {
    signal: controller.signal,
    get timedOut() { return timedOut },
    cancel() {
      clearTimeout(timer)
      controller.abort()
    },
    timeout() {
      timedOut = true
      clearTimeout(timer)
      controller.abort()
    },
    finish() {
      clearTimeout(timer)
      controller.abort()
    },
    race<T>(p: Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (controller.signal.aborted) {
          p.catch(() => undefined)
          reject(new RunAbortError())
          return
        }
        const onAbort = () => reject(new RunAbortError())
        controller.signal.addEventListener('abort', onAbort, { once: true })
        p.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', onAbort))
      })
    },
  }
  return run
}

export type RunFailure = 'ignore' | 'timeout' | 'error'

/**
 * Decides what a failed run means. CallerAbortError (cashu-ts) / RunAbortError (ours) is tested
 * FIRST and by `name`: both are subclasses of NetworkError in cashu-ts (as is
 * UncancellableReadError), so an instanceof NetworkError check would swallow an abort.
 * An abort with our timedOut flag set is our timeout; any other abort was an edit, a new run
 * or an unmount and is ignored. Everything else (NetworkError, UncancellableReadError,
 * HttpResponseError, InvalidMintUrlError, …) goes to the caller's existing error handling.
 */
export function classifyRunError(err: unknown, run: Pick<TokenRun, 'timedOut'>): RunFailure {
  const name = err instanceof Error ? err.name : undefined
  if (name === 'CallerAbortError' || name === 'RunAbortError') return run.timedOut ? 'timeout' : 'ignore'
  return 'error'
}

/**
 * Run-id guard, belt and braces on top of real cancellation: every async path captures an id
 * when it starts and discards its result (no state writes at all) if the id has moved on.
 * Advance it on every textarea edit, every new run of that kind, and on unmount.
 */
export interface RunGuard {
  /** Advances the id and returns the new one (the id a fresh run should capture). */
  next(): number
  isCurrent(id: number): boolean
}

export function createRunGuard(): RunGuard {
  let current = 0
  return {
    next: () => ++current,
    isCurrent: id => id === current,
  }
}
