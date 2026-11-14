// Reliability Score computation (see the 5 weighted components below).
//
// SOURCE OF TRUTH is backend/src/shared/reliabilityScore.ts — this frontend package can't
// import it directly (separate npm package, no workspace set up between backend/ and
// the frontend), so this is a manually-synced copy. Do not change the logic here
// without also updating the backend copy (and vice versa).
//
// The server-side score (stored in mints.last_reliability_score, served as
// KnownMint.reliabilityScore) is AUTHORITATIVE. This copy exists for two cases only:
// (1) a fallback when a mint has no stored score yet, and (2) the per-component
// Reliability Score Breakdown on Mint Detail, which must add up to the stored total.
//
// `latestVersions` (family -> latest) is the value the API sends with each mint (`softwareLatest`);
// pass it so the breakdown uses the same "latest" as the stored score. There is no static fallback.
import { auditComponent, type AuditLongWindow } from './auditScore'
import { classifyMintVersion, type LatestVersions } from './versionRule'

/**
 * Number of NUTs the app tracks, i.e. the denominator of the NUT-support
 * component. Must stay equal to the length of the frontend's TRACKED_NUTS
 * list (src/constants/nuts.ts) — a test asserts this.
 */
export const TRACKED_NUT_COUNT = 14

// ── Software versions ────────────────────────────────────────────────────────
// The version rule (labels AND points) lives in ONE shared module, versionRule.ts; the score only
// takes its points. `latestVersions` is the family -> latest map the API sends (never a static list).
export {
  splitVersionString, normalizeVersionNumber, parseMajorMinorPatch, compareMintVersionNumbers,
  canonicalSoftwareName, classifyVersion, classifyMintVersion,
} from './versionRule'

// ── Individual components ────────────────────────────────────────────────────
// Exported separately so the Reliability Score Breakdown UI shows exactly the numbers
// that went into the total, rather than re-deriving them.

// ── Uptime component (40 points) ─────────────────────────────────────────────
// Methodology 7: the 40 points are four parts. The last 24 hours say how the mint runs now; the last 30 days say
// how it ran: the share of successful probes (total downtime), the longest single outage (how long funds were out
// of reach) and the number of outages (how often a payment would have failed). An outage is two or more failed
// probes in a row (backend/src/outages.ts, the same blocks the History tab lists).

export const UPTIME_24H_MAX = 20
export const UPTIME_30D_MAX = 10
/** 30-day uptime at or below this scores 0 of UPTIME_30D_MAX; each whole percent above it scores one point. */
export const UPTIME_30D_FLOOR_PCT = 90
/** Longest outage in 30 days, [shorter than this many hours, points]; at or above the last limit: 0. */
export const LONGEST_OUTAGE_BANDS: ReadonlyArray<readonly [number, number]> = [[1, 6], [6, 4], [24, 2]]
export const LONGEST_OUTAGE_MAX = 6
/** Outages in 30 days, [at most this many, points]; more than the last limit: 0. */
export const OUTAGE_COUNT_BANDS: ReadonlyArray<readonly [number, number]> = [[2, 4], [5, 3], [10, 2], [20, 1]]
export const OUTAGE_COUNT_MAX = 4

/** The inputs of the uptime component; the 30-day figures cover the stored history of at most 30 days. */
export interface UptimeInput {
  /** Share of successful probes in the last 24 hours, whole percent. */
  pct24h: number
  /** Share of successful probes in the last 30 days, whole percent. */
  pct30d: number
  /**
   * The same share unrounded (two decimals, rounded down), the figure the recommendation gate (hasSteadyUptime)
   * compares, so 94.5 % does not pass as 95 %. Absent: pct30d stands in.
   */
  pct30dExact?: number
  /** Outages (two or more failed probes in a row) in the last 30 days. */
  outageCount30d: number
  /** Duration of the longest of them in milliseconds, an ongoing one measured up to now. */
  longestOutageMs30d: number
  /** True while the mint is in an outage: the outage-count part then scores 0. */
  ongoingOutage: boolean
}

export interface UptimeParts { last24h: number; last30d: number; longestOutage: number; outageCount: number }

