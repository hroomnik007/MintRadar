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
import { safeLookup, isWellFormedMintUrl } from './ssrf.js'
import { reserveDmSlot, releaseDmSlot, resetSummaryFlag, type DmSlot } from './dmQuota.js'
import {
  ALERT_COOLDOWN_HOURS, CLEAR_PROBES_TO_REARM, DM_CAP_SUMMARY_TEXT, UPDOWN_COOLDOWN_MINUTES, type AlertKind,
} from './notificationLimits.js'

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
// per mint per hour (UPDOWN_COOLDOWN_MINUTES, notificationLimits.ts). Enforced
// atomically in SQL (see notifySubscribers).
const COOLDOWN_MINUTES = UPDOWN_COOLDOWN_MINUTES

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

// ---------------------------------------------------------------------------
// DM text. EVERY notification text (down, up and the three "More alerts") is built ONLY from a fixed
// template, the hostname of the mint (validated by isWellFormedMintUrl's hostname rules) and a link
// https://mintradar.org/mint/<encodeURIComponent(mint url)>. The mint's name, version, MOTD, error
// texts and the raw URL (path, query, fragment) are mint-controlled and never reach a DM, so a hostile
// mint cannot put its own sentences, links, nostr: references or @mentions into a message signed by
// the MintRadar service key. The only "://" in a DM is the one in "https://mintradar.org/".
// ---------------------------------------------------------------------------
export type { AlertKind }
export type DmKind = 'down' | 'up' | AlertKind

const MINTRADAR_ORIGIN = 'https://mintradar.org'
const FALLBACK_HOSTNAME = 'A watched mint'

const DM_TEMPLATES: Record<DmKind, (host: string, detailUrl: string) => string> = {
  down: (host, url) => `⚠️ ${host} just went offline.\nView details: ${url}`,
  up: (host, url) => `✅ ${host} is back online.\nView details: ${url}`,
  mint_melt: (host, url) => `⚠️ ${host}: mint or melt issues were detected.\nView details: ${url}`,
  version_outdated: (host, url) => `ℹ️ ${host} is now running outdated software.\nView details: ${url}`,
  nut_loss: (host, url) => `⚠️ ${host} no longer supports NUT-04 or NUT-05 (minting or melting).\nView details: ${url}`,
}

export function dmHostname(mintUrl: string): string {
  try {
    return isWellFormedMintUrl(mintUrl) ? new URL(mintUrl).hostname : FALLBACK_HOSTNAME
  } catch {
    return FALLBACK_HOSTNAME
  }
}

export function buildDmText(kind: DmKind, mintUrl: string): string {
  return DM_TEMPLATES[kind](dmHostname(mintUrl), `${MINTRADAR_ORIGIN}/mint/${encodeURIComponent(mintUrl)}`)
}

interface ClaimedRow {
  pubkey: string
  relays: string[]
  claimed_at: Date
  /** "More alerts" only: the claim column's value before this claim (restored when the send fails). */
  prev_at?: Date | null
}

type DeliveryOutcome = 'sent' | 'failed' | 'dropped'

// The 13 fixed notification relays plus the subscriber's own.
function targetRelaysFor(row: ClaimedRow): string[] {
  return [...new Set([...row.relays, ...NOTIFICATION_RELAYS])]
}

// Sent once per window to a subscriber whose daily cap was just exceeded (not itself counted).
async function sendCapSummary(secretKey: Uint8Array, row: ClaimedRow, slot: DmSlot): Promise<void> {
  try {
    const giftWrap = nip17.wrapEvent(secretKey, { publicKey: row.pubkey }, DM_CAP_SUMMARY_TEXT)
    const { succeeded } = await publishToRelays(targetRelaysFor(row), giftWrap)
    if (succeeded === 0) await resetSummaryFlag(row.pubkey, slot.windowStart)
  } catch (err) {
    console.error(`[notify] cap summary error for pubkey=${row.pubkey.slice(0, 8)}…:`, err)
    await resetSummaryFlag(row.pubkey, slot.windowStart).catch(() => undefined)
  }
}

