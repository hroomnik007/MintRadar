// "Fees and limits" card of the Mint Detail NUTs tab. Facts only: the fee rate (input_fee_ppk of the ACTIVE keyset of each
// unit, the highest when several are active) and the examples are computed from the stored keysets
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
  'Limits are declared by the mint. Lightning fee reserves depend on the invoice and are known only when a quote is requested, so MintRadar does not show them.'

/**
 * The unit as a person reads an amount of it: "sat" stays, the two fiat units the app knows (usd, eur: the
 * Dashboard unit filter) count in cents, any other unit is shown as the mint states it. Only the label changes,
 * never the number (a usd keyset's fee is already stated in cents).
 */
export function feeUnitLabel(unit: string): string {
  const u = unit.trim().toLowerCase()
  if (u === 'sat') return 'sat'
  if (u === 'usd' || u === 'eur') return 'cents'
  return unit
}

/**
 * The fee RATE per coin as a plain decimal: ppk / 1000 without trailing zeros and without floating-point artefacts
 * (integer arithmetic on the thousandths): 150 -> "0.15", 100 -> "0.1", 1000 -> "1", 1 -> "0.001".
 */
export function formatFeeRate(ppk: number): string {
  const whole = Math.floor(ppk / 1000).toLocaleString('en-US')
  const thousandths = String(ppk % 1000).padStart(3, '0').replace(/0+$/, '')
  return thousandths ? `${whole}.${thousandths}` : whole
}

export interface FeeRow {
  unit: string
  /** "0.15 sat per coin · 150 ppk" (the rate), or "No input fee". */
  text: string
  /** "You pay (rounded up per payment): 1 / 3 / 15 sat for 1 / 16 / 100 coins"; null for "No input fee". */
  examples: string | null
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
    rows: units.map(u => u.inputFeePpk === 0
      ? { unit: u.unit, text: NO_INPUT_FEE, examples: null }
      : {
        unit: u.unit,
        text: `${formatFeeRate(u.inputFeePpk)} ${feeUnitLabel(u.unit)} per coin · ${u.inputFeePpk} ppk`,
        examples: `You pay (rounded up per payment): ${u.examples.map(e => e.fee.toLocaleString('en-US')).join(' / ')} ${feeUnitLabel(u.unit)} for ${FEE_EXAMPLE_PROOFS.join(' / ')} coins`,
      }),
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

/** One row of the Mint Detail limits table (2026-11-19 redesign): a method and unit with its deposit and withdrawal limits. */
export interface LimitTableRow {
  key: string
  /** "bolt11 · sat", "On-chain · sat" */
  label: string
  deposit: string
  withdrawal: string
}

/** "1 to 1,000,000", "from 1", "up to 500,000", "no limits declared". */
function rangeText(m: MethodLike): string {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  const min = m['min_amount'], max = m['max_amount']
  if (ok(min) && ok(max)) return `${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')}`
  if (ok(min)) return `from ${min.toLocaleString('en-US')}`
  if (ok(max)) return `up to ${max.toLocaleString('en-US')}`
  return 'no limits declared'
}

/**
 * The declared limits as a table, one row per method and unit (known units first, then by method), deposit (NUT-04) and
 * withdrawal (NUT-05) side by side; "—" where a side does not offer the method, "Disabled by the mint" for a side the mint
 * switched off. Same input checks as limitRows (method and unit names from the mint are filtered, never rendered raw).
 */
export function limitTable(
  mintMethods: readonly MethodLike[] | null | undefined,
  meltMethods: readonly MethodLike[] | null | undefined,
  disabled: { mint?: boolean; melt?: boolean } = {},
): LimitTableRow[] {
  const valid = (list: readonly MethodLike[] | null | undefined) => (list ?? [])
    .filter(m => typeof m.method === 'string' && METHOD_RE.test(m.method) && typeof m.unit === 'string' && UNIT_RE.test(m.unit))
  const keyOf = (m: MethodLike) => `${m.method.toLowerCase()}|${m.unit.toLowerCase()}`
  const dep = new Map(valid(mintMethods).map(m => [keyOf(m), m] as const))
  const wd = new Map(valid(meltMethods).map(m => [keyOf(m), m] as const))
  const keys = [...new Set([...dep.keys(), ...wd.keys()])]
  const rank = new Map(sortUnits(keys.map(k => k.split('|')[1]!)).map((u, i) => [u.toLowerCase(), i] as const))
  const mOrder = ['bolt11', 'bolt12', 'onchain']
  const mRank = (m: string) => { const i = mOrder.indexOf(m); return i === -1 ? mOrder.length : i }
  keys.sort((a, b) => {
    const [am, au] = a.split('|') as [string, string], [bm, bu] = b.split('|') as [string, string]
    return (rank.get(au) ?? 0) - (rank.get(bu) ?? 0) || mRank(am) - mRank(bm) || (am < bm ? -1 : am > bm ? 1 : 0)
  })
  return keys.map(k => {
    const [method, unit] = k.split('|') as [string, string]
    const d = dep.get(k), w = wd.get(k)
    return {
      key: k,
      label: `${method === 'onchain' ? 'On-chain' : method} · ${unit}`,
      deposit: disabled.mint ? 'Disabled by the mint' : d ? rangeText(d) : '—',
      withdrawal: disabled.melt ? 'Disabled by the mint' : w ? rangeText(w) : '—',
    }
  })
}
