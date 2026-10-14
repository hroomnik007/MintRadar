// wsPolyfill must stay the first import: the root 'nostr-tools' SimplePool captures globalThis.WebSocket when it loads.
import '../wsPolyfill.js'
import { describe, it, expect, vi, afterEach } from 'vitest'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'
import { SimplePool as RootSimplePool, finalizeEvent, generateSecretKey } from 'nostr-tools'

// Relay connection errors must be handled where the connection is made: no call site may leave an uncaught exception
// or an unhandled rejection behind, however the relay misbehaves. Each backend call site that opens a Nostr relay
// socket runs its real code path against a stub relay on 127.0.0.1 (the DNS pin is replaced by a lookup that allows the
// loopback stub; the SSRF rules themselves are covered by ssrf*.test.ts).
//
// Regression: a relay that accepts the TCP connection but does not finish the WebSocket handshake made nostr-tools
// close the still-CONNECTING socket after its connection timeout; `ws` then emitted 'error' with no listener left
// (nostr-tools nulls onerror right after) -> "uncaughtException: WebSocket was closed before the connection was
// established", once per start (discovery at +10 s, the service profile at start).
vi.mock('../db.js', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }))
vi.mock('../ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssrf.js')>()
  return {
    ...actual,
    safeLookup: (_host: string, options: { all?: boolean }, cb: (err: Error | null, a: unknown, f?: number) => void): void => {
      const list = [{ address: '127.0.0.1', family: 4 }]
      if (options?.all) cb(null, list, 4); else cb(null, '127.0.0.1', 4)
    },
  }
})

import { publishToRelays } from '../nostrService.js'
import { createPoolPublisher } from '../healthPublisher.js'
import { connectRelayWs } from '../reviewsRelayFetch.js'

type Behaviour = 'refuse' | 'silent' | 'close-immediately' | 'ws-close' | 'invalid-frame'
const BEHAVIOURS: Behaviour[] = ['refuse', 'silent', 'close-immediately', 'ws-close', 'invalid-frame']

interface Stub { url: string; open: () => number; close: () => Promise<void> }

async function startStub(kind: Behaviour): Promise<Stub> {
  if (kind === 'refuse') {
    const probe = net.createServer()
    await new Promise<void>(r => probe.listen(0, '127.0.0.1', r))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>(r => probe.close(() => r()))
    return { url: `ws://127.0.0.1:${port}`, open: () => 0, close: async () => undefined }
  }
  if (kind === 'silent' || kind === 'close-immediately') {
    const socks = new Set<net.Socket>()
    const server = net.createServer(sock => {
      if (kind === 'close-immediately') { sock.destroy(); return }
      socks.add(sock)
      sock.resume() // read (and discard) so that the peer closing the connection is noticed
      sock.on('error', () => undefined)
      sock.on('close', () => socks.delete(sock))
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    return {
      url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
      open: () => socks.size,
      close: async () => { socks.forEach(s => s.destroy()); await new Promise<void>(r => server.close(() => r())) },
    }
  }
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>(r => wss.on('listening', () => r()))
  wss.on('connection', (ws: WsSocket) => {
    if (kind === 'ws-close') { ws.close(1011, 'bye'); return }
    ws.on('error', () => undefined)
    ws.on('message', () => {
      // not JSON, a frame with an invalid opcode, wrong shapes
      ws.send('not json')
      ws.send('["EVENT"]')
      ws.send('{"x":1}')
      ws.send('["OK"]')
      ;(ws as unknown as { _socket: net.Socket })._socket.write(Buffer.from([0x83, 0x00]))
    })
  })
  return {
    url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`,
    open: () => wss.clients.size,
    close: async () => { wss.clients.forEach(c => c.terminate()); await new Promise<void>(r => wss.close(() => r())) },
  }
}

const event = () => finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'x' }, generateSecretKey())

const SITES: Record<string, (url: string) => Promise<void>> = {
  'nostrService.publishToRelays (notifications, service profile)': async url => { await publishToRelays([url], event()) },
  'healthPublisher pool publisher (attestations)': async url => {
    const p = createPoolPublisher()
    try { await p.publish(url, event(), 2000) } catch { /* a refused publish is the expected outcome */ } finally { p.close() }
  },
  'root SimplePool (discovery.ts)': async url => {
    const pool = new RootSimplePool()
    try { await pool.querySync([url], { kinds: [1], limit: 1 }, { maxWait: 2000 }) } finally { pool.destroy() }
  },
  'reviewsRelayFetch.connectRelayWs (reviews sync)': async url => {
    const conn = await connectRelayWs(url, 1500).catch(() => null)
    if (!conn) return
    try { await conn.query({ kinds: [1], limit: 1 }, 1000) } finally { conn.close() }
  },
}

let detach: (() => void) | null = null
afterEach(() => { detach?.(); detach = null })

describe('relay connection errors are handled at the source', () => {
  for (const [site, run] of Object.entries(SITES)) {
    describe(site, () => {
      it.each(BEHAVIOURS)('relay behaviour "%s": returns cleanly, no uncaught exception or unhandled rejection, no socket left', async (kind) => {
        const stray: string[] = []
        const onUncaught = (e: Error): void => { stray.push(`uncaughtException: ${e.message}`) }
        const onRejection = (e: unknown): void => { stray.push(`unhandledRejection: ${String(e)}`) }
        process.on('uncaughtException', onUncaught)
        process.on('unhandledRejection', onRejection)
        detach = () => { process.off('uncaughtException', onUncaught); process.off('unhandledRejection', onRejection) }

        const stub = await startStub(kind)
        const t0 = Date.now()
        try {
          await Promise.race([
            run(stub.url),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('call site did not finish in time')), 10_000)),
          ])
          const took = Date.now() - t0
          await new Promise(r => setTimeout(r, 200)) // errors that arrive after the call returned
          expect(stray, 'stray async errors').toEqual([])
          expect(took, 'bounded by the connection timeout').toBeLessThan(9_000)
          await vi.waitFor(() => expect(stub.open()).toBe(0), { timeout: 2_000 })
        } finally {
          await stub.close()
        }
      }, 20_000)
    })
  }
})
