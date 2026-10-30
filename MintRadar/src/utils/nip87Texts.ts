// Mint Detail header: the NIP-87 announcement line, built from the stored facts (utils/nip87Announcement.ts). Wording
// rules: "seen on our relays" / "not seen on our relays", never "does not exist" or "verified"; the key-match sentence
// only when it is comparable. "checked" is the time of the last discovery run that reached our relays (app_state discovery_last_success_at); without one it is left out.
import { formatDate, formatDateTimeUtc } from '@/utils/formatDate'
import { formatTimeAgo } from '@/utils/mintFormatting'
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

/** " · checked 5 min ago" (exact UTC time as `title`, like the other "checked" labels); null when no discovery run has reached the relays yet. */
export function nip87CheckedLabel(checkedAt: string | null | undefined, now: number): { text: string; label: string; title: string } | null {
  const t = checkedAt ? new Date(checkedAt) : null
  if (!t || !Number.isFinite(t.getTime())) return null
  return { text: ' · checked ', label: formatTimeAgo(t, now), title: formatDateTimeUtc(t) }
}

/** The key-match sentence, or null when the `d` tag is missing, not pubkey-shaped or the /v1/info pubkey is unknown. */
export function nip87KeyText(f: Pick<Nip87AnnouncementFacts, 'dMatchesInfoPubkey'>): string | null {
  if (f.dMatchesInfoPubkey === null) return null
  return f.dMatchesInfoPubkey ? NIP87_KEY_MATCH_TEXT : NIP87_KEY_DIFFERS_TEXT
}