export function longestOutagePoints(longestOutageMs: number): number {
  const hours = longestOutageMs / 3_600_000
  for (const [limit, points] of LONGEST_OUTAGE_BANDS) if (hours < limit) return points
  return 0
}

export function outageCountPoints(outageCount: number, ongoingOutage: boolean): number {
  if (ongoingOutage) return 0
  for (const [limit, points] of OUTAGE_COUNT_BANDS) if (outageCount <= limit) return points
  return 0
}

export function uptimeParts(u: UptimeInput): UptimeParts {
  return {
    last24h: Math.round(u.pct24h * (UPTIME_24H_MAX / 100)),
    last30d: Math.min(UPTIME_30D_MAX, Math.max(0, Math.round(u.pct30d) - UPTIME_30D_FLOOR_PCT)),
    longestOutage: longestOutagePoints(u.longestOutageMs30d),
    outageCount: outageCountPoints(u.outageCount30d, u.ongoingOutage),
  }
}

/**
 * Uptime — 40 points. With the 30-day inputs: the sum of the four parts above. With a plain number (only the
 * 24-hour percentage is known: a chart bucket of the past, a mint the API has no 30-day figures for yet) that
 * percentage stands in for all 40 points.
 */
export function uptimeComponent(uptime: number | UptimeInput): number {
  if (typeof uptime === 'number') return Math.round(uptime * 0.40)
  const p = uptimeParts(uptime)
  return p.last24h + p.last30d + p.longestOutage + p.outageCount
}

/** NUT support — 15 points, capped at TRACKED_NUT_COUNT NUTs. */
export function nutComponent(nutCount: number | null | undefined): number {
  return Math.round(Math.min((nutCount ?? 0) / TRACKED_NUT_COUNT, 1) * 15)
}

/**
 * Software version freshness — 15 points: 0 or 1 minor versions behind the family's latest stable
 * release = 15, 2 behind = 9, 3 = 6, 4 = 3, 5 or more = 0 (see versionRule.ts).
 */
export function versionComponent(
  version: string | null | undefined,
  latestVersions?: LatestVersions
): number {
  return classifyMintVersion(version, latestVersions).points
}

/**
 * Published contact methods (email / twitter / nostr) — 5 points, capped.
 *
 * `contactCount` is clamped to 3 (the number of recognised channels) BEFORE the
 * ratio, so 3-or-more contacts award the full 5 points and never more. This cap
 * is an explicit anti-abuse control, not cosmetic: `contactCount` is derived
 * from the mint's own `/v1/info` `contact` array (backend/src/prober.ts), which
 * is untrusted mint-operator input (see the audit "Trust model" — the mint
 * operator is Untrusted). Without the clamp a mint advertising e.g. 60 contact
 * entries scored 100 on this component alone, saturating its entire Reliability Score
 * regardless of uptime / NUT support / version — the self-attestation inflation
 * reported as finding H1 in the 2026-09-07 security audit. The clamp is applied
 * here, the single call site every caller shares (backend probe, backend
 * breakdown, frontend fallback, frontend breakdown), and it clamps the combined
 * count across all channel types — it cannot be bypassed per-type.
 */
export function contactComponent(contactCount: number): number {
  return Math.round((Math.min(contactCount, 3) / 3) * 5)
}

/**
 * Total Reliability Score, 0-100.
 *
 * Rounding: the components above round individually, and the total gets exactly
 * one outer Math.round before the 100 cap — `Math.min(100, Math.round(sum))`.
 * Keep this ordering; the frontend copy must produce bit-identical results for
 * the same inputs, otherwise a mint's displayed breakdown won't add up to the
 * stored score.
 */

export const NEW_MINT_MAX_DAYS = 30
export const NEW_MINT_RELIABILITY_CAP = 75

export function applyNewMintCap(score: number, discoveredAt?: string | null, now = Date.now()): number {
  if (!discoveredAt) return score
  const t = new Date(discoveredAt).getTime()
  if (!Number.isFinite(t)) return score
  const days = (now - t) / 86_400_000
  if (days >= 0 && days < NEW_MINT_MAX_DAYS) return Math.min(score, NEW_MINT_RELIABILITY_CAP)
  return score
}

