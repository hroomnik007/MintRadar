import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

// A unit test never talks to a real relay. The page under test reaches nostr-tools through `sharedPool`
// (src/core/nostr/pool.ts), and a real WebSocket that connects while jsdom is torn down made undici dispatch an Event that
// jsdom's EventTarget rejects: an "Unhandled Error" ("The "event" argument must be an instance of Event") in about one
// whole-suite run in five, reported on whichever test file happened to be running (Task F3). So the global WebSocket is a
// stub that refuses to connect and records the attempt, and the test that made it FAILS, with the relay URLs, instead of a
// stray error later. Fix such a test by mocking '@/core/nostr/pool' (see watchlistSync.test.ts) or the hook; a test that
// needs its own socket class stubs it with vi.stubGlobal('WebSocket', ...).
const refused: string[] = []

class RefusedWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  constructor(url: string | URL) {
    refused.push(String(url))
    throw new Error('A unit test tried to open a real WebSocket')
  }
}
globalThis.WebSocket = RefusedWebSocket as unknown as typeof WebSocket

afterEach(() => {
  if (refused.length === 0) return
  const urls = [...new Set(refused.splice(0))]
  throw new Error(`This test opened a real WebSocket (${urls.join(', ')}). Mock '@/core/nostr/pool' (or the hook that uses it) instead of reaching the network.`)
})