// One claimed subscriber: take a slot of the per-subscriber daily cap, then publish the gift wrap.
//  - over the cap          -> 'dropped' (never queued; the claim stays used; one summary DM per window)
//  - published somewhere   -> 'sent'
//  - nothing went out      -> 'failed': the claim AND the cap slot are given back so the next probe retries
// Never throws.
async function deliverDm(
  secretKey: Uint8Array,
  row: ClaimedRow,
  message: string,
  errorLabel: string,
  releaseClaim: (row: ClaimedRow) => Promise<unknown>,
): Promise<DeliveryOutcome> {
  let slot: DmSlot | null = null
  const giveBack = async (): Promise<void> => {
    await releaseClaim(row)
    if (slot?.allowed) {
      await releaseDmSlot(row.pubkey, slot.windowStart).catch(err =>
        console.error(`[notify] failed to release cap slot for ${row.pubkey.slice(0, 8)}…:`, err))
    }
  }
  try {
    slot = await reserveDmSlot(row.pubkey)
    if (!slot.allowed) {
      if (slot.sendSummary) await sendCapSummary(secretKey, row, slot)
      return 'dropped'
    }
    const giftWrap = nip17.wrapEvent(secretKey, { publicKey: row.pubkey }, message)
    const { succeeded } = await publishToRelays(targetRelaysFor(row), giftWrap)
    if (succeeded > 0) return 'sent'
    await giveBack()
    return 'failed'
  } catch (err) {
    console.error(`[notify] ${errorLabel} pubkey=${row.pubkey.slice(0, 8)}…:`, err)
    await giveBack()
    return 'failed'
  }
}

