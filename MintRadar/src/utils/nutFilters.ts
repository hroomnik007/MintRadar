import { mintSupportsNut } from './nutSupport'

// The NUT filters of the Best Mint wizard (Tools), the Stats "NUT coverage" modal and the Dashboard ?nuts=
// filter. All three use the one NUT-support rule (nutSupport.ts): an entry with `supported: false` is NOT
// support, the same as Compare, the Reliability Score NUT component and /api/stats nutAdoption.

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
    if (checks.has(check) && !mintSupportsNut(nuts, key)) return false
  }
  return true
}

/** True when the mint supports every NUT in `required` (an empty list always passes). */
export function hasRequiredNuts(nuts: Nuts, required: readonly string[]): boolean {
  return required.every(key => mintSupportsNut(nuts, key))
}

/** Online mints that support NUT `key` — the population the Stats NUT coverage modal lists. */
export function onlineMintsSupportingNut<T extends { online?: boolean | null; nutsLimits?: Nuts }>(mints: readonly T[], key: string): T[] {
  return mints.filter(m => m.online === true && mintSupportsNut(m.nutsLimits, key))
}
