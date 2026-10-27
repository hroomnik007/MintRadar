// Which NUT numbers a mint DECLARES AS SUPPORTED in its /v1/info `nuts` object. ONE rule for the whole app
// (the NUT card grid, its modal, the "Nutzap-related features" group, and, since methodology 4, the backend's
// Reliability Score NUT component, /api/nuts, /api/stats, the wallet API `nuts` field and `nuts=` filter, `authRequired`
// and the mint change log):
//   - absent or null: not declared;
//   - an entry that is an object with `supported: false` (e.g. "7": { "supported": false }) is NOT supported;
//   - `supported: true`, an object without a `supported` key (older mints declare a NUT by presence, with settings),
//     an empty object and any other non-null value count as declared by presence.
// This backend copy and src/utils/nutSupport.ts have the same code; src/__tests__/sharedModules.test.ts
// pins both to one table of cases.
export function isNutSupported(entry: unknown): boolean {
  return !(entry !== null && typeof entry === 'object' && (entry as { supported?: unknown }).supported === false)
}

/** True when `entry` is declared (not absent, not null) and not `supported: false`. */
export function isNutDeclaredSupported(entry: unknown): boolean {
  return entry !== null && entry !== undefined && isNutSupported(entry)
}

/** The NUT numbers (as strings) of `nuts` that are declared as supported (a null or absent value is not declared). */
export function supportedNutKeys(nuts: Record<string, unknown> | null | undefined): Set<string> {
  return new Set(Object.keys(nuts ?? {}).filter(k => isNutDeclaredSupported(nuts![k])))
}

/** True when the mint's `nuts` object declares NUT `key` as supported (same rule as isNutDeclaredSupported); a null or absent `nuts` is false. */
export function mintSupportsNut(nuts: Record<string, unknown> | null | undefined, key: string): boolean {
  return nuts != null && isNutDeclaredSupported(nuts[key])
}

// Switched off (2026-10-27): NUT-04 (minting) and NUT-05 (melting) carry `disabled: true` when the operator turned
// deposits or withdrawals off (Lek: "4": { "methods": [], "disabled": true }). The NUT is still DECLARED, so the rule
// above (and the Reliability Score NUT component, the wallet API `nuts` field) still count it; the website shows it
// as disabled and its lists and filters treat it as not offered. The wallet API exposes it as mintDisabled/meltDisabled.
/** True when `entry` is an object with `disabled: true` (only the boolean counts). */
export function isNutDisabled(entry: unknown): boolean {
  return entry !== null && typeof entry === 'object' && (entry as { disabled?: unknown }).disabled === true
}

/** True when `entry` is declared as supported and not switched off: the mint offers it right now. */
export function isNutOffered(entry: unknown): boolean {
  return isNutDeclaredSupported(entry) && !isNutDisabled(entry)
}

/** The NUT numbers (as strings) of `nuts` that are declared and not switched off. */
export function offeredNutKeys(nuts: Record<string, unknown> | null | undefined): Set<string> {
  return new Set(Object.keys(nuts ?? {}).filter(k => isNutOffered(nuts![k])))
}

/** True when the mint's `nuts` object offers NUT `key` right now (declared, not `disabled: true`); a null or absent `nuts` is false. */
export function mintOffersNut(nuts: Record<string, unknown> | null | undefined, key: string): boolean {
  return nuts != null && isNutOffered(nuts[key])
}
