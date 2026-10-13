#!/usr/bin/env node
// Verify a MintRadar Health assertion (Nostr kind 30385) for one Cashu mint.
// Draft spec: docs/nostr-health-assertions.md. STATUS: live since 2026-10-13 (early version).
//
//   npm install nostr-tools
//   node verify-health.mjs https://mint.example.com
//
// The only dependency is nostr-tools (verifyEvent, SimplePool). The signal is operational health, not solvency and not
// a recommendation to deposit funds.

import { verifyEvent } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'

/** The provider key you pin. Check it against the npub in the docs and against health@mintradar.org (NIP-05). */
export const PINNED_PUBKEY = '2ddd7ce9833d2ed8a0bfaaf903cc71f65641f20d8f8142130163a625aa6b941c'
export const RELAYS = ['wss://nostr.mintradar.org', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']
export const KIND = 30385
/** Seconds of clock skew tolerated for a created_at that lies in the future. */
const FUTURE_SKEW_S = 300

/**
 * The `d` value for a mint URL: https, lowercase host, no default port, no trailing slash on a bare host, NO fragment.
 * Same rules as MintRadar's backend (normalizeUrl + dropped fragment).
 */
export function normalizeMintUrl(raw) {
  let parsed
  try { parsed = new URL(String(raw).trim()) } catch { return String(raw).trim() }
  parsed.protocol = 'https:'
  parsed.hostname = parsed.hostname.toLowerCase()
  parsed.hash = ''
  let result = parsed.toString()
  if (parsed.pathname === '/' && parsed.search === '') result = result.replace(/\/$/, '')
  return result
}

const tagValue = (event, name) => event.tags.find(t => t[0] === name)?.[1]
const isInt = (s) => typeof s === 'string' && /^\d{1,12}$/.test(s)

/**
 * Checks one event. Returns { ok: true, health } or { ok: false, reason }.
 * Steps: signature and id, author equals the pinned key, kind, d equals the normalised mint URL, k, expiration,
 * created_at not in the future, rank and methodology are integers.
 */
export function verifyHealthEvent(event, { mintUrl, pubkey = PINNED_PUBKEY, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!event || typeof event !== 'object' || !Array.isArray(event.tags)) return { ok: false, reason: 'not an event' }
  if (!verifyEvent(event)) return { ok: false, reason: 'bad signature or id' }
  if (event.pubkey !== pubkey) return { ok: false, reason: 'not signed by the pinned key' }
  if (event.kind !== KIND) return { ok: false, reason: 'wrong kind' }
  if (tagValue(event, 'd') !== normalizeMintUrl(mintUrl)) return { ok: false, reason: 'd does not match the mint URL' }
  if (tagValue(event, 'k') !== 'web') return { ok: false, reason: 'k is not "web"' }
  const expiration = tagValue(event, 'expiration')
  if (!isInt(expiration)) return { ok: false, reason: 'no expiration' }
  if (now >= Number(expiration)) return { ok: false, reason: 'expired' }
  if (event.created_at > now + FUTURE_SKEW_S) return { ok: false, reason: 'created_at in the future' }
  const rank = tagValue(event, 'rank')
  if (!isInt(rank) || Number(rank) > 100) return { ok: false, reason: 'rank is not an integer from 0 to 100' }
  const methodology = tagValue(event, 'methodology')
  if (!isInt(methodology)) return { ok: false, reason: 'methodology is not an integer' }
  return {
    ok: true,
    health: {
      createdAt: event.created_at,
      expiration: Number(expiration),
      rank: Number(rank),
      status: tagValue(event, 'mint_status'),
      methodology: Number(methodology),
      methodologyUrl: tagValue(event, 'methodology_url'),
      isTest: tagValue(event, 'mint_test') === '1',
      newMintCapped: tagValue(event, 'mint_new_capped') === '1',
      checkedAt: isInt(tagValue(event, 'mint_checked_at')) ? Number(tagValue(event, 'mint_checked_at')) : null,
      tags: Object.fromEntries(event.tags.map(t => [t[0], t[1]])),
    },
  }
}

/** The valid event with the newest created_at (addressable events: newest wins), or null. */
export function pickNewest(events, options) {
  let best = null
  for (const event of events) {
    const result = verifyHealthEvent(event, options)
    if (result.ok && (best === null || event.created_at > best.event.created_at)) best = { event, health: result.health }
  }
  return best
}

/** Queries the four relays and returns the newest valid assertion for the mint, or null (no event, or an expired one: that means "unknown", not "bad"). */
export async function fetchHealth(mintUrl, { pool = new SimplePool(), relays = RELAYS, pubkey = PINNED_PUBKEY, now } = {}) {
  try {
    const events = await pool.querySync(relays, { kinds: [KIND], authors: [pubkey], '#d': [normalizeMintUrl(mintUrl)], limit: 5 })
    return pickNewest(events, { mintUrl, pubkey, now })
  } finally {
    pool.close(relays)
  }
}

// Command line: node verify-health.mjs <mint url>
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const mintUrl = process.argv[2]
  if (!mintUrl) {
    console.error('usage: node verify-health.mjs <mint url>')
    process.exit(2)
  }
  const found = await fetchHealth(mintUrl)
  if (!found) {
    console.log('no valid assertion found (the mint has none, or its event expired: unknown, not bad)')
    process.exit(1)
  }
  console.log(JSON.stringify(found.health, null, 2))
  console.log('Operational health signal, not solvency, not a recommendation to deposit funds.')
}
