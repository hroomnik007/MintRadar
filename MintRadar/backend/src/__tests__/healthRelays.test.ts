import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { generateSecretKey } from 'nostr-tools'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'
import type { AddressInfo } from 'node:net'

// Real WebSocket traffic against local stub relays (the pool, the DNS-pinned WebSocket class and the publish helper
// are the production ones): a relay that accepts, one that rejects with an OK false, one that only sends a NOTICE and
// one that never answers. The database is the only mock.

vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))

import { createPoolPublisher, planCycle, publishBatch, runAttestationCycle, type DueItem } from '../healthPublisher.js'
import { finalizeEvent } from 'nostr-tools'
import type { KnownMintLike } from '../walletApi.js'

type Mode = 'accept' | 'reject' | 'notice' | 'silent'

interface Stub { url: string; received: () => number; close: () => Promise<void> }

function startStub(mode: Mode): Promise<Stub> {
  return new Promise(resolve => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    let received = 0
    const sockets = new Set<WsSocket>()
    wss.on('connection', socket => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('message', data => {
        let msg: unknown
        try { msg = JSON.parse(String(data)) } catch { return }
        if (!Array.isArray(msg) || msg[0] !== 'EVENT') return
        received++
        const id = (msg[1] as { id: string }).id
        if (mode === 'accept') socket.send(JSON.stringify(['OK', id, true, '']))
        else if (mode === 'reject') socket.send(JSON.stringify(['OK', id, false, 'blocked: this key may not write here']))
        else if (mode === 'notice') socket.send(JSON.stringify(['NOTICE', 'ERROR: not accepting events from you']))
        // 'silent': no answer at all
      })
    })
    wss.on('listening', () => {
      const { port } = wss.address() as AddressInfo
      resolve({
        url: `ws://127.0.0.1:${port}`,
        received: () => received,
        close: () => new Promise<void>(res => { for (const s of sockets) s.terminate(); wss.close(() => res()) }),
      })
    })
  })
}

const sk = generateSecretKey()
function signedEvents(n: number): DueItem[] {
  const rows: KnownMintLike[] = Array.from({ length: n }, (_, i) => ({
    url: `https://mint${i + 1}.example.com`, name: null, archived: false, degraded: false, online: true, version: 'Nutshell/0.17.5',
    softwareLatest: { major: 0, minor: 17 }, nutsLimits: null, units: ['sat'], auditCzTotal: null, auditCzBlamed: null, auditCzFetchedAt: null,
    discoveredAt: '2026-01-01T00:00:00.000Z', reliabilityScore: 80, uptimePct24h: 100, uptimePct7d: 100, lastCheckedAt: new Date().toISOString(),
    reviewCount: 0, reviewRatedCount: 0, reviewAvgRating: null, operatorReviewCount: 0, latencyMs: 100,
  }))
  return planCycle(rows, new Map(), Date.now()).due.map(p => ({ d: p.d, candidate: p.candidate, event: finalizeEvent(p.template, sk) }))
}

let accept: Stub, reject: Stub, notice: Stub, silent: Stub
beforeAll(async () => {
  ;[accept, reject, notice, silent] = await Promise.all([startStub('accept'), startStub('reject'), startStub('notice'), startStub('silent')])
})
afterAll(async () => { await Promise.all([accept, reject, notice, silent].map(s => s.close())) })

describe('createPoolPublisher against stub relays', () => {
  it('resolves when the relay accepts', async () => {
    const p = createPoolPublisher()
    try { await expect(p.publish(accept.url, signedEvents(1)[0]!.event, 2000)).resolves.toBeUndefined() } finally { p.close() }
  })

  it('rejects when the relay answers OK false (reason kept)', async () => {
    const p = createPoolPublisher()
    try { await expect(p.publish(reject.url, signedEvents(1)[0]!.event, 2000)).rejects.toThrow(/blocked/) } finally { p.close() }
  })

  it('rejects when the relay only sends a NOTICE (no OK within the timeout)', async () => {
    const p = createPoolPublisher()
    try { await expect(p.publish(notice.url, signedEvents(1)[0]!.event, 400)).rejects.toThrow() } finally { p.close() }
  })

  it('rejects after the timeout when the relay never answers', async () => {
    const p = createPoolPublisher()
    const started = Date.now()
    try { await expect(p.publish(silent.url, signedEvents(1)[0]!.event, 300)).rejects.toThrow(/timeout/) } finally { p.close() }
    expect(Date.now() - started).toBeLessThan(2500)
  })

  it('rejects quickly when nothing listens on the port', async () => {
    const dead = await startStub('accept')
    const url = dead.url
    await dead.close()
    const p = createPoolPublisher()
    try { await expect(p.publish(url, signedEvents(1)[0]!.event, 1500)).rejects.toThrow() } finally { p.close() }
  })
})

describe('publishBatch against stub relays', () => {
  it('after 3 failures a relay is skipped; the state callback fires once an accepting relay took the event', async () => {
    const items = signedEvents(6)
    const accepted: string[] = []
    const publisher = createPoolPublisher()
    let stats
    try {
      stats = await publishBatch(items, {
        publisher, relays: [reject.url, accept.url], pauseMs: 0, timeoutMs: 1500, onAccepted: async i => { accepted.push(i.d) },
      })
    } finally { publisher.close() }
    expect(stats.relays[reject.url]).toEqual({ ok: 0, failed: 3, skipped: 3 })
    expect(stats.relays[accept.url]).toEqual({ ok: 6, failed: 0, skipped: 0 })
    expect(reject.received()).toBeGreaterThanOrEqual(3)
    expect(accepted).toHaveLength(6)
    expect(stats.accepted).toBe(6)
  })

  it('no state callback when every relay rejects, answers with a NOTICE or stays silent', async () => {
    const items = signedEvents(4)
    const onAccepted = vi.fn(async () => {})
    const publisher = createPoolPublisher()
    let stats
    try {
      stats = await publishBatch(items, { publisher, relays: [reject.url, notice.url, silent.url], pauseMs: 0, timeoutMs: 250, onAccepted })
    } finally { publisher.close() }
    expect(onAccepted).not.toHaveBeenCalled()
    expect(stats.accepted).toBe(0)
    for (const relay of [reject.url, notice.url, silent.url]) {
      expect(stats.relays[relay]).toEqual({ ok: 0, failed: 3, skipped: 1 })
    }
  })
})

describe('runAttestationCycle against stub relays', () => {
  it('writes the state only for events a relay accepted', async () => {
    const saved: string[] = []
    const rows = signedEvents(3).map(i => i.d)
    const res = await runAttestationCycle({
      secretKey: sk,
      loadSnapshot: async () => ({
        computedAt: Date.now(),
        data: rows.map((url, n) => ({
          url, name: null, archived: false, degraded: false, online: true, version: null, softwareLatest: null, nutsLimits: null, units: null,
          auditCzTotal: null, auditCzBlamed: null, auditCzFetchedAt: null, discoveredAt: '2026-01-01T00:00:00.000Z', reliabilityScore: 70 + n,
          uptimePct24h: 100, uptimePct7d: 100, lastCheckedAt: new Date().toISOString(), reviewCount: 0, reviewRatedCount: 0,
          reviewAvgRating: null, operatorReviewCount: 0, latencyMs: 1,
        } satisfies KnownMintLike)),
      }),
      loadStates: async () => new Map(),
      saveState: async (d: string) => { saved.push(d) },
      relays: [reject.url, accept.url], pauseMs: 0, timeoutMs: 1500, log: () => {},
    })
    expect(res.accepted).toBe(3)
    expect(saved.sort()).toEqual([...rows].sort())
  })
})
