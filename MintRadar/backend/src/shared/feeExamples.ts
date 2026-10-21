// Input fees in plain amounts (NUT-02): the fee for spending n proofs of a keyset is the sum of their input_fee_ppk
// divided by 1000, rounded UP, in the keyset's unit. Computed from stored keysets only, never from a request to a mint.
// The "effective fee" of a unit is the largest input_fee_ppk among its ACTIVE keysets (the W4 rule, mintChanges.ts
// feesByUnit). A keyset that states no input_fee_ppk uses the NUT-02 default of 0. This file has no imports, so the frontend copy src/utils/feeExamples.ts is
// byte-identical (code, comments aside); src/__tests__/sharedModules.test.ts fails when they drift.

/** The proof counts every example is computed for. */
export const FEE_EXAMPLE_PROOFS: readonly number[] = [1, 16, 100]

export interface FeeKeysetLike {
  unit: string
  active: boolean
  /** null: the mint stated no (valid) fee; NUT-02 says 0 then. */
  inputFeePpk: number | null
}

export interface FeeExample { proofs: number; fee: number }
export interface FeeExampleUnit { unit: string; inputFeePpk: number; examples: FeeExample[] }

/** Fee in the keyset's unit for spending `proofs` proofs of a keyset with `ppk`: ceil(ppk * proofs / 1000). */
export function inputFeeFor(ppk: number, proofs: number): number {
  return Math.floor((ppk * proofs + 999) / 1000)
}

/** One entry per unit that has an active keyset; sat first, then alphabetical. */
export function feeExamplesOf(keysets: readonly FeeKeysetLike[]): FeeExampleUnit[] {
  const byUnit = new Map<string, number>()
  for (const k of keysets) {
    if (!k.active) continue
    const unit = k.unit.toLowerCase()
    byUnit.set(unit, Math.max(byUnit.get(unit) ?? 0, k.inputFeePpk ?? 0))
  }
  return [...byUnit.entries()]
    .sort(([a], [b]) => (a === 'sat' ? -1 : b === 'sat' ? 1 : a < b ? -1 : a > b ? 1 : 0))
    .map(([unit, ppk]) => ({
      unit,
      inputFeePpk: ppk,
      examples: FEE_EXAMPLE_PROOFS.map(proofs => ({ proofs, fee: inputFeeFor(ppk, proofs) })),
    }))
}
