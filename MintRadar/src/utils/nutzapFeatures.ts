// NUTs a Nutzap (NIP-61) relies on, each reported on its own: a Nutzap is locked to the recipient's key with
// P2PK (NUT-11) and carries a DLEQ proof (NUT-12); the spent check (NUT-07) and the spending conditions (NUT-10) belong
// to the same flow. Facts only: "supported" means the number is a key of `nuts` in the mint's /v1/info (the same rule as
// the NUT compatibility grid); there is deliberately no combined verdict.
export const NUTZAP_NUTS = [
  { nut: 7, label: 'NUT-07 · Spent check' },
  { nut: 10, label: 'NUT-10 · Spending conditions' },
  { nut: 11, label: 'NUT-11 · P2PK locking' },
  { nut: 12, label: 'NUT-12 · DLEQ proofs' },
] as const

export interface NutzapRow {
  nut: number
  label: string
  /** '—' while the mint's NUT list is not known at all (nothing is claimed either way). */
  value: 'supported' | 'not declared' | '—'
}

/** `declared` = the NUT numbers (as strings) the mint lists in /v1/info, or null when that list is not known. */
export function nutzapRows(declared: ReadonlySet<string> | null): NutzapRow[] {
  return NUTZAP_NUTS.map(({ nut, label }) => ({
    nut, label,
    value: declared === null ? '—' : declared.has(String(nut)) ? 'supported' : 'not declared',
  }))
}
