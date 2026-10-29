import { describe, it, expect } from 'vitest'
import { PaymentRequest } from '@cashu/cashu-ts'
import {
  readPaymentRequestExtras, NO_EXTRAS, EXTRAS_MAX_METHODS, EXTRAS_MAX_METHOD_BYTES, EXTRAS_CREQB_MAX_LENGTH, EXTRAS_MAX_LENGTH,
} from '../utils/paymentRequestExtras'
import { parsePaymentRequest } from '../utils/paymentRequest'

// The vectors are built by hand: cashu-ts cannot encode mp / sm (that is why paymentRequestExtras.ts exists). A small
// CBOR encoder and a small bech32m encoder (BIP-350), both test-only, make creqA and creqB strings from plain values.
const MINT = 'https://alpha.mint.example'

function head(major: number, n: number | bigint): number[] {
  const m = major << 5
  const v = BigInt(n)
  if (v < 24n) return [m | Number(v)]
  if (v < 256n) return [m | 24, Number(v)]
  if (v < 65536n) return [m | 25, Number(v >> 8n), Number(v & 255n)]
  if (v < 4294967296n) return [m | 26, ...[24n, 16n, 8n, 0n].map(s => Number((v >> s) & 255n))]
  return [m | 27, ...[56n, 48n, 40n, 32n, 24n, 16n, 8n, 0n].map(s => Number((v >> s) & 255n))]
}
function cbor(v: unknown): number[] {
  if (typeof v === 'boolean') return [v ? 0xf5 : 0xf4]
  if (typeof v === 'number' || typeof v === 'bigint') return head(0, v)
  if (typeof v === 'string') { const b = Array.from(new TextEncoder().encode(v)); return [...head(3, b.length), ...b] }
  if (Array.isArray(v)) return [...head(4, v.length), ...v.flatMap(cbor)]
  const e = Object.entries(v as Record<string, unknown>)
  return [...head(5, e.length), ...e.flatMap(([k, x]) => [...cbor(k), ...cbor(x)])]
}
const creqA = (bytes: number[]) => 'creqA' + Buffer.from(bytes).toString('base64url')
const creqAOf = (raw: unknown) => creqA(cbor(raw))

function creqB(tlvBytes: number[]): string {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
  const hrp = 'creqb'
  const polymod = (values: number[]) => {
    const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    let chk = 1
    for (const v of values) {
      const top = chk >>> 25
      chk = ((chk & 0x1ffffff) << 5) ^ v
      for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i]!
    }
    return chk >>> 0
  }
  const words: number[] = []
  let acc = 0, bits = 0
  for (const b of tlvBytes) {
    acc = (acc << 8) | b; bits += 8
    while (bits >= 5) { bits -= 5; words.push((acc >> bits) & 31) }
    acc &= (1 << bits) - 1
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31)
  const hrpExp = [...hrp].map(c => c.charCodeAt(0) >> 5).concat([0], [...hrp].map(c => c.charCodeAt(0) & 31))
  const mod = polymod([...hrpExp, ...words, 0, 0, 0, 0, 0, 0]) ^ 0x2bc830a3
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31)
  return `${hrp}1${[...words, ...checksum].map(w => CHARSET[w]).join('')}`
}
const utf8 = (s: string) => Array.from(new TextEncoder().encode(s))
const tlv = (type: number, value: number[]) => [type, value.length >> 8, value.length & 255, ...value]
const u64 = (n: bigint) => [56n, 48n, 40n, 32n, 24n, 16n, 8n, 0n].map(s => Number((n >> s) & 255n))
const method = (name: string, fee?: bigint, extra: number[] = []) =>
  tlv(0x0a, [...tlv(0x01, utf8(name)), ...(fee === undefined ? [] : tlv(0x02, u64(fee))), ...extra])

const TWO = [{ method: 'bolt11', fee: null }, { method: 'onchain', fee: 50n }]

