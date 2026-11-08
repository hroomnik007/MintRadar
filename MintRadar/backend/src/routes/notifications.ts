// NIP-98-authenticated notification subscriptions: subscribe, unsubscribe, list.
import { Router } from 'express'
import { type Request, type Response } from 'express'
import { pool } from '../db.js'
import { checkWsUrlSafety } from '../ssrf.js'
import { normalizeUrl } from '../discovery.js'
import { authenticateNip98 } from '../nip98Auth.js'
import { IS_DEV, MAX_URL_LENGTH, sanitizeLogValue } from '../serverConfig.js'
import { setRetryAfter, notifySubscribeRateLimitStore, notifyUnsubscribeRateLimitStore, notifyListRateLimitStore, checkNotifySubscribeRateLimit, checkNotifyUnsubscribeRateLimit, checkNotifyListRateLimit } from '../rateLimits.js'

export const router = Router()

// ── Routes: notification subscriptions ────────────────────────
//
// Phase 1: storage only — no sending. A subscription records that `pubkey`
// wants a DM (over `relays`) when `mintUrl` transitions online/offline.
// Both routes require NIP-98 auth (RFC 27235 "Nostr" HTTP Auth) so a
// subscription can only be created/removed by the key that owns it.

export const MIN_RELAYS = 1
export const MAX_RELAYS = 10

// Per-pubkey caps on the notification-subscription store. `notifySubscribers`
// (nostrService.ts) fans a gift-wrap signed by NOTIFICATION_SERVICE_NSEC out to
// (row.relays ∪ NOTIFICATION_RELAYS) for every matching row on a mint
// transition. Without a total cap, one free pubkey could accumulate a
// subscription row for every mint (each carrying up to 10 attacker-chosen relay
// URLs), turning a flapping mint into amplified traffic toward arbitrary public
// relays — and getting the service key rate-limited/banned, breaking
// notifications for everyone. A real user watches single- to low-double-digit
// mints and reuses one relay list across them, so these limits are far above
// legitimate use. (The 30/hr rate limit bounds the *rate* of writes, not the
// *total* — and pubkeys are free, so it isn't enough on its own.)
export const MAX_SUBSCRIPTIONS_PER_PUBKEY = 50
export const MAX_DISTINCT_RELAYS_PER_PUBKEY = 25

// Validates the relay list shape and, for each entry, that it's a ws:/wss:
// URL that passes the same SSRF guard used for mint probing (adapted for the
// ws(s) scheme in ssrf.ts) — prevents a subscription from later being used to
// make the (future, phase-2) DM-sending code connect to internal
// infrastructure via an attacker-supplied "relay".
//
// `logContext` (a truncated pubkey — never full request data) is included in
// every rejection log line so a rejected batch is diagnosable server-side
// without needing to expose which specific relay/reason failed to the client.
export async function validateRelays(relays: unknown, logContext: string): Promise<string[] | null> {
  if (!Array.isArray(relays)) {
    console.warn(`[notifications] relay validation rejected (${logContext}): relays is not an array`)
    return null
  }
  if (relays.length < MIN_RELAYS || relays.length > MAX_RELAYS) {
    console.warn(`[notifications] relay validation rejected (${logContext}): ${relays.length} relays, expected ${MIN_RELAYS}-${MAX_RELAYS}`)
    return null
  }
  for (const r of relays) {
    if (typeof r !== 'string' || r.length === 0 || r.length > MAX_URL_LENGTH) {
      console.warn(`[notifications] relay validation rejected (${logContext}): malformed relay entry (not a string, empty, or over ${MAX_URL_LENGTH} chars)`)
      return null
    }
  }
  const typedRelays = relays as string[]
  const checks = await Promise.all(
    typedRelays.map(async url => ({ url, result: await checkWsUrlSafety(url) }))
  )

  // A DNS failure is not an SSRF signal — mirrors checkWsUrlSafety's own
  // three-state contract (ssrf.ts), where 'dns-error' means "currently
  // unreachable", not "malicious" (only 'blocked' does: bad scheme, or
  // resolves to a private/internal address). Treating 'dns-error' the same
  // as 'blocked' was the actual bug: a single relay with a dead/unresolvable
  // hostname (e.g. relay.nostr.bg — confirmed via `dig`, no DNS records at
  // all) rejected the ENTIRE subscribe request, even with 9 other perfectly
  // valid relays in the same batch. A relay list naturally includes relays
  // that are temporarily or permanently down; that's not something the
  // request as a whole should fail on. Only a genuinely 'blocked' relay
  // invalidates the batch — 'dns-error' relays are still stored as given.
  const blocked = checks.filter(c => c.result === 'blocked')
  if (blocked.length > 0) {
    console.warn(
      `[notifications] relay validation rejected (${logContext}): blocked — ` +
      blocked.map(c => sanitizeLogValue(c.url)).join(', ')
    )
    return null
  }

  const dnsErrors = checks.filter(c => c.result === 'dns-error')
  if (dnsErrors.length > 0) {
    console.warn(
      `[notifications] relay(s) unresolvable but accepted (${logContext}): ` +
      dnsErrors.map(c => sanitizeLogValue(c.url)).join(', ')
    )
  }

  return typedRelays
}

