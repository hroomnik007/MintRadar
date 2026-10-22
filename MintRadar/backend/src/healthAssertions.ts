// Signed mint health assertions (Nostr kind 30385, NIP-85 style): the PURE part. The builder, the
// sanitising of the one mint-controlled string, the publish decision and the key handling live here;
// everything that touches the database or a relay is in healthPublisher.ts. Draft spec:
// docs/nostr-health-assertions.md. Design and activation: docs/claude/nostr-health-assertions.md.
//
// The feature is DORMANT: it does nothing unless ATTESTATION_SERVICE_NSEC is set on the server and its
// public key equals ATTESTATION_PUBKEY_HEX. The key is never logged, never put in an error message,
// never stored and never returned by an endpoint.

import { nip19, getPublicKey } from 'nostr-tools'
import type { EventTemplate } from 'nostr-tools'
import { normalizeUrl } from './discovery.js'
import { METHODOLOGY_VERSION } from './shared/methodology.js'
import { ATTESTATION_PUBKEY_HEX } from './shared/healthAssertionConstants.js'
import type { WalletKeyset } from './walletApi.js'

/** Public key (hex) of the MintRadar Health attestation identity: defined in shared/healthAssertionConstants.ts (one
 *  value for the publisher and the public page). The private key is only in the owner's file and, once activated, in
 *  the server's backend/.env as ATTESTATION_SERVICE_NSEC. */
export { ATTESTATION_PUBKEY_HEX }

/** NIP-85 "NIP-73 identifier as subject" (addressable). */
export const HEALTH_KIND = 30385
/** Relays that receive assertions: the only connections the assertion publisher ever opens. The public pages name the
 *  subset ATTESTATION_RELAYS_PUBLIC (shared/healthAssertionConstants.ts). */
export const ATTESTATION_RELAYS = [
  'wss://nostr.mintradar.org',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.cypherpunk.today',
  'wss://nostr.mom',
] as const

export const ATTESTATION_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000
export const ATTESTATION_MIN_RANK_DELTA = 2
export const ATTESTATION_REFRESH_MS = 24 * 60 * 60 * 1000
export const ATTESTATION_EXPIRY_S = 172_800
export const ATTESTATION_MAX_EVENTS_PER_RUN = 200
/** A status change (the mint_status value differs from the last event) is published at the next run instead of waiting
 *  for ATTESTATION_MIN_INTERVAL_MS, but never sooner than this after the mint's previous event (flapping). */
export const ATTESTATION_STATE_CHANGE_MIN_GAP_MS = 5 * 60 * 1000
/** At most this many state-change events per rolling hour over all mints; the rest is deferred to the next run, never
 *  dropped. 61 eligible mints (2026-10-20): the periodic refresh is about 61 / 24 = 2.5 events an hour, a status change
 *  is a rare event per mint, so 30 an hour is about half of the fleet and 30 x 6 relays = 180 relay writes an hour. */
export const ATTESTATION_STATE_CHANGE_MAX_PER_HOUR = 30
/** The audit tags are only sent while the audit data is at most this old. */
export const ATTESTATION_AUDIT_MAX_AGE_MS = 168 * 60 * 60 * 1000

export const METHODOLOGY_URL = 'https://mintradar.org/methodology'
export const HEALTH_CONTENT =
  "Operational health signal, not solvency, not a recommendation to deposit funds. Based on MintRadar's probes and third-party audit data; it can be wrong or out of date."

/** The site's own app icon (public/icons/icon-512x512.png, the 512 px icon of the web manifest): a static PNG served
 *  from mintradar.org, no third-party host. */
export const ATTESTATION_PROFILE_PICTURE_URL = 'https://mintradar.org/icons/icon-512x512.png'

export const ATTESTATION_PROFILE = {
  name: 'MintRadar Health',
  display_name: 'MintRadar Health',
  about: 'Operational health signals for Cashu mints, computed by MintRadar. Not solvency, not advice. Method: https://mintradar.org/methodology',
  website: 'https://mintradar.org',
  nip05: 'health@mintradar.org',
  picture: ATTESTATION_PROFILE_PICTURE_URL,
} as const

