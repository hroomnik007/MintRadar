// Reliability Score computation — the single definition of how a mint's 0-100 score
// is built out of its five weighted components.
//
// This is the shared source of truth for both the server-side computation
// (prober.ts, run on every probe cycle and stored in mints.last_reliability_score) and
// the frontend's client-side fallback + Reliability Score Breakdown display
// (MintDetail.tsx). The stored server-side value is authoritative: the frontend
// only computes a score itself when `knownMint.reliabilityScore` is missing (a mint
// not yet probed, or a historical chart bucket with no stored score).
//
// The frontend cannot import this file directly (separate npm package, no
// workspace set up between backend/ and the frontend), so src/utils/reliabilityScore.ts
// is a manually-synced copy — if you change the logic here, mirror it there too.
// The same arrangement exists for shared/auditScore.ts.
import { auditComponent } from './auditScore.js'
import { classifyMintVersion, type LatestVersions } from './versionRule.js'

/**
 * Numeric keys ('4', '5', …) of the mint-side NUTs this app tracks for the
 * NUT-support component — the backend twin of TRACKED_NUT_KEYS in the
 * frontend's src/constants/nuts.ts (that file documents which NUTs are
 * excluded and why: mandatory NUTs, wallet-only NUTs, and auth/payment-method
 * NUTs that are real mint-side features but not part of this score). Keep
 * both lists identical — a test asserts this.
 */
export const TRACKED_NUT_KEYS: string[] = [
  '4', '5', '7', '8', '9', '10', '11', '12', '14', '15', '17', '19', '20', '29',
]

/**
 * Number of NUTs the app tracks, i.e. the denominator of the NUT-support
 * component. Must stay equal to the length of the frontend's TRACKED_NUTS
 * list (src/constants/nuts.ts) — a test asserts this.
 */
export const TRACKED_NUT_COUNT = TRACKED_NUT_KEYS.length

/**
 * The wider universe of NUT keys a mint can actually advertise in `/v1/info`
 * — TRACKED_NUT_KEYS plus the auth (21/22) and payment-method (23/25/30) NUTs
 * that are real mint-side features but deliberately excluded from the NUT-
 * support score (see TRACKED_NUT_KEYS above). Used only for adoption-stats
 * endpoints that other, non-Reliability-Score widgets read from (e.g. Stats.tsx's
 * Network Health Index "advanced adoption" component, which looks at 21/22/25
 * alongside a few TRACKED_NUT_KEYS entries) — NOT for anything that should be
 * capped at the 14 tracked NUTs.
 */
export const MINT_ADVERTISED_NUT_KEYS: string[] = [
  ...TRACKED_NUT_KEYS, '21', '22', '23', '25', '30',
]

// ── Software versions ────────────────────────────────────────────────────────
// The version rule (labels AND points) lives in ONE shared module, versionRule.ts; the score only
// takes its points. `latestVersions` is the family -> latest map the API sends (never a static list).
export {
  splitVersionString, normalizeVersionNumber, parseMajorMinorPatch, compareMintVersionNumbers,
  canonicalSoftwareName, classifyVersion, classifyMintVersion,
} from './versionRule.js'

// ── Individual components ────────────────────────────────────────────────────
// Exported separately so the Reliability Score Breakdown UI shows exactly the numbers
// that went into the total, rather than re-deriving them.

/** Uptime over the last 24h — 40 points. */
export function uptimeComponent(uptimePct: number): number {
  return Math.round(uptimePct * 0.40)
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
// is NOT NULL on every mints row, set at insert time).
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

/** The cashu.info audit inputs stored on mints.audit_cz_* (see shared/auditScore.ts). */
export interface AuditInput {
  blamed: number | null
  total: number | null
  fetchedAt: string | Date | null
}

export function computeReliabilityScore(
  uptimePct: number,
  nutCount: number | null,
  version: string | null,
  contactCount: number,
  audit: AuditInput,
  latestVersions?: LatestVersions,
  discoveredAt?: string | null,
  now: number = Date.now(),
): number {
  const uScore = uptimeComponent(uptimePct)
  const nScore = nutComponent(nutCount)
  const vScore = versionComponent(version, latestVersions)
  const cScore = contactComponent(contactCount)
  const aScore = auditComponent(audit.blamed, audit.total, audit.fetchedAt, now)
  const total = Math.min(100, Math.round(uScore + nScore + vScore + cScore + aScore))
  return applyNewMintCap(total, discoveredAt, now)
}
