import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateSecretKey, getPublicKey, finalizeEvent, matchFilter, type Event, type Filter } from 'nostr-tools'
import { getConversationKey, encrypt, decrypt } from 'nostr-tools/nip44'
import { useWebSocketImplementation as setWebSocketImplementation } from 'nostr-tools/pool'

// Lower-layer test: REAL nostr-tools (BunkerSigner, SimplePool, relays) over a fake websocket
// relay hub. Only throwaway keys generated here; nothing leaves the process.
vi.mock('@/stores/auth.store', () => ({ useAuthStore: { getState: () => ({ logout: vi.fn() }) } }))
vi.mock('@/core/nostr/pool', () => ({ sharedPool: {} }))

class Hub {
  sockets = new Set<FakeWS>()
  published: Event[] = []
  accepting = true
  dropAll() { for (const s of [...this.sockets]) s.serverClose() }
  deliver(ev: Event) {
    for (const s of this.sockets) for (const [id, f] of s.subs) if (matchFilter(f, ev)) s.push(['EVENT', id, ev])
  }
}
const hub = new Hub()

class FakeWS {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
  readyState = 0
  subs = new Map<string, Filter>()
  onopen: (() => void) | null = null
  onmessage: ((m: { data: string }) => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(public url: string) {
    setTimeout(() => {
      if (!hub.accepting) { this.readyState = 3; this.onerror?.(new Error('refused')); this.onclose?.({ code: 1006, reason: 'refused' }); return }
      this.readyState = 1; hub.sockets.add(this); this.onopen?.()
    }, 0)
  }
  push(msg: unknown[]) { if (this.readyState === 1) setTimeout(() => this.onmessage?.({ data: JSON.stringify(msg) }), 0) }
  send(raw: string) {
    const msg = JSON.parse(raw) as unknown[]
    if (msg[0] === 'REQ') { this.subs.set(msg[1] as string, msg[2] as Filter); this.push(['EOSE', msg[1]]) }
    else if (msg[0] === 'CLOSE') this.subs.delete(msg[1] as string)
    else if (msg[0] === 'EVENT') { const ev = msg[1] as Event; hub.published.push(ev); this.push(['OK', ev.id, true, '']); hub.deliver(ev) }
  }
  close() { if (this.readyState >= 2) return; this.readyState = 3; hub.sockets.delete(this); setTimeout(() => this.onclose?.({ code: 1000, reason: '' }), 0) }
  serverClose() { this.readyState = 3; hub.sockets.delete(this); this.subs.clear(); this.onclose?.({ code: 1006, reason: 'gone' }) }
  ping() {}
}
setWebSocketImplementation(FakeWS)

import { initBunkerQR } from '@/core/nostr/client'

const USER_SK = generateSecretKey()
const USER_PK = getPublicKey(USER_SK)
const SIGNER_SK = generateSecretKey() // remote-signer transport key ≠ user key

function parse(uri: string) {
  const u = new URL(uri.replace('nostrconnect://', 'https://'))
  return { clientPk: u.hostname, secret: u.searchParams.get('secret')! }
}
function fromSigner(clientPk: string, payload: object): Event {
  const ck = getConversationKey(SIGNER_SK, clientPk)
  return finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', clientPk]], content: encrypt(JSON.stringify(payload), ck) }, SIGNER_SK)
}
function requestsFromClient(clientPk: string): { id: string; method: string }[] {
  // One request is published to every relay: dedupe by event id.
  const unique = [...new Map(hub.published.filter(e => e.pubkey === clientPk).map(e => [e.id, e])).values()]
  return unique.map(e => JSON.parse(decrypt(e.content, getConversationKey(SIGNER_SK, clientPk))) as { id: string; method: string })
}
const flush = async (ms = 50) => { await vi.advanceTimersByTimeAsync(ms) }
const setVisible = () => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }

beforeEach(() => {
  vi.useFakeTimers()
  hub.sockets.clear(); hub.published = []; hub.accepting = true
  sessionStorage.clear()
  delete (window as { nostr?: unknown }).nostr
})
afterEach(() => { vi.useRealTimers() })

