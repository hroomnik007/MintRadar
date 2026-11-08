import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Login-time restore of account-wide notification settings from POST /api/notifications/list.
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

import { restoreServerSettings, setNotifyFlag, parseSubscriptionList } from '@/core/nostr/notificationSubscription'

const A = 'https://a.example'
const B = 'https://b.example'
const OTHER = 'https://not-in-watchlist.example'
const all = (v: boolean) => ({ notifyOnDown: v, notifyOnUp: v, notifyOnMintMeltIssues: v, notifyOnVersionOutdated: v, notifyOnNutLoss: v })
const okList = (subs: unknown[]) => new Response(JSON.stringify({ subscriptions: subs }), { status: 200 })
const notStale = () => false

let respond: (path: string) => Promise<Response> | Response
let paths: string[]

beforeEach(() => {
  rows.clear()
  paths = []
  respond = () => okList([])
  ;(window as unknown as { nostr: unknown }).nostr = { signEvent: async (e: object) => ({ ...e, id: 'x', pubkey: 'p', sig: 's' }) }
  vi.stubGlobal('fetch', vi.fn(async (path: string) => { paths.push(path); return respond(path) }))
})
afterEach(() => { vi.useRealTimers() })

const seedLocal = (url: string, flags: Record<string, boolean>, confirmed = false) =>
  rows.set(url, { url, ...flags, ...(confirmed ? { notifyConfirmedAt: new Date('2026-01-01') } : {}) })

describe('restoreServerSettings', () => {
  it('restores all five flags + a fresh confirmation for watched mints; ignores server rows not in the watchlist', async () => {
    seedLocal(A, all(false))
    respond = () => okList([
      { mintUrl: A + '/', notifyOnDown: true, notifyOnUp: false, notifyOnMintMeltIssues: true, notifyOnVersionOutdated: false, notifyOnNutLoss: true },
      { mintUrl: OTHER, ...all(true) },
    ])
    expect(await restoreServerSettings(notStale)).toEqual({ ok: true, updated: 1 })
    expect(rows.get(A)).toMatchObject({ notifyOnDown: true, notifyOnUp: false, notifyOnMintMeltIssues: true, notifyOnVersionOutdated: false, notifyOnNutLoss: true })
    expect(rows.get(A)!['notifyConfirmedAt']).toBeInstanceOf(Date)
    expect(rows.has(OTHER)).toBe(false)
    expect(paths).toEqual(['/api/notifications/list'])
  })

  it('a watched mint with no server row is set off (confirmed) after a valid complete response', async () => {
    seedLocal(B, all(true), true)
    respond = () => okList([])
    await restoreServerSettings(notStale)
    expect(rows.get(B)).toMatchObject(all(false))
    expect(rows.get(B)!['notifyConfirmedAt']).toBeInstanceOf(Date)
  })

  it.each([
    ['HTTP 500', () => new Response('{}', { status: 500 }), 'rejected'],
    ['429', () => new Response('{}', { status: 429 }), 'rate-limited'],
    ['network error', () => { throw new TypeError('offline') }, 'unreachable'],
    ['malformed body', () => new Response('{"subscriptions":[{"mintUrl":"https://a.example","notifyOnDown":"yes"}]}', { status: 200 }), 'malformed'],
    ['non-JSON body', () => new Response('<html>', { status: 200 }), 'unreachable'],
    ['missing list', () => new Response('{}', { status: 200 }), 'malformed'],
  ])('%s leaves local data untouched', async (_n, r, reason) => {
    seedLocal(A, all(true), true)
    const before = { ...rows.get(A) }
    respond = r as () => Response
    expect(await restoreServerSettings(notStale)).toEqual({ ok: false, reason })
    expect(rows.get(A)).toEqual(before)
  })

  it('signer refusal leaves local data untouched and sends nothing', async () => {
    seedLocal(A, all(true), true)
    const before = { ...rows.get(A) }
    ;(window as unknown as { nostr: unknown }).nostr = { signEvent: async () => { throw new Error('user rejected') } }
    expect(await restoreServerSettings(notStale)).toEqual({ ok: false, reason: 'signer-declined' })
    expect(rows.get(A)).toEqual(before)
    expect(paths).toEqual([])
  })

  it('a signer that never answers times out (bounded) without touching data', async () => {
    vi.useFakeTimers()
    seedLocal(A, all(true), true)
    const before = { ...rows.get(A) }
    ;(window as unknown as { nostr: unknown }).nostr = { signEvent: () => new Promise(() => {}) }
    const p = restoreServerSettings(notStale)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await p).toEqual({ ok: false, reason: 'signer-timeout' })
    expect(rows.get(A)).toEqual(before)
  })

  it('a delayed signer still restores once it answers', async () => {
    seedLocal(A, all(false))
    let sign!: () => void
    ;(window as unknown as { nostr: unknown }).nostr = { signEvent: (e: object) => new Promise(r => { sign = () => r({ ...e, id: 'x', pubkey: 'p', sig: 's' }) }) }
    respond = () => okList([{ mintUrl: A, ...all(true) }])
    const p = restoreServerSettings(notStale)
    await vi.waitFor(() => expect(sign).toBeTypeOf('function'))
    sign()
    expect(await p).toEqual({ ok: true, updated: 1 })
    expect(rows.get(A)).toMatchObject(all(true))
  })

  it('an account switch during the request writes nothing', async () => {
    seedLocal(A, all(false))
    let stale = false
    respond = () => { stale = true; return okList([{ mintUrl: A, ...all(true) }]) }
    expect(await restoreServerSettings(() => stale)).toEqual({ ok: false, reason: 'stale' })
    expect(rows.get(A)).toMatchObject(all(false))
    expect(rows.get(A)!['notifyConfirmedAt']).toBeUndefined()
  })

  it('a user toggle requested after the restore began wins over the (older) server snapshot', async () => {
    seedLocal(A, all(false), true)
    seedLocal(B, all(false), true)
    let finishList!: () => void
    respond = path => path === '/api/notifications/list'
      ? new Promise(r => { finishList = () => r(okList([{ mintUrl: A, ...all(false) }, { mintUrl: B, ...all(true) }])) })
      : new Response('{"success":true}', { status: 200 })
    const restore = restoreServerSettings(notStale)
    await vi.waitFor(() => expect(finishList).toBeTypeOf('function'))
    // User turns A's Down alert on while the list request is still in flight.
    expect(await setNotifyFlag(A, 'notifyOnDown', true, null)).toEqual({ ok: true })
    finishList()
    expect(await restore).toEqual({ ok: true, updated: 1 })
    expect(rows.get(A)).toMatchObject({ notifyOnDown: true }) // not reset by the stale snapshot
    expect(rows.get(B)).toMatchObject(all(true))              // untouched mint still restored
  })
})

describe('parseSubscriptionList', () => {
  it('rejects extra-type junk and accepts the exact shape', () => {
    expect(parseSubscriptionList(null)).toBeNull()
    expect(parseSubscriptionList({ subscriptions: 'x' })).toBeNull()
    expect(parseSubscriptionList({ subscriptions: [{ mintUrl: 1, ...all(true) }] })).toBeNull()
    expect(parseSubscriptionList({ subscriptions: [{ mintUrl: A, ...all(true) }] })?.get(A)).toEqual(all(true))
  })
})
