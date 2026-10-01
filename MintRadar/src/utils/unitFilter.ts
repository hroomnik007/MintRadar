// Dashboard unit filter (SAT / USD / EUR). Pure helpers, no React.
// Units come from GET /api/mints/known `units` (lowercase strings such as "sat"
// or "usd", or null when the mint's NUT-04/05 methods are unknown). MintCard
// shows them uppercased; matching here is case-insensitive on the same field.

export const UNIT_FILTER_OPTIONS = ['sat', 'usd', 'eur'] as const
export type UnitFilterValue = (typeof UNIT_FILTER_OPTIONS)[number]

function isUnitFilterValue(v: string): v is UnitFilterValue {
  return (UNIT_FILTER_OPTIONS as readonly string[]).includes(v)
}

/** Canonical order (sat, usd, eur), de-duplicated, whitelist-only. */
export function normalizeUnitSelection(values: readonly string[]): UnitFilterValue[] {
  const wanted = new Set(values.map(v => v.trim().toLowerCase()))
  return UNIT_FILTER_OPTIONS.filter(u => wanted.has(u))
}

/** ?unit=sat,usd → ['sat','usd']. Unknown/malformed entries are dropped, duplicates collapse. */
export function parseUnitParam(raw: string | null): UnitFilterValue[] {
  if (!raw) return []
  return normalizeUnitSelection(raw.split(','))
}

/** Inverse of parseUnitParam; null when nothing is selected (param is omitted). */
export function buildUnitParam(units: readonly UnitFilterValue[]): string | null {
  const n = normalizeUnitSelection(units)
  return n.length > 0 ? n.join(',') : null
}

/** Empty selection = no filtering; otherwise the mint must advertise at least one selected unit. */
export function mintMatchesUnits(mint: { units?: string[] | null }, selected: readonly UnitFilterValue[]): boolean {
  if (selected.length === 0) return true
  const units = mint.units
  if (!units || units.length === 0) return false
  for (const u of units) {
    if (typeof u === 'string' && isUnitFilterValue(u.trim().toLowerCase()) && selected.includes(u.trim().toLowerCase() as UnitFilterValue)) return true
  }
  return false
}
