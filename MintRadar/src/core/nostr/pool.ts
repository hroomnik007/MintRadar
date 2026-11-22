import { SimplePool } from 'nostr-tools/pool'
import type { AbstractRelay } from 'nostr-tools/abstract-relay'

// Exponential backoff parameters for WebSocket relay reconnects.
// Start: 1s, doubles per attempt, cap: 5 min, ±20% jitter to avoid thundering herd.
const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS  = 300_000

// Patches a relay instance to use exponential backoff with jitter instead of
// nostr-tools' built-in stepped array [10s,10s,10s,20s,20s,30s,60s].
// Uses instance-level override so prototype of AbstractRelay is unchanged.
// Private nostr-tools relay internals we patch. Standalone shape (not an
// intersection with AbstractRelay) because reconnectAttempts is private there,
// which would collapse the intersection to never.
type PatchableRelay = {
  _backoffPatched?: boolean
  reconnectAttempts?: number
  resubscribeBackoff?: number[]
  reconnect(): Promise<void>
}

function applyExponentialBackoff(relay: AbstractRelay): void {
  const r = relay as unknown as PatchableRelay
  if (r._backoffPatched) return
  r._backoffPatched = true

  // Bind the original prototype method before shadowing it on the instance.
  const protoReconnect: () => Promise<void> =
    (Object.getPrototypeOf(relay) as { reconnect(): Promise<void> }).reconnect.bind(relay)

  r.reconnect = async function (this: PatchableRelay): Promise<void> {
    const attempts: number = this.reconnectAttempts ?? 0
    const base   = Math.min(BACKOFF_BASE_MS * (2 ** attempts), BACKOFF_CAP_MS)
    const jitter = base * 0.2 * (Math.random() * 2 - 1)
    this.resubscribeBackoff = [Math.round(base + jitter)]
    return protoReconnect()
  }
}

// P5 (UI/UX report 2026-11-22): a relay whose connection failed (e.g. a 502/503 from a dead relay) is skipped for
// the next RELAY_SKIP_MS of this page session instead of being dialled again by every query (each attempt is a
// console error and a slower "Loading reviews…"). Not while the browser is offline (then every relay fails and none
// is to blame), and the skip expires, so a relay that comes back is used again.
export const RELAY_SKIP_MS = 10 * 60_000
const failedRelays = new Map<string, number>() // normalised url -> skip until (epoch ms)

const relayKey = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase()

export function isRelaySkipped(url: string, now = Date.now()): boolean {
  const until = failedRelays.get(relayKey(url))
  if (until === undefined) return false
  if (now >= until) { failedRelays.delete(relayKey(url)); return false }
  return true
}

export function noteRelayFailure(url: string, now = Date.now()): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  failedRelays.set(relayKey(url), now + RELAY_SKIP_MS)
}

/** Tests only. */
export function resetRelaySkips(): void { failedRelays.clear() }

function createPool(): SimplePool {
  const pool = new SimplePool()
  const origEnsureRelay = pool.ensureRelay.bind(pool)
  // Override ensureRelay to patch each newly created relay's reconnect behaviour, and to skip a relay that failed
  // this session (SimplePool treats a rejected ensureRelay as that relay closing; the others answer as usual).
  ;(pool as unknown as { ensureRelay: typeof origEnsureRelay }).ensureRelay = async (
    url: string,
    params?: { connectionTimeout?: number; abort?: AbortSignal }
  ): Promise<AbstractRelay> => {
    if (isRelaySkipped(url)) throw new Error(`relay skipped after a failed connection this session: ${url}`)
    let relay: AbstractRelay
    try {
      relay = await origEnsureRelay(url, params)
    } catch (err) {
      if (!params?.abort?.aborted) noteRelayFailure(url)
      throw err
    }
    applyExponentialBackoff(relay)
    return relay
  }
  return pool
}

// Single WebSocket pool shared for the entire browser session.
// SimplePool lazily opens a connection per relay on first use and reuses it.
// Never call sharedPool.destroy() — it must remain alive for the app lifetime.
export const sharedPool = createPool()
