import { describe, it, expect } from 'vitest'
import { classifyKeysetId, deriveKeysetIdV1, deriveKeysetIdV2, verifyKeysetId } from '../keysetId.js'
import { NUT02_VECTORS as V } from './fixtures/nut02Vectors.js'

describe('NUT-02 keyset id derivation — vectors printed in the spec', () => {
  it('v1: both published keysets', () => {
    expect(deriveKeysetIdV1(V.v1_4.keys)).toBe(V.v1_4.id)
    expect(deriveKeysetIdV1(V.v1_64.keys)).toBe(V.v1_64.id)
  })

  it('v2: the three published keysets (fee + expiry, expiry only, neither)', () => {
    for (const v of [V.v2_1, V.v2_2, V.v2_3]) {
      expect(deriveKeysetIdV2(v.keys, v.unit, v.fee, v.expiry)).toBe(v.id)
    }
  })

  it('v2 depends on unit, input_fee_ppk and final_expiry: leaving any of them out changes the id', () => {
    const v = V.v2_1
    expect(deriveKeysetIdV2(v.keys, v.unit, v.fee, null)).not.toBe(v.id)
    expect(deriveKeysetIdV2(v.keys, v.unit, 0, v.expiry)).not.toBe(v.id)
    expect(deriveKeysetIdV2(v.keys, 'usd', v.fee, v.expiry)).not.toBe(v.id)
  })

  it('v2: a null / 0 fee and a null / 0 expiry are omitted from the preimage (same id)', () => {
    const v = V.v2_3
    expect(deriveKeysetIdV2(v.keys, v.unit, null, null)).toBe(v.id)
    expect(deriveKeysetIdV2(v.keys, v.unit, 0, 0)).toBe(v.id)
  })

  it('sorts by numeric amount, not by string order (amounts 8 and 16 and 128)', () => {
    const keys = { '128': V.v1_4.keys['1'], '8': V.v1_4.keys['2'], '16': V.v1_4.keys['4'] }
    const sorted = { '8': V.v1_4.keys['2'], '16': V.v1_4.keys['4'], '128': V.v1_4.keys['1'] }
    expect(deriveKeysetIdV1(keys)).toBe(deriveKeysetIdV1(sorted))
    expect(deriveKeysetIdV2(keys, 'sat', null, null)).toBe(deriveKeysetIdV2(sorted, 'sat', null, null))
  })

  it('lowercases the unit and the key hex (v2 preimage is lowercase)', () => {
    const v = V.v2_1
    const upper = Object.fromEntries(Object.entries(v.keys).map(([a, k]) => [a, k.toUpperCase()]))
    expect(deriveKeysetIdV2(upper, 'SAT', v.fee, v.expiry)).toBe(v.id)
  })

  it('handles amounts beyond 2^53 exactly (the 64-key keyset ends at 2^63)', () => {
    expect(Object.keys(V.v1_64.keys)).toContain('9223372036854775808')
    expect(deriveKeysetIdV1(V.v1_64.keys)).toBe(V.v1_64.id)
  })

  it('malformed or empty keys derive nothing (null), never a wrong id', () => {
    expect(deriveKeysetIdV1({})).toBeNull()
    expect(deriveKeysetIdV2({ '1': 'zz' }, 'sat', null, null)).toBeNull()
    expect(deriveKeysetIdV2({ 'x': V.v1_4.keys['1'] }, 'sat', null, null)).toBeNull()
    expect(deriveKeysetIdV2({ '01': V.v1_4.keys['1'] }, 'sat', null, null)).toBeNull()
  })
})

describe('classifyKeysetId', () => {
  it('v1, v2, legacy base64-style and unknown', () => {
    expect(classifyKeysetId(V.v1_4.id)).toBe('v1')
    expect(classifyKeysetId(V.v2_1.id)).toBe('v2')
    expect(classifyKeysetId('I2yN+iRYfkzT')).toBe('legacy')
    expect(classifyKeysetId('Zm9vYmFy')).toBe('legacy')
    expect(classifyKeysetId('02' + 'a'.repeat(14))).toBe('unknown')
    expect(classifyKeysetId('00' + 'a'.repeat(13))).toBe('unknown')
    expect(classifyKeysetId('01' + 'A'.repeat(64))).toBe('unknown')
    expect(classifyKeysetId('')).toBe('unknown')
  })
})

describe('verifyKeysetId', () => {
  it('true for the published vectors, false when a key changes, null when it cannot be checked', () => {
    const v = V.v2_1
    expect(verifyKeysetId(v.id, v.keys, v.unit, v.fee, v.expiry)).toBe(true)
    expect(verifyKeysetId(V.v1_4.id, V.v1_4.keys, 'sat', null, null)).toBe(true)
    const tampered = { ...v.keys, '1': V.v1_4.keys['2'] }
    expect(verifyKeysetId(v.id, tampered, v.unit, v.fee, v.expiry)).toBe(false)
    expect(verifyKeysetId(v.id, v.keys, v.unit, v.fee, null)).toBe(false)
    expect(verifyKeysetId('I2yN+iRYfkzT', v.keys, 'sat', null, null)).toBeNull()
    expect(verifyKeysetId(v.id, { '1': 'not-a-key' }, v.unit, v.fee, v.expiry)).toBeNull()
  })
})
