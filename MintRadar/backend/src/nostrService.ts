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

// Always install the 'ws' package as globalThis.WebSocket, even on Node
// versions (22+) that ship a native undici WebSocket. The root 'nostr-tools'
// SimplePool used by discovery.ts / reviewsSync.ts reads globalThis.WebSocket
// directly, and undici's native implementation has a known bug where a failed
// relay connection recurses through its close/error handling and crashes the
// process with "RangeError: Maximum call stack size exceeded" — 'ws' does not
// have this bug. Previously guarded by `if (!globalThis.WebSocket)`, which was
// only true on Node 20; the guard silently stopped firing once the Dockerfile
// moved to node:22-alpine, leaving the buggy native implementation in place.
// (same pattern as discovery.ts / index.ts's nostr-reviews endpoint).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).WebSocket = WebSocket

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
// Not a React hook — the react-hooks plugin flags this purely because of the "use" name
// prefix nostr-tools chose for this function.
// eslint-disable-next-line react-hooks/rules-of-hooks
useWebSocketImplementation(DnsPinnedWebSocket)

// Broader relay set for BROADCASTING kind:0/30023 identity + article events
// (publishServiceProfile/publishLongFormArticle below) — deliberately wider
// than the frontend's 4-relay fast-bootstrap META_RELAYS (client.ts), not
// meant to mirror it. That list was trimmed 2026-09-02 (commit dc43304) for
// login-path latency (a *read*, gated by the slowest relay's connect+EOSE);
// this one runs infrequently (startup + once/day, or on-demand) and cares
// about propagation reach, not latency, so it was deliberately left alone —
// see dc43304's own commit message, which scoped that change to the frontend
// only and documented it as an exception, not a rename of a shared list.
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
// `relay.nostr.band` removed 2026-09-20 — see the frontend array's comment.
// `pyramid.fiatjaf.com` / `nostr.lopp.social` removed 2026-09-23 — see the frontend array's
// comment (same measured 0-yield/restricted-write findings).
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

const RELAY_PUBLISH_TIMEOUT_MS = 5_000
// Per-direction cooldown: at most one down-alert and one up-alert per subscriber
// per mint per hour. Enforced atomically in SQL (see notifySubscribers) — a
// constant so the interval literal in the query stays in one place.
const COOLDOWN_MINUTES = 60

let serviceSecretKey: Uint8Array | null = null

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
      const servicePubkeyHex = getPublicKey(serviceSecretKey)
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
          about: 'Automated Cashu mint status notifications from mintradar.org. Replies are not monitored — manage your subscriptions in the app.',
          website: 'https://mintradar.org',
          picture: 'https://mintradar.org/icons/icon-512x512.png',
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

// Publishes a NIP-23 long-form article (kind:30023). `identifier` is the
// event's `d` tag — publishing again with the same identifier replaces the
// previous version on relays that honor replaceable events, so this is safe
// to re-run for edits. Same relay set and short-lived-pool publish pattern
// as publishServiceProfile.
export async function publishLongFormArticle(params: {
  identifier: string
  title: string
  content: string
  summary?: string
}): Promise<{ succeeded: number; failed: number }> {
  if (!serviceSecretKey) throw new Error('NOTIFICATION_SERVICE_NSEC not configured — cannot publish')

  const tags: string[][] = [
    ['d', params.identifier],
    ['title', params.title],
    ['published_at', String(Math.floor(Date.now() / 1000))],
  ]
  if (params.summary) tags.push(['summary', params.summary])

  const event = finalizeEvent(
    {
      kind: 30023,
      content: params.content,
      tags,
      created_at: Math.floor(Date.now() / 1000),
    },
    serviceSecretKey
  )
  const { succeeded, failed } = await publishToRelays(META_RELAYS, event)
  console.log(`[nostr-service] published kind:30023 "${params.identifier}" (${succeeded} succeeded, ${failed} failed)`)
  return { succeeded, failed }
}

interface ClaimedRow {
  pubkey: string
  relays: string[]
  claimed_at: Date
}

