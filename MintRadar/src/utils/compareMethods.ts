// Compare modal rows for payment methods (NUT-04 deposit / NUT-05 withdrawal), their declared limits and the units.
// Pure helpers, no React. Limits reuse limitRows() from feesLimits.ts (the Mint Detail "Fees and limits" card), so the
// two never disagree. A switched-off NUT-04/05 (`disabled: true`, #168) reads "Disabled by the mint", like there.
import type { KnownMint } from '@/hooks/useKnownMints'
import { isNutDisabled } from '@/utils/nutSupport'
import { limitRows, type LimitRow } from '@/utils/feesLimits'
import { sortUnits } from '@/utils/sortUnits'

type MethodLike = { method: string; unit: string; [key: string]: unknown }

const METHOD_RE = /^[a-z0-9_-]{1,32}$/i
/** Known payment methods first, in this order; anything else after them, alphabetically. */
const METHOD_ORDER = ['bolt11', 'bolt12', 'onchain']

export const METHODS_DISABLED = 'Disabled by the mint'
export const METHODS_NONE = 'None declared'

export interface MethodsCell {
  /** "bolt11, bolt12", METHODS_DISABLED or METHODS_NONE. */
  text: string
  state: 'list' | 'disabled' | 'none'
}

/** Distinct method names of a NUT-04 or NUT-05 list, known ones first. */
export function methodNames(list: readonly MethodLike[] | null | undefined): string[] {
  const names = new Set<string>()
  for (const m of list ?? []) {
    if (m && typeof m.method === 'string' && METHOD_RE.test(m.method)) names.add(m.method.toLowerCase())
  }
  const rank = (n: string) => { const i = METHOD_ORDER.indexOf(n); return i === -1 ? METHOD_ORDER.length : i }
  return [...names].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
}

export function methodsCell(list: readonly MethodLike[] | null | undefined, disabled: boolean): MethodsCell {
  if (disabled) return { text: METHODS_DISABLED, state: 'disabled' }
  const names = methodNames(list)
  return names.length === 0 ? { text: METHODS_NONE, state: 'none' } : { text: names.join(', '), state: 'list' }
}

/** Which of NUT-04 / NUT-05 the mint switched off (nutsLimits['4'|'5'].disabled === true). */
export function disabledSides(mint: Pick<KnownMint, 'nutsLimits'>): { mint: boolean; melt: boolean } {
  const nuts = (mint.nutsLimits ?? {}) as Record<string, unknown>
  return { mint: isNutDisabled(nuts['4']), melt: isNutDisabled(nuts['5']) }
}

export interface CompareMethods {
  deposit: MethodsCell
  withdrawal: MethodsCell
  /** limitRows() with the short side names "Deposit" / "Withdrawal" (the cell is narrow). */
  limits: LimitRow[]
  /** "SAT, USD", or "—" when the mint's units are unknown. */
  units: string
}

const shortSide = (label: string) => label.replace('Deposit (mint)', 'Deposit').replace('Withdrawal (melt)', 'Withdrawal')

export function compareMethods(mint: Pick<KnownMint, 'nutsLimits' | 'mintMethods' | 'meltMethods' | 'units'>): CompareMethods {
  const off = disabledSides(mint)
  const units = sortUnits(mint.units)
  return {
    deposit: methodsCell(mint.mintMethods, off.mint),
    withdrawal: methodsCell(mint.meltMethods, off.melt),
    limits: limitRows(mint.mintMethods, mint.meltMethods, off).map(r => ({ ...r, label: shortSide(r.label) })),
    units: units.length > 0 ? units.map(u => u.toUpperCase()).join(', ') : '—',
  }
}

/** What "Only differences" compares for the limits row. */
export function limitsKey(rows: readonly LimitRow[]): string {
  return rows.map(r => `${r.label}=${r.value}`).join('|')
}
