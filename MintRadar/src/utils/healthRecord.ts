// The "Signed health record" row on Mint Detail: where the mint's kind 30385 health event lives on Nostr.
// Pure: no relay connection, nothing fetched. The `d` tag is the backend's healthIdentifier() (the normalised
// URL without a fragment); src/__tests__/healthRecord.test.ts pins this copy against the backend function.
import { nip19 } from 'nostr-tools'
import { ATTESTATION_PUBKEY_HEX, ATTESTATION_RELAYS_PUBLIC } from './healthAssertionConstants'
import { normalizeMintUrl } from './mintFormatting'

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

export interface HealthRecord {
  naddr: string
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
  return { naddr, nakCommand }
}
