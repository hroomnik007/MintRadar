import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory stand-in for the Dexie watchlist table.
const rows = vi.hoisted(() => new Map<string, Record<string, unknown>>())
vi.mock('@/db', () => ({
  db: {
    watchlist: {
      get: async (url: string) => rows.get(url),
      update: async (url: string, patch: Record<string, unknown>) => { const r = rows.get(url); if (r) rows.set(url, { ...r, ...patch }) },
      toArray: async () => [...rows.values()],
    },
  },
}))
vi.mock('nostr-tools', () => ({
  nip98: { getToken: async (_u: string, _m: string, sign: (e: object) => Promise<object>) => { await sign({ kind: 27235 }); return 'Nostr token' } },
}))

import { setNotifyFlag, refreshAllSubscriptions, subscribeToServer, hasNotifyRequestInFlight } from '@/core/nostr/notificationSubscription'

const A = 'https://a.example'
const B = 'https://b.example'
const confirmedAt = new Date('2026-10-01')

interface Call { path: string; body: Record<string, unknown> }
let calls: Call[]
let respond: (path: string) => Promise<Response> | Response

beforeEach(() => {
  rows.clear()
  calls = []
  respond = () => new Response('{"success":true}', { status: 200 })
  ;(window as unknown as { nostr: unknown }).nostr = { signEvent: async (e: object) => ({ ...e, id: 'x', pubkey: 'p', sig: 's' }) }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    calls.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> })
    return respond(path)
  }))
})

const seed = (url: string, down: boolean, up: boolean, confirmed: boolean) =>
  rows.set(url, { url, notifyOnDown: down, notifyOnUp: up, ...(confirmed ? { notifyConfirmedAt: confirmedAt } : {}) })

describe('setNotifyFlag', () => {
  it('writes flags + confirmation only after the server said ok', async () => {
    seed(A, false, false, false)
    let finish!: () => void
    respond = () => new Promise(resolve => { finish = () => resolve(new Response('{}', { status: 200 })) })
    const p = setNotifyFlag(A, 'notifyOnDown', true, null)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(rows.get(A)).toMatchObject({ notifyOnDown: false }) // still untouched while in flight
    expect(rows.get(A)!['notifyConfirmedAt']).toBeUndefined()
    expect(hasNotifyRequestInFlight(A)).toBe(true)
    finish()
    expect(await p).toEqual({ ok: true })
    expect(rows.get(A)).toMatchObject({ notifyOnDown: true, notifyOnUp: false })
    expect(rows.get(A)!['notifyConfirmedAt']).toBeInstanceOf(Date)
    expect(hasNotifyRequestInFlight(A)).toBe(false)
    expect(calls[0]).toMatchObject({ path: '/api/notifications/subscribe', body: { mintUrl: A, notifyOnDown: true, notifyOnUp: false } })
  })

  it('computes the target from the CONFIRMED state: a legacy unconfirmed on/on is off', async () => {
    seed(A, true, true, false)
    await setNotifyFlag(A, 'notifyOnUp', true, null)
    expect(calls[0]!.body).toMatchObject({ notifyOnDown: false, notifyOnUp: true })
  })

  it('turning the last pill off unsubscribes', async () => {
    seed(A, true, false, true)
    await setNotifyFlag(A, 'notifyOnDown', false, null)
    expect(calls[0]).toMatchObject({ path: '/api/notifications/unsubscribe', body: { mintUrl: A } })
    expect(rows.get(A)).toMatchObject({ notifyOnDown: false, notifyOnUp: false })
  })

  it('turning one of two pills off keeps the subscription for the other', async () => {
    seed(A, true, true, true)
    await setNotifyFlag(A, 'notifyOnDown', false, null)
    expect(calls[0]).toMatchObject({ path: '/api/notifications/subscribe', body: { notifyOnDown: false, notifyOnUp: true } })
  })

  it('a More alerts pill subscribes with all five flags, keeping the others as confirmed', async () => {
    seed(A, true, false, true)
    expect(await setNotifyFlag(A, 'notifyOnNutLoss', true, null)).toEqual({ ok: true })
    expect(calls[0]).toMatchObject({
      path: '/api/notifications/subscribe',
      body: { mintUrl: A, notifyOnDown: true, notifyOnUp: false, notifyOnMintMeltIssues: false, notifyOnVersionOutdated: false, notifyOnNutLoss: true },
    })
    expect(rows.get(A)).toMatchObject({ notifyOnDown: true, notifyOnNutLoss: true })
  })

  it('a More alerts pill alone keeps the subscription (Goes down/up off), and only after ok', async () => {
    seed(A, false, false, false)
    let finish!: () => void
    respond = () => new Promise(resolve => { finish = () => resolve(new Response('{}', { status: 200 })) })
    const p = setNotifyFlag(A, 'notifyOnVersionOutdated', true, null)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(rows.get(A)!['notifyOnVersionOutdated']).toBeUndefined() // not "on" before the server answers
    finish()
    await p
    expect(calls[0]!.path).toBe('/api/notifications/subscribe')
    expect(rows.get(A)).toMatchObject({ notifyOnVersionOutdated: true, notifyOnDown: false, notifyOnUp: false })
  })

  it('only unsubscribes when the last of all five flags goes off', async () => {
    seed(A, true, false, true)
    rows.set(A, { ...rows.get(A)!, notifyOnMintMeltIssues: true })
    await setNotifyFlag(A, 'notifyOnDown', false, null)
    expect(calls[0]!.path).toBe('/api/notifications/subscribe') // mint/melt still on
    await setNotifyFlag(A, 'notifyOnMintMeltIssues', false, null)
    expect(calls[1]).toMatchObject({ path: '/api/notifications/unsubscribe', body: { mintUrl: A } })
  })

  it('a failed More alerts press leaves the local state untouched', async () => {
    seed(A, false, false, false)
    respond = () => new Response('{}', { status: 500 })
    expect(await setNotifyFlag(A, 'notifyOnMintMeltIssues', true, null)).toEqual({ ok: false, reason: 'rejected' })
    expect(rows.get(A)!['notifyOnMintMeltIssues']).toBeUndefined()
  })

  it.each([
    [500, 'rejected'], [401, 'rejected'], [429, 'rate-limited'], [409, 'limit'],
  ])('HTTP %i leaves the local state untouched and reports %s', async (status, reason) => {
    seed(A, false, false, false)
    respond = () => new Response('{}', { status })
    expect(await setNotifyFlag(A, 'notifyOnDown', true, null)).toEqual({ ok: false, reason })
    expect(rows.get(A)).toMatchObject({ notifyOnDown: false })
    expect(rows.get(A)!['notifyConfirmedAt']).toBeUndefined()
  })

  it('a network error is "unreachable"', async () => {
    seed(A, false, false, false)
    respond = () => { throw new TypeError('Failed to fetch') }
    expect(await setNotifyFlag(A, 'notifyOnDown', true, null)).toEqual({ ok: false, reason: 'unreachable' })
    expect(rows.get(A)).toMatchObject({ notifyOnDown: false })
  })

  it('a signer that rejects sends nothing', async () => {
    seed(A, false, false, false)
    ;(window as unknown as { nostr: unknown }).nostr = { signEvent: async () => { throw new Error('rejected') } }
    expect(await setNotifyFlag(A, 'notifyOnDown', true, null)).toEqual({ ok: false, reason: 'signer-declined' })
    expect(calls).toHaveLength(0)
  })

  it('no signer at all is "signer-unavailable"', async () => {
    seed(A, false, false, false)
    delete (window as unknown as { nostr?: unknown }).nostr
    expect(await setNotifyFlag(A, 'notifyOnDown', true, null)).toEqual({ ok: false, reason: 'signer-unavailable' })
    expect(calls).toHaveLength(0)
  })

  it('requests for the same mint run one after another, each seeing the previous result', async () => {
    seed(A, false, false, false)
    const releases: (() => void)[] = []
    respond = () => new Promise(resolve => { releases.push(() => resolve(new Response('{}', { status: 200 }))) })
    const first = setNotifyFlag(A, 'notifyOnDown', true, null)
    const second = setNotifyFlag(A, 'notifyOnUp', true, null)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await new Promise(r => setTimeout(r, 20))
    expect(calls).toHaveLength(1) // the second waits for the first
    releases[0]!()
    await first
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    releases[1]!()
    await second
    expect(calls[1]!.body).toMatchObject({ notifyOnDown: true, notifyOnUp: true }) // built from the first's confirmed result
  })
})

