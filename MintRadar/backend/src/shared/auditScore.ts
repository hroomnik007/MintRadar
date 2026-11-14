// Audit reliability score (the 25%-weight "audit" component of Reliability Score).
//
// This is the shared source of truth for both the server-side Reliability Score computation
// (prober.ts's computeServerReliabilityScore, run on every probe cycle) and the frontend's
// client-side Reliability Score Breakdown display (MintDetail.tsx, ComparisonModal.tsx) — the
// two must always agree on the same mint's audit component. The frontend cannot import this
// file directly (separate npm package, no workspace set up between backend/ and the frontend),
// so src/utils/auditScore.ts is a manually-synced copy — if you change the logic here, mirror
// the change there too (src/__tests__/sharedModules.test.ts compares both on one table).
//
// Source: the stored cashu.info per-mint detail (auditCzDetail.ts), 7-day window. The input is
// the number of swaps whose failure cashu.info attributes to the mint itself (`errorsBlamed`)
// over all swaps of the window (`swaps7d.all.total`), copied onto mints.audit_cz_blamed /
// audit_cz_total / audit_cz_fetched_at by the detail cron. audit.8333.space data is NOT used here
// (it stays stored and shown on the Audit tab only).

/** Fewer swaps than this in the 7-day window = not enough data, neutral. */
export const AUDIT_MIN_SAMPLES = 10
/** A stored detail older than this (hours since its fetched_at) is not scored, neutral. */
export const AUDIT_MAX_AGE_HOURS = 168
/** The value for "no usable audit data": the middle of the 0-25 range. */
export const AUDIT_NEUTRAL = 12.5

export type AuditDataState = 'scored' | 'no-data' | 'too-few' | 'too-old'

/**
 * The long window (methodology 8): the sum of up to four 7-day totals that do not overlap, each stored at the
 * start of a UTC day 7 days apart (auditCzDetail.ts, mints.audit_cz_long_*). `days` is 7, 14, 21 or 28: how much
 * history the sum covers. With 7 days it holds nothing the 7-day window does not, and is ignored.
 */
export interface AuditLongWindow {
  blamed: number | null | undefined
  total: number | null | undefined
  days: number | null | undefined
}

/** Most days the long window covers. */
export const AUDIT_LONG_WINDOW_DAYS = 28

function usableLong(long: AuditLongWindow | null | undefined): { blamed: number; total: number } | null {
  if (!long) return null
  const { blamed, total, days } = long
  if (typeof total !== 'number' || typeof blamed !== 'number' || typeof days !== 'number') return null
  if (!Number.isFinite(total) || !Number.isFinite(blamed) || total < 0 || blamed < 0) return null
  if (days <= 7 || total < AUDIT_MIN_SAMPLES) return null
  return { blamed, total }
}

function band(blamed: number, total: number): number {
  const errorRate = Math.min(blamed, total) / total
  if (errorRate === 0) return 25
  if (errorRate < 0.01) return 20
  if (errorRate < 0.05) return 15
  if (errorRate < 0.15) return 10
  return 5
}

function toMs(fetchedAt: string | Date | null | undefined): number | null {
  if (fetchedAt === null || fetchedAt === undefined) return null
  const t = fetchedAt instanceof Date ? fetchedAt.getTime() : new Date(fetchedAt).getTime()
  return Number.isFinite(t) ? t : null
}

/** Age of the stored detail in hours; 0 for a timestamp in the future; null when missing/unparseable. */
export function auditAgeHours(fetchedAt: string | Date | null | undefined, now: number = Date.now()): number | null {
  const t = toMs(fetchedAt)
  return t === null ? null : Math.max(0, (now - t) / 3_600_000)
}

/** Why the audit component is (or is not) scored. 'no-data' covers null/non-finite/negative inputs and a missing timestamp. */
export function auditDataState(
  blamed: number | null | undefined,
  total: number | null | undefined,
  fetchedAt: string | Date | null | undefined,
  now: number = Date.now(),
  long?: AuditLongWindow | null,
): AuditDataState {
  if (typeof total !== 'number' || typeof blamed !== 'number') return 'no-data'
  if (!Number.isFinite(total) || !Number.isFinite(blamed) || total < 0 || blamed < 0) return 'no-data'
  const age = auditAgeHours(fetchedAt, now)
  if (age === null) return 'no-data'
  if (age > AUDIT_MAX_AGE_HOURS) return 'too-old'
  // Too few swaps in 7 days is still scored when the long window holds enough of them.
  if (total < AUDIT_MIN_SAMPLES && !usableLong(long)) return 'too-few'
  return 'scored'
}

/**
 * The 0-25 audit component: the WORSE of the 7-day band and the long-window band (methodology 8), so a fresh
 * failure counts at once and an old one keeps counting for up to 28 days. A window with fewer than
 * AUDIT_MIN_SAMPLES swaps has no band; with no band at all the part is neutral. blamed greater than total is
 * clamped to total.
 */
export function auditComponent(
  blamed: number | null | undefined,
  total: number | null | undefined,
  fetchedAt: string | Date | null | undefined,
  now: number = Date.now(),
  long?: AuditLongWindow | null,
): number {
  if (auditDataState(blamed, total, fetchedAt, now, long) !== 'scored') return AUDIT_NEUTRAL
  const l = usableLong(long)
  const shortBand = (total as number) >= AUDIT_MIN_SAMPLES ? band(blamed as number, total as number) : null
  const longBand = l ? band(l.blamed, l.total) : null
  if (shortBand === null) return longBand as number
  return longBand === null ? shortBand : Math.min(shortBand, longBand)
}
