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

export type UnitHiddenCounts = { unknown: number; other: number }

/**
 * Of mints that already passed every other filter, how many does the unit filter drop?
 * "unknown" = units null/empty (not probed yet); "other" = units known but none of them is
 * SAT/USD/EUR (e.g. msat), so no choice in the control could ever show that mint. A mint that is
 * merely on another of the three (USD while only SAT is selected) is ordinary filtering, not counted.
 * Zero for an empty selection.
 */
export function countUnitHidden(mints: readonly { units?: string[] | null }[], selected: readonly UnitFilterValue[]): UnitHiddenCounts {
  const counts: UnitHiddenCounts = { unknown: 0, other: 0 }
  if (selected.length === 0) return counts
  for (const m of mints) {
    if (mintMatchesUnits(m, selected)) continue
    if (!m.units || m.units.length === 0) counts.unknown++
    else if (!m.units.some(u => typeof u === 'string' && isUnitFilterValue(u.trim().toLowerCase()))) counts.other++
  }
  return counts
}

/** Footer note text, or null when nothing is hidden for this reason. */
export function unitHiddenNote({ unknown, other }: UnitHiddenCounts): string | null {
  const n = unknown + other
  if (n === 0) return null
  return `${n} hidden: ${other === 0 ? 'units unknown' : unknown === 0 ? 'other units' : 'units unknown or other'}`
}
