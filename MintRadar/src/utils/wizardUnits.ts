// Which units the Best Mint Wizard offers as "the currency you want to hold" (Tools.tsx).

/**
 * Only these (owner, 2026-11-28): sat, usd, eur and msat. A mint's own units (TIH, "chf", "chf-employee",
 * "chf-musician" of mint-f8xsif6.cdv.be-bop.dev, ...) are not offered; a new currency is added here on purpose.
 */
const WIZARD_UNITS: ReadonlySet<string> = new Set(['sat', 'usd', 'eur', 'msat'])

export function wizardOffersUnit(unit: string): boolean {
  return WIZARD_UNITS.has(unit.toLowerCase())
}