describe('refreshAllSubscriptions', () => {
  it('refreshes only confirmed-on entries, never unconfirmed legacy ones', async () => {
    seed(A, true, true, false)   // legacy
    seed(B, true, false, true)   // confirmed
    await refreshAllSubscriptions(null)
    expect(calls.map(c => c.body['mintUrl'])).toEqual([B])
    expect(calls[0]!.body).toMatchObject({ notifyOnDown: true, notifyOnUp: false })
  })

  it('refreshes an entry whose only confirmed flag is a More alerts one, with all five flags', async () => {
    rows.set(B, { url: B, notifyOnDown: false, notifyOnUp: false, notifyOnNutLoss: true, notifyConfirmedAt: confirmedAt })
    await refreshAllSubscriptions(null)
    expect(calls[0]!.body).toMatchObject({ mintUrl: B, notifyOnDown: false, notifyOnUp: false, notifyOnNutLoss: true, notifyOnMintMeltIssues: false })
  })

  it('does nothing without a signer or without confirmed entries', async () => {
    seed(A, true, true, false)
    await refreshAllSubscriptions(null)
    expect(calls).toHaveLength(0)
    seed(B, true, true, true)
    delete (window as unknown as { nostr?: unknown }).nostr
    await refreshAllSubscriptions(null)
    expect(calls).toHaveLength(0)
  })

  it('a second call while one is running joins it (no duplicate requests)', async () => {
    seed(B, true, true, true)
    await Promise.all([refreshAllSubscriptions(null), refreshAllSubscriptions(null)])
    expect(calls).toHaveLength(1)
  })

  it('skips an entry the user switched off while the refresh was waiting its turn', async () => {
    seed(B, true, true, true)
    let finish!: () => void
    respond = () => new Promise(resolve => { finish = () => resolve(new Response('{}', { status: 200 })) })
    const toggle = setNotifyFlag(B, 'notifyOnDown', false, null) // in flight first
    const refresh = refreshAllSubscriptions(null)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    finish()
    await toggle
    respond = () => new Response('{}', { status: 200 })
    await refresh
    // the toggle left Up on, so the refresh sends the NEW state (down off, up on), not the stale one
    expect(calls.at(-1)!.body).toMatchObject({ notifyOnDown: false, notifyOnUp: true })
  })
})

describe('subscribeToServer', () => {
  it('sends the NIP-98 token and never throws', async () => {
    respond = () => new Response('{}', { status: 200 })
    expect(await subscribeToServer({ mintUrl: A, notifyOnDown: true, notifyOnUp: true, relays: ['wss://r'] })).toEqual({ ok: true })
    const init = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Nostr token')
    expect(init.credentials).toBe('omit')
  })
})
