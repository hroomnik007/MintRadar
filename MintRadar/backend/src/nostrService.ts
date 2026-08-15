import { nip19, nip17, getPublicKey, finalizeEvent } from 'nostr-tools'
// SimplePool and useWebSocketImplementation are deliberately both imported from
// the 'nostr-tools/pool' subpath rather than the root 'nostr-tools' package.
// The two entry points are separate compiled bundles with their own
// module-scoped `_WebSocket` variable — the root package's SimplePool has no
// wiring to the useWebSocketImplementation() exported by 'nostr-tools/pool'
// (and vice versa), so calling useWebSocketImplementation() while importing
// SimplePool from the other entry point would silently have no effect on the
// pool actually used below. Verified against node_modules/nostr-tools's
// compiled output (lib/cjs/index.js's SimplePool captures its own _WebSocket2
// at module-load time and exposes no setter; lib/cjs/pool.js's SimplePool
// reads the _WebSocket useWebSocketImplementation() mutates).
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool'
import type { Event as NostrEvent } from 'nostr-tools'
import WebSocket from 'ws'
import type { ClientRequestArgs } from 'http'
import { pool } from './db.js'
import { safeLookup } from './ssrf.js'

// Node.js 20 has no native WebSocket — inject ws polyfill for nostr-tools
// (same pattern as discovery.ts / index.ts's nostr-reviews endpoint).
if (!globalThis.WebSocket) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).WebSocket = WebSocket
}

// DNS-rebinding TOCTOU fix: relay URLs stored on subscribe are SSRF-checked
// once (checkWsUrlSafety in index.ts), but nostr-tools' SimplePool otherwise
// opens `new WebSocket(url)` at publish time with no re-validation — a
// low-TTL domain could repoint to an internal address between subscribe and
// the next notification. `ws` forwards unrecognized constructor options
// straight through to the underlying `http`/`https`/`net`/`tls` connect
// (see initAsClient in ws/lib/websocket.js), which accepts the same `lookup`
// option undici's Agent uses in ssrf.ts — so pinning DNS resolution at
// connect time works here exactly like it does for HTTPS probing. This is
// installed as the nostr-tools-wide WebSocket implementation (there is no
// per-relay hook on SimplePool), so it applies to every relay connection the
// backend makes, closing the gap for good rather than just narrowing it.
class DnsPinnedWebSocket extends WebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols, { lookup: safeLookup } as ClientRequestArgs)
  }
}
useWebSocketImplementation(DnsPinnedWebSocket)

// Mirrors the frontend's META_RELAYS (src/core/nostr/client.ts) — the two
// packages can't share a module directly (no workspace set up), so keep
// these two arrays in sync manually when editing either one.
const META_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.cypherpunk.today',
]

// Mirrors the frontend's NOTIFICATION_RELAYS (src/hooks/useWatchlistNotifications.ts)
// — same no-workspace caveat as above. Used as the fallback/redundancy set unioned
// with each subscriber's own stored relays when delivering a DM.
const NOTIFICATION_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
  'wss://relay.nostr.band',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.mom',
  'wss://nostr.oxtr.dev',
  'wss://relay.mostr.pub',
  'wss://relay.noswhere.com',
  'wss://pyramid.fiatjaf.com',
  'wss://nostr.lopp.social',
  'wss://nostr.cypherpunk.today',
]

const RELAY_PUBLISH_TIMEOUT_MS = 5_000
const COOLDOWN_MS = 60 * 60 * 1000

let serviceSecretKey: Uint8Array | null = null
let servicePubkeyHex: string | null = null

const rawNsec = process.env['NOTIFICATION_SERVICE_NSEC']
if (!rawNsec) {
  console.warn('[notify-service] NOTIFICATION_SERVICE_NSEC not set — notification sending disabled')
} else {
  try {
    const decoded = nip19.decode(rawNsec)
    if (decoded.type !== 'nsec') {
      console.warn('[notify-service] NOTIFICATION_SERVICE_NSEC is not a valid nsec — notification sending disabled')
    } else {
      serviceSecretKey = decoded.data
      servicePubkeyHex = getPublicKey(serviceSecretKey)
      console.log(`[notify-service] service identity loaded (pubkey ${servicePubkeyHex.slice(0, 8)}…)`)
    }
  } catch {
    console.warn('[notify-service] NOTIFICATION_SERVICE_NSEC failed to decode — notification sending disabled')
  }
}

export function isNotificationServiceEnabled(): boolean {
  return serviceSecretKey !== null
}

