// The final expiry a mint states for a keyset (NUT-02 `final_expiry`, UNIX seconds; the website's stored copy in
// /api/mints/known `lastKeysets[].finalExpiry` is ISO 8601). Shown on Mint Detail only when the mint sets it: a short
// "Expires 12 Mar 2027" line, highlighted when it is less than 30 days away or already past ("Expired ...").
import { formatDate, formatDateTimeUtc } from './formatDate'
import { formatLocalDateTime } from './changeDates'

/** Highlight an expiry closer than this. */
export const KEYSET_EXPIRY_SOON_DAYS = 30
/** Same bound as the backend (keysetsSync.ts MAX_STORED_EXPIRY_S, year 3000): anything above is treated as no expiry. */
export const MAX_KEYSET_EXPIRY_S = 32_503_680_000
const DAY_MS = 86_400_000

/** UNIX seconds (positive safe integer) or an ISO string -> epoch ms; anything else, 0 or above year 3000 -> null. */
export function keysetExpiryMs(raw: unknown): number | null {
  let s: number | null = null
  if (typeof raw === 'number') s = Number.isSafeInteger(raw) && raw > 0 ? raw : null
  else if (typeof raw === 'string' && raw !== '') {
    const ms = Date.parse(raw)
    s = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : null
  }
  if (s === null || s > MAX_KEYSET_EXPIRY_S) return null
  return s * 1000
}

export interface KeysetExpiry {
  /** "Expires 12 Mar 2027" or "Expired 12 Mar 2027" (viewer's date). */
  text: string
  /** Full time, local and UTC. */
  title: string
  /** Less than KEYSET_EXPIRY_SOON_DAYS away, or already past. */
  soon: boolean
  expired: boolean
}

/** The expiry line of a keyset row, or null when the mint states no (usable) expiry. */
export function keysetExpiry(raw: unknown, now: number = Date.now()): KeysetExpiry | null {
  const ms = keysetExpiryMs(raw)
  if (ms === null) return null
  const iso = new Date(ms).toISOString()
  const expired = ms <= now
  return {
    text: `${expired ? 'Expired' : 'Expires'} ${formatDate(ms, { local: true })}`,
    title: `${formatLocalDateTime(iso)} (your time) · ${formatDateTimeUtc(iso)}`,
    soon: expired || ms - now < KEYSET_EXPIRY_SOON_DAYS * DAY_MS,
    expired,
  }
}
