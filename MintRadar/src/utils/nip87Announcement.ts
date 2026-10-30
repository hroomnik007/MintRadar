// The ONE reading of a mint's stored NIP-87 announcement (kind:38172), for the Mint Detail header and the wallet API
// `nip87` field. Input is only what discovery.ts already stored (mints.nostr_announced_at = the event's created_at,
// mints.nostr_announce_d = its `d` tag) and the mint's own /v1/info pubkey (mints.pubkey); nothing is fetched.
//
// NIP-87: the `d` tag SHOULD be the mint's pubkey (from /v1/info); the event author is whoever published it, so it says
// nothing about the mint. The key match is therefore decided only when the `d` tag has the shape of a mint pubkey
// (33-byte compressed secp256k1, 66 hex characters, 02/03 prefix) and the mint's pubkey is known; otherwise it is null
// (not comparable), never false. "not_seen" means not seen on our relays, not that no announcement exists.
// The backend copy (backend/src/shared/nip87Announcement.ts) has the same code; src/__tests__/sharedModules.test.ts pins both.

export type Nip87Seen = 'seen' | 'not_seen'

export interface Nip87AnnouncementFacts {
  announcement: Nip87Seen
  /** true / false only when the `d` tag is pubkey-shaped and the /v1/info pubkey is known; null otherwise. */
  dMatchesInfoPubkey: boolean | null
  /** The announcement event's created_at (ISO 8601); null when not seen. */
  eventCreatedAt: string | null
  /** When the last discovery run that reached our relays ran (ISO 8601); the key is ABSENT until there was one. */
  checkedAt?: string
}

export interface Nip87AnnouncementInput {
  announcedAt?: string | Date | null | undefined
  announceD?: string | null | undefined
  infoPubkey?: string | null | undefined
  /** app_state discovery_last_success_at as stored by discovery.ts. */
  checkedAt?: string | Date | null | undefined
}

const MINT_PUBKEY_RE = /^0[23][0-9a-f]{64}$/

/** The `d` value trimmed and lower-cased when it is shaped like a mint pubkey, else null. */
export function pubkeyShaped(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  return MINT_PUBKEY_RE.test(s) ? s : null
}

function isoOf(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

export function nip87AnnouncementOf(m: Nip87AnnouncementInput): Nip87AnnouncementFacts {
  const eventCreatedAt = isoOf(m.announcedAt)
  const checkedAt = isoOf(m.checkedAt)
  const checked = checkedAt === null ? {} : { checkedAt }
  if (eventCreatedAt === null) return { announcement: 'not_seen', dMatchesInfoPubkey: null, eventCreatedAt: null, ...checked }
  const d = pubkeyShaped(m.announceD)
  const info = pubkeyShaped(m.infoPubkey)
  return { announcement: 'seen', dMatchesInfoPubkey: d !== null && info !== null ? d === info : null, eventCreatedAt, ...checked }
}