// Fires the DM for a down/up transition to every subscriber with a matching
// notify flag, respecting a per-direction hourly cooldown. Never throws — every
// failure (query, per-subscriber send) is caught and logged so a notification
// failure can never affect the probe loop that triggered it.
//
// The cooldown is enforced ATOMICALLY in SQL: a single conditional UPDATE claims
// the cooldown slot (sets the timestamp to now() only where the cooldown has
// actually elapsed) and RETURNs exactly the rows it claimed. Two overlapping
// probe cycles racing on the same up/down transition can't both claim the same
// subscriber — the loser's UPDATE matches zero rows — so at most one DM is sent.
// (Replaces a race-prone SELECT-check → send → UPDATE sequence.)
export async function notifySubscribers(mintUrl: string, direction: 'down' | 'up', checkedAt: Date): Promise<void> {
  if (!serviceSecretKey) return
  const secretKey = serviceSecretKey

  try {
    const notifyColumn = direction === 'down' ? 'notify_on_down' : 'notify_on_up'
    const cooldownColumn = direction === 'down' ? 'last_notified_down_at' : 'last_notified_up_at'

    const claimed = await pool.query(
      `UPDATE notification_subscriptions
          SET ${cooldownColumn} = now()
        WHERE mint_url = $1
          AND ${notifyColumn} = true
          AND (${cooldownColumn} IS NULL OR ${cooldownColumn} < now() - INTERVAL '${COOLDOWN_MINUTES} minutes')
       RETURNING pubkey, relays, ${cooldownColumn} AS claimed_at`,
      [mintUrl]
    )
    const rows = claimed.rows as ClaimedRow[]
    if (rows.length === 0) return

    const hostname = new URL(mintUrl).hostname
    const detailUrl = `https://mintradar.org/mint/${encodeURIComponent(mintUrl)}`
    const message = direction === 'down'
      ? `⚠️ ${hostname} just went offline.\nView details: ${detailUrl}`
      : `✅ ${hostname} is back online.\nView details: ${detailUrl}`

    // Release a claim whose DM never went out, so the next probe cycle can
    // retry that subscriber. Guarded on the exact timestamp we set, so a
    // concurrent successful claim is never clobbered. Reverting to NULL is
    // safe — the claim query only matched rows whose cooldown had elapsed.
    const releaseClaim = (pubkey: string, claimedAt: Date) =>
      pool.query(
        `UPDATE notification_subscriptions SET ${cooldownColumn} = NULL
         WHERE pubkey = $1 AND mint_url = $2 AND ${cooldownColumn} = $3`,
        [pubkey, mintUrl, claimedAt]
      ).catch(err => console.error(`[notify] failed to release claim for ${pubkey.slice(0, 8)}…:`, err))

    let sent = 0
    let failed = 0

    for (const row of rows) {
      try {
        const giftWrap = nip17.wrapEvent(secretKey, { publicKey: row.pubkey }, message)
        const targetRelays = [...new Set([...row.relays, ...NOTIFICATION_RELAYS])]
        const { succeeded } = await publishToRelays(targetRelays, giftWrap)

        if (succeeded > 0) {
          sent++
        } else {
          failed++
          await releaseClaim(row.pubkey, row.claimed_at)
        }
      } catch (err) {
        failed++
        console.error(`[notify] send error for mint=${mintUrl} pubkey=${row.pubkey.slice(0, 8)}…:`, err)
        await releaseClaim(row.pubkey, row.claimed_at)
      }
    }

    console.log(
      `[notify] ${direction}-alert (checked ${checkedAt.toISOString()}) for ${mintUrl}: ` +
      `claimed ${rows.length}, ${sent} sent, ${failed} failed (claim released)`
    )
  } catch (err) {
    console.error(`[notify] notifySubscribers error for mint=${mintUrl}:`, err)
  }
}

// ---------------------------------------------------------------------------
// "More alerts": mint/melt issues, version outdated, lost NUT-04/05.
// Same atomic-claim pattern as notifySubscribers, one claim column per alert.
// NULL = armed. The claim sets it to now() and RETURNs only the rows it claimed,
// so overlapping probe cycles cannot both send. resetAlert() re-arms a mint's
// subscribers once the condition has cleared. Existing up/down code is untouched.
// ---------------------------------------------------------------------------
export type AlertKind = 'mint_melt' | 'version_outdated' | 'nut_loss'

const MINT_MELT_COOLDOWN_HOURS = 12

