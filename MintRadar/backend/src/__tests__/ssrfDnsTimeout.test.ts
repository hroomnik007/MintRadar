import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The DNS step of the SSRF check is bounded: DNS_LOOKUP_CEILING_MS of its own, inside the request deadline.
// Stubs and fake timers only: no real DNS, no socket.
const undiciFetch = vi.fn()
vi.mock('undici', () => ({
  Agent: class { constructor(public opts: unknown) {} },
  fetch: (...a: unknown[]) => undiciFetch(...a),
}))
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('dns', () => ({ lookup: vi.fn() }))

import { lookup } from 'dns/promises'
import { lookup as connectLookup } from 'dns'
import { checkUrlSafety, checkWsUrlSafety, safeFetch, safeLookup, DNS_LOOKUP_CEILING_MS } from '../ssrf.js'

const vLookup = vi.mocked(lookup)
const cLookup = vi.mocked(connectLookup)
const PUBLIC = [{ address: '93.184.216.34', family: 4 }]
const never = (): Promise<never> => new Promise(() => undefined)
const resolvesAfter = (ms: number, value: unknown = PUBLIC): Promise<unknown> => new Promise(res => setTimeout(() => res(value), ms))

/** Settles a promise into a recorder so a test can ask "is it done yet?" at a fake-clock instant. */
function track<T>(p: Promise<T>): { done: boolean; value?: T } {
  const rec: { done: boolean; value?: T } = { done: false }
  void p.then(v => { rec.done = true; rec.value = v })
  return rec
}

