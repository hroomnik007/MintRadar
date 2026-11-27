// Which units the Best Mint Wizard offers as "the currency you want to hold" (Tools.tsx).

/** Units the wizard does not offer although they look like a currency code (review 2026-11-27: TIH). */
const WIZARD_HIDDEN_UNITS: ReadonlySet<string> = new Set(['tih'])

/**
 * Only real currencies (owner, 2026-11-28): sat, msat and three-letter currency codes (usd, eur, chf, ...). A mint's own
 * token units such as "chf-employee" or "chf-musician" (mint-f8xsif6.cdv.be-bop.dev) are not a currency to hold.
 */
export function wizardOffersUnit(unit: string): boolean {
  const u = unit.toLowerCase()
  if (WIZARD_HIDDEN_UNITS.has(u)) return false
  return u === 'sat' || u === 'msat' || /^[a-z]{3}$/.test(u)
}