describe('NIP-46 pairing over a resilient pool (real nostr-tools, fake relays)', () => {
  it('all relays drop while backgrounded → keeps waiting → resubscribes on return → ack after reconnect logs in', async () => {
    const { uri, loginPromise } = initBunkerQR()
    const settled = loginPromise.then(p => ({ ok: p }), (e: Error) => ({ err: e }))
    await flush()
    const { clientPk, secret } = parse(uri)
    expect(hub.sockets.size).toBeGreaterThan(0)

    hub.accepting = false
    hub.dropAll()                      // Android closes every socket
    await flush(1000)
    expect(await Promise.race([settled, Promise.resolve('pending')])).toBe('pending') // not rejected

    hub.accepting = true
    setVisible()                        // user returns to the browser
    await flush()
    expect(hub.sockets.size).toBeGreaterThan(0)

    hub.deliver(fromSigner(clientPk, { id: 'x', result: secret }))   // ack only AFTER reconnection
    await flush(1500)
    const gpk = requestsFromClient(clientPk).filter(r => r.method === 'get_public_key')
    expect(gpk.length).toBe(1)
    hub.deliver(fromSigner(clientPk, { id: gpk[0]!.id, result: USER_PK }))
    await flush()
    const r = await settled
    expect(r).toEqual({ ok: { pubkey: USER_PK, npub: expect.stringMatching(/^npub1/) } })
    expect(sessionStorage.getItem('bunkerPubkey')).toBe(USER_PK)
    // Identity comes from get_public_key, never the transport signer pubkey.
    expect(sessionStorage.getItem('bunkerPubkey')).not.toBe(getPublicKey(SIGNER_SK))
    expect(requestsFromClient(clientPk).some(q => q.method === 'sign_event')).toBe(false)
  })

  it('reopens on its own backoff even without a visibility event', async () => {
    const { uri, loginPromise } = initBunkerQR()
    void loginPromise.catch(() => {})
    await flush()
    hub.dropAll()
    expect(hub.sockets.size).toBe(0)
    await flush(5_100)
    expect(hub.sockets.size).toBeGreaterThan(0)
    void uri
  })

  it('still disconnected at the 2-minute deadline → actionable connection error; nothing saved, nothing left running', async () => {
    const { loginPromise } = initBunkerQR()
    const settled = loginPromise.catch((e: Error) => e)
    await flush()
    hub.accepting = false
    hub.dropAll()
    await flush(120_000)
    const err = await settled
    expect(err).toMatchObject({ name: 'PairingConnectionLost' })
    expect(sessionStorage.getItem('bunkerPubkey')).toBeNull()
    hub.accepting = true
    await flush(60_000)
    expect(hub.sockets.size).toBe(0) // no reconnect after the pool was disposed
  })

  it('connected but no signer at the deadline → the normal timeout message', async () => {
    const { loginPromise } = initBunkerQR()
    const settled = loginPromise.catch((e: Error) => e)
    await flush(120_000)
    expect((await settled as Error).message).toMatch(/timed out/i)
  })

  it('cancel while reconnecting is a clean AbortError; a late ack afterwards saves nothing and reopens nothing', async () => {
    const { uri, loginPromise, cancel } = initBunkerQR()
    const settled = loginPromise.catch((e: Error) => e)
    await flush()
    const { clientPk, secret } = parse(uri)
    hub.accepting = false
    hub.dropAll()
    await flush(100)
    cancel()
    expect(await settled).toMatchObject({ name: 'AbortError' })
    hub.accepting = true
    setVisible()
    await flush(30_000)
    expect(hub.sockets.size).toBe(0)
    hub.deliver(fromSigner(clientPk, { id: 'x', result: secret }))
    await flush()
    expect(sessionStorage.getItem('bunkerPubkey')).toBeNull()
    expect((window as { nostr?: unknown }).nostr).toBeUndefined()
  })
})

describe('logged-in NIP-46 session over the resilient pool', () => {
  async function login() {
    const { uri, loginPromise } = initBunkerQR()
    await flush()
    const { clientPk, secret } = parse(uri)
    hub.deliver(fromSigner(clientPk, { id: 'x', result: secret }))
    await flush(1500)
    const gpk = requestsFromClient(clientPk).find(r => r.method === 'get_public_key')!
    hub.deliver(fromSigner(clientPk, { id: gpk.id, result: USER_PK }))
    await flush()
    await loginPromise
    return clientPk
  }

  it('a request in flight survives all relays dropping; its answer after return resolves it; it is sent exactly once', async () => {
    const clientPk = await login()
    const nostr = (window as unknown as { nostr: { signEvent(e: object): Promise<Event> } }).nostr
    const tmpl = { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'test' }
    const signing = nostr.signEvent(tmpl).then(e => ({ ok: e }), (e: Error) => ({ err: e.message }))
    await flush()
    hub.dropAll() // request already sent, answer not yet received
    await flush(100)
    expect(await Promise.race([signing, Promise.resolve('pending')])).toBe('pending')
    setVisible()
    await flush()
    const signReqs = requestsFromClient(clientPk).filter(r => r.method === 'sign_event')
    expect(signReqs).toHaveLength(1)
    const signed = finalizeEvent(tmpl, USER_SK)
    hub.deliver(fromSigner(clientPk, { id: signReqs[0]!.id, result: JSON.stringify(signed) }))
    await flush()
    expect(await signing).toMatchObject({ ok: { id: signed.id, sig: signed.sig, pubkey: USER_PK } })
    await flush(60_000)
    expect(requestsFromClient(clientPk).filter(r => r.method === 'sign_event')).toHaveLength(1) // never re-sent
  })
})