// Short-lived SimplePool: create → publish → allSettled with a per-relay
// timeout → destroy. Matches the existing backend pattern (discovery.ts),
// not the frontend's long-lived backoff-patched singleton (pool.ts), which
// solves a different problem.
async function publishToRelays(relays: string[], event: NostrEvent): Promise<{ succeeded: number; failed: number }> {
  const nostrPool = new SimplePool()
  try {
    const pubs = nostrPool.publish(relays, event)
    const results = await Promise.allSettled(
      pubs.map(p =>
        Promise.race([
          p,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), RELAY_PUBLISH_TIMEOUT_MS)),
        ])
      )
    )
    const succeeded = results.filter(r => r.status === 'fulfilled').length
    return { succeeded, failed: results.length - succeeded }
  } finally {
    nostrPool.destroy()
  }
}

// Publishes the "MintRadar Alerts" kind:0 profile. Called once at startup
// and re-published daily (cron.ts) since it's a cheap, idempotent
// replaceable event — keeps it fresh on relays with short retention.
export async function publishServiceProfile(): Promise<void> {
  if (!serviceSecretKey) return
  try {
    const event = finalizeEvent(
      {
        kind: 0,
        content: JSON.stringify({
          name: 'MintRadar Alerts',
          about: 'Automated Cashu mint status notifications from mintradar.pedani.eu. Replies are not monitored — manage your subscriptions in the app.',
          website: 'https://mintradar.pedani.eu',
          picture: 'https://mintradar.pedani.eu/icons/icon-512x512.png',
        }),
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      },
      serviceSecretKey
    )
    const { succeeded, failed } = await publishToRelays(META_RELAYS, event)
    console.log(`[notify-service] published kind:0 profile (${succeeded} succeeded, ${failed} failed)`)
  } catch (err) {
    console.error('[notify-service] kind:0 publish error:', err)
  }
}

interface SubscriberRow {
  pubkey: string
  relays: string[]
  last_notified_at: Date | null
}

// Fires the DM for a down/up transition to every subscriber with a matching
// notify flag, respecting a 60-minute per-direction cooldown. Never throws —
// every failure (query, per-subscriber send) is caught and logged so a
// notification failure can never affect the probe loop that triggered it.
export async function notifySubscribers(mintUrl: string, direction: 'down' | 'up', checkedAt: Date): Promise<void> {
  if (!serviceSecretKey) return
  const secretKey = serviceSecretKey

  try {
    const notifyColumn = direction === 'down' ? 'notify_on_down' : 'notify_on_up'
    const cooldownColumn = direction === 'down' ? 'last_notified_down_at' : 'last_notified_up_at'

    const result = await pool.query(
      `SELECT pubkey, relays, ${cooldownColumn} AS last_notified_at
       FROM notification_subscriptions
       WHERE mint_url = $1 AND ${notifyColumn} = true`,
      [mintUrl]
    )
    const rows = result.rows as SubscriberRow[]
    if (rows.length === 0) return

    const hostname = new URL(mintUrl).hostname
    const detailUrl = `https://mintradar.pedani.eu/mint/${encodeURIComponent(mintUrl)}`
    const message = direction === 'down'
      ? `⚠️ ${hostname} just went offline.\nView details: ${detailUrl}`
      : `✅ ${hostname} is back online.\nView details: ${detailUrl}`

    let sent = 0
    let cooldownSkipped = 0
    let failed = 0

    for (const row of rows) {
      try {
        if (row.last_notified_at !== null && Date.now() - new Date(row.last_notified_at).getTime() < COOLDOWN_MS) {
          cooldownSkipped++
          continue
        }

        const giftWrap = nip17.wrapEvent(secretKey, { publicKey: row.pubkey }, message)
        const targetRelays = [...new Set([...row.relays, ...NOTIFICATION_RELAYS])]
        const { succeeded } = await publishToRelays(targetRelays, giftWrap)

        if (succeeded > 0) {
          await pool.query(
            `UPDATE notification_subscriptions SET ${cooldownColumn} = now() WHERE pubkey = $1 AND mint_url = $2`,
            [row.pubkey, mintUrl]
          )
          sent++
        } else {
          failed++
        }
      } catch (err) {
        failed++
        console.error(`[notify] send error for mint=${mintUrl} pubkey=${row.pubkey.slice(0, 8)}…:`, err)
      }
    }

    console.log(
      `[notify] sent ${direction}-alert (checked ${checkedAt.toISOString()}) for ${mintUrl} to ${rows.length} subscriber(s) ` +
      `(${sent} succeeded, ${failed} failed, ${cooldownSkipped} cooldown-skipped)`
    )
  } catch (err) {
    console.error(`[notify] notifySubscribers error for mint=${mintUrl}:`, err)
  }
}