const ALERTS: Record<AlertKind, { flag: string; claim: string; cooldownHours: number | null; text: (name: string, url: string) => string }> = {
  mint_melt: {
    flag: 'notify_on_mint_melt_issues',
    claim: 'last_notified_mint_melt_at',
    cooldownHours: MINT_MELT_COOLDOWN_HOURS,
    text: (name, url) => `MintRadar: mint/melt issues on ${name} (${url})`,
  },
  version_outdated: {
    flag: 'notify_on_version_outdated',
    claim: 'last_notified_version_outdated_at',
    cooldownHours: null,
    text: (name, url) => `MintRadar: ${name} is now outdated (${url})`,
  },
  nut_loss: {
    flag: 'notify_on_nut_loss',
    claim: 'last_notified_nut_loss_at',
    cooldownHours: null,
    text: (name, url) => `MintRadar: ${name} no longer supports NUT-04/05 (${url})`,
  },
}

// Sends one DM per subscriber of `mintUrl` who has the alert's flag on and whose claim slot is armed
// (and, for mint/melt, whose last alert is older than 12 h). Never throws.
export async function notifyAlert(mintUrl: string, kind: AlertKind): Promise<void> {
  if (!serviceSecretKey) return
  const secretKey = serviceSecretKey
  const cfg = ALERTS[kind]

  try {
    const cooldown = cfg.cooldownHours === null
      ? `${cfg.claim} IS NULL`
      : `(${cfg.claim} IS NULL OR ${cfg.claim} < now() - INTERVAL '${cfg.cooldownHours} hours')`
    const claimed = await pool.query(
      `UPDATE notification_subscriptions
          SET ${cfg.claim} = now()
        WHERE mint_url = $1
          AND ${cfg.flag} = true
          AND ${cooldown}
       RETURNING pubkey, relays, ${cfg.claim} AS claimed_at`,
      [mintUrl]
    )
    const rows = claimed.rows as ClaimedRow[]
    if (rows.length === 0) return

    const nameRes = await pool.query('SELECT name FROM mints WHERE url = $1', [mintUrl])
    const stored = nameRes.rows[0]?.name as string | null | undefined
    const name = stored && stored.trim().length > 0 ? stored.trim() : new URL(mintUrl).hostname
    const message = cfg.text(name, mintUrl)

    const releaseClaim = (pubkey: string, claimedAt: Date) =>
      pool.query(
        `UPDATE notification_subscriptions SET ${cfg.claim} = NULL
         WHERE pubkey = $1 AND mint_url = $2 AND ${cfg.claim} = $3`,
        [pubkey, mintUrl, claimedAt]
      ).catch(err => console.error(`[notify] failed to release ${kind} claim for ${pubkey.slice(0, 8)}…:`, err))

    let sent = 0
    let failed = 0
    for (const row of rows) {
      try {
        const giftWrap = nip17.wrapEvent(secretKey, { publicKey: row.pubkey }, message)
        const targetRelays = [...new Set([...row.relays, ...NOTIFICATION_RELAYS])]
        const { succeeded } = await publishToRelays(targetRelays, giftWrap)
        if (succeeded > 0) sent++
        else { failed++; await releaseClaim(row.pubkey, row.claimed_at) }
      } catch (err) {
        failed++
        console.error(`[notify] ${kind} send error for mint=${mintUrl} pubkey=${row.pubkey.slice(0, 8)}…:`, err)
        await releaseClaim(row.pubkey, row.claimed_at)
      }
    }
    console.log(`[notify] ${kind}-alert for ${mintUrl}: claimed ${rows.length}, ${sent} sent, ${failed} failed (claim released)`)
  } catch (err) {
    console.error(`[notify] notifyAlert(${kind}) error for mint=${mintUrl}:`, err)
  }
}

// The condition cleared: re-arm this mint's subscribers so a later recurrence notifies again. Never throws.
export async function resetAlert(mintUrl: string, kind: AlertKind): Promise<void> {
  try {
    const col = ALERTS[kind].claim
    await pool.query(
      `UPDATE notification_subscriptions SET ${col} = NULL WHERE mint_url = $1 AND ${col} IS NOT NULL`,
      [mintUrl]
    )
  } catch (err) {
    console.error(`[notify] resetAlert(${kind}) error for mint=${mintUrl}:`, err)
  }
}