// Minimum age (days) a mint must have before it's eligible to appear on a
// "recommendation" surface (Reliability Score top-5, Best Mint wizard-adjacent
// lists) — 2026-09-19 security audit run-3 MEDIUM finding. NEW_MINT_RELIABILITY_CAP
// above only discounts a new mint's SCORE (capped at 75 for its first 30
// days); on its own that still leaves room for a mint with only hours/days of
// track record to rank in a top-5 if its capped score still beats everything
// else online. This is a separate, additive gate on discovered_at alone — the
// simplest reliable proxy for "the network has actually observed this mint
// for a while" (there is no probe_count column to check instead; discovered_at
// is NOT NULL on every mints row, set at insert time). Manually synced with
// backend/src/shared/reliabilityScore.ts (same no-workspace caveat as the rest of
// this file).
export const MIN_RECOMMENDATION_AGE_DAYS = 14

export function isEligibleForRecommendation(
  discoveredAt: string | Date | null | undefined,
  now = Date.now()
): boolean {
  if (!discoveredAt) return false
  const t = new Date(discoveredAt).getTime()
  if (!Number.isFinite(t)) return false
  return now - t >= MIN_RECOMMENDATION_AGE_DAYS * 86_400_000
}

/**
 * A mint is recommended only while its NEWEST probe is at most this old (2026-10-28, audit run-4 follow-up). "Online"
 * alone means "the latest stored probe succeeded" with no age: when probes stop landing for a mint (it answers 429
 * or its host resolves to a blocked address, or our own probing stalls) that row, and the score stored with it, would
 * otherwise stay "online" and recommended for good. The probe runs every 5 minutes, so 3 hours is 36 missed cycles.
 */
export const MAX_RECOMMENDATION_PROBE_AGE_HOURS = 3

export function hasFreshProbe(
  lastCheckedAt: string | Date | null | undefined,
  now = Date.now()
): boolean {
  if (!lastCheckedAt) return false
  const t = new Date(lastCheckedAt).getTime()
  if (!Number.isFinite(t)) return false
  return now - t <= MAX_RECOMMENDATION_PROBE_AGE_HOURS * 3_600_000
}

/**
 * A mint is recommended only if at least this share of its probes in the last 30 days succeeded (methodology 7).
 * The score looks mostly at now; a recommendation is a stronger statement and asks for a month without long downtime.
 * Unknown (no 30-day figure yet) is not eligible. Pass the UNROUNDED share (uptime30dExactPct / uptimePct30dExact):
 * the whole-percent figure shown in the UI would let 94.5 % pass as 95 %.
 */
export const MIN_RECOMMENDATION_UPTIME_30D_PCT = 95

export function hasSteadyUptime(uptimePct30d: number | null | undefined): boolean {
  return typeof uptimePct30d === 'number' && Number.isFinite(uptimePct30d) && uptimePct30d >= MIN_RECOMMENDATION_UPTIME_30D_PCT
}

/** `part` of `total` in percent with two decimals, rounded DOWN (a share just under a limit never reaches it). */
export function exactPct(part: number, total: number): number {
  return Math.floor((part / total) * 10_000) / 100
}

/** The cashu.info audit inputs stored on mints.audit_cz_* (see shared/auditScore.ts). */
export interface AuditInput {
  blamed: number | null
  total: number | null
  fetchedAt: string | Date | null
  /** The long window (up to 28 days); absent or null = only the 7-day window is known. */
  long?: AuditLongWindow | null
}

export function computeReliabilityScore(
  uptime: number | UptimeInput,
  nutCount: number | null,
  version: string | null,
  contactCount: number,
  audit: AuditInput,
  latestVersions?: LatestVersions,
  discoveredAt?: string | null,
  now: number = Date.now(),
): number {
  const uScore = uptimeComponent(uptime)
  const nScore = nutComponent(nutCount)
  const vScore = versionComponent(version, latestVersions)
  const cScore = contactComponent(contactCount)
  const aScore = auditComponent(audit.blamed, audit.total, audit.fetchedAt, now, audit.long)
  const total = Math.min(100, Math.round(uScore + nScore + vScore + cScore + aScore))
  return applyNewMintCap(total, discoveredAt, now)
}
