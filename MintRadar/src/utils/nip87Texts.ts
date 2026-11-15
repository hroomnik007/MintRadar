// Mint Detail "Mint info" row: the NIP-87 announcement line, built from the stored facts (utils/nip87Announcement.ts). A
// stored announcement is never re-checked, so the found text only gives the event date ("event dated …"), never "seen on
// our relays" or "checked"; the not-found text is "not seen on our relays" (no "checked {time}" since 2026-11-15). Never
// "does not exist" or "verified"; the key-match sentence only when it is comparable.
import { formatDate } from '@/utils/formatDate'
import type { Nip87AnnouncementFacts } from '@/utils/nip87Announcement'

export const NIP87_ANNOUNCEMENT_LABEL = 'NIP-87 announcement (kind:38172)'
export const NIP87_NOT_SEEN_TEXT = 'No NIP-87 announcement seen on our relays'
export const NIP87_KEY_MATCH_TEXT = "Announcement key matches the mint's /v1/info pubkey"
export const NIP87_KEY_DIFFERS_TEXT = "Announcement key differs from the mint's /v1/info pubkey"

/** The text after the linked label for a stored announcement: " · event dated 14 Mar 2026" ('' without a date). */
export function nip87StoredSuffix(eventCreatedAt: string | null): string {
  const date = formatDate(eventCreatedAt)
  return date ? ` · event dated ${date}` : ''
}

/** The key-match sentence, or null when the `d` tag is missing, not pubkey-shaped or the /v1/info pubkey is unknown. */
export function nip87KeyText(f: Pick<Nip87AnnouncementFacts, 'dMatchesInfoPubkey'>): string | null {
  if (f.dMatchesInfoPubkey === null) return null
  return f.dMatchesInfoPubkey ? NIP87_KEY_MATCH_TEXT : NIP87_KEY_DIFFERS_TEXT
}
