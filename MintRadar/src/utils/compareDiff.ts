// "Only differences" on the mobile Compare table (ComparisonModal.tsx). Each row gets one comparable key per
// mint: the text the cell shows, reduced to what a reader compares. `null` means "not known yet" (a live probe
// or history request still loading); such a row always stays visible, so nothing is hidden on a guess.

export type CompareKey = string | null

/** True when the row should stay visible under "Only differences": an unknown key, or two keys that differ. */
export function rowDiffers(keys: readonly CompareKey[]): boolean {
  if (keys.length < 2) return true
  if (keys.some(k => k === null)) return true
  return new Set(keys).size > 1
}

export interface CompareRowKeys { id: string; keys: readonly CompareKey[] }

/** The ids of the rows to render. With `onlyDifferences` off every row stays, in its order. */
export function visibleCompareRows<T extends CompareRowKeys>(rows: readonly T[], onlyDifferences: boolean): T[] {
  return onlyDifferences ? rows.filter(r => rowDiffers(r.keys)) : [...rows]
}
