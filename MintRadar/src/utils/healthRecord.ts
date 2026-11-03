// The "Signed health record" row on Mint Detail: where the mint's kind 30385 health event lives on Nostr.
// Pure: no relay connection, nothing fetched. The `d` tag is the backend's healthIdentifier() (the normalised
// URL without a fragment); src/__tests__/healthRecord.test.ts pins this copy against the backend function.
// The nip19 entry alone (bech32 only): this module is reachable from the initial bundle, the full nostr-tools is not.
import * as nip19 from 'nostr-tools/nip19'
import { ATTESTATION_PUBKEY_HEX, ATTESTATION_RELAYS_PUBLIC } from './healthAssertionConstants'
import { normalizeMintUrl, formatTimeAgo } from './mintFormatting'
import { formatDateTimeUtc } from './formatDate'
import { njumpNaddrUrl } from './nostrLinks'

/** NIP-85 "NIP-73 identifier as subject" (addressable), same value as HEALTH_KIND in backend/src/healthAssertions.ts. */
export const HEALTH_KIND = 30385

const IPV4_HOST_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/

/** The event's `d` tag for a mint URL; null for a URL that gets no event (not https, onion or IP-literal host). */
export function healthIdentifier(rawUrl: string): string | null {
  const normalized = normalizeMintUrl(rawUrl)
  let parsed: URL
  try { parsed = new URL(normalized) } catch { return null }
  if (parsed.protocol !== 'https:') return null
  const host = parsed.hostname.toLowerCase()
  if (host === '' || host.endsWith('.onion') || host.startsWith('[') || IPV4_HOST_RE.test(host)) return null
  parsed.hash = ''
  return normalizeMintUrl(parsed.toString())
}

/** The MintRadar relay the record is read from (the first of the public relays; the naddr and the nak command carry all of them). */
export const HEALTH_RELAY_URL: string = ATTESTATION_RELAYS_PUBLIC[0]

export interface HealthRecord {
  naddr: string
  /** njump.me page for humans; null when it cannot be built (then no link is shown). */
  njumpUrl: string | null
  nakCommand: string
}

/** The coordinate and a ready `nak req` for the mint's current event, or null when the mint has none. */
export function healthRecordFor(rawUrl: string): HealthRecord | null {
  const d = healthIdentifier(rawUrl)
  if (d === null) return null
  const relays = [...ATTESTATION_RELAYS_PUBLIC]
  const naddr = nip19.naddrEncode({ kind: HEALTH_KIND, pubkey: ATTESTATION_PUBKEY_HEX, identifier: d, relays })
  const quoted = `'${d.replace(/'/g, `'\\''`)}'`
  const nakCommand = `nak req -k ${HEALTH_KIND} -a ${ATTESTATION_PUBKEY_HEX} -d ${quoted} ${relays.join(' ')}`
  return { naddr, njumpUrl: njumpNaddrUrl(naddr), nakCommand }
}

/**
 * The muted line of the Signed health record row: "Last published 2h ago", the absolute UTC time as the title. It says only
 * when the event was last published (the record is republished about once a day for a stable mint and sooner when its status or
 * rank changes), nothing about the mint's health. null (nothing is shown) for a missing, null or unreadable time. A time a little
 * in the future (clock difference) reads as "0s ago", never as a negative age.
 */
export function healthPublishedLine(iso: string | null | undefined, now: number = Date.now()): { text: string; title: string } | null {
  if (typeof iso !== 'string' || iso === '') return null
  const t = new Date(iso)
  if (!Number.isFinite(t.getTime())) return null
  return { text: `Last published ${formatTimeAgo(new Date(Math.min(t.getTime(), now)), now)}`, title: formatDateTimeUtc(t) }
}
