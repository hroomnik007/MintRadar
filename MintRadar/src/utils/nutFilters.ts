import { mintOffersNut } from './nutSupport'

// The NUT filters of the Best Mint wizard (Tools), the Stats "NUT coverage" modal and the Dashboard ?nuts=
// filter. All three use the one NUT rule (nutSupport.ts): an entry with `supported: false` is NOT support, and
// since 2026-10-27 a switched-off NUT-04/05 (`disabled: true`) is not offered either (mintOffersNut), the same as
// Compare, /api/stats nutAdoption and, since methodology 5, the Reliability Score NUT component.

type Nuts = Record<string, unknown> | null | undefined

/** Wizard capability checks that require a NUT the mint declares as supported. */
export const WIZARD_NUT_CHECKS: Readonly<Record<string, string>> = {
  // NUT-9 (restore signatures) is the mint-side capability that actually gates seed-phrase backup/restore.
  seed: '9',
  // P2PK (NUT-11) — locking ecash to a public key.
  p2pk: '11',
  // WebSocket (NUT-17) — live balance/payment update subscriptions.
  ws: '17',
}

/** True when the mint supports every NUT the selected wizard checks need (checks without a NUT are ignored here). */
export function passesWizardNutChecks(nuts: Nuts, checks: ReadonlySet<string>): boolean {
  for (const [check, key] of Object.entries(WIZARD_NUT_CHECKS)) {
    if (checks.has(check) && !mintOffersNut(nuts, key)) return false
  }
  return true
}

/** True when the mint supports every NUT in `required` (an empty list always passes). */
export function hasRequiredNuts(nuts: Nuts, required: readonly string[]): boolean {
  return required.every(key => mintOffersNut(nuts, key))
}

/** Online mints that support NUT `key` — the population the Stats NUT coverage modal lists. */
export function onlineMintsSupportingNut<T extends { online?: boolean | null; nutsLimits?: Nuts }>(mints: readonly T[], key: string): T[] {
  return mints.filter(m => m.online === true && mintOffersNut(m.nutsLimits, key))
}

/**
 * Where every online mint stands for NUT `key`: `offering` (offers it), `lacking` (has NUT data and does not offer
 * it) and `noData` (online but no `nuts` data stored yet: neither offering nor lacking). `online` is the denominator,
 * so offering + lacking + noData === online. The Stats NUT coverage modal and the Mint Detail NUT modal both read it.
 */
export function nutOfferBreakdown<T extends { online?: boolean | null; nutsLimits?: Nuts }>(mints: readonly T[], key: string): { online: number; offering: T[]; lacking: T[]; noData: number } {
  const online = mints.filter(m => m.online === true)
  const offering = onlineMintsSupportingNut(online, key)
  const lacking = online.filter(m => m.nutsLimits != null && !mintOffersNut(m.nutsLimits, key))
  return { online: online.length, offering, lacking, noData: online.filter(m => m.nutsLimits == null).length }
}
