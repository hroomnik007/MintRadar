// Which Nostr keys belong to a mint's OPERATOR? A review written by one of them is labelled
// "Operator" and is not counted in the Community Rating or the review count.
//
// Manually-synced copy of backend/src/shared/operatorPubkeys.ts (no workspace between the two npm
// packages) — keep the code identical; src/__tests__/sharedModules.test.ts fails when the two drift.
// Used on Mint Detail with the live probe's contact list and the announcement author.
//
// Sources: (a) the mint's own NUT-06 contact entries with method "nostr" that are an npub,
// nprofile or 64-character hex key (an optional "nostr:" prefix is accepted), (b) the author of the
// mint's NIP-87 announcement. NIP-05 contact entries (name@domain) are NOT resolved: neither side
// holds a verified, persisted resolution, and fetching one here would be a new outbound request.
import { nip19 } from 'nostr-tools'

export interface OperatorSource {
  /** NUT-06 `contact` array as published by the mint (only method "nostr" entries are read). */
  contact?: ReadonlyArray<{ method: string; info?: unknown }> | null
  /** Hex pubkey of the NIP-87 announcement author, when known. */
  announcePubkey?: string | null
}

const HEX64 = /^[0-9a-f]{64}$/i
// Bounded work AND bounded blast radius: the contact list is written by the mint itself, so a hostile
// /v1/info could name any key (e.g. a critical reviewer) as "operator" to get its review left out of
// the rating. At most 3 contact keys are read (real operators list one or two), strings are capped.
const MAX_CONTACTS = 3
const MAX_INFO_CHARS = 300

function toHexPubkey(raw: string): string | null {
  const s = raw.trim().replace(/^nostr:/i, '')
  if (s.length === 0 || s.length > MAX_INFO_CHARS) return null
  if (HEX64.test(s)) return s.toLowerCase()
  try {
    const d = nip19.decode(s)
    if (d.type === 'npub') return d.data.toLowerCase()
    if (d.type === 'nprofile') return d.data.pubkey.toLowerCase()
  } catch {
    // not a valid bech32 key (NIP-05 name@domain, free text, ...) -> not an operator key
  }
  return null
}

/** Lowercase hex pubkeys of the mint's operator keys; empty when nothing usable is listed. */
export function operatorPubkeys(source: OperatorSource): Set<string> {
  const out = new Set<string>()
  const contact = Array.isArray(source.contact) ? source.contact : []
  let seen = 0
  for (const c of contact) {
    if (seen >= MAX_CONTACTS) break
    if (!c || c.method !== 'nostr' || typeof c.info !== 'string') continue
    seen++
    const hex = toHexPubkey(c.info)
    if (hex) out.add(hex)
  }
  if (typeof source.announcePubkey === 'string' && HEX64.test(source.announcePubkey)) {
    out.add(source.announcePubkey.toLowerCase())
  }
  return out
}