describe('readPaymentRequestExtras: creqA (CBOR)', () => {
  it('reads mp true and two methods, one with a fee and one without', () => {
    const r = readPaymentRequestExtras(creqAOf({ m: [MINT], mp: true, sm: [{ mn: 'bolt11' }, { mn: 'onchain', mf: 50 }] }))
    expect(r).toEqual({ mintPreferred: true, supportedMethods: TWO })
  })

  it('mp false is read as false; an explicit mf of 0 is a fee of 0n', () => {
    expect(readPaymentRequestExtras(creqAOf({ mp: false, sm: [{ mn: 'bolt12', mf: 0 }] })))
      .toEqual({ mintPreferred: false, supportedMethods: [{ method: 'bolt12', fee: 0n }] })
  })

  it('absent fields give nulls (also for an empty request and a request of other fields only)', () => {
    expect(readPaymentRequestExtras(creqAOf({}))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(creqAOf({ m: [MINT], a: 1, u: 'sat', d: 'x' }))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(new PaymentRequest(undefined, 'x', 5, 'sat', [MINT]).toEncodedCreqA())).toEqual(NO_EXTRAS)
  })

  it('the prefix is case-insensitive and the string is trimmed', () => {
    const s = creqAOf({ mp: true })
    expect(readPaymentRequestExtras(`  CREQA${s.slice(5)}\n`).mintPreferred).toBe(true)
  })

  it('a fee above 2^53 stays exact (bigint)', () => {
    expect(readPaymentRequestExtras(creqAOf({ sm: [{ mn: 'onchain', mf: 18446744073709551615n }] })).supportedMethods)
      .toEqual([{ method: 'onchain', fee: 18446744073709551615n }])
  })

  it('unknown keys of any supported kind are skipped, also inside a method', () => {
    const r = readPaymentRequestExtras(creqAOf({ zz: [1, 'a', { q: true }], mp: true, sm: [{ x: [1, 2], mn: 'bolt11', mf: 2 }], yy: 9 }))
    expect(r).toEqual({ mintPreferred: true, supportedMethods: [{ method: 'bolt11', fee: 2n }] })
  })

  it('an mp that is not a boolean is unreadable (null), sm is still read', () => {
    expect(readPaymentRequestExtras(creqAOf({ mp: 1, sm: [{ mn: 'bolt11' }] })))
      .toEqual({ mintPreferred: null, supportedMethods: [{ method: 'bolt11', fee: null }] })
  })

  it('unsupported CBOR (float, tag, indefinite length, negative fee, reserved value) gives nulls', () => {
    const key = (k: string) => cbor(k)
    const cases: number[][] = [
      [0xa1, ...key('zz'), 0xf9, 0x3c, 0x00], // half float
      [0xa1, ...key('zz'), 0xc1, 0x01], // tag
      [0xa1, ...key('zz'), 0x9f, 0x01, 0xff], // indefinite-length array
      [0xa1, ...key('zz'), 0xf7], // undefined
      [0xa1, ...key('sm'), 0x81, 0xa2, ...key('mn'), ...cbor('bolt11'), ...key('mf'), 0x20], // mf = -1
      [0xa1, ...key('zz'), 0x1c], // reserved additional information
      [0xa1, ...key('zz'), 0xf8, 0x20], // simple value 32
    ]
    for (const bytes of cases) expect(readPaymentRequestExtras(creqA(bytes)), String(bytes)).toEqual(NO_EXTRAS)
  })

  it('a top-level value that is not a map gives nulls', () => {
    for (const raw of ['text', 7, [1, 2], true]) expect(readPaymentRequestExtras(creqAOf(raw))).toEqual(NO_EXTRAS)
  })

  it('CBOR nesting: depth 8 (the map is level 0) is read, one level deeper gives nulls', () => {
    const nest = (n: number): unknown => (n === 0 ? 1 : [nest(n - 1)])
    expect(readPaymentRequestExtras(creqAOf({ mp: true, zz: nest(7) })).mintPreferred).toBe(true) // the integer sits at depth 8
    expect(readPaymentRequestExtras(creqAOf({ mp: true, zz: nest(8) }))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(creqAOf({ mp: true, zz: nest(500) }))).toEqual(NO_EXTRAS)
  })

  it('a declared length larger than the data gives nulls, with nothing allocated for it', () => {
    const k = cbor('sm')
    const cases: number[][] = [
      [0xa1, ...k, 0x9a, 0xff, 0xff, 0xff, 0xff], // array of 4 billion, no items
      [0xa1, ...k, 0x9b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], // 2^64 - 1 items
      [0xa1, ...k, 0x81, 0xbb, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], // map of 2^63 entries
      [0xa1, ...k, 0x81, 0xa1, ...cbor('mn'), 0x79, 0x03, 0xe8, 0x61], // text of 1000 bytes, one present
      [0xa1, 0x78, 0xff, 0x61], // key text longer than the data
      [0xa5, ...cbor('mp'), 0xf5], // map announces 5 entries, has 1
      [0xa1, ...k, 0x81, 0xa1, ...cbor('mn'), 0x5b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], // byte string, 2^64 - 1 long
    ]
    for (const bytes of cases) expect(readPaymentRequestExtras(creqA(bytes)), String(bytes)).toEqual(NO_EXTRAS)
  })

  it('truncated input gives nulls at every cut point', () => {
    const bytes = cbor({ m: [MINT], mp: true, sm: [{ mn: 'bolt11' }, { mn: 'onchain', mf: 50 }] })
    for (let cut = 0; cut < bytes.length; cut++) expect(() => readPaymentRequestExtras(creqA(bytes.slice(0, cut)))).not.toThrow()
    expect(readPaymentRequestExtras(creqA(bytes.slice(0, bytes.length - 1)))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras('creqA')).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras('creqA!!!!')).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras('creqAA')).toEqual(NO_EXTRAS) // 1 base64 character cannot be a byte
  })

  it('over 4096 characters gives nulls even when the start is valid', () => {
    const big = creqAOf({ mp: true, d: 'x'.repeat(EXTRAS_MAX_LENGTH) })
    expect(big.length).toBeGreaterThan(EXTRAS_MAX_LENGTH)
    expect(readPaymentRequestExtras(big)).toEqual(NO_EXTRAS)
  })

  it('methods: 32 are read, 33 give nulls; a name of 32 bytes is read, 33 bytes give nulls; empty or missing names give nulls', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ mn: `m${i}` }))
    expect(readPaymentRequestExtras(creqAOf({ sm: many(EXTRAS_MAX_METHODS) })).supportedMethods).toHaveLength(EXTRAS_MAX_METHODS)
    expect(readPaymentRequestExtras(creqAOf({ sm: many(EXTRAS_MAX_METHODS + 1) }))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(creqAOf({ sm: [{ mn: 'a'.repeat(EXTRAS_MAX_METHOD_BYTES) }] })).supportedMethods).toHaveLength(1)
    expect(readPaymentRequestExtras(creqAOf({ sm: [{ mn: 'a'.repeat(EXTRAS_MAX_METHOD_BYTES + 1) }] }))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(creqAOf({ sm: [{ mn: '' }] }))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(creqAOf({ sm: [{ mf: 3 }] }))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(creqAOf({ sm: [] }))).toEqual({ mintPreferred: null, supportedMethods: [] })
  })

  it('invalid UTF-8 in a method name gives nulls', () => {
    const bytes = [0xa1, ...cbor('sm'), 0x81, 0xa1, ...cbor('mn'), 0x62, 0xc3, 0x28]
    expect(readPaymentRequestExtras(creqA(bytes))).toEqual(NO_EXTRAS)
  })
})

