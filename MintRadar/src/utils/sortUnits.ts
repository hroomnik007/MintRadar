// Canonical display order for a mint's unit list: sat, usd, eur, then any other
// unit (msat, unknown) alphabetically. Display only — never feed the result into
// filtering, search, sort or URL params. Pure: returns a new array, original
// casing of the first occurrence is kept so lookups by the raw unit still match.

const CANONICAL = ['sat', 'usd', 'eur']

export function sortUnits(units: readonly string[] | null | undefined): string[] {
  if (!units || units.length === 0) return []
  const seen = new Map<string, string>()
  for (const u of units) {
    if (typeof u !== 'string') continue
    const key = u.trim().toLowerCase()
    if (key !== '' && !seen.has(key)) seen.set(key, u)
  }
  const rank = (k: string) => { const i = CANONICAL.indexOf(k); return i === -1 ? CANONICAL.length : i }
  return [...seen.keys()]
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map(k => seen.get(k) as string)
}
