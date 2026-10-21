// Which NUT numbers a mint DECLARES AS SUPPORTED in its /v1/info `nuts` object, as the NUT card grid, its modal and the
// "Nutzap-related features" group on Mint Detail read it:
//   - an entry that is an object with `supported: false` (e.g. "7": { "supported": false }) is NOT supported;
//   - `supported: true`, an object without a `supported` key (older mints declare a NUT by presence, with settings),
//     an empty object and any other value keep counting as declared by presence.
// The Reliability Score's NUT component and the backend's own NUT lists are deliberately NOT derived from this
// (presence only, see docs/claude/scoring-and-probing.md): this helper is display-only.
export function isNutSupported(entry: unknown): boolean {
  return !(entry !== null && typeof entry === 'object' && (entry as { supported?: unknown }).supported === false)
}

/** The NUT numbers (as strings) of `nuts` that are declared as supported. */
export function supportedNutKeys(nuts: Record<string, unknown> | null | undefined): Set<string> {
  return new Set(Object.keys(nuts ?? {}).filter(k => isNutSupported(nuts![k])))
}
