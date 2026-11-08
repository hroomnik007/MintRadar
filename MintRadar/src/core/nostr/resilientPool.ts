import { SimplePool } from 'nostr-tools/pool'
import type { Filter } from 'nostr-tools'
import type { SubCloser, SubscribeManyParams } from 'nostr-tools/abstract-pool'

// NIP-46 transport pool that survives relay loss (e.g. Android closing a backgrounded browser's
// websockets while the user approves in Amber). Plain SimplePool reports a subscription closed
// as soon as every relay dropped it, and nostr-tools' BunkerSigner then gives up: fromURI rejects
// ("subscription closed before connection was established") and a live signer rejects every
// pending request. Here such a drop is NOT reported to the caller; the subscription is reopened
// (SimplePool creates fresh relay connections) when the page comes back (visibilitychange →
// visible, online, pageshow) or after a capped backoff. It is reported closed only when the
// caller closes it, its abort signal fires, or the pool is destroyed — so the owner's deadline
// (pairing timeout, logout) still bounds everything. Same pattern as other NIP-46 web clients
// that restore subscriptions on resume; independently implemented. Logs nothing.

const RETRY_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000]

type CloseReasons = Parameters<NonNullable<SubscribeManyParams['onclose']>>[0]

interface ManagedSub {
  down: boolean
  done: boolean
  closing: boolean
  attempts: number
  inner?: SubCloser
  timer?: ReturnType<typeof setTimeout> | undefined
  lastReasons: CloseReasons
  reopen: () => void
  finish: (reasons: CloseReasons) => void
}

export class ResilientNip46Pool extends SimplePool {
  private readonly managed = new Set<ManagedSub>()
  private destroyed = false
  private readonly onResume = () => { for (const m of [...this.managed]) if (m.down && !m.done && !m.closing) m.reopen() }
  private readonly onVisibility = () => { if (document.visibilityState === 'visible') this.onResume() }

  constructor() {
    super()
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onResume)
      window.addEventListener('pageshow', this.onResume)
      document.addEventListener('visibilitychange', this.onVisibility)
    }
  }

  /** True while at least one subscription has lost every relay and is waiting to reopen. */
  isDisconnected(): boolean {
    for (const m of this.managed) if (m.down && !m.done) return true
    return false
  }

  override subscribe(relays: string[], filter: Filter, params: SubscribeManyParams): SubCloser {
    const { abort, onclose, ...rest } = params
    const m: ManagedSub = {
      down: false,
      done: false,
      closing: false,
      attempts: 0,
      lastReasons: [],
      reopen: () => {
        if (m.done || m.closing) return
        if (m.timer !== undefined) { clearTimeout(m.timer); m.timer = undefined }
        m.down = false
        open()
      },
      finish: reasons => {
        if (m.done) return
        m.done = true
        if (m.timer !== undefined) clearTimeout(m.timer)
        this.managed.delete(m)
        abort?.removeEventListener('abort', onAbort)
        onclose?.(reasons)
      },
    }
    const open = () => {
      const inner = super.subscribe(relays, filter, {
        ...rest,
        onclose: reasons => {
          if (m.inner !== inner) return // an older generation closing after a reopen
          m.lastReasons = reasons
          if (m.done) return
          if (m.closing || this.destroyed) { m.finish(reasons); return }
          // Every relay dropped: keep the caller's subscription alive and reopen later.
          m.down = true
          const delay = RETRY_BACKOFF_MS[Math.min(m.attempts, RETRY_BACKOFF_MS.length - 1)]!
          m.attempts++
          m.timer = setTimeout(() => { m.timer = undefined; if (m.down) m.reopen() }, delay)
        },
        onevent: event => { m.attempts = 0; rest.onevent?.(event) },
      })
      m.inner = inner
    }
    const onAbort = () => closer.close('aborted')
    const closer: SubCloser = {
      // Like SimplePool, the caller's onclose is delivered asynchronously (nostr-tools' fromURI
      // relies on that: it closes its own subscription before marking the pairing successful).
      close: (reason?: string) => {
        if (m.done || m.closing) return
        m.closing = true
        if (m.timer !== undefined) { clearTimeout(m.timer); m.timer = undefined }
        if (!m.down && m.inner) void m.inner.close(reason)
        else void Promise.resolve().then(() => m.finish(m.lastReasons))
      },
    }
    this.managed.add(m)
    if (abort?.aborted) { m.finish([]); return closer }
    abort?.addEventListener('abort', onAbort, { once: true })
    open()
    return closer
  }

  override destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onResume)
      window.removeEventListener('pageshow', this.onResume)
      document.removeEventListener('visibilitychange', this.onVisibility)
    }
    super.destroy()
    // Subscriptions waiting to reopen have no live inner subscription to report their close.
    for (const m of [...this.managed]) m.finish(m.lastReasons)
  }
}