describe('readPaymentRequestExtras: creqB (TLV in bech32m)', () => {
  const VALID = creqB([...tlv(0x01, utf8('id1')), ...tlv(0x05, utf8(MINT)), ...tlv(0x09, [1]), ...method('bolt11'), ...method('onchain', 50n)])

  it('reads tag 0x09 and two tag 0x0a methods, one with a fee and one without', () => {
    expect(readPaymentRequestExtras(VALID)).toEqual({ mintPreferred: true, supportedMethods: TWO })
  })

  it('accepts upper, lower and mixed case', () => {
    expect(readPaymentRequestExtras(VALID.toUpperCase())).toEqual(readPaymentRequestExtras(VALID))
    expect(readPaymentRequestExtras(VALID.slice(0, 20) + VALID.slice(20).toUpperCase())).toEqual(readPaymentRequestExtras(VALID))
    expect(readPaymentRequestExtras(VALID.toUpperCase()).supportedMethods).toEqual(TWO)
  })

  it('0x09 = 0 is false; a flag that is not 0 or 1, or not one byte, is unreadable (null)', () => {
    expect(readPaymentRequestExtras(creqB(tlv(0x09, [0]))).mintPreferred).toBe(false)
    expect(readPaymentRequestExtras(creqB(tlv(0x09, [2]))).mintPreferred).toBeNull()
    expect(readPaymentRequestExtras(creqB(tlv(0x09, [1, 1]))).mintPreferred).toBeNull()
  })

  it('absent fields give nulls', () => {
    expect(readPaymentRequestExtras(creqB(tlv(0x01, utf8('x'))))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(creqB([]))).toEqual(NO_EXTRAS)
  })

  it('unknown TLV types are skipped, at the top level and inside a method', () => {
    const r = readPaymentRequestExtras(creqB([...tlv(0x7f, [1, 2, 3]), ...tlv(0x09, [1]), ...method('bolt11', 7n, tlv(0x7e, [9])), ...tlv(0x40, [])]))
    expect(r).toEqual({ mintPreferred: true, supportedMethods: [{ method: 'bolt11', fee: 7n }] })
  })

  it('a fee that is not 8 bytes, a method without a name, a name over 32 bytes or 33 methods give nulls', () => {
    expect(readPaymentRequestExtras(creqB(tlv(0x0a, [...tlv(0x01, utf8('bolt11')), ...tlv(0x02, [1, 2])])))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(creqB(tlv(0x0a, tlv(0x02, u64(1n)))))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(creqB(method('a'.repeat(EXTRAS_MAX_METHOD_BYTES + 1))))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(creqB(Array.from({ length: EXTRAS_MAX_METHODS }, (_, i) => method(`m${i}`)).flat())).supportedMethods).toHaveLength(EXTRAS_MAX_METHODS)
    expect(readPaymentRequestExtras(creqB(Array.from({ length: EXTRAS_MAX_METHODS + 1 }, (_, i) => method(`m${i}`)).flat()))).toEqual(NO_EXTRAS)
  })

  it('a bad checksum, a wrong prefix, a bad character, truncated TLV and a length past the data give nulls', () => {
    expect(readPaymentRequestExtras(VALID.slice(0, -1) + (VALID.endsWith('q') ? 'p' : 'q'))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras('cashub1' + VALID.slice(6))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(VALID.slice(0, 10) + 'b' + VALID.slice(11))).toEqual(NO_EXTRAS) // "b" is not in the bech32 alphabet
    expect(readPaymentRequestExtras(creqB([0x09, 0x00]))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(creqB([0x09, 0x00, 0xc8, 1]))).toEqual(NO_EXTRAS)
    expect(readPaymentRequestExtras(creqB(tlv(0x0a, [0x01, 0x00, 0x20, 0x61])))).toEqual(NO_EXTRAS)
  })

  it('above 1023 characters gives nulls (the string limit of creqB)', () => {
    const long = creqB([...tlv(0x09, [1]), ...tlv(0x06, utf8('x'.repeat(900)))])
    expect(long.length).toBeGreaterThan(EXTRAS_CREQB_MAX_LENGTH)
    expect(readPaymentRequestExtras(long)).toEqual(NO_EXTRAS)
  })
})