router.post('/api/notifications/subscribe', (req: Request, res: Response): void => {
  authenticateNip98(req)
    .then(auth => {
      if (!auth.ok) {
        res.status(auth.status).json({ error: auth.error })
        return
      }
      const { pubkey } = auth

      if (!checkNotifySubscribeRateLimit(pubkey)) {
        setRetryAfter(res, notifySubscribeRateLimitStore, pubkey)
        res.status(429).json({ error: 'Too many requests. Try again later.' })
        return
      }

      const body = req.body as {
        mintUrl?: unknown
        notifyOnDown?: unknown
        notifyOnUp?: unknown
        notifyOnMintMeltIssues?: unknown
        notifyOnVersionOutdated?: unknown
        notifyOnNutLoss?: unknown
        relays?: unknown
      }

      const mintUrl = body.mintUrl
      if (typeof mintUrl !== 'string' || mintUrl.length === 0) {
        res.status(400).json({ error: 'Missing required field: mintUrl' })
        return
      }
      if (mintUrl.length > MAX_URL_LENGTH) {
        res.status(400).json({ error: `mintUrl exceeds maximum length of ${MAX_URL_LENGTH} characters` })
        return
      }

      const { notifyOnDown, notifyOnUp } = body
      if (typeof notifyOnDown !== 'boolean' || typeof notifyOnUp !== 'boolean') {
        res.status(400).json({ error: 'notifyOnDown and notifyOnUp must be boolean' })
        return
      }
      // "More alerts" flags are optional: omitted = keep what is stored (false for a new row), so a client
      // that only knows down/up never switches them off. When present they must be boolean.
      const moreFlags = [body.notifyOnMintMeltIssues, body.notifyOnVersionOutdated, body.notifyOnNutLoss]
      if (moreFlags.some(f => f !== undefined && typeof f !== 'boolean')) {
        res.status(400).json({ error: 'notifyOnMintMeltIssues, notifyOnVersionOutdated and notifyOnNutLoss must be boolean when provided' })
        return
      }
      const [notifyOnMintMelt, notifyOnVersionOutdated, notifyOnNutLoss] = moreFlags.map(f => (typeof f === 'boolean' ? f : null))

      return validateRelays(body.relays, pubkey.slice(0, 8)).then(relays => {
        if (relays === null) {
          res.status(400).json({
            error: `relays must be an array of ${MIN_RELAYS}-${MAX_RELAYS} valid ws:// or wss:// URLs`,
          })
          return
        }

        return pool.query('SELECT 1 FROM mints WHERE url = $1', [mintUrl]).then(mintResult => {
          if ((mintResult.rowCount ?? 0) === 0) {
            res.status(400).json({ error: 'Unknown mint' })
            return
          }

          // Per-pubkey caps — one round-trip: current row count, whether THIS
          // mint already has a row (an update, always allowed), and the set of
          // relay URLs already stored for this pubkey's OTHER subscriptions.
          return pool.query(
            `SELECT
               (SELECT COUNT(*)::int FROM notification_subscriptions WHERE pubkey = $1) AS total,
               (SELECT COUNT(*)::int FROM notification_subscriptions WHERE pubkey = $1 AND mint_url = $2) AS this_mint,
               COALESCE(ARRAY(
                 SELECT DISTINCT r FROM notification_subscriptions ns, unnest(ns.relays) AS r
                 WHERE ns.pubkey = $1 AND ns.mint_url <> $2
               ), '{}'::text[]) AS other_relays`,
            [pubkey, mintUrl]
          ).then(capRow => {
            const { total, this_mint, other_relays } = capRow.rows[0] as {
              total: number; this_mint: number; other_relays: string[]
            }
            const isNewRow = this_mint === 0

            if (isNewRow && total >= MAX_SUBSCRIPTIONS_PER_PUBKEY) {
              res.status(409).json({
                error: `You already have ${MAX_SUBSCRIPTIONS_PER_PUBKEY} mint notification subscriptions, which is the maximum. Unsubscribe from one before adding another.`,
              })
              return
            }

            const distinctRelaysAfter = new Set([...other_relays, ...relays])
            if (distinctRelaysAfter.size > MAX_DISTINCT_RELAYS_PER_PUBKEY) {
              res.status(400).json({
                error: `This subscription would push your notification relay list to ${distinctRelaysAfter.size} distinct relays across all your subscriptions; the maximum is ${MAX_DISTINCT_RELAYS_PER_PUBKEY}. Reuse the same relay list across your subscriptions.`,
              })
              return
            }

            return pool.query(
              `INSERT INTO notification_subscriptions
               (pubkey, mint_url, notify_on_down, notify_on_up, relays, updated_at,
                notify_on_mint_melt_issues, notify_on_version_outdated, notify_on_nut_loss)
             VALUES ($1, $2, $3, $4, $5, now(), COALESCE($6::boolean, false), COALESCE($7::boolean, false), COALESCE($8::boolean, false))
             ON CONFLICT (pubkey, mint_url) DO UPDATE SET
               notify_on_down = EXCLUDED.notify_on_down,
               notify_on_up = EXCLUDED.notify_on_up,
               notify_on_mint_melt_issues = COALESCE($6::boolean, notification_subscriptions.notify_on_mint_melt_issues),
               notify_on_version_outdated = COALESCE($7::boolean, notification_subscriptions.notify_on_version_outdated),
               notify_on_nut_loss = COALESCE($8::boolean, notification_subscriptions.notify_on_nut_loss),
               relays = EXCLUDED.relays,
               updated_at = now()`,
            [pubkey, mintUrl, notifyOnDown, notifyOnUp, relays, notifyOnMintMelt, notifyOnVersionOutdated, notifyOnNutLoss]
            ).then(() => {
              // Audit trail: truncated pubkey + mint only — never relays/notify
              // flags, which is the rest of the request body.
              console.log(`[notifications/subscribe] pubkey=${pubkey.slice(0, 8)}… mint=${mintUrl}`)
              res.json({ success: true })
            })
          })
        })
      })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/notifications/subscribe]', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' })
    })
})

