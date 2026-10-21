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
