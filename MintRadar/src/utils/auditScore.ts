// Audit reliability score (the 25%-weight "audit" component of Reliability Score).
//
// SOURCE OF TRUTH is backend/src/shared/auditScore.ts — this frontend package can't import
// it directly (separate npm package, no workspace set up between backend/ and the frontend),
// so this is a manually-synced copy. Do not change the logic here without also updating the
// backend copy (and vice versa): src/__tests__/sharedModules.test.ts compares both on one table.
// Both feed the server-side Reliability Score (prober.ts) and this app's client-side
// Reliability Score Breakdown (MintDetail.tsx, ComparisonModal.tsx).
//
// Input: cashu.info's attributed failures (`errorsBlamed`) over all swaps of the 7-day window,
// stored on mints.audit_cz_* by the backend detail cron. audit.8333.space is not used here.

/** Fewer swaps than this in the 7-day window = not enough data, neutral. */
export const AUDIT_MIN_SAMPLES = 10
/** A stored detail older than this (hours since its fetched_at) is not scored, neutral. */
export const AUDIT_MAX_AGE_HOURS = 168
/** The value for "no usable audit data": the middle of the 0-25 range. */
export const AUDIT_NEUTRAL = 12.5

export type AuditDataState = 'scored' | 'no-data' | 'too-few' | 'too-old'

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
): AuditDataState {
  if (typeof total !== 'number' || typeof blamed !== 'number') return 'no-data'
  if (!Number.isFinite(total) || !Number.isFinite(blamed) || total < 0 || blamed < 0) return 'no-data'
  const age = auditAgeHours(fetchedAt, now)
  if (age === null) return 'no-data'
  if (age > AUDIT_MAX_AGE_HOURS) return 'too-old'
  if (total < AUDIT_MIN_SAMPLES) return 'too-few'
  return 'scored'
}

/** The 0-25 audit component. blamed greater than total is clamped to total. */
export function auditComponent(
  blamed: number | null | undefined,
  total: number | null | undefined,
  fetchedAt: string | Date | null | undefined,
  now: number = Date.now(),
): number {
  if (auditDataState(blamed, total, fetchedAt, now) !== 'scored') return AUDIT_NEUTRAL
  const t = total as number
  const errorRate = Math.min(blamed as number, t) / t
  if (errorRate === 0) return 25
  if (errorRate < 0.01) return 20
  if (errorRate < 0.05) return 15
  if (errorRate < 0.15) return 10
  return 5
}

// ── audit.8333.space Audit tab only (never feeds the score) ─────────────────
// The Audit tab's "too few to score" label still uses the 8333 rolling window's own floor.
export const AUDIT_TAB_MIN_SAMPLES = 3

// True when there's some 8333 audit history but not enough of it (< AUDIT_TAB_MIN_SAMPLES) to
// read reliably — distinct from "no audit data at all" (recentTotal === null).
export function isAuditUnknown(recentTotal: number | null): boolean {
  return recentTotal !== null && recentTotal < AUDIT_TAB_MIN_SAMPLES
}
