// NUT-02 keyset ID derivation and classification. Pure: no I/O, no clock. Implements the spec text exactly
// (cashubtc/nuts 02.md, "Deriving the keyset ID"):
//   v1 ("00"): sha256 over the raw compressed public keys sorted by amount, first 14 hex chars, prefix "00".
//   v2 ("01"): sha256 over "amount:pubkeyhex" pairs joined by ",", then "|unit:<unit>", then "|input_fee_ppk:<n>"
//              (only when non-null and non-zero), then "|final_expiry:<n>" (only when non-null and non-zero), prefix "01".
// Anything else (old base64-style ids, unknown version bytes) cannot be checked: the caller stores id_valid = null.
import { createHash } from 'node:crypto'

export type KeysetIdVersion = 'v1' | 'v2' | 'legacy' | 'unknown'

const V1_RE = /^00[0-9a-f]{14}$/
const V2_RE = /^01[0-9a-f]{64}$/
const HEX_ONLY_RE = /^[0-9a-f]+$/i
const LEGACY_RE = /^[A-Za-z0-9+/=_-]{8,24}$/
const AMOUNT_RE = /^(0|[1-9][0-9]{0,19})$/
const PUBKEY_RE = /^0[23][0-9a-f]{64}$/i

/** 'v1' for 00..., 'v2' for 01..., 'legacy' for the old base64-style ids, 'unknown' for everything else. */
export function classifyKeysetId(id: string): KeysetIdVersion {
  if (V1_RE.test(id)) return 'v1'
  if (V2_RE.test(id)) return 'v2'
  if (LEGACY_RE.test(id) && !HEX_ONLY_RE.test(id)) return 'legacy'
  return 'unknown'
}

/** Amount -> compressed public key hex, as served by GET /v1/keys/{id}. */
export type KeysetKeys = Readonly<Record<string, string>>

/** The keys sorted by numeric amount, or null when an amount or a key is malformed or there are none. */
function sortedPairs(keys: KeysetKeys): Array<[bigint, string]> | null {
  const pairs: Array<[bigint, string]> = []
  for (const [amount, key] of Object.entries(keys)) {
    if (!AMOUNT_RE.test(amount) || typeof key !== 'string' || !PUBKEY_RE.test(key)) return null
    pairs.push([BigInt(amount), key.toLowerCase()])
  }
  if (pairs.length === 0) return null
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return pairs
}

export function deriveKeysetIdV1(keys: KeysetKeys): string | null {
  const pairs = sortedPairs(keys)
  if (pairs === null) return null
  const concat = Buffer.concat(pairs.map(([, key]) => Buffer.from(key, 'hex')))
  return '00' + createHash('sha256').update(concat).digest('hex').slice(0, 14)
}

export function deriveKeysetIdV2(
  keys: KeysetKeys,
  unit: string,
  inputFeePpk: number | null,
  finalExpiry: number | null,
): string | null {
  const pairs = sortedPairs(keys)
  if (pairs === null) return null
  let preimage = pairs.map(([amount, key]) => `${amount.toString()}:${key}`).join(',')
  preimage += `|unit:${unit.toLowerCase()}`
  if (inputFeePpk !== null && inputFeePpk !== 0) preimage += `|input_fee_ppk:${inputFeePpk}`
  if (finalExpiry !== null && finalExpiry !== 0) preimage += `|final_expiry:${finalExpiry}`
  return '01' + createHash('sha256').update(preimage, 'utf8').digest('hex')
}

/**
 * Checks an id against the keys obtained together with it. true/false for v1 and v2; null when the id cannot be
 * checked (legacy, unknown) or the keys are malformed: a parse problem is never a "mismatch".
 */
export function verifyKeysetId(
  id: string,
  keys: KeysetKeys,
  unit: string,
  inputFeePpk: number | null,
  finalExpiry: number | null,
): boolean | null {
  const version = classifyKeysetId(id)
  const derived = version === 'v1' ? deriveKeysetIdV1(keys)
    : version === 'v2' ? deriveKeysetIdV2(keys, unit, inputFeePpk, finalExpiry)
    : null
  if (derived === null) return null
  return derived === id
}