export type HealthStatus = 'online' | 'offline' | 'degraded'

/** What the builder reads for one mint (a subset of WalletMint, walletApi.ts). Reviews, names, network data and
 *  contacts are deliberately not part of it. */
export interface HealthInput {
  url: string
  /** 'archived' and a null score produce no event. */
  status: HealthStatus | 'archived'
  score: number | null
  uptime24hPct: number | null
  uptime7dPct: number | null
  /** The mint's own version string (mint-controlled): sanitised, or left out. */
  software: string | null
  outdated: boolean | null
  isTest: boolean
  scoreCappedNew: boolean
  audit: { swaps7d: number; attributedFailures: number; fetchedAt: string } | null
  lastCheckedAt: string | null
  /** Probes in the last 24 hours (wallet API sample.probes24h); left out of the event when null or absent. */
  probes24h?: number | null
  /** Start of the current offline streak (wallet API downSince); used only while the mint is not online. */
  downSince?: string | null
  /** The keysets of the latest successful keysets check (wallet API keysets) and when that check ran. */
  keysets?: readonly WalletKeyset[]
  keysetsCheckedAt?: string | null
  /** Time of the newest confirmed change in the mint's public data (wallet API changes[0].observedAt); the tag is left out when null. */
  lastChangeAt?: string | null
  /** Current time, ms. */
  now: number
}

const SOFTWARE_RE = /^[A-Za-z0-9._+/ -]{1,64}$/

/** mint_software: the only mint-controlled text allowed into an event. Trimmed, then it must match the pattern or it
 *  is left out (a control character, RTL override, zero-width character, newline, ":" or markdown never matches). */
export function sanitizeSoftware(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return SOFTWARE_RE.test(t) ? t : null
}

const IPV4_HOST_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/

/** The `d` tag: the repository's normalizeUrl with the fragment dropped (NIP-73: URL, normalized, no fragment).
 *  null for a URL that is not https, has an onion or IP-literal host (no onion addresses or IPs in events). */
export function healthIdentifier(rawUrl: string): string | null {
  const normalized = normalizeUrl(rawUrl)
  let parsed: URL
  try { parsed = new URL(normalized) } catch { return null }
  if (parsed.protocol !== 'https:') return null
  const host = parsed.hostname.toLowerCase()
  if (host === '' || host.endsWith('.onion') || host.startsWith('[') || IPV4_HOST_RE.test(host)) return null
  // Always re-serialise without the fragment (also a bare "#"), then normalise again for the root-slash rule.
  parsed.hash = ''
  return normalizeUrl(parsed.toString())
}

function pct(v: number | null): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return String(Math.min(100, Math.max(0, Math.round(v))))
}

