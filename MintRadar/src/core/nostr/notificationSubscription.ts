import { nip98 } from 'nostr-tools'
import type { Event, EventTemplate } from 'nostr-tools'
import { db } from '@/db'
import { confirmedNotify, confirmedMoreNotify } from '@/utils/notifyState'

// Client for the server-side notification subscription store (backend:
// POST /api/notifications/subscribe|unsubscribe). The server is the truth: a toggle is
// "on" in the UI only after the server answered ok, and the confirmation is stored with the
// flags (`notifyConfirmedAt`, see utils/notifyState.ts). Nothing here logs user data (no mint
// URLs, no errors) and the functions never throw — they return a NotifyResult.

// Fallback relay list sent to the server when the user has no NIP-65 read relays (the server
// publishes the DMs; the browser never does) — the task explicitly required not inventing a
// second default list.
// `relay.nostr.band` removed 2026-09-20 — confirmed dead from two independent
// networks (a sandbox and the production VPS) in the 2026-09-19 relay audit,
// matching the earlier 2026-08-15 finding. No replacement needed:
// `resolveNotificationRelays` already caps at 10, and `nostr-pub.wellorder.net`
// (also re-verified live in that same audit) is already in this list.
// `pyramid.fiatjaf.com` (restricted_writes: true) and `nostr.lopp.social` (0 events on
// live probe) removed 2026-09-23 — same measured reasons that already excluded them from
// REVIEW_PUBLISH_RELAYS; a DM's whole point is delivery, so a relay that connects but never
// actually carries anything is dead weight here too. Mirror this change in the backend copy
// (backend/src/nostrService.ts's own NOTIFICATION_RELAYS).
const NOTIFICATION_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.mom',
  'wss://nostr.oxtr.dev',
  'wss://relay.mostr.pub',
  'wss://relay.noswhere.com',
  'wss://nostr.cypherpunk.today',
]

const MAX_SERVER_RELAYS = 10

// The server accepts a subscriber relay only as wss on port 443 or ws on port 80 (no port = the default;
// backend/src/ssrf.ts isAllowedRelayPort, keep both in sync) and answers 400 to the WHOLE request if one relay
// breaks the rule. A NIP-65 list can contain relays on other ports, so those are left out here.
export function isAllowedRelayPort(relay: string): boolean {
  try {
    const url = new URL(relay)
    if (url.protocol === 'wss:') return url.port === '' || url.port === '443'
    if (url.protocol === 'ws:') return url.port === '' || url.port === '80'
    return false
  } catch {
    return false
  }
}

// Server rejects >10 relays (Phase 1 SSRF/abuse guard). NIP-65 read relay
// lists and NOTIFICATION_RELAYS can both exceed that, so cap here rather
// than at every call site. If no usable relay is left, the fixed list is used.
export function resolveNotificationRelays(userReadRelays: string[] | null | undefined): string[] {
  const usable = (userReadRelays ?? []).filter(isAllowedRelayPort)
  const relays = usable.length > 0 ? usable : NOTIFICATION_RELAYS
  return relays.slice(0, MAX_SERVER_RELAYS)
}

export type NotifyFailure =
  | 'signer-unavailable' // no window.nostr
  | 'signer-declined'    // signEvent rejected (user said no, or the signer errored)
  | 'signer-timeout'     // signer never answered (e.g. a remote signer nobody approved)
  | 'unreachable'        // fetch failed or timed out
  | 'rate-limited'       // 429
  | 'limit'              // 409 — subscription cap reached
  | 'rejected'           // any other non-2xx
export type NotifyResult = { ok: true } | { ok: false; reason: NotifyFailure }

const SIGN_TIMEOUT_MS = 60_000
const REQUEST_TIMEOUT_MS = 15_000

