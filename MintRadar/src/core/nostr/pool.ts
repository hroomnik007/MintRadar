import { SimplePool } from 'nostr-tools/pool'

// Single WebSocket pool shared for the entire browser session.
// SimplePool lazily opens a connection per relay on first use and reuses it.
// Never call sharedPool.destroy() — it must remain alive for the app lifetime.
export const sharedPool = new SimplePool()
