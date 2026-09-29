import { describe, it, expect, vi, afterEach } from 'vitest'
import { startTokenRun, classifyRunError, createRunGuard, RunAbortError, REQUEST_TIMEOUT_MS, OPERATION_TIMEOUT_MS } from '../utils/tokenRun'

// Stand-ins named like the cashu-ts errors: the classifier must go by `name`, and cashu-ts's own
// CallerAbortError / UncancellableReadError both extend NetworkError.
class NetworkError extends Error { constructor(m: string) { super(m); this.name = 'NetworkError' } }
class CallerAbortError extends NetworkError { constructor(m: string) { super(m); this.name = 'CallerAbortError' } }
class UncancellableReadError extends NetworkError { constructor(m: string) { super(m); this.name = 'UncancellableReadError' } }

afterEach(() => { vi.useRealTimers() })

describe('createRunGuard', () => {
  it('a captured id is current until the guard advances', () => {
    const g = createRunGuard()
    const id = g.next()
    expect(g.isCurrent(id)).toBe(true)
    g.next() // textarea edit, new run or unmount
    expect(g.isCurrent(id)).toBe(false)
  })

  it('only the newest id is current', () => {
    const g = createRunGuard()
    const a = g.next()
    const b = g.next()
    expect(g.isCurrent(a)).toBe(false)
    expect(g.isCurrent(b)).toBe(true)
  })

  it('guards are independent of each other', () => {
    const inspect = createRunGuard()
    const check = createRunGuard()
    const id = inspect.next()
    check.next()
    expect(inspect.isCurrent(id)).toBe(true)
  })
})

describe('classifyRunError', () => {
  it('an abort we did not time out is ignored (edit / new run / unmount)', () => {
    expect(classifyRunError(new CallerAbortError('Request aborted by caller'), { timedOut: false })).toBe('ignore')
    expect(classifyRunError(new RunAbortError(), { timedOut: false })).toBe('ignore')
  })

  it('an abort after our timedOut flag is our timeout', () => {
    expect(classifyRunError(new CallerAbortError('This operation was aborted'), { timedOut: true })).toBe('timeout')
    expect(classifyRunError(new RunAbortError(), { timedOut: true })).toBe('timeout')
  })

  it('tests CallerAbortError before NetworkError: it IS a NetworkError, but must not count as a failure', () => {
    const abort = new CallerAbortError('x')
    expect(abort instanceof NetworkError).toBe(true)
    expect(classifyRunError(abort, { timedOut: false })).toBe('ignore')
  })

  it('UncancellableReadError, NetworkError and other failures go to the existing error handling', () => {
    expect(classifyRunError(new UncancellableReadError('Request timed out after 10000ms'), { timedOut: false })).toBe('error')
    expect(classifyRunError(new UncancellableReadError('x'), { timedOut: true })).toBe('error')
    expect(classifyRunError(new NetworkError('Network request failed'), { timedOut: false })).toBe('error')
    expect(classifyRunError(new Error('boom'), { timedOut: false })).toBe('error')
    expect(classifyRunError('not an error', { timedOut: false })).toBe('error')
  })
})

describe('startTokenRun timers', () => {
  it('has the agreed constants', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(10_000)
    expect(OPERATION_TIMEOUT_MS).toBe(30_000)
  })

  it('the overall timer marks timedOut before it aborts', () => {
    vi.useFakeTimers()
    const run = startTokenRun()
    let timedOutAtAbort: boolean | null = null
    run.signal.addEventListener('abort', () => { timedOutAtAbort = run.timedOut })
    vi.advanceTimersByTime(OPERATION_TIMEOUT_MS - 1)
    expect(run.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1)
    expect(run.signal.aborted).toBe(true)
    expect(timedOutAtAbort).toBe(true)
  })

  it('cancel() aborts without marking a timeout and stops the timer', () => {
    vi.useFakeTimers()
    const run = startTokenRun()
    run.cancel()
    expect(run.signal.aborted).toBe(true)
    expect(run.timedOut).toBe(false)
    vi.advanceTimersByTime(OPERATION_TIMEOUT_MS * 2)
    expect(run.timedOut).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('finish() clears the timer, so a settled run never reports a timeout later', () => {
    vi.useFakeTimers()
    const run = startTokenRun()
    run.finish()
    vi.advanceTimersByTime(OPERATION_TIMEOUT_MS * 2)
    expect(run.timedOut).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('timeout() marks timedOut and aborts', () => {
    const run = startTokenRun()
    run.timeout()
    expect(run.timedOut).toBe(true)
    expect(run.signal.aborted).toBe(true)
  })
})

describe('TokenRun.race', () => {
  it('passes a result through', async () => {
    const run = startTokenRun()
    await expect(run.race(Promise.resolve(42))).resolves.toBe(42)
    run.finish()
  })

  it('passes a rejection through', async () => {
    const run = startTokenRun()
    await expect(run.race(Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    run.finish()
  })

  it('rejects with RunAbortError when the run aborts, even if the underlying promise never settles', async () => {
    const run = startTokenRun()
    const pending = run.race(new Promise<never>(() => undefined))
    run.cancel()
    await expect(pending).rejects.toBeInstanceOf(RunAbortError)
  })

  it('rejects at once for an already-aborted run, and swallows the late rejection of the loser', async () => {
    const run = startTokenRun()
    run.cancel()
    await expect(run.race(Promise.reject(new Error('late')))).rejects.toBeInstanceOf(RunAbortError)
  })

  it('an overall timeout settles a call the library cannot cancel', async () => {
    vi.useFakeTimers()
    const run = startTokenRun()
    const settled = run.race(new Promise<never>(() => undefined)).catch(e => e)
    vi.advanceTimersByTime(OPERATION_TIMEOUT_MS)
    const err = await settled
    expect(classifyRunError(err, run)).toBe('timeout')
  })
})
