// Mint Detail header: the NIP-87 announcement line, built from the stored facts (utils/nip87Announcement.ts). Wording
// rules: "seen on our relays" / "not seen on our relays", never "does not exist" or "verified"; the key-match sentence
// only when it is comparable. No check time: the time of the last discovery run is not stored (docs/claude/
// card-and-mint-detail-ui.md, "NIP-87 announcement line").
import { formatDate } from '@/utils/formatDate'
import type { Nip87AnnouncementFacts } from '@/utils/nip87Announcement'

export const NIP87_ANNOUNCEMENT_LABEL = 'NIP-87 announcement (kind:38172)'
export const NIP87_NOT_SEEN_TEXT = 'No NIP-87 announcement seen on our relays'
export const NIP87_KEY_MATCH_TEXT = "Announcement key matches the mint's /v1/info pubkey"
export const NIP87_KEY_DIFFERS_TEXT = "Announcement key differs from the mint's /v1/info pubkey"

/** The text after the linked label for a seen announcement: " · seen on our relays · 14 Mar 2026". */
export function nip87SeenSuffix(eventCreatedAt: string | null): string {
  const date = formatDate(eventCreatedAt)
  return ` · seen on our relays${date ? ` · ${date}` : ''}`
}

/** The key-match sentence, or null when the `d` tag is missing, not pubkey-shaped or the /v1/info pubkey is unknown. */
export function nip87KeyText(f: Pick<Nip87AnnouncementFacts, 'dMatchesInfoPubkey'>): string | null {
  if (f.dMatchesInfoPubkey === null) return null
  return f.dMatchesInfoPubkey ? NIP87_KEY_MATCH_TEXT : NIP87_KEY_DIFFERS_TEXT
}
