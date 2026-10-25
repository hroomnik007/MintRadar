// Stats "Reliability movers" without archived mints (2026-10-25). An archived mint is no longer probed, so its score
// only drifts down as the stored history ages; listing it as a "faller" (or, after a last blip, a "riser") says nothing
// about the network today. The API returns them, the page drops them against the known-mints list.
// Until the list has loaded, the rows are shown unchanged (no flash of an empty panel).

export interface MoverRow { url: string; name: string | null; delta: number }
export interface MoversData<R extends MoverRow = MoverRow> { risers: R[]; fallers: R[] }

export function archivedUrlSet(known: readonly { url: string; archived?: boolean | null }[] | undefined): ReadonlySet<string> | null {
  if (!known) return null
  return new Set(known.filter(m => m.archived === true).map(m => m.url))
}

export function withoutArchivedMovers<D extends MoversData>(data: D | undefined, archived: ReadonlySet<string> | null): D | undefined {
  if (!data || !archived || archived.size === 0) return data
  const keep = (r: MoverRow) => !archived.has(r.url)
  return { ...data, risers: data.risers.filter(keep), fallers: data.fallers.filter(keep) }
}
