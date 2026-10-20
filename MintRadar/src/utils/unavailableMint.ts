// Mint Detail's honest page for a mint that is not online: since when, the last error (sanitised and capped), and
// what the visitor can do. No verdict words: this describes measurements, it does not judge the mint.
import { formatDate } from './formatDate'

export const LAST_SCORE_CAPTION = 'Last measured score. Measurements from this mint are not current.'
/** Offline for less than this long: "Not responding", not "Unavailable". */
export const NOT_RESPONDING_MAX_HOURS = 24
export const LAST_ERROR_MAX_CHARS = 120

export interface UnavailableHeadline {
  /** "Unavailable since 12 Sep 2026 (8 days)" or "Not responding since 20 Oct 2026". */
  text: string
  /** True for the short, still-recoverable-looking case (under 24 h). */
  notResponding: boolean
}

/** `since` = downSince, else lastOnlineAt. Without either the mint was never seen online. */
export function unavailableHeadline(i: { since: string | null | undefined; archived: boolean; now: number }): UnavailableHeadline {
  const t = i.since ? new Date(i.since).getTime() : NaN
  if (!Number.isFinite(t)) return { text: 'Unavailable. MintRadar has not seen this mint online.', notResponding: false }
  const hours = Math.max(0, (i.now - t) / 3_600_000)
  const date = formatDate(t)
  if (!i.archived && hours < NOT_RESPONDING_MAX_HOURS) return { text: `Not responding since ${date}`, notResponding: true }
  const days = Math.floor(hours / 24)
  return { text: `Unavailable since ${date} (${days} ${days === 1 ? 'day' : 'days'})`, notResponding: false }
}

/** The stored probe error as one short plain line: no URLs, no control characters, capped. null when nothing is left. */
export function sanitizeLastError(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
  s = s.replace(/\b(?:https?|wss?|ftp):\/\/\S*/gi, '').replace(/\s+/g, ' ').trim()
  if (s === '') return null
  return s.length > LAST_ERROR_MAX_CHARS ? `${s.slice(0, LAST_ERROR_MAX_CHARS - 1)}…` : s
}

export function restoreSentence(supportsNut09: boolean): string {
  return supportsNut09
    ? 'This mint listed NUT-09 at its last check, so a wallet can restore ecash from your seed phrase.'
    : 'This mint did not list NUT-09 at its last check, so a wallet may not be able to restore ecash from a seed phrase here.'
}

export const KEEP_WALLET_SENTENCE = 'Keep your wallet and your seed phrase.'
export const TEMPORARY_SENTENCE = 'An outage can be temporary; once the mint is back, check your tokens in your wallet.'
export function contactSentence(contacts: readonly string[]): string {
  return contacts.length > 0 ? `You can contact the operator: ${contacts.join(', ')}.` : 'You can contact the operator; this mint lists no contact.'
}
