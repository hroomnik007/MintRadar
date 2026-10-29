import { describe, it, expect } from 'vitest'
import { PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts'
import {
  parsePaymentRequest, mintStatusWord, transportTagLines, PAYMENT_REQUEST_INVALID, PAYMENT_REQUEST_MAX_LENGTH, PAYMENT_REQUEST_TOO_LONG,
  PAYMENT_REQUEST_CREQB_MAX_LENGTH, PAYMENT_REQUEST_CREQB_TOO_LONG, PAYMENT_REQUEST_PREFIX_ERROR,
} from '../utils/paymentRequest'

// There is no NUT-18 test vector in this repository (docs or fixtures), so the vectors are built with the library
// that also decodes them, plus a small hand-written CBOR encoder for the cases the library cannot produce
// (unknown extra fields, a request without mints).
const MINT = 'https://alpha.mint.example'
const NPROFILE = 'nprofile1qqsxyz'

function cbor(v: unknown): number[] {
  const head = (major: number, n: number): number[] =>
    n < 24 ? [(major << 5) | n] : n < 256 ? [(major << 5) | 24, n] : [(major << 5) | 25, n >> 8, n & 255]
  if (typeof v === 'boolean') return [v ? 0xf5 : 0xf4]
  if (typeof v === 'number') return head(0, v)
  if (typeof v === 'string') { const b = Array.from(new TextEncoder().encode(v)); return [...head(3, b.length), ...b] }
  if (Array.isArray(v)) return [...head(4, v.length), ...v.flatMap(cbor)]
  const e = Object.entries(v as Record<string, unknown>)
  return [...head(5, e.length), ...e.flatMap(([k, x]) => [...cbor(k), ...cbor(x)])]
}
// NUT-26 example, copied from the spec text (nuts/26.md): id demo123, 1000 sat, single use, one mint, "Coffee payment".
const NUT26_EXAMPLE = 'CREQB1QYQQWER9D4HNZV3NQGQQSQQQQQQQQQQRAQPSQQGQQSQQZQG9QQVXSAR5WPEN5TE0D45KUAPWV4UXZMTSD3JJUCM0D5RQQRJRDANXVET9YPCXZ7TDV4H8GXHR3TQ'

// A small bech32m encoder (BIP-350), only to build creqb strings from hand-written TLV bytes (unknown types, a bad length).
function creqb(tlv: number[]): string {
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
  for (const b of tlv) {
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
const tlv = (type: number, value: number[]) => [type, value.length >> 8, value.length & 255, ...value]
const utf8 = (s: string) => Array.from(new TextEncoder().encode(s))

const creq = (raw: unknown) => 'creqA' + Buffer.from(cbor(raw)).toString('base64url')

describe('parsePaymentRequest', () => {
  it('decodes a library-encoded request with every field', () => {
    const encoded = new PaymentRequest(
      [{ type: PaymentRequestTransportType.NOSTR, target: NPROFILE, tags: [['n', '17']] }, { type: PaymentRequestTransportType.POST, target: 'https://pay.example/cb' }],
      'req-1', 21, 'sat', [MINT, 'https://beta.mint.example'], 'Coffee', true,
      { kind: 'P2PK', data: '02' + 'ab'.repeat(32), tags: [['locktime', '1700000000']] },
    ).toEncodedCreqA()
    const r = parsePaymentRequest(`  ${encoded}\n`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.view).toEqual({
      id: 'req-1', amount: '21', unit: 'sat', singleUse: true, description: 'Coffee',
      mints: [MINT, 'https://beta.mint.example'],
      transports: [{ type: 'nostr', target: NPROFILE, tags: [{ key: 'n', values: ['17'] }] }, { type: 'post', target: 'https://pay.example/cb', tags: [] }],
      lock: { kind: 'P2PK', data: '02' + 'ab'.repeat(32), tags: ['locktime: 1700000000'] },
      mintPreferred: null, supportedMethods: null,
    })
  })

  it('amount absent: null; single use not set: null; no lock: null', () => {
    const r = parsePaymentRequest(creq({ m: [MINT] }))
    expect(r.ok && r.view).toMatchObject({ id: null, amount: null, unit: null, singleUse: null, description: null, transports: [], lock: null })
  })

  it('ignores unknown extra fields', () => {
    const r = parsePaymentRequest(creq({ m: [MINT], u: 'sat', zz: 'x', qq: [1, 2, 3], t: [{ t: 'post', a: 'https://p.example', extra: 1 }] }))
    expect(r.ok && r.view.transports).toEqual([{ type: 'post', target: 'https://p.example', tags: [] }])
  })

  it('empty input is its own state, not an error message', () => {
    expect(parsePaymentRequest('   ')).toEqual({ ok: false, reason: 'empty', message: '' })
  })

  it('wrong prefix is refused', () => {
    for (const s of ['cashuBabc', 'creqBabc', 'creqb', 'lnbc1xyz', ' xcreqAabc']) {
      const r = parsePaymentRequest(s)
      expect(r.ok, s).toBe(false)
      if (!r.ok) { expect(r.reason, s).toBe('prefix'); expect(r.message, s).toBe(PAYMENT_REQUEST_PREFIX_ERROR) }
    }
    expect(PAYMENT_REQUEST_PREFIX_ERROR).toBe('Not a payment request: expected a string starting with creqA or creqB.')
  })

  it('creqA prefix is case-insensitive; the payload is not touched', () => {
    const encoded = new PaymentRequest(undefined, 'up', 5, 'sat', [MINT]).toEncodedCreqA()
    const r = parsePaymentRequest('CREQA' + encoded.slice(5))
    expect(r.ok && r.view).toMatchObject({ id: 'up', amount: '5', unit: 'sat', mints: [MINT] })
  })

  it('bad base64, bad CBOR and a non-map all give the one calm message', () => {
    for (const s of ['creqA', 'creqA!!!!', 'creqA' + Buffer.from([0xff, 0xff, 0xff]).toString('base64url'), creq('just a string'), creq([1, 2]), creq(7)]) {
      const r = parsePaymentRequest(s)
      expect(r.ok, s).toBe(false)
      if (!r.ok) expect(r.message, s).toBe(PAYMENT_REQUEST_INVALID)
    }
  })

  it('no mints (absent or an empty list) is a valid request: every NUT-18 field is optional', () => {
    for (const raw of [{ u: 'sat' }, { m: [] }, {}, { i: 'x', a: 5 }]) {
      const r = parsePaymentRequest(creq(raw))
      expect(r.ok, JSON.stringify(raw)).toBe(true)
      if (r.ok) expect(r.view.mints, JSON.stringify(raw)).toEqual([])
    }
  })

  it('a library-encoded empty request (base64 padding included) is valid', () => {
    expect(parsePaymentRequest(new PaymentRequest().toEncodedCreqA()).ok).toBe(true)
  })

  it('a request with no field at all decodes, and every optional field is null or empty (never invalid)', () => {
    const r = parsePaymentRequest(creq({}))
    expect(r.ok && r.view).toEqual({ id: null, amount: null, unit: null, singleUse: null, description: null, mints: [], transports: [], lock: null, mintPreferred: null, supportedMethods: null })
  })

  it('each optional field may be absent on its own', () => {
    const full = { i: 'a', a: 3, u: 'sat', s: true, d: 'hi', m: [MINT], t: [{ t: 'post', a: 'https://p.example' }], nut10: { k: 'P2PK', d: '02ab' } }
    for (const key of Object.keys(full)) {
      const { [key as keyof typeof full]: _omit, ...rest } = full
      void _omit
      expect(parsePaymentRequest(creq(rest)).ok, `without ${key}`).toBe(true)
    }
  })

  it('a mints field of the wrong type is still unusable', () => {
    for (const raw of [{ m: 'https://x.example' }, { m: [1] }]) {
      expect(parsePaymentRequest(creq(raw)), JSON.stringify(raw)).toMatchObject({ ok: false, message: PAYMENT_REQUEST_INVALID })
    }
  })

  it('a transport or lock of the wrong shape is invalid, never a throw', () => {
    expect(parsePaymentRequest(creq({ m: [MINT], t: [{ t: 'post' }] })).ok).toBe(false)
    expect(parsePaymentRequest(creq({ m: [MINT], t: 'post' })).ok).toBe(false)
    expect(parsePaymentRequest(creq({ m: [MINT], nut10: { k: 'P2PK' } })).ok).toBe(false)
  })

  it('input over the length limit gets its own calm message, even when the prefix is right', () => {
    const r = parsePaymentRequest('creqA' + 'A'.repeat(PAYMENT_REQUEST_MAX_LENGTH))
    expect(r).toEqual({ ok: false, reason: 'too-long', message: PAYMENT_REQUEST_TOO_LONG })
    expect(parsePaymentRequest('creqA' + 'A'.repeat(PAYMENT_REQUEST_MAX_LENGTH - 5)).ok).toBe(false) // within the limit: decoded, and invalid
  })

  it('no message carries technical detail', () => {
    const r = parsePaymentRequest('creqA' + Buffer.from([1, 2, 3, 4]).toString('base64url'))
    expect(r.ok === false && r.message).not.toMatch(/Error|undefined|at |stack|CBOR|base64/i)
  })
})

describe('parsePaymentRequest: NUT-26 creqB', () => {
  const EXAMPLE_VIEW = {
    id: 'demo123', amount: '1000', unit: 'sat', singleUse: true, description: 'Coffee payment',
    mints: ['https://mint.example.com'], transports: [], lock: null, mintPreferred: null, supportedMethods: null,
  }

  it('decodes the example of the NUT-26 text', () => {
    const r = parsePaymentRequest(NUT26_EXAMPLE)
    expect(r.ok && r.view).toEqual(EXAMPLE_VIEW)
  })

  it('accepts lower case and mixed case (the spec requires both)', () => {
    expect(parsePaymentRequest(NUT26_EXAMPLE.toLowerCase())).toEqual(parsePaymentRequest(NUT26_EXAMPLE))
    expect(parsePaymentRequest(NUT26_EXAMPLE.slice(0, 40) + NUT26_EXAMPLE.slice(40).toLowerCase())).toEqual(parsePaymentRequest(NUT26_EXAMPLE))
    expect(parsePaymentRequest(`  ${NUT26_EXAMPLE.toLowerCase()}\n`).ok).toBe(true)
  })

  it('a bad checksum gives the one calm message and does not throw', () => {
    const r = parsePaymentRequest(NUT26_EXAMPLE.slice(0, -1) + 'P')
    expect(r).toEqual({ ok: false, reason: 'invalid', message: PAYMENT_REQUEST_INVALID })
  })

  it('an unknown TLV type is ignored', () => {
    const r = parsePaymentRequest(creqb([...tlv(0x01, utf8('abc')), ...tlv(0x7f, [1, 2, 3]), ...tlv(0x05, utf8(MINT))]))
    expect(r.ok && r.view).toMatchObject({ id: 'abc', mints: [MINT] })
  })

  it('a TLV whose length runs past the data, and a cut-off header, give the one calm message', () => {
    for (const bytes of [[0x01, 0x00, 0xc8, 0x41], [0x01, 0x00]]) {
      expect(parsePaymentRequest(creqb(bytes)), String(bytes)).toEqual({ ok: false, reason: 'invalid', message: PAYMENT_REQUEST_INVALID })
    }
  })

  it('a creqb string above 1023 characters gets the too-long message, below the general 4096 limit', () => {
    const r = parsePaymentRequest('creqb1' + 'q'.repeat(PAYMENT_REQUEST_CREQB_MAX_LENGTH))
    expect(r).toEqual({ ok: false, reason: 'too-long', message: PAYMENT_REQUEST_CREQB_TOO_LONG })
    expect(PAYMENT_REQUEST_CREQB_TOO_LONG).toContain('1,023 characters')
    expect(parsePaymentRequest('creqb1' + 'q'.repeat(PAYMENT_REQUEST_CREQB_MAX_LENGTH - 6))).toMatchObject({ ok: false, reason: 'invalid' })
    // above 4096 the general message applies, as for creqA
    expect(parsePaymentRequest('creqb1' + 'q'.repeat(PAYMENT_REQUEST_MAX_LENGTH))).toEqual({ ok: false, reason: 'too-long', message: PAYMENT_REQUEST_TOO_LONG })
  })

  it('a nostr transport with an n tag comes through with its tag; the tag text is plain', () => {
    const transport = [...tlv(0x01, [0]), ...tlv(0x02, Array(32).fill(7)), ...tlv(0x03, [1, ...utf8('n'), 2, ...utf8('17')])]
    const encoded = creqb([...tlv(0x01, utf8('n1')), ...tlv(0x05, utf8(MINT)), ...tlv(0x07, transport)])
    const r = parsePaymentRequest(encoded.toUpperCase())
    expect(r.ok && r.view.transports[0]).toMatchObject({ type: 'nostr', target: expect.stringMatching(/^nprofile1/), tags: [{ key: 'n', values: ['17'] }] })
    expect(transportTagLines([{ key: 'n', values: ['17', '44'] }, { key: 'r', values: ['wss://relay.example'] }, { key: 'x', values: ['y'] }]))
      .toEqual({ nips: '17, 44', lines: ['Relays: wss://relay.example', 'x: y'] })
    expect(transportTagLines([])).toEqual({ nips: null, lines: [] })
  })

  it('open amount and single use are read from the view: amount null means open, singleUse only true when set', () => {
    const open = parsePaymentRequest(new PaymentRequest(undefined, 'o', undefined, undefined, [MINT], undefined, false).toEncodedCreqB())
    expect(open.ok && open.view).toMatchObject({ amount: null, singleUse: null })
    const once = parsePaymentRequest(new PaymentRequest(undefined, 'o', 5, 'sat', [MINT], undefined, true).toEncodedCreqB())
    expect(once.ok && once.view).toMatchObject({ amount: '5', singleUse: true })
  })
})

describe('mintStatusWord', () => {
  it('archived, degraded, online, offline, unknown', () => {
    expect(mintStatusWord({ online: false, archived: true })).toBe('Archived')
    expect(mintStatusWord({ online: false, degraded: true })).toBe('Degraded')
    expect(mintStatusWord({ online: true })).toBe('Online')
    expect(mintStatusWord({ online: false })).toBe('Offline')
    expect(mintStatusWord({ online: null })).toBe('Unknown')
  })
})
