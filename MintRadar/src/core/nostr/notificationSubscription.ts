import { nip98 } from 'nostr-tools'
import type { Event, EventTemplate } from 'nostr-tools'
import { db } from '@/db'
import { NOTIFICATION_RELAYS } from '@/hooks/useWatchlistNotifications'

// Client for the server-side notification subscription store (backend Phase
// 1: POST /api/notifications/subscribe|unsubscribe). This is best-effort
// mirroring of local Dexie toggle state to the server — Dexie stays the
// single source of truth for the UI. Every failure here (network, 401, 429,
// 400) is caught and logged, never thrown or surfaced to the user, and never
// reverts the local toggle.

const MAX_SERVER_RELAYS = 10

// Server rejects >10 relays (Phase 1 SSRF/abuse guard). NIP-65 read relay
// lists and NOTIFICATION_RELAYS can both exceed that, so cap here rather
// than at every call site.
export function resolveNotificationRelays(userReadRelays: string[] | null | undefined): string[] {
  const relays = userReadRelays && userReadRelays.length > 0 ? userReadRelays : NOTIFICATION_RELAYS
  return relays.slice(0, MAX_SERVER_RELAYS)
}

async function buildNip98Token(url: string, method: string): Promise<string> {
  if (!window.nostr) throw new Error('No Nostr signer available')
  const sign = async (e: EventTemplate): Promise<Event> => (await window.nostr!.signEvent(e)) as Event
  // includeAuthorizationScheme=true → result is ready to use as the raw
  // Authorization header value ("Nostr <base64>").
  return nip98.getToken(url, method, sign, true)
}

async function postWithNip98(path: string, body: unknown): Promise<void> {
  const url = `${window.location.origin}${path}`
  const token = await buildNip98Token(url, 'POST')
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
}

export interface SubscribeParams {
  mintUrl: string
  notifyOnDown: boolean
  notifyOnUp: boolean
  relays: string[]
}

// Fire-and-forget from the caller's perspective — never throws.
export async function syncSubscribeToServer(params: SubscribeParams): Promise<void> {
  try {
    await postWithNip98('/api/notifications/subscribe', {
      mintUrl: params.mintUrl,
      notifyOnDown: params.notifyOnDown,
      notifyOnUp: params.notifyOnUp,
      relays: params.relays,
    })
  } catch (err) {
    console.warn(`[notif-subscribe] subscribe failed for ${params.mintUrl}:`, err)
  }
}

// Fire-and-forget from the caller's perspective — never throws.
export async function syncUnsubscribeFromServer(mintUrl: string): Promise<void> {
  try {
    await postWithNip98('/api/notifications/unsubscribe', { mintUrl })
  } catch (err) {
    console.warn(`[notif-subscribe] unsubscribe failed for ${mintUrl}:`, err)
  }
}

const REFRESH_CONCURRENCY = 3

// Re-subscribes every watchlist entry that currently has a notification
// toggle on, refreshing `updated_at` server-side (resets the 30-day
// retention clock). Called once per login. Chunks requests to avoid firing
// the whole watchlist at once.
export async function refreshAllSubscriptions(userReadRelays: string[] | null | undefined): Promise<void> {
  if (!window.nostr) return

  const entries = await db.watchlist.toArray()
  const toRefresh = entries.filter(e => e.notifyOnDown || e.notifyOnUp)
  if (toRefresh.length === 0) return

  const relays = resolveNotificationRelays(userReadRelays)

  for (let i = 0; i < toRefresh.length; i += REFRESH_CONCURRENCY) {
    const chunk = toRefresh.slice(i, i + REFRESH_CONCURRENCY)
    await Promise.allSettled(
      chunk.map(entry =>
        syncSubscribeToServer({
          mintUrl: entry.url,
          notifyOnDown: entry.notifyOnDown,
          notifyOnUp: entry.notifyOnUp,
          relays,
        })
      )
    )
  }
}
