// Network Health Index (NHI) on the Stats page: the weights, the list of "advanced" features and
// every tooltip/explanation string that describes them. The computation (Stats.tsx) and the texts
// below read the SAME constants, so a changed weight or feature list changes the text with it.

/** Index points per component; they add up to 100. */
export const NHI_WEIGHTS = {
  online: 30,
  reliability: 25,
  diversity: 15,
  advanced: 15,
  stability: 15,
} as const

export type NhiWeights = { readonly [K in keyof typeof NHI_WEIGHTS]: number }

/**
 * A mint counts as "degraded" (left out of the Online share and the average uptime) once it has
 * been offline this long — the frontend twin of STALE_OFFLINE_MS in backend/src/degraded.ts, which
 * decides `degraded` on /api/mints/known (src/__tests__/networkHealthIndex.test.ts compares them).
 */
export const DEGRADED_AFTER_HOURS = 24

export interface AdvancedNut {
  /** NUT number as the key of a mint's /v1/info `nuts` object ('11'). */
  key: string
  /** Plain-words name used in the tooltip. */
  label: string
}

/**
 * "Advanced" features: optional capabilities beyond the baseline mint/melt/state-check/restore
 * lifecycle every mint needs just to function (NUT-04/05/07/08/09/10). The Network Health Index's
 * feature-adoption component averages the adoption of exactly these NUTs; a NUT that no mint
 * advertises counts as 0%.
 *
 * Only MINT-SIDE features belong here. NUT-27 (Nostr mint backup) and NUT-28 (pay to blinded key)
 * were removed on 2026-10-14: they are wallet-side specs (see TRACKED_NUTS in src/constants/nuts.ts)
 * that a mint never advertises in /v1/info, so they were stuck at 0% and capped the component below
 * 100 (39.2 instead of 49.0 on the live data). Mint-side features stay in even when nobody
 * advertises them yet (measured 2026-10-14: no online mint reports 21, 22, 25 or 30) — those can
 * be adopted, so they are meant to count.
 */
export const ADVANCED_NUTS: readonly AdvancedNut[] = [
  { key: '11', label: 'P2PK' },
  { key: '12', label: 'DLEQ' },
  { key: '14', label: 'HTLCs' },
  { key: '17', label: 'WebSocket' },
  { key: '21', label: 'clear auth' },
  { key: '22', label: 'blind auth' },
  { key: '25', label: 'BOLT12' },
  { key: '30', label: 'on-chain' },
]

export const ADVANCED_NUT_KEYS: string[] = ADVANCED_NUTS.map(n => n.key)

/** Average adoption (0-100) over the advanced NUTs; a NUT missing from `nutAdoption` counts as 0%. */
export function advancedAdoptionPercent(
  nutAdoption: ReadonlyArray<{ nut: string; percent: number }>,
  features: readonly AdvancedNut[] = ADVANCED_NUTS,
): number {
  if (features.length === 0) return 0
  const percents = features.map(f => nutAdoption.find(n => n.nut === `NUT-${f.key.padStart(2, '0')}`)?.percent ?? 0)
  return percents.reduce((s, p) => s + p, 0) / percents.length
}

export interface NhiParts {
  /** Each part as 0-100. */
  online: number
  reliability: number
  diversity: number
  advanced: number
  stability: number
}

/** The index: the five parts weighted by `w` (points per 100), rounded to a whole number. */
export function nhiScore(p: NhiParts, w: NhiWeights = NHI_WEIGHTS): number {
  return Math.round(
    p.online * (w.online / 100) + p.reliability * (w.reliability / 100) + p.diversity * (w.diversity / 100) +
      p.advanced * (w.advanced / 100) + p.stability * (w.stability / 100),
  )
}

// ── Texts ────────────────────────────────────────────────────────────────────

/** Subtitle under the "Network health index" header; where the gauge opens the breakdown dialog (<= 768 px) it says so. */
export const NHI_SUBTITLE = 'Weighted from five factors.'
export const NHI_SUBTITLE_GAUGE_HINT = 'Tap or click the gauge for the breakdown.'
export function nhiSubtitle(gaugeOpensBreakdown: boolean): string {
  return gaugeOpensBreakdown ? `${NHI_SUBTITLE} ${NHI_SUBTITLE_GAUGE_HINT}` : NHI_SUBTITLE
}

/** Which mints the Online share is taken over (also appended to the desktop header tooltip). */
export function nhiOnlineSetText(hours: number = DEGRADED_AFTER_HOURS): string {
  return `Online share counts mints not offline for ${hours}h or more.`
}

/** The formula line of the breakdown dialog's footer. */
export function nhiFormulaText(w: NhiWeights = NHI_WEIGHTS): string {
  return `Score = Online%×${w.online} + Reliability×${w.reliability} + SW Diversity×${w.diversity} + Advanced NUTs×${w.advanced} + Stability×${w.stability}, each part 0-100%. ${nhiOnlineSetText()} Test mints are included. ` +
    'Network Stability (share of mints tracked 1 month+) stands in for churn rate — churn ' +
    'isn\'t reliably measurable yet, since mints are never marked "removed" in the database.'
}

/** "Online mints" row. */
export function nhiOnlineRowText(points: number, w: NhiWeights = NHI_WEIGHTS, hours: number = DEGRADED_AFTER_HOURS): string {
  return `${points} of ${w.online} points: the share of online mints among all mints not offline for ${hours}h or more (test mints included). Not a count of mints.`
}

/** "Avg. Reliability Score" row. */
export function nhiReliabilityRowText(): string {
  return 'Average Reliability Score (0-100) of online mints. An online mint without a score counts as 0. Test mints are included.'
}

/** "Advanced feature adoption" row — the feature list comes from ADVANCED_NUTS. */
export function nhiAdvancedRowText(features: readonly AdvancedNut[] = ADVANCED_NUTS): string {
  return `Average share of online mints offering each of: ${features.map(f => f.label).join(', ')}. A feature no mint offers counts as 0%.`
}

/** Caption of the "average uptime" tile on the Stats page: which mints are averaged (the others are left out). */
export function avgUptimeCaption(hours: number = DEGRADED_AFTER_HOURS): string {
  return `of mints not offline for ${hours}h+`
}
