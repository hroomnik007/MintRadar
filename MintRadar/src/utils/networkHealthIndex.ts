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
 * Measured 2026-10-14: no online mint advertises 21, 22, 25, 27, 28 or 30. NUT-27 and NUT-28 are
 * wallet-side specs (see TRACKED_NUTS in src/constants/nuts.ts), so they stay at 0% until a mint
 * implements them — the index has a permanent ceiling below 100 while they are listed here.
 */
export const ADVANCED_NUTS: readonly AdvancedNut[] = [
  { key: '11', label: 'P2PK' },
  { key: '12', label: 'DLEQ' },
  { key: '14', label: 'HTLCs' },
  { key: '17', label: 'WebSocket' },
  { key: '21', label: 'clear auth' },
  { key: '22', label: 'blind auth' },
  { key: '25', label: 'BOLT12' },
  { key: '27', label: 'Nostr backup' },
  { key: '28', label: 'pay-to-blinded-key' },
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

// ── Texts ────────────────────────────────────────────────────────────────────

/** Header tooltip of the index: the components and their weights. */
export function nhiSummaryText(w: NhiWeights = NHI_WEIGHTS): string {
  return `Five parts, in points: online mints ${w.online}, Reliability Score ${w.reliability}, software diversity ${w.diversity}, advanced NUTs ${w.advanced}, network stability ${w.stability}. Rows show points, not mint counts.`
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

/** "Average uptime" tile on the Stats page. */
export function avgUptimeText(hours: number = DEGRADED_AFTER_HOURS): string {
  return `Average 24-hour uptime of all mints not offline for ${hours}h or more. Mints without probe data are skipped, not counted as 0%. Test mints are included.`
}
