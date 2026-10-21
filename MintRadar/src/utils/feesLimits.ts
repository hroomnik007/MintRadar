// "Fees and limits" group of the Mint Detail Overview. Facts only: the fee examples are computed from the stored keysets
// (utils/feeExamples.ts, the NUT-02 rule), the limits are the ones the mint declares in /v1/info (NUT-04 / NUT-05).
// Nothing here judges a number and nothing is requested from a mint.
import { feeExamplesOf, FEE_EXAMPLE_PROOFS, type FeeKeysetLike } from './feeExamples'
import { sortUnits } from './sortUnits'
import { formatTimeAgo } from './mintFormatting'
import { formatDateTimeUtc } from './formatDate'

export const FEES_NOT_CHECKED = 'Keyset data not available yet'
export const FEES_NO_ACTIVE_KEYSET = 'No active keyset'
export const NO_INPUT_FEE = 'No input fee'
export const LIMIT_NOT_DECLARED = 'not declared'
export const LIMITS_NOTE =
  'Limits are declared by the mint in /v1/info. Lightning fee reserves depend on the invoice and are only known when a quote is requested, so MintRadar does not show them.'

export interface FeeRow {
  unit: string
  /** "Spending 1 / 16 / 100 proofs: 1 / 2 / 10 sat", or "No input fee". */
  text: string
}

export interface FeesView {
  rows: FeeRow[]
  /** Set when there is no row to show: the keysets are not checked yet, or none of them is active. */
  empty: string | null
}

/** The fee rows of the keysets the page has (live probe, or the last known ones of an unavailable mint). */
export function feesView(keysets: readonly FeeKeysetLike[] | null | undefined): FeesView {
  if (!keysets || keysets.length === 0) return { rows: [], empty: FEES_NOT_CHECKED }
  const units = feeExamplesOf(keysets)
  if (units.length === 0) return { rows: [], empty: FEES_NO_ACTIVE_KEYSET }
  return {
    rows: units.map(u => ({
      unit: u.unit,
      text: u.inputFeePpk === 0
        ? NO_INPUT_FEE
        : `Spending ${FEE_EXAMPLE_PROOFS.join(' / ')} proofs: ${u.examples.map(e => e.fee.toLocaleString('en-US')).join(' / ')} ${u.unit}`,
    })),
    empty: null,
  }
}

type MethodLike = { method: string; unit: string; [key: string]: unknown }

export interface LimitRow {
  key: string
  /** "Deposit (mint) · bolt11 · sat" */
  label: string
  /** "min 1, max 1,000,000" (a limit the mint does not declare reads "not declared"), or a state sentence. */
  value: string
}

const METHOD_RE = /^[a-z0-9_-]{1,32}$/i
const UNIT_RE = /^[A-Za-z0-9_-]{1,16}$/

const amount = (v: unknown): string => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v.toLocaleString('en-US') : LIMIT_NOT_DECLARED)

function rowsOf(prefix: string, list: readonly MethodLike[] | null | undefined, disabled: boolean): LimitRow[] {
  if (disabled) return [{ key: prefix, label: prefix, value: 'disabled by the mint' }]
  const entries = (list ?? []).filter(m => typeof m.method === 'string' && METHOD_RE.test(m.method) && typeof m.unit === 'string' && UNIT_RE.test(m.unit))
  if (entries.length === 0) return [{ key: prefix, label: prefix, value: 'no methods declared' }]
  const rank = new Map(sortUnits(entries.map(m => m.unit)).map((u, i) => [u.toLowerCase(), i] as const))
  const sorted = [...entries].sort((a, b) =>
    (rank.get(a.unit.toLowerCase()) ?? 0) - (rank.get(b.unit.toLowerCase()) ?? 0)
    || (a.method < b.method ? -1 : a.method > b.method ? 1 : 0))
  return sorted.map((m, i) => ({
    key: `${prefix}-${m.method}-${m.unit}-${i}`,
    label: `${prefix} · ${m.method.toLowerCase()} · ${m.unit.toLowerCase()}`,
    value: `min ${amount(m['min_amount'])}, max ${amount(m['max_amount'])}`,
  }))
}

/** Declared limits per method and unit: deposit (NUT-04, mint) rows first, then withdrawal (NUT-05, melt). */
export function limitRows(
  mintMethods: readonly MethodLike[] | null | undefined,
  meltMethods: readonly MethodLike[] | null | undefined,
  disabled: { mint?: boolean; melt?: boolean } = {},
): LimitRow[] {
  return [
    ...rowsOf('Deposit (mint)', mintMethods, disabled.mint === true),
    ...rowsOf('Withdrawal (melt)', meltMethods, disabled.melt === true),
  ]
}

/** The source line under the limits: where the numbers come from and when they were fetched (absolute UTC time in the title). */
export function limitsSource(fetchedAt: string | null | undefined, now: number): { text: string; time: { label: string; title: string } | null } {
  const d = fetchedAt ? new Date(fetchedAt) : null
  const time = d && Number.isFinite(d.getTime()) ? { label: formatTimeAgo(d, now), title: formatDateTimeUtc(d) } : null
  return { text: 'declared by the mint in /v1/info', time }
}

/** Number of fee lines to reserve while the keysets load: one per unit the mint lists (at least one). */
export function reservedFeeLines(units: readonly string[] | null | undefined): number {
  return Math.max(1, sortUnits(units).length)
}
