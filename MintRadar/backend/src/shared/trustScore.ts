// Trust Score computation — the single definition of how a mint's 0-100 score
// is built out of its five weighted components.
//
// This is the shared source of truth for both the server-side computation
// (prober.ts, run on every probe cycle and stored in mints.last_trust_score) and
// the frontend's client-side fallback + Trust Score Breakdown display
// (MintDetail.tsx). The stored server-side value is authoritative: the frontend
// only computes a score itself when `knownMint.trustScore` is missing (a mint
// not yet probed, or a historical chart bucket with no stored score).
//
// The frontend cannot import this file directly (separate npm package, no
// workspace set up between backend/ and the frontend), so src/utils/trustScore.ts
// is a manually-synced copy — if you change the logic here, mirror it there too.
// The same arrangement exists for shared/auditScore.ts.
import { auditReliabilityScore } from './auditScore.js'

/**
 * Number of NUTs the app tracks, i.e. the denominator of the NUT-support
 * component. Must stay equal to the length of the frontend's TRACKED_NUTS
 * list (src/constants/nuts.ts) — a test asserts this.
 */
export const TRACKED_NUT_COUNT = 25

// [major, minor] descending — newest first.
export const NUTSHELL_VERSIONS: [number, number][] = [
  [0, 16], [0, 15], [0, 14], [0, 13], [0, 12], [0, 11],
]

/** Version recency on a 0-10 scale (scaled to the 15-point component below). */
export function versionFreshnessScore(v: string | null | undefined): number {
  if (!v) return 0
  const m = v.match(/(\d+)\.(\d+)/)
  if (!m || !m[1] || !m[2]) return 3
  const major = parseInt(m[1], 10)
  const minor = parseInt(m[2], 10)
  const idx = NUTSHELL_VERSIONS.findIndex(
    ([mj, mn]) => major > mj || (major === mj && minor >= mn)
  )
  if (idx === -1) return 0
  return Math.max(0, 10 - idx * 2)
}

// ── Individual components ────────────────────────────────────────────────────
// Exported separately so the Trust Score Breakdown UI shows exactly the numbers
// that went into the total, rather than re-deriving them.

/** Uptime over the last 24h — 45 points. */
export function uptimeComponent(uptimePct: number): number {
  return Math.round(uptimePct * 0.45)
}

/** NUT support — 30 points, capped at TRACKED_NUT_COUNT NUTs. */
export function nutComponent(nutCount: number | null | undefined): number {
  return Math.round(Math.min((nutCount ?? 0) / TRACKED_NUT_COUNT, 1) * 30)
}

/** Software version freshness — 15 points. */
export function versionComponent(version: string | null | undefined): number {
  return Math.round(versionFreshnessScore(version) / 10 * 15)
}

/**
 * Published contact methods (email / twitter / nostr) — 5 points.
 * Deliberately NOT capped per-component; see the trustScore tests.
 */
export function contactComponent(contactCount: number): number {
  return Math.round((contactCount / 3) * 5)
}

/**
 * Total Trust Score, 0-100.
 *
 * Rounding: the components above round individually, and the total gets exactly
 * one outer Math.round before the 100 cap — `Math.min(100, Math.round(sum))`.
 * Keep this ordering; the frontend copy must produce bit-identical results for
 * the same inputs, otherwise a mint's displayed breakdown won't add up to the
 * stored score.
 */
export function computeTrustScore(
  uptimePct: number,
  nutCount: number | null,
  version: string | null,
  contactCount: number,
  auditRecentTotal: number | null,
  auditRecentErrors: number | null
): number {
  const uScore = uptimeComponent(uptimePct)
  const nScore = nutComponent(nutCount)
  const vScore = versionComponent(version)
  const cScore = contactComponent(contactCount)
  const aScore = auditReliabilityScore(auditRecentTotal, auditRecentErrors)
  return Math.min(100, Math.round(uScore + nScore + vScore + cScore + aScore))
}
