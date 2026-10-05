// Which Nostr keys belong to a mint's OPERATOR? A review written by one of them is labelled
// "Operator" and is not counted in the Community Rating or the review count.
//
// Source of truth for the backend (reviewsSync.ts aggregation). The frontend cannot import this
// file (separate npm package, no workspace), so src/utils/operatorPubkeys.ts is a manually-synced
// copy — keep the code identical; src/__tests__/sharedModules.test.ts fails when the two drift.
//
// A key counts as the operator ONLY when BOTH sources agree (2026-10-05): (a) it is listed in the
// mint's own NUT-06 contact entries with method "nostr" as an npub, nprofile or 64-character hex key
// (an optional "nostr:" prefix is accepted) AND (b) it is the author of the mint's NIP-87
// announcement (kind 38172). Either source alone proves nothing: the contact list is written by the
// mint (a hostile mint could list a critic's key to get that review labelled and left out of the
// rating), and anyone can publish a kind 38172 for any URL. Requiring both means a forger would need
// the critic's key to have signed an announcement for that mint too.
// NIP-05 contact entries (name@domain) are NOT resolved: neither side holds a verified, persisted
// resolution, and fetching one here would be a new outbound request.
import { nip19 } from 'nostr-tools'

export interface OperatorSource {
  /** NUT-06 `contact` array as published by the mint (only method "nostr" entries are read). */
  contact?: ReadonlyArray<{ method: string; info?: unknown }> | null
  /** Hex pubkey of the author of the mint's NIP-87 announcement (kind 38172), when known. Only the
   *  newest announcement's author is stored (mints.nostr_announce_pubkey). */
  announcePubkey?: string | null
}

const HEX64 = /^[0-9a-f]{64}$/i
// Bounded work AND bounded blast radius: the contact list is written by the mint itself, so a hostile
// /v1/info could name any key (e.g. a critical reviewer) as a contact. At most 3 contact keys are read
// (real operators list one or two), strings are capped.
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

/** Lowercase hex pubkeys of the mint's operator keys: the contact keys (at most 3) that are also the
 *  announcement author. Empty when either source is missing or they disagree. */
export function operatorPubkeys(source: OperatorSource): Set<string> {
  const out = new Set<string>()
  const announcer = typeof source.announcePubkey === 'string' && HEX64.test(source.announcePubkey)
    ? source.announcePubkey.toLowerCase()
    : null
  if (announcer === null) return out
  const contact = Array.isArray(source.contact) ? source.contact : []
  let seen = 0
  for (const c of contact) {
    if (seen >= MAX_CONTACTS) break
    if (!c || c.method !== 'nostr' || typeof c.info !== 'string') continue
    seen++
    const hex = toHexPubkey(c.info)
    if (hex === announcer) out.add(hex)
  }
  return out
}
