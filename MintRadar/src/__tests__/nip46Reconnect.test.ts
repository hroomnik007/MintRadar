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
  published: Event[] = []       // events a relay ACCEPTED
  received: Event[] = []        // every EVENT a client sent, accepted or not
  accepting = true
  rejectPublish = false         // relays answer every EVENT with OK=false (transport/relay error for the client)
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
    else if (msg[0] === 'EVENT') {
      const ev = msg[1] as Event
      hub.received.push(ev)
      if (hub.rejectPublish) { this.push(['OK', ev.id, false, 'blocked: test']); return }
      hub.published.push(ev); this.push(['OK', ev.id, true, '']); hub.deliver(ev)
    }
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
function decodeRequests(events: Event[], clientPk: string): { id: string; method: string }[] {
  // One request is published to every relay: dedupe by event id.
  const unique = [...new Map(events.filter(e => e.pubkey === clientPk).map(e => [e.id, e])).values()]
  return unique.map(e => JSON.parse(decrypt(e.content, getConversationKey(SIGNER_SK, clientPk))) as { id: string; method: string })
}
// Requests a relay accepted (what the signer could have seen).
function requestsFromClient(clientPk: string) { return decodeRequests(hub.published, clientPk) }
// Every request the client tried to send, including the ones the relays refused.
function attemptsFromClient(clientPk: string) { return decodeRequests(hub.received, clientPk) }
const flush = async (ms = 50) => { await vi.advanceTimersByTimeAsync(ms) }
const setVisible = () => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }

