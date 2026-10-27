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