router.post('/api/notifications/unsubscribe', (req: Request, res: Response): void => {
  authenticateNip98(req)
    .then(auth => {
      if (!auth.ok) {
        res.status(auth.status).json({ error: auth.error })
        return
      }
      const { pubkey } = auth

      if (!checkNotifyUnsubscribeRateLimit(pubkey)) {
        setRetryAfter(res, notifyUnsubscribeRateLimitStore, pubkey)
        res.status(429).json({ error: 'Too many requests. Try again later.' })
        return
      }

      const body = req.body as { mintUrl?: unknown }
      const mintUrl = body.mintUrl
      if (typeof mintUrl !== 'string' || mintUrl.length === 0) {
        res.status(400).json({ error: 'Missing required field: mintUrl' })
        return
      }
      if (mintUrl.length > MAX_URL_LENGTH) {
        res.status(400).json({ error: `mintUrl exceeds maximum length of ${MAX_URL_LENGTH} characters` })
        return
      }

      // Normalize the same way every other mint-URL entry point does before
      // using it anywhere — including in the log line below, where a raw
      // client-supplied string with an embedded newline could otherwise
      // forge a second, fabricated log entry.
      try {
        new URL(mintUrl.trim())
      } catch {
        res.status(400).json({ error: 'Invalid mintUrl' })
        return
      }
      const normalizedMintUrl = normalizeUrl(mintUrl)

      return pool.query(
        'DELETE FROM notification_subscriptions WHERE pubkey = $1 AND mint_url = $2',
        [pubkey, normalizedMintUrl]
      ).then(() => {
        console.log(`[notifications/unsubscribe] pubkey=${pubkey.slice(0, 8)}… mint=${normalizedMintUrl}`)
        res.json({ success: true })
      })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/notifications/unsubscribe]', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' })
    })
})

// Lists the authenticated pubkey's own notification settings so a new device/browser can show
// them truthfully at login. Only mint_url + the five flags — never relays, timestamps or other
// accounts' rows. POST (not GET) so the NIP-98 token is bound to this exact method/url and the
// response is never cached by a browser or proxy.
router.post('/api/notifications/list', (req: Request, res: Response): void => {
  res.set('Cache-Control', 'private, no-store')
  authenticateNip98(req)
    .then(auth => {
      if (!auth.ok) {
        res.status(auth.status).json({ error: auth.error })
        return
      }
      const { pubkey } = auth
      if (!checkNotifyListRateLimit(pubkey)) {
        setRetryAfter(res, notifyListRateLimitStore, pubkey)
        res.status(429).json({ error: 'Too many requests. Try again later.' })
        return
      }
      return pool.query(
        `SELECT mint_url, notify_on_down, notify_on_up, notify_on_mint_melt_issues,
                notify_on_version_outdated, notify_on_nut_loss
           FROM notification_subscriptions WHERE pubkey = $1`,
        [pubkey]
      ).then(result => {
        const rows = (result.rows as Record<string, unknown>[]).map(r => ({
          mintUrl: String(r.mint_url),
          notifyOnDown: r.notify_on_down === true,
          notifyOnUp: r.notify_on_up === true,
          notifyOnMintMeltIssues: r.notify_on_mint_melt_issues === true,
          notifyOnVersionOutdated: r.notify_on_version_outdated === true,
          notifyOnNutLoss: r.notify_on_nut_loss === true,
        }))
        res.json({ subscriptions: rows })
      })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/notifications/list]', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' })
    })
})