beforeEach(() => {
  vi.useFakeTimers()
  hub.sockets.clear(); hub.published = []; hub.received = []; hub.accepting = true; hub.rejectPublish = false
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

// get_public_key attempts: a transient transport problem of one attempt must not end the pairing.
// Real nostr-tools over the fake relays; the signer never sees an attempt the relays refused.
describe('NIP-46 pairing: get_public_key survives transient errors (real nostr-tools, fake relays)', () => {
  const pending = (p: Promise<unknown>) => Promise.race([p, Promise.resolve('pending')])
  const gpk = (clientPk: string) => requestsFromClient(clientPk).filter(r => r.method === 'get_public_key')
  const gpkAttempts = (clientPk: string) => attemptsFromClient(clientPk).filter(r => r.method === 'get_public_key')
  const nothingInstalled = () => {
    expect(sessionStorage.getItem('bunkerPubkey')).toBeNull()
    expect(sessionStorage.getItem('bunkerURI')).toBeNull()
    expect(sessionStorage.getItem('bunkerClientSecretKey')).toBeNull()
    expect((window as { nostr?: unknown }).nostr).toBeUndefined()
  }
  // Pairs up to the signer's connect answer; the first get_public_key attempt is sent right after.
  async function pairAndAck() {
    const { uri, loginPromise, cancel } = initBunkerQR()
    const settled = loginPromise.then(p => ({ ok: p }), (e: Error) => ({ err: e }))
    await flush()
    const { clientPk, secret } = parse(uri)
    hub.deliver(fromSigner(clientPk, { id: 'x', result: secret }))
    await flush(100)
    return { clientPk, settled, cancel }
  }

  it('the first attempt is refused by every relay, a later one is answered: login completes, one session, nothing stored before', async () => {
    hub.rejectPublish = true
    const { clientPk, settled } = await pairAndAck()
    expect(gpkAttempts(clientPk)).toHaveLength(1)
    expect(await pending(settled)).toBe('pending') // the transport error did not end the login
    nothingInstalled()

    hub.rejectPublish = false
    await flush(8_000)                              // the next scheduled tick sends a NEW request
    expect(gpkAttempts(clientPk)).toHaveLength(2)
    expect(gpk(clientPk)).toHaveLength(1)
    nothingInstalled()                              // still nothing stored: no answer yet

    hub.deliver(fromSigner(clientPk, { id: gpk(clientPk)[0]!.id, result: USER_PK }))
    await flush()
    expect(await settled).toEqual({ ok: { pubkey: USER_PK, npub: expect.stringMatching(/^npub1/) } })
    expect(sessionStorage.getItem('bunkerPubkey')).toBe(USER_PK)
    expect((window as { nostr?: unknown }).nostr).toBeDefined()
    await flush(60_000)
    expect(gpkAttempts(clientPk)).toHaveLength(2)   // the schedule stopped with the success
  })

  it('several refused attempts in a row do not skip a tick; the schedule stays immediately, then every 8 s', async () => {
    hub.rejectPublish = true
    const { clientPk, settled } = await pairAndAck()
    await flush(7_000)
    expect(gpkAttempts(clientPk)).toHaveLength(1)   // no early retry
    await flush(1_500)
    expect(gpkAttempts(clientPk)).toHaveLength(2)
    await flush(8_000)
    expect(gpkAttempts(clientPk)).toHaveLength(3)
    expect(await pending(settled)).toBe('pending')
    hub.rejectPublish = false
    await flush(8_000)
    hub.deliver(fromSigner(clientPk, { id: gpk(clientPk)[0]!.id, result: USER_PK }))
    await flush()
    expect(await settled).toMatchObject({ ok: { pubkey: USER_PK } })
  })

  it('the first request times out after the library\'s 30 s: the login does not end, a later attempt answered at 40 s completes it', async () => {
    const { clientPk, settled } = await pairAndAck()   // relays accept, the signer stays silent
    await flush(31_000)                                // the t=0 request is rejected by nostr-tools at 30 s
    expect(await pending(settled)).toBe('pending')
    nothingInstalled()
    await flush(10_000)                                // ticks at +32 s and +40 s were not skipped
    expect(gpk(clientPk).length).toBeGreaterThanOrEqual(6)
    expect(await pending(settled)).toBe('pending')
    hub.deliver(fromSigner(clientPk, { id: gpk(clientPk).at(-1)!.id, result: USER_PK }))
    await flush()
    expect(await settled).toMatchObject({ ok: { pubkey: USER_PK } })
    expect(sessionStorage.getItem('bunkerPubkey')).toBe(USER_PK)
    // The user's identity is the get_public_key answer, never the transport key of the signer.
    expect(sessionStorage.getItem('bunkerPubkey')).not.toBe(getPublicKey(SIGNER_SK))
  })

  it('an explicit rejection by the signer ends the login at once and is not retried', async () => {
    const { clientPk, settled } = await pairAndAck()
    hub.deliver(fromSigner(clientPk, { id: gpk(clientPk)[0]!.id, error: 'user rejected' }))
    await flush()
    expect(await settled).toMatchObject({ err: { message: 'user rejected' } })
    nothingInstalled()
    await flush(60_000)
    expect(gpkAttempts(clientPk)).toHaveLength(1)
  })

  it('an answer with neither result nor error is terminal: the login ends at once, nothing retried', async () => {
    const { clientPk, settled } = await pairAndAck()
    hub.deliver(fromSigner(clientPk, { id: gpk(clientPk)[0]!.id }))
    await flush()
    expect(await settled).toMatchObject({ err: { message: expect.stringContaining('neither result nor error') } })
    nothingInstalled()
    await flush(60_000)
    expect(gpkAttempts(clientPk)).toHaveLength(1)
  })

  it('only transient errors until the deadline: ends with the 120 s deadline message, schedule bounded, nothing left running', async () => {
    hub.rejectPublish = true
    const { clientPk, settled } = await pairAndAck()
    await flush(120_000)
    const r = await settled as { err?: Error }
    expect(r.err?.message).toMatch(/timed out/i)
    expect(r.err?.name).not.toBe('PairingConnectionLost') // relays were reachable
    nothingInstalled()
    const attempts = gpkAttempts(clientPk).length
    expect(attempts).toBeGreaterThanOrEqual(14)
    expect(attempts).toBeLessThanOrEqual(16)             // bounded by deadline / 8 s
    expect(hub.sockets.size).toBe(0)
    hub.rejectPublish = false
    await flush(120_000)
    expect(gpkAttempts(clientPk)).toHaveLength(attempts)  // nothing sent after the end
    expect(hub.sockets.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancel while attempts are pending: AbortError, nothing retried or installed afterwards, even for a late answer', async () => {
    const { clientPk, settled, cancel } = await pairAndAck()
    await flush(10_000)
    const before = gpkAttempts(clientPk).length
    const ids = gpk(clientPk).map(r => r.id)
    expect(before).toBeGreaterThanOrEqual(2)
    cancel()
    expect(await settled).toMatchObject({ err: { name: 'AbortError' } })
    hub.accepting = true
    setVisible()
    for (const id of ids) hub.deliver(fromSigner(clientPk, { id, result: USER_PK })) // late answers
    await flush(120_000)
    nothingInstalled()
    expect(gpkAttempts(clientPk)).toHaveLength(before)
    expect(hub.sockets.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a transient error of an attempt followed by cancel and a NEW pairing: the old late answer installs nothing next to the new session', async () => {
    hub.rejectPublish = true
    const first = await pairAndAck()
    first.cancel()
    expect(await first.settled).toMatchObject({ err: { name: 'AbortError' } })
    hub.rejectPublish = false
    const second = await pairAndAck()
    hub.deliver(fromSigner(first.clientPk, { id: 'whatever', result: USER_PK }))     // stale pairing's key: nobody listens
    hub.deliver(fromSigner(second.clientPk, { id: gpk(second.clientPk)[0]!.id, result: USER_PK }))
    await flush()
    expect(await second.settled).toMatchObject({ ok: { pubkey: USER_PK } })
    expect(sessionStorage.getItem('bunkerPubkey')).toBe(USER_PK)
    await flush(60_000)
    expect(gpkAttempts(first.clientPk)).toHaveLength(1)   // the cancelled pairing sent nothing more
  })
})

describe('NIP-46 sign_event is never retried automatically (real nostr-tools, fake relays)', () => {
  it('a sign_event refused by every relay fails once and is not sent again', async () => {
    const { uri, loginPromise } = initBunkerQR()
    await flush()
    const { clientPk, secret } = parse(uri)
    hub.deliver(fromSigner(clientPk, { id: 'x', result: secret }))
    await flush(100)
    const g = requestsFromClient(clientPk).find(r => r.method === 'get_public_key')!
    hub.deliver(fromSigner(clientPk, { id: g.id, result: USER_PK }))
    await flush()
    await loginPromise
    const nostr = (window as unknown as { nostr: { signEvent(e: object): Promise<Event> } }).nostr
    hub.rejectPublish = true
    const signing = nostr.signEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'x' }).then(() => 'ok', (e: Error) => e.message)
    await flush(100)
    expect(await signing).toMatch(/failed to send "sign_event"/)
    await flush(120_000)
    expect(attemptsFromClient(clientPk).filter(r => r.method === 'sign_event')).toHaveLength(1)
  })
})
