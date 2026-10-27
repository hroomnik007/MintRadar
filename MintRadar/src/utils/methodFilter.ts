// Dashboard payment-method filter (?method=bolt12). Pure helpers, no React.
// Same meaning as the Wallet API `method=` filter: keep a mint that advertises the method in NUT-04 (deposit) or
// NUT-05 (withdrawal), on any unit; a mint whose methods are unknown never matches. One deliberate addition (#168):
// a side the mint switched off (`disabled: true`) does not count, even when it still lists the method, because the
// method is not available there right now. The options are the methods mints actually offer, not a fixed list.
import type { KnownMint } from '@/hooks/useKnownMints'
import { isNutDisabled } from '@/utils/nutSupport'

type MethodLike = { method: string; unit: string; [key: string]: unknown }
type MethodMint = Pick<KnownMint, 'mintMethods' | 'meltMethods' | 'nutsLimits'>

const METHOD_RE = /^[a-z0-9_-]{1,32}$/
/** Known payment methods first, in this order; anything else after them, alphabetically. */
const METHOD_ORDER = ['bolt11', 'bolt12', 'onchain']

const rank = (m: string) => { const i = METHOD_ORDER.indexOf(m); return i === -1 ? METHOD_ORDER.length : i }
export const sortMethods = (list: Iterable<string>): string[] => [...new Set(list)].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))

/** ?method=BOLT12 → 'bolt12'. Missing, empty or malformed → null (no filtering). */
export function parseMethodParam(raw: string | null): string | null {
  if (raw === null) return null
  const v = raw.trim().toLowerCase()
  return METHOD_RE.test(v) ? v : null
}

const names = (list: readonly MethodLike[] | null | undefined): string[] =>
  (list ?? []).flatMap(e => (e && typeof e.method === 'string' && METHOD_RE.test(e.method.toLowerCase()) ? [e.method.toLowerCase()] : []))

/** The methods a mint offers right now: NUT-04 and NUT-05 lists, minus a side it switched off. */
export function offeredMethods(mint: MethodMint): Set<string> {
  const nuts = (mint.nutsLimits ?? {}) as Record<string, unknown>
  return new Set([
    ...(isNutDisabled(nuts['4']) ? [] : names(mint.mintMethods)),
    ...(isNutDisabled(nuts['5']) ? [] : names(mint.meltMethods)),
  ])
}

/** No method selected = no filtering; otherwise the mint must offer it on deposit or withdrawal. */
export function mintMatchesMethod(mint: MethodMint, method: string | null): boolean {
  return method === null || offeredMethods(mint).has(method)
}

/** Filter options: every method some mint offers, known ones first. A selected method nobody offers stays listed so it can be cleared. */
export function methodOptions(mints: readonly MethodMint[], selected: string | null): string[] {
  const all: string[] = selected ? [selected] : []
  for (const m of mints) all.push(...offeredMethods(m))
  return sortMethods(all)
}