describe('parsePaymentRequest with the extras', () => {
  it('the result for the same request is unchanged apart from the two new fields', () => {
    const base = { m: [MINT], a: 21, u: 'sat', d: 'Coffee', i: 'req-1', s: true }
    const without = parsePaymentRequest(creqAOf(base))
    const withExtras = parsePaymentRequest(creqAOf({ ...base, mp: true, sm: [{ mn: 'bolt11' }, { mn: 'onchain', mf: 50 }] }))
    expect(without.ok && withExtras.ok).toBe(true)
    if (!without.ok || !withExtras.ok) return
    const strip = (v: typeof without.view) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'mintPreferred' && k !== 'supportedMethods'))
    expect(strip(withExtras.view)).toEqual(strip(without.view))
    expect(without.view).toMatchObject({ mintPreferred: null, supportedMethods: null })
    expect(withExtras.view).toMatchObject({ mintPreferred: true, supportedMethods: TWO })
    // the same for creqB
    const b = parsePaymentRequest(creqB([...tlv(0x01, utf8('x')), ...tlv(0x05, utf8(MINT)), ...tlv(0x09, [1]), ...method('bolt11')]))
    const bPlain = parsePaymentRequest(creqB([...tlv(0x01, utf8('x')), ...tlv(0x05, utf8(MINT))]))
    expect(b.ok && bPlain.ok).toBe(true)
    if (!b.ok || !bPlain.ok) return
    expect(strip(b.view)).toEqual(strip(bPlain.view))
    expect(b.view).toMatchObject({ mintPreferred: true, supportedMethods: [{ method: 'bolt11', fee: null }] })
  })

  it('an input the extras reader cannot read (a float in an unknown field) still decodes everything else', () => {
    const bytes = [0xa3, ...cbor('m'), ...cbor([MINT]), ...cbor('zz'), 0xf9, 0x3c, 0x00, ...cbor('mp'), 0xf5]
    const r = parsePaymentRequest(creqA(bytes))
    expect(r.ok && r.view).toMatchObject({ mints: [MINT], mintPreferred: null, supportedMethods: null })
  })
})