function unixSeconds(iso: string | null): number | null {
  if (iso === null) return null
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

const nonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0


/**
 * The keyset facts of the ACTIVE keysets of the latest successful check (all counts are over active keysets, so they
 * partition them: verified + legacy + id_invalid <= active). Nothing at all for a mint that was never checked.
 * Every time tag is UNIX seconds (decimal string), also mint_keyset_final_expiry (only present when an active keyset
 * has one, the earliest); the wallet API keeps ISO 8601 for the same values.
 */
function keysetTags(keysets: readonly WalletKeyset[] | undefined, checkedAtIso: string | null | undefined): string[][] {
  const checkedAt = unixSeconds(checkedAtIso ?? null)
  if (checkedAt === null || !Array.isArray(keysets)) return []
  const active = keysets.filter(k => k.active)
  const tags: string[][] = [
    ['mint_keysets_verified', String(active.filter(k => k.idValid === true).length)],
    ['mint_keysets_legacy', String(active.filter(k => k.idVersion === 'legacy').length)],
    ['mint_keysets_id_invalid', String(active.filter(k => k.idValid === false).length)],
  ]
  const expiries = active.map(k => unixSeconds(k.finalExpiry ?? null)).filter((e): e is number => e !== null)
  if (expiries.length > 0) tags.push(['mint_keyset_final_expiry', String(Math.min(...expiries))])
  tags.push(['mint_keysets_checked_at', String(checkedAt)])
  return tags
}

/**
 * The unsigned kind 30385 event for one mint, or null when the mint gets none (no stored score, archived, or a URL
 * that may not appear in an event). Tags, in this order (v1 names are fixed): d, k, rank, mint_status,
 * mint_uptime_24h, mint_uptime_7d, mint_software, mint_outdated, mint_audit_swaps_7d, mint_audit_attributed_7d,
 * mint_audit_at, mint_test, mint_new_capped, mint_checked_at, mint_probes_24h, mint_down_since, mint_keysets_verified,
 * mint_keysets_legacy, mint_keysets_id_invalid, mint_keyset_final_expiry, mint_keysets_checked_at, mint_last_change, methodology,
 * methodology_url, expiration (the seven tags between mint_checked_at and methodology were added 2026-10-20; mint_last_change, present only when
 * the mint has a confirmed change in its public data, on 2026-10-20).
 * A tag whose value is unknown (no uptime yet, version rule cannot decide, no probe time) is omitted, never guessed.
 */
export function buildHealthEvent(input: HealthInput): EventTemplate | null {
  if (input.status === 'archived') return null
  if (typeof input.score !== 'number' || !Number.isFinite(input.score)) return null
  const d = healthIdentifier(input.url)
  if (d === null) return null

  const createdAt = Math.floor(input.now / 1000)
  const rank = Math.min(100, Math.max(0, Math.round(input.score)))
  const tags: string[][] = [['d', d], ['k', 'web'], ['rank', String(rank)], ['mint_status', input.status]]

  const u24 = pct(input.uptime24hPct)
  if (u24 !== null) tags.push(['mint_uptime_24h', u24])
  const u7 = pct(input.uptime7dPct)
  if (u7 !== null) tags.push(['mint_uptime_7d', u7])
  const software = sanitizeSoftware(input.software)
  if (software !== null) tags.push(['mint_software', software])
  if (input.outdated !== null) tags.push(['mint_outdated', input.outdated ? '1' : '0'])

  const a = input.audit
  if (a && nonNegInt(a.swaps7d) && nonNegInt(a.attributedFailures)) {
    const at = unixSeconds(a.fetchedAt)
    // A little tolerance for clock skew; an audit timestamp clearly in the future is not trusted.
    if (at !== null) {
      const ageMs = input.now - at * 1000
      if (ageMs >= -60_000 && ageMs <= ATTESTATION_AUDIT_MAX_AGE_MS) {
        tags.push(['mint_audit_swaps_7d', String(a.swaps7d)], ['mint_audit_attributed_7d', String(a.attributedFailures)], ['mint_audit_at', String(at)])
      }
    }
  }

  tags.push(['mint_test', input.isTest ? '1' : '0'], ['mint_new_capped', input.scoreCappedNew ? '1' : '0'])
  const checked = unixSeconds(input.lastCheckedAt)
  if (checked !== null) tags.push(['mint_checked_at', String(checked)])
  if (nonNegInt(input.probes24h)) tags.push(['mint_probes_24h', String(input.probes24h)])
  const downSince = input.status === 'online' ? null : unixSeconds(input.downSince ?? null)
  if (downSince !== null) tags.push(['mint_down_since', String(downSince)])
  tags.push(...keysetTags(input.keysets, input.keysetsCheckedAt))
  // Informational only: it never takes part in the publish decision (publishReason), it just appears in the next event.
  const lastChange = unixSeconds(input.lastChangeAt ?? null)
  if (lastChange !== null) tags.push(['mint_last_change', String(lastChange)])
  tags.push(
    ['methodology', String(METHODOLOGY_VERSION)],
    ['methodology_url', METHODOLOGY_URL],
    ['expiration', String(createdAt + ATTESTATION_EXPIRY_S)],
  )
  return { kind: HEALTH_KIND, created_at: createdAt, tags, content: HEALTH_CONTENT }
}

/** The kind 0 profile of the attestation key (the site logo as picture, no banner). */
export function buildProfileTemplate(nowMs: number): EventTemplate {
  return { kind: 0, created_at: Math.floor(nowMs / 1000), tags: [], content: JSON.stringify(ATTESTATION_PROFILE) }
}

// ── Publish decision ─────────────────────────────────────────────────────────

/** What was last published for a mint (the attestation_state row). */
export interface PublishedState {
  lastCreatedAt: number // UNIX seconds
  lastRank: number
  lastStatus: string
  lastMethodology: number
}

export interface PublishCandidate {
  rank: number
  status: string
  methodology: number
}

/**
 * Decision (4): a never-published mint publishes immediately. Otherwise at most one event per
 * ATTESTATION_MIN_INTERVAL_MS, and then only if the rank moved by ATTESTATION_MIN_RANK_DELTA or more, the status
 * changed, the methodology version changed, or the last event is ATTESTATION_REFRESH_MS old (so the 48 hour
 * expiration never lapses).
 */
export function shouldPublish(prev: PublishedState | null | undefined, next: PublishCandidate, nowMs: number): boolean {
  if (!prev) return true
  const ageMs = nowMs - prev.lastCreatedAt * 1000
  if (ageMs < ATTESTATION_MIN_INTERVAL_MS) return false
  if (ageMs >= ATTESTATION_REFRESH_MS) return true
  if (Math.abs(next.rank - prev.lastRank) >= ATTESTATION_MIN_RANK_DELTA) return true
  if (next.status !== prev.lastStatus) return true
  return next.methodology !== prev.lastMethodology
}

export type PublishReason = 'first' | 'periodic' | 'state-change'

/**
 * Why a mint publishes now, or null. 'first': never published. 'periodic': shouldPublish() (6 hour minimum, rank delta,
 * methodology, 24 hour refresh), unchanged. 'state-change': the mint_status value differs from the last event and the
 * previous event is at least ATTESTATION_STATE_CHANGE_MIN_GAP_MS old; this is the only reason that skips the 6 hour
 * minimum, and the only one the hourly cap (ATTESTATION_STATE_CHANGE_MAX_PER_HOUR) applies to.
 */
export function publishReason(prev: PublishedState | null | undefined, next: PublishCandidate, nowMs: number): PublishReason | null {
  if (!prev) return 'first'
  if (shouldPublish(prev, next, nowMs)) return 'periodic'
  const ageMs = nowMs - prev.lastCreatedAt * 1000
  if (next.status !== prev.lastStatus && ageMs >= ATTESTATION_STATE_CHANGE_MIN_GAP_MS) return 'state-change'
  return null
}

// ── Key handling ─────────────────────────────────────────────────────────────

export interface KeyLog {
  info: (line: string) => void
  error: (line: string) => void
}

const defaultKeyLog: KeyLog = {
  info: line => console.log(line),
  error: line => console.error(line),
}

/**
 * Reads the attestation key ONCE. Missing or empty: disabled, one info line. Present but not an nsec, or its public
 * key differs from the expected one: disabled, one error line. No line ever contains key material, and the decode
 * error is dropped (it could echo the input).
 */
export function resolveAttestationKey(
  raw: string | undefined,
  expectedPubkeyHex: string = ATTESTATION_PUBKEY_HEX,
  log: KeyLog = defaultKeyLog,
): Uint8Array | null {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '') {
    log.info('[attestations] disabled: no signing key is configured')
    return null
  }
  let secret: Uint8Array
  try {
    const decoded = nip19.decode(value)
    if (decoded.type !== 'nsec') throw new Error('not an nsec')
    secret = decoded.data
  } catch {
    log.error('[attestations] disabled: the configured signing key is not a valid nsec')
    return null
  }
  let pubkey = ''
  try { pubkey = getPublicKey(secret) } catch { /* fall through to the mismatch branch */ }
  if (pubkey !== expectedPubkeyHex) {
    secret.fill(0)
    log.error('[attestations] disabled: the configured signing key does not match the attestation public key')
    return null
  }
  return secret
}