function summaryLine(sent: number, failed: number, dropped: number): string {
  return `${sent} sent, ${failed} failed (claim released)` + (dropped > 0 ? `, ${dropped} dropped (daily cap)` : '')
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
// Every claimed DM also takes a slot of the subscriber's daily cap (deliverDm).
export async function notifySubscribers(mintUrl: string, direction: 'down' | 'up', checkedAt: Date): Promise<void> {
  if (!serviceSecretKey) return
  const secretKey = serviceSecretKey

  try {
    const notifyColumn = direction === 'down' ? 'notify_on_down' : 'notify_on_up'
    const cooldownColumn = direction === 'down' ? 'last_notified_down_at' : 'last_notified_up_at'

    // The claim time is cut to milliseconds: it is read back as a JS Date and used as the guard of
    // releaseClaim below, and PostgreSQL's microseconds would never compare equal to it.
    const claimed = await pool.query(
      `UPDATE notification_subscriptions
          SET ${cooldownColumn} = date_trunc('milliseconds', now())
        WHERE mint_url = $1
          AND ${notifyColumn} = true
          AND (${cooldownColumn} IS NULL OR ${cooldownColumn} < now() - INTERVAL '${COOLDOWN_MINUTES} minutes')
       RETURNING pubkey, relays, ${cooldownColumn} AS claimed_at`,
      [mintUrl]
    )
    const rows = claimed.rows as ClaimedRow[]
    if (rows.length === 0) return

    const message = buildDmText(direction, mintUrl)

    // Release a claim whose DM never went out, so the next probe cycle can
    // retry that subscriber. Guarded on the exact timestamp we set, so a
    // concurrent successful claim is never clobbered. Reverting to NULL is
    // safe — the claim query only matched rows whose cooldown had elapsed.
    const releaseClaim = (row: ClaimedRow) =>
      pool.query(
        `UPDATE notification_subscriptions SET ${cooldownColumn} = NULL
         WHERE pubkey = $1 AND mint_url = $2 AND ${cooldownColumn} = $3`,
        [row.pubkey, mintUrl, row.claimed_at]
      ).catch(err => console.error(`[notify] failed to release claim for ${row.pubkey.slice(0, 8)}…:`, err))

    const count = { sent: 0, failed: 0, dropped: 0 }
    for (const row of rows) {
      count[await deliverDm(secretKey, row, message, `send error for mint=${mintUrl}`, releaseClaim)]++
    }

    console.log(
      `[notify] ${direction}-alert (checked ${checkedAt.toISOString()}) for ${mintUrl}: ` +
      `claimed ${rows.length}, ${summaryLine(count.sent, count.failed, count.dropped)}`
    )
  } catch (err) {
    console.error(`[notify] notifySubscribers error for mint=${mintUrl}:`, err)
  }
}

// ---------------------------------------------------------------------------
// "More alerts": mint/melt issues, version outdated, lost NUT-04/05.
// Same atomic-claim pattern as notifySubscribers, one claim column per alert:
// notification_subscriptions.last_notified_*_at = the time of the subscriber's last claim, NEVER reset
// to NULL by a cleared condition (that used to bypass every cooldown). A subscriber can be claimed when
//   - the slot is NULL (never notified), or
//   - the cooldown (ALERT_COOLDOWN_HOURS) has passed since the last claim AND the mint has been re-armed
//     since that claim (mints.alert_rearmed_<kind>_at > the claim): the condition stayed clear for
//     CLEAR_PROBES_TO_REARM consecutive probes (recordAlertClear), so one episode = at most one DM.
// The claim is one atomic statement (row lock + re-check), so overlapping probes or two backend
// processes cannot both send. Every claimed DM also takes a slot of the daily cap (deliverDm).
// The probe loop drives it: an active condition calls notifyAlert (which also resets the clear streak),
// a clear one calls recordAlertClear, an unknown one does neither.
// ---------------------------------------------------------------------------
const ALERTS: Record<AlertKind, { flag: string; claim: string; streak: string; rearmed: string }> = {
  mint_melt: {
    flag: 'notify_on_mint_melt_issues', claim: 'last_notified_mint_melt_at',
    streak: 'alert_clear_streak_mint_melt', rearmed: 'alert_rearmed_mint_melt_at',
  },
  version_outdated: {
    flag: 'notify_on_version_outdated', claim: 'last_notified_version_outdated_at',
    streak: 'alert_clear_streak_version_outdated', rearmed: 'alert_rearmed_version_outdated_at',
  },
  nut_loss: {
    flag: 'notify_on_nut_loss', claim: 'last_notified_nut_loss_at',
    streak: 'alert_clear_streak_nut_loss', rearmed: 'alert_rearmed_nut_loss_at',
  },
}

// Sends one DM per subscriber of `mintUrl` who has the alert's flag on and can be claimed (see above).
// Never throws.
export async function notifyAlert(mintUrl: string, kind: AlertKind): Promise<void> {
  if (!serviceSecretKey) return
  const secretKey = serviceSecretKey
  const cfg = ALERTS[kind]

  try {
    // The condition is active: restart the clear streak (a no-op write is skipped when it is already 0).
    await pool.query(
      `UPDATE mints SET ${cfg.streak} = 0 WHERE url = $1 AND ${cfg.streak} <> 0`,
      [mintUrl]
    )

    // FOR UPDATE row-locks the candidates; a concurrent claim waits, re-checks the WHERE against the
    // updated row and no longer matches. prev_at is what the release restores if the send fails.
    const claimed = await pool.query(
      `WITH cand AS (
         SELECT ns.pubkey, ns.mint_url, ns.${cfg.claim} AS prev_at
           FROM notification_subscriptions ns
           JOIN mints m ON m.url = ns.mint_url
          WHERE ns.mint_url = $1
            AND ns.${cfg.flag} = true
            AND (ns.${cfg.claim} IS NULL
                 OR (ns.${cfg.claim} < now() - make_interval(hours => $2::int)
                     AND ns.${cfg.claim} < m.${cfg.rearmed}))
            FOR UPDATE OF ns
       )
       UPDATE notification_subscriptions ns
          SET ${cfg.claim} = date_trunc('milliseconds', now())
         FROM cand
        WHERE ns.pubkey = cand.pubkey AND ns.mint_url = cand.mint_url
       RETURNING ns.pubkey, ns.relays, ns.${cfg.claim} AS claimed_at, cand.prev_at AS prev_at`,
      [mintUrl, ALERT_COOLDOWN_HOURS[kind]]
    )
    const rows = claimed.rows as ClaimedRow[]
    if (rows.length === 0) return

    const message = buildDmText(kind, mintUrl)

    // Guarded on the exact timestamp we set (ms precision, see the claim) so a newer claim is never clobbered.
    const releaseClaim = (row: ClaimedRow) =>
      pool.query(
        `UPDATE notification_subscriptions SET ${cfg.claim} = $4
         WHERE pubkey = $1 AND mint_url = $2 AND ${cfg.claim} = $3`,
        [row.pubkey, mintUrl, row.claimed_at, row.prev_at ?? null]
      ).catch(err => console.error(`[notify] failed to release ${kind} claim for ${row.pubkey.slice(0, 8)}…:`, err))

    const count = { sent: 0, failed: 0, dropped: 0 }
    for (const row of rows) {
      count[await deliverDm(secretKey, row, message, `${kind} send error for mint=${mintUrl}`, releaseClaim)]++
    }
    console.log(`[notify] ${kind}-alert for ${mintUrl}: claimed ${rows.length}, ${summaryLine(count.sent, count.failed, count.dropped)}`)
  } catch (err) {
    console.error(`[notify] notifyAlert(${kind}) error for mint=${mintUrl}:`, err)
  }
}

// The condition is clear on this probe: count it. After CLEAR_PROBES_TO_REARM clear probes in a row the
// mint is re-armed (alert_rearmed_*_at = now), which lets a later episode notify again — still subject to
// the cooldown. One atomic statement; once the streak is full there is nothing left to write. Never throws.
export async function recordAlertClear(mintUrl: string, kind: AlertKind): Promise<void> {
  try {
    const { streak, rearmed } = ALERTS[kind]
    await pool.query(
      `UPDATE mints
          SET ${streak} = ${streak} + 1,
              ${rearmed} = CASE WHEN ${streak} + 1 >= $2::int THEN now() ELSE ${rearmed} END
        WHERE url = $1 AND ${streak} < $2::int`,
      [mintUrl, CLEAR_PROBES_TO_REARM]
    )
  } catch (err) {
    console.error(`[notify] recordAlertClear(${kind}) error for mint=${mintUrl}:`, err)
  }
}
