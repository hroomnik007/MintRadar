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

function createPool(): SimplePool {
  const pool = new SimplePool()
  const origEnsureRelay = pool.ensureRelay.bind(pool)
  // Override ensureRelay to patch each newly created relay's reconnect behaviour.
  ;(pool as unknown as { ensureRelay: typeof origEnsureRelay }).ensureRelay = async (
    url: string,
    params?: { connectionTimeout?: number; abort?: AbortSignal }
  ): Promise<AbstractRelay> => {
    const relay = await origEnsureRelay(url, params)
    applyExponentialBackoff(relay)
    return relay
  }
  return pool
}

// Single WebSocket pool shared for the entire browser session.
// SimplePool lazily opens a connection per relay on first use and reuses it.
// Never call sharedPool.destroy() — it must remain alive for the app lifetime.
export const sharedPool = createPool()