async function buildNip98Token(url: string, method: string): Promise<{ token: string } | { reason: NotifyFailure }> {
  if (!window.nostr) return { reason: 'signer-unavailable' }
  const sign = async (e: EventTemplate): Promise<Event> => (await window.nostr!.signEvent(e)) as Event
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), SIGN_TIMEOUT_MS) })
  try {
    // includeAuthorizationScheme=true → result is ready to use as the raw
    // Authorization header value ("Nostr <base64>").
    const result = await Promise.race([nip98.getToken(url, method, sign, true), timeout])
    if (result === 'timeout') return { reason: 'signer-timeout' }
    return { token: result }
  } catch {
    return { reason: 'signer-declined' }
  } finally {
    clearTimeout(timer)
  }
}

async function postWithNip98(path: string, body: unknown): Promise<NotifyResult> {
  const url = `${window.location.origin}${path}`
  const signed = await buildNip98Token(url, 'POST')
  if ('reason' in signed) return { ok: false, reason: signed.reason }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Authorization: signed.token },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (res.ok) return { ok: true }
    if (res.status === 429) return { ok: false, reason: 'rate-limited' }
    if (res.status === 409) return { ok: false, reason: 'limit' }
    return { ok: false, reason: 'rejected' }
  } catch {
    return { ok: false, reason: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

export interface SubscribeParams {
  mintUrl: string
  notifyOnDown: boolean
  notifyOnUp: boolean
  // "More alerts" — optional; left out, the server keeps whatever it has stored.
  notifyOnMintMeltIssues?: boolean
  notifyOnVersionOutdated?: boolean
  notifyOnNutLoss?: boolean
  relays: string[]
}

export type NotifyField =
  | 'notifyOnDown'
  | 'notifyOnUp'
  | 'notifyOnMintMeltIssues'
  | 'notifyOnVersionOutdated'
  | 'notifyOnNutLoss'

interface NotifyFlags {
  notifyOnDown: boolean
  notifyOnUp: boolean
  notifyOnMintMeltIssues: boolean
  notifyOnVersionOutdated: boolean
  notifyOnNutLoss: boolean
}

// The confirmed flags of one entry, all five, in the shape the server and Dexie use.
function confirmedFlags(entry: Parameters<typeof confirmedNotify>[0] & Parameters<typeof confirmedMoreNotify>[0]): NotifyFlags {
  const base = confirmedNotify(entry)
  const more = confirmedMoreNotify(entry)
  return {
    notifyOnDown: base.down,
    notifyOnUp: base.up,
    notifyOnMintMeltIssues: more.mintMelt,
    notifyOnVersionOutdated: more.versionOutdated,
    notifyOnNutLoss: more.nutLoss,
  }
}

const anyOn = (f: NotifyFlags): boolean => Object.values(f).some(Boolean)

export function subscribeToServer(params: SubscribeParams): Promise<NotifyResult> {
  return postWithNip98('/api/notifications/subscribe', {
    mintUrl: params.mintUrl,
    notifyOnDown: params.notifyOnDown,
    notifyOnUp: params.notifyOnUp,
    notifyOnMintMeltIssues: params.notifyOnMintMeltIssues,
    notifyOnVersionOutdated: params.notifyOnVersionOutdated,
    notifyOnNutLoss: params.notifyOnNutLoss,
    relays: params.relays,
  })
}

export function unsubscribeFromServer(mintUrl: string): Promise<NotifyResult> {
  return postWithNip98('/api/notifications/unsubscribe', { mintUrl })
}

// Per-mint FIFO: a toggle, a login-time refresh and (later) a removal for the same mint never
// overlap, so a slow earlier request cannot overwrite a newer decision on the server. Also the
// duplicate-request guard — the second caller waits for the first instead of racing it.
const queueTails = new Map<string, Promise<unknown>>()
const inFlight = new Map<string, number>()

export function hasNotifyRequestInFlight(mintUrl: string): boolean {
  return (inFlight.get(mintUrl) ?? 0) > 0
}

function runExclusive<T>(mintUrl: string, task: () => Promise<T>): Promise<T> {
  inFlight.set(mintUrl, (inFlight.get(mintUrl) ?? 0) + 1)
  const prev = queueTails.get(mintUrl) ?? Promise.resolve()
  const guarded = async (): Promise<T> => {
    try {
      return await task()
    } finally {
      const left = (inFlight.get(mintUrl) ?? 1) - 1
      if (left <= 0) inFlight.delete(mintUrl)
      else inFlight.set(mintUrl, left)
    }
  }
  const run = prev.then(guarded, guarded)
  const tail = run.then(() => undefined, () => undefined)
  queueTails.set(mintUrl, tail)
  void tail.then(() => { if (queueTails.get(mintUrl) === tail) queueTails.delete(mintUrl) })
  return run
}

// Cancels a mint's server subscription (queued behind any request still running for that mint).
// Used when the mint is removed from the watchlist; writes nothing locally — the entry is gone.
export function cancelSubscription(mintUrl: string): Promise<NotifyResult> {
  bumpMutation(mintUrl)
  return runExclusive(mintUrl, () => unsubscribeFromServer(mintUrl))
}

// One pill press. The target is computed from the CONFIRMED state (other pill included) at the
// moment the request runs; the local flags + confirmation are written only after the server
// answered ok. subscribe is an idempotent upsert on the server and unsubscribe a DELETE, so this
// is safe on top of a pre-existing server row. All five flags off → unsubscribe.
export function setNotifyFlag(
  mintUrl: string,
  field: NotifyField,
  next: boolean,
  userReadRelays: string[] | null | undefined,
): Promise<NotifyResult> {
  bumpMutation(mintUrl)
  return runExclusive(mintUrl, async (): Promise<NotifyResult> => {
    const entry = await db.watchlist.get(mintUrl)
    if (!entry) return { ok: false, reason: 'rejected' } // removed meanwhile
    const target: NotifyFlags = { ...confirmedFlags(entry), [field]: next }
    const result = anyOn(target)
      ? await subscribeToServer({ mintUrl, ...target, relays: resolveNotificationRelays(userReadRelays) })
      : await unsubscribeFromServer(mintUrl)
    if (result.ok) {
      await db.watchlist.update(mintUrl, { ...target, notifyConfirmedAt: new Date() })
    }
    return result
  })
}

// Per-mint count of user-initiated changes (toggle / removal), bumped synchronously when one is
// requested. restoreServerSettings snapshots it before its request and skips any mint whose
// count moved meanwhile, so a slow login-time restore never overwrites a newer user decision.
const mutationSeq = new Map<string, number>()
function bumpMutation(mintUrl: string): void {
  mutationSeq.set(mintUrl, (mutationSeq.get(mintUrl) ?? 0) + 1)
}

// Same normalization as the backend's normalizeUrl (backend/src/discovery.ts) — the server
// stores mint_url normalized, so local watchlist urls are compared in that form. Keep in sync.
export function serverMintKey(raw: string): string {
  try {
    const parsed = new URL(raw.trim())
    parsed.protocol = 'https:'
    parsed.hostname = parsed.hostname.toLowerCase()
    let result = parsed.toString()
    if (parsed.pathname === '/') result = result.replace(/\/$/, '')
    return result
  } catch {
    return raw.trim()
  }
}

const FLAG_FIELDS: readonly NotifyField[] = ['notifyOnDown', 'notifyOnUp', 'notifyOnMintMeltIssues', 'notifyOnVersionOutdated', 'notifyOnNutLoss']

// Strict shape check: anything unexpected → null (caller then changes nothing).
export function parseSubscriptionList(body: unknown): Map<string, NotifyFlags> | null {
  if (typeof body !== 'object' || body === null) return null
  const list = (body as { subscriptions?: unknown }).subscriptions
  if (!Array.isArray(list)) return null
  const out = new Map<string, NotifyFlags>()
  for (const item of list) {
    if (typeof item !== 'object' || item === null) return null
    const rec = item as Record<string, unknown>
    if (typeof rec.mintUrl !== 'string') return null
    if (!FLAG_FIELDS.every(f => typeof rec[f] === 'boolean')) return null
    out.set(serverMintKey(rec.mintUrl), Object.fromEntries(FLAG_FIELDS.map(f => [f, rec[f]])) as unknown as NotifyFlags)
  }
  return out
}

export type RestoreResult = { ok: true; updated: number } | { ok: false; reason: NotifyFailure | 'malformed' | 'stale' }

const ALL_OFF: NotifyFlags = { notifyOnDown: false, notifyOnUp: false, notifyOnMintMeltIssues: false, notifyOnVersionOutdated: false, notifyOnNutLoss: false }

// Login-time restore of the account's notification settings from the server (the source of
// truth; rows are keyed by pubkey + mint, so they apply to every device). Only for mints in the
// local watchlist; server rows for other mints are ignored. A mint with no server row is set
// off ONLY after a complete, valid response. Any failure (signer declined/timed out, network,
// non-2xx, malformed body), an account change (`isStale`) or a user toggle/removal requested
// after the restore began leaves local data untouched. Bounded by SIGN_TIMEOUT_MS + REQUEST_TIMEOUT_MS.
export async function restoreServerSettings(isStale: () => boolean): Promise<RestoreResult> {
  const startSeq = new Map(mutationSeq)
  const path = '/api/notifications/list'
  const signed = await buildNip98Token(`${window.location.origin}${path}`, 'POST')
  if ('reason' in signed) return { ok: false, reason: signed.reason }
  if (isStale()) return { ok: false, reason: 'stale' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  let body: unknown
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: signed.token },
      body: '{}',
      signal: ctrl.signal,
    })
    if (res.status === 429) return { ok: false, reason: 'rate-limited' }
    if (!res.ok) return { ok: false, reason: 'rejected' }
    body = await res.json()
  } catch {
    return { ok: false, reason: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
  const server = parseSubscriptionList(body)
  if (!server) return { ok: false, reason: 'malformed' }
  if (isStale()) return { ok: false, reason: 'stale' }

  let updated = 0
  const entries = await db.watchlist.toArray()
  await Promise.all(entries.map(entry => runExclusive(entry.url, async () => {
    if (isStale()) return
    if ((mutationSeq.get(entry.url) ?? 0) !== (startSeq.get(entry.url) ?? 0)) return
    if (!(await db.watchlist.get(entry.url))) return // removed meanwhile
    const flags = server.get(serverMintKey(entry.url)) ?? ALL_OFF
    await db.watchlist.update(entry.url, { ...flags, notifyConfirmedAt: new Date() })
    updated++
  })))
  if (isStale()) return { ok: false, reason: 'stale' }
  return { ok: true, updated }
}

const REFRESH_CONCURRENCY = 3

// Re-subscribes every watchlist entry whose notifications the server has CONFIRMED as on,
// refreshing `updated_at` server-side (resets the 30-day retention clock). Called once per
// login. Unconfirmed local flags (legacy defaults) are not refreshed — they show as off and are
// not silently kept alive. Each entry is re-read when its turn comes, so a toggle the user made
// meanwhile wins. Chunks requests to avoid firing the whole watchlist at once.
let refreshRunning: Promise<void> | null = null

// A second call while one is running (React StrictMode re-runs the sync effect in dev) joins it
// instead of sending every subscription again.
export function refreshAllSubscriptions(userReadRelays: string[] | null | undefined): Promise<void> {
  if (refreshRunning) return refreshRunning
  refreshRunning = refreshConfirmedSubscriptions(userReadRelays).finally(() => { refreshRunning = null })
  return refreshRunning
}

async function refreshConfirmedSubscriptions(userReadRelays: string[] | null | undefined): Promise<void> {
  if (!window.nostr) return

  const entries = await db.watchlist.toArray()
  const toRefresh = entries.filter(e => {
    return anyOn(confirmedFlags(e))
  })
  if (toRefresh.length === 0) return

  const relays = resolveNotificationRelays(userReadRelays)

  for (let i = 0; i < toRefresh.length; i += REFRESH_CONCURRENCY) {
    const chunk = toRefresh.slice(i, i + REFRESH_CONCURRENCY)
    await Promise.allSettled(
      chunk.map(entry =>
        runExclusive(entry.url, async () => {
          const current = confirmedFlags(await db.watchlist.get(entry.url))
          if (!anyOn(current)) return
          await subscribeToServer({ mintUrl: entry.url, ...current, relays })
        })
      )
    )
  }
}