beforeEach(() => {
  vi.useFakeTimers()
  undiciFetch.mockReset(); vLookup.mockReset(); cLookup.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('the DNS ceiling', () => {
  it('is 3 seconds', () => { expect(DNS_LOOKUP_CEILING_MS).toBe(3000) })

  it('a lookup that never resolves fails closed with dns-error at 3 s, not later', async () => {
    vLookup.mockImplementation(never as never)
    const r = track(checkUrlSafety('https://mint.example.com'))
    await vi.advanceTimersByTimeAsync(2999)
    expect(r.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(r).toEqual({ done: true, value: 'dns-error' })
  })

  it('a lookup that resolves at 2.9 s is accepted normally', async () => {
    vLookup.mockImplementation((() => resolvesAfter(2900)) as never)
    const r = track(checkUrlSafety('https://mint.example.com'))
    await vi.advanceTimersByTimeAsync(2900)
    expect(r).toEqual({ done: true, value: 'safe' })
  })

  it('a late answer is never turned into "safe" and nothing is cached', async () => {
    vLookup.mockImplementationOnce((() => resolvesAfter(4000)) as never)
    const first = track(checkUrlSafety('https://mint.example.com'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(first.value).toBe('dns-error')
    vLookup.mockImplementationOnce((() => resolvesAfter(10)) as never)
    const second = track(checkUrlSafety('https://mint.example.com'))
    await vi.advanceTimersByTimeAsync(10)
    expect(second.value).toBe('safe')
    expect(vLookup).toHaveBeenCalledTimes(2)
  })

  it('the timeout is logged with a distinguishable detail, without the host name', async () => {
    vLookup.mockImplementation(never as never)
    void checkUrlSafety('https://secret-host.example.com')
    await vi.advanceTimersByTimeAsync(3000)
    expect(console.warn).toHaveBeenCalledWith('[ssrf] dns-timeout')
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).not.toContain('secret-host')
  })

  it('no budget left (ceiling used up, or deadline passed): dns-error at once, the resolver is not even asked', async () => {
    expect(await checkUrlSafety('https://mint.example.com', { deadlineAt: Date.now() + 60_000, dnsUsedMs: DNS_LOOKUP_CEILING_MS })).toBe('dns-error')
    expect(await checkUrlSafety('https://mint.example.com', { deadlineAt: Date.now() - 1, dnsUsedMs: 0 })).toBe('dns-error')
    expect(vLookup).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the relay variant (ws/wss) fails closed at the same bound', async () => {
    vLookup.mockImplementation(never as never)
    const r = track(checkWsUrlSafety('wss://relay.example.com'))
    await vi.advanceTimersByTimeAsync(2999)
    expect(r.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(r).toEqual({ done: true, value: 'dns-error' })
  })
})

describe('one shared deadline per request (safeFetch)', () => {
  /** AbortSignal.timeout runs on a native timer that fake timers cannot move: build the same signal on the fake clock. */
  function fakeClockAbortTimeout(): void {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const c = new AbortController()
      setTimeout(() => c.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), ms)
      return c.signal
    })
  }
  const hangUntilAborted = (_url: string, init: { signal: AbortSignal }): Promise<never> =>
    new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)))

  it('DNS that took 2 s is subtracted: a hanging fetch is aborted at 5 s in total, not at 7 s', async () => {
    fakeClockAbortTimeout()
    vLookup.mockImplementation((() => resolvesAfter(2000)) as never)
    undiciFetch.mockImplementation(hangUntilAborted)
    const errors: unknown[] = []
    const r = track(safeFetch('https://mint.example.com/v1/info', { timeoutMs: 5000, onError: e => errors.push(e) }))
    await vi.advanceTimersByTimeAsync(4999)
    expect(r.done).toBe(false)
    expect(undiciFetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(r).toEqual({ done: true, value: null })
    expect(errors).toHaveLength(1)
  })

  it('a hanging resolver cannot eat the whole fetch budget: refused at 3 s (dns-error), no request sent', async () => {
    fakeClockAbortTimeout()
    vLookup.mockImplementation(never as never)
    const why: string[] = []
    const r = track(safeFetch('https://mint.example.com/', { timeoutMs: 5000, onRejected: x => why.push(x) }))
    await vi.advanceTimersByTimeAsync(3000)
    expect(r).toEqual({ done: true, value: null })
    expect(why).toEqual(['dns-error'])
    expect(undiciFetch).not.toHaveBeenCalled()
  })

  it('when the request deadline is shorter than the ceiling, the deadline wins', async () => {
    fakeClockAbortTimeout()
    vLookup.mockImplementation(never as never)
    const r = track(safeFetch('https://mint.example.com/', { timeoutMs: 1000 }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(r).toEqual({ done: true, value: null })
  })

  it('two lookups in one request (a redirect hop) share the 3 s ceiling, not 3 s plus 3 s', async () => {
    fakeClockAbortTimeout()
    vLookup
      .mockImplementationOnce((() => resolvesAfter(2000)) as never)
      .mockImplementation(never as never)
    undiciFetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://other.example.com/' } }))
    const why: string[] = []
    const r = track(safeFetch('https://mint.example.com/', { timeoutMs: 20_000, onRejected: x => why.push(x) }))
    await vi.advanceTimersByTimeAsync(2999)
    expect(r.done).toBe(false) // second lookup has only 1 s left, started at t=2000
    await vi.advanceTimersByTimeAsync(1)
    expect(r).toEqual({ done: true, value: null })
    expect(why).toEqual(['dns-error'])
    expect(vLookup).toHaveBeenCalledTimes(2)
  })

  it('a fast lookup per hop is unaffected (budget only counts time actually spent)', async () => {
    fakeClockAbortTimeout()
    vLookup.mockImplementation((() => resolvesAfter(500)) as never)
    undiciFetch
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://b.example.com/' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://c.example.com/' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const r = track(safeFetch('https://a.example.com/', { timeoutMs: 20_000 }))
    await vi.advanceTimersByTimeAsync(1500)
    expect(r.done).toBe(true)
    expect((r.value as Response).status).toBe(200)
  })
})

describe('no dangling work', () => {
  it('zero pending timers after success, after a failed lookup and after a timeout', async () => {
    vLookup.mockImplementationOnce((() => resolvesAfter(10)) as never)
    const ok = track(checkUrlSafety('https://mint.example.com'))
    await vi.advanceTimersByTimeAsync(10)
    expect(ok.value).toBe('safe')
    expect(vi.getTimerCount()).toBe(0)

    vLookup.mockRejectedValueOnce(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }))
    expect(await checkUrlSafety('https://mint.example.com')).toBe('dns-error')
    expect(vi.getTimerCount()).toBe(0)

    vLookup.mockImplementationOnce((() => { throw new Error('sync throw') }) as never)
    expect(await checkUrlSafety('https://mint.example.com')).toBe('dns-error')
    expect(vi.getTimerCount()).toBe(0)

    vLookup.mockImplementationOnce(never as never)
    const t = track(checkUrlSafety('https://mint.example.com'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(t.value).toBe('dns-error')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a refusal before DNS (blocked URL) starts no timer at all', async () => {
    expect(await checkUrlSafety('https://127.0.0.1/')).toBe('blocked')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a lookup that rejects after the timeout produces no unhandledRejection and no uncaughtException', async () => {
    const seen: string[] = []
    const onRej = (e: unknown): void => { seen.push(`unhandledRejection: ${String(e)}`) }
    const onExc = (e: unknown): void => { seen.push(`uncaughtException: ${String(e)}`) }
    process.on('unhandledRejection', onRej)
    process.on('uncaughtException', onExc)
    try {
      vLookup.mockImplementation((() => new Promise((_res, rej) => setTimeout(() => rej(Object.assign(new Error('late'), { code: 'ESERVFAIL' })), 4000))) as never)
      const r = track(checkUrlSafety('https://mint.example.com'))
      await vi.advanceTimersByTimeAsync(3000)
      expect(r.value).toBe('dns-error')
      await vi.advanceTimersByTimeAsync(1500) // the abandoned lookup rejects at t=4000
      vi.useRealTimers()
      await new Promise(res => setTimeout(res, 200))
      expect(seen).toEqual([])
    } finally {
      process.off('unhandledRejection', onRej)
      process.off('uncaughtException', onExc)
    }
  })
})

describe('the DNS-pinned connect path (safeLookup, used by DnsPinnedWebSocket and undici)', () => {
  type Cb = (err: Error | null, addr: unknown, family?: number) => void

  it('fails closed at the same bound with an ETIMEOUT error', async () => {
    cLookup.mockImplementation((() => undefined) as never)
    const cb = vi.fn()
    safeLookup('relay.example.com', {}, cb as never)
    await vi.advanceTimersByTimeAsync(2999)
    expect(cb).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(cb).toHaveBeenCalledTimes(1)
    expect((cb.mock.calls[0]![0] as NodeJS.ErrnoException).code).toBe('ETIMEOUT')
    expect(cb.mock.calls[0]![1]).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an answer after the timeout is dropped (the callback runs exactly once)', async () => {
    let late: Cb | undefined
    cLookup.mockImplementation(((_h: string, _o: unknown, c: Cb) => { late = c }) as never)
    const cb = vi.fn()
    safeLookup('relay.example.com', {}, cb as never)
    await vi.advanceTimersByTimeAsync(3000)
    late!(null, PUBLIC)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('an answer in time clears the timer and is passed on unchanged', async () => {
    cLookup.mockImplementation(((_h: string, _o: unknown, c: Cb) => { setTimeout(() => c(null, PUBLIC), 2900) }) as never)
    const cb = vi.fn()
    safeLookup('relay.example.com', {}, cb as never)
    await vi.advanceTimersByTimeAsync(2900)
    expect(cb).toHaveBeenCalledWith(null, PUBLIC, 4)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a synchronous throw of the resolver still propagates and leaves no timer behind', () => {
    cLookup.mockImplementation((() => { throw new TypeError('bad arg') }) as never)
    expect(() => safeLookup('relay.example.com', {}, vi.fn() as never)).toThrow('bad arg')
    expect(vi.getTimerCount()).toBe(0)
  })
})
