// Best Mint wizard (Tools page): the pure pieces added by Task B2. Reason line, "Preferred software" options and ranking
// effect, "Max latency" filter. Nothing here fetches: the latency numbers are the ones the wizard already measures for its
// top candidates on every "Find my mint" click (Tools.tsx), and the software families come from the Dashboard's own parsing.
import type { KnownMint } from '@/hooks/useKnownMints'
import { cardLightningLabel } from '@/utils/mintFormatting'
import { passesWizardNutChecks } from '@/utils/nutFilters'
import { softwareFamily, softwareGroups, SOFTWARE_OTHER, SOFTWARE_UNKNOWN } from '@/utils/softwareFilter'
import { REVIEWS_WEIGHT, type WizardCheck } from '@/utils/wizardScoring'
import { pluralize } from '@/utils/plural'

/** The latency limits the wizard offers, in ms (strictly under). */
export const LATENCY_LIMITS = [300, 600] as const
export type LatencyLimit = typeof LATENCY_LIMITS[number]

/**
 * Score credit of a mint of the preferred software. The wizard's yes/no priorities (Lightning, restore, locked payments, live
 * updates) are FILTERS and add no score, so there is no existing per-priority credit to copy; the preference gets the same small
 * share as the community reviews (REVIEWS_WEIGHT): enough to put a matching mint ahead of an otherwise close one, never enough
 * to override a clear difference in latency or reliability (the score is on a 0..1 scale).
 */
export const PREFERRED_SOFTWARE_BONUS = REVIEWS_WEIGHT

export const FACT_SEPARATOR = ' · '
const SOFTWARE_NAME_MAX = 32

/** A software name taken from a mint's version string (untrusted): control and bidi characters out, one line, capped. */
export function cleanSoftwareName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length > SOFTWARE_NAME_MAX ? `${s.slice(0, SOFTWARE_NAME_MAX - 1)}…` : s
}

export interface SoftwareChoice { key: string; name: string }

/** One option per software family of the ONLINE mints, the Dashboard Software filter's grouping and names; "Other" and "Unknown" are not offered. */
export function softwareChoices(mints: readonly Pick<KnownMint, 'online' | 'version'>[]): SoftwareChoice[] {
  const online = mints.filter(m => m.online === true)
  return softwareGroups(online).options
    .filter(o => o.key !== SOFTWARE_OTHER && o.key !== SOFTWARE_UNKNOWN)
    .map(o => ({ key: o.key, name: cleanSoftwareName(o.name) }))
    .filter(o => o.name !== '')
}

/** True when the mint belongs to the preferred family (no preference: false). */
export function matchesPreferredSoftware(mint: Pick<KnownMint, 'version'>, preferred: string | null): boolean {
  return preferred !== null && softwareFamily(mint.version)?.key === preferred
}

export interface WizardRankable { mint: Pick<KnownMint, 'version'>; score: number; latencyMs: number | null }
export interface WizardRanking<T> {
  /** The best `limit` results after the latency limit and the software preference. */
  top: T[]
  /** How many of the candidates have a latency measurement, and how many were measured (tried) in all. */
  measured: number
  total: number
}

/**
 * The preference adds PREFERRED_SOFTWARE_BONUS to a matching mint's score before sorting; nobody is removed by it. A latency
 * limit keeps only the candidates whose measurement exists and is under the limit (an unmeasured or failed one is not shown);
 * it changes no score. Ties keep their order.
 */
export function rankWizardRecs<T extends WizardRankable>(recs: readonly T[], opts: { preferred: string | null; latencyLimit: number | null; limit?: number }): WizardRanking<T> {
  const measured = recs.filter(r => r.latencyMs !== null).length
  const kept = opts.latencyLimit === null ? [...recs] : recs.filter(r => r.latencyMs !== null && r.latencyMs < opts.latencyLimit!)
  const bonus = (r: T) => (matchesPreferredSoftware(r.mint, opts.preferred) ? PREFERRED_SOFTWARE_BONUS : 0)
  const top = kept.map((r, i) => ({ r, i, s: r.score + bonus(r) })).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.r).slice(0, opts.limit ?? 3)
  return { top, measured, total: recs.length }
}

/** The one muted line under the results: only with a limit chosen. */
export function latencyLimitNote(measured: number, total: number): string {
  return `The latency limit applies to the ${measured} of ${pluralize(total, 'mint')} measured from your browser.`
}
export function latencyLimitEmptyText(limit: number): string {
  return `No measured mint is under ${limit} ms. Try a higher limit.`
}

export interface ReasonInput {
  checks: ReadonlySet<WizardCheck>
  mint: Pick<KnownMint, 'mintMethods' | 'meltMethods' | 'nutsLimits' | 'reliabilityScore' | 'version'>
  latencyMs: number | null
  latencyLimit: number | null
  preferred: string | null
}

/**
 * Facts the mint meets from what the person selected, joined with " · ", in a fixed order: Lightning, restore, locked payments,
 * live updates, Reliability, latency from the browser, the preferred software. A selected priority the mint does not meet is left
 * out (no negative words). null when there is nothing to say.
 */
export function wizardReasonText(i: ReasonInput): string | null {
  const parts: string[] = []
  if (i.checks.has('ln')) {
    const ln = cardLightningLabel(i.mint)
    if (ln === 'LN') parts.push('Lightning in and out')
    else if (ln === 'LN in') parts.push('Lightning in')
    else if (ln === 'LN out') parts.push('Lightning out')
  }
  const nut: [WizardCheck, string][] = [['seed', 'Restore (NUT-09)'], ['p2pk', 'Locked payments (NUT-11)'], ['ws', 'Live updates (NUT-17)']]
  for (const [check, text] of nut) {
    if (i.checks.has(check) && passesWizardNutChecks(i.mint.nutsLimits ?? null, new Set([check]))) parts.push(text)
  }
  if (i.checks.has('reliable') && i.mint.reliabilityScore != null) parts.push(`Reliability ${i.mint.reliabilityScore}`)
  if ((i.checks.has('fast') || i.latencyLimit !== null) && i.latencyMs !== null) parts.push(`${i.latencyMs} ms from your browser`)
  if (i.preferred !== null && matchesPreferredSoftware(i.mint, i.preferred)) {
    const f = softwareFamily(i.mint.version)
    const name = f ? cleanSoftwareName(f.name) : ''
    if (name !== '') parts.push(name)
  }
  return parts.length > 0 ? parts.join(FACT_SEPARATOR) : null
}