describe('readPaymentRequestExtras: random mutations', () => {
  // A small deterministic generator (mulberry32), so a failure can be reproduced.
  function rng(seed: number) {
    let a = seed
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const mutate = (bytes: number[], rand: () => number): number[] => {
    const out = bytes.slice()
    const kind = Math.floor(rand() * 4)
    const at = Math.floor(rand() * Math.max(out.length, 1))
    if (kind === 0) out[at] = Math.floor(rand() * 256)
    else if (kind === 1) out.length = at
    else if (kind === 2) out.splice(at, 0, ...Array.from({ length: 1 + Math.floor(rand() * 4) }, () => Math.floor(rand() * 256)))
    else out.splice(at, 1 + Math.floor(rand() * 3))
    return out
  }

  it('300+ mutations of a valid creqA and creqB never throw and each takes a few milliseconds', () => {
    const cborBytes = cbor({ m: [MINT], mp: true, sm: [{ mn: 'bolt11' }, { mn: 'onchain', mf: 50 }], d: 'Coffee' })
    const tlvBytes = [...tlv(0x01, utf8('id1')), ...tlv(0x05, utf8(MINT)), ...tlv(0x09, [1]), ...method('bolt11'), ...method('onchain', 50n)]
    const rand = rng(20261029)
    readPaymentRequestExtras(creqA(cborBytes)) // warm-up, so the first call's JIT time is not counted
    let worst = 0
    let calls = 0
    const run = (s: string) => {
      const t0 = performance.now()
      expect(() => readPaymentRequestExtras(s)).not.toThrow()
      worst = Math.max(worst, performance.now() - t0)
      calls++
    }
    for (let i = 0; i < 400; i++) {
      run(creqA(mutate(cborBytes, rand)))
      run(creqB(mutate(tlvBytes, rand))) // re-encoded, so the checksum is valid and the TLV reader is what gets tested
      // a string-level change of the valid creqB (checksum path)
      const s = creqB(tlvBytes)
      const at = Math.floor(rand() * s.length)
      run(s.slice(0, at) + String.fromCharCode(33 + Math.floor(rand() * 90)) + s.slice(at + 1))
    }
    expect(calls).toBe(1200)
    // "a few milliseconds" in practice (the worst of 1,200 calls measured 1.2 to 1.9 ms in three runs); the bound is looser so a busy CI machine does not flake
    expect(worst).toBeLessThan(50)
  })
})
