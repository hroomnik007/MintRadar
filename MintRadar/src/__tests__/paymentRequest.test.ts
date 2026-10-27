import { describe, it, expect } from 'vitest'
import { PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts'
import {
  parsePaymentRequest, mintStatusWord, PAYMENT_REQUEST_INVALID, PAYMENT_REQUEST_MAX_LENGTH, PAYMENT_REQUEST_TOO_LONG,
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
      transports: [{ type: 'nostr', target: NPROFILE }, { type: 'post', target: 'https://pay.example/cb' }],
      lock: { kind: 'P2PK', data: '02' + 'ab'.repeat(32), tags: ['locktime: 1700000000'] },
    })
  })

  it('amount absent: null; single use not set: null; no lock: null', () => {
    const r = parsePaymentRequest(creq({ m: [MINT] }))
    expect(r.ok && r.view).toMatchObject({ id: null, amount: null, unit: null, singleUse: null, description: null, transports: [], lock: null })
  })

  it('ignores unknown extra fields', () => {
    const r = parsePaymentRequest(creq({ m: [MINT], u: 'sat', zz: 'x', qq: [1, 2, 3], t: [{ t: 'post', a: 'https://p.example', extra: 1 }] }))
    expect(r.ok && r.view.transports).toEqual([{ type: 'post', target: 'https://p.example' }])
  })

  it('empty input is its own state, not an error message', () => {
    expect(parsePaymentRequest('   ')).toEqual({ ok: false, reason: 'empty', message: '' })
  })

  it('wrong prefix is refused', () => {
    for (const s of ['cashuBabc', 'creqBabc', 'creqa' + 'AAAA', 'lnbc1xyz', ' xcreqAabc']) {
      const r = parsePaymentRequest(s)
      expect(r.ok, s).toBe(false)
      if (!r.ok) expect(r.reason, s).toBe('prefix')
    }
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
    expect(r.ok && r.view).toEqual({ id: null, amount: null, unit: null, singleUse: null, description: null, mints: [], transports: [], lock: null })
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

describe('mintStatusWord', () => {
  it('archived, degraded, online, offline, unknown', () => {
    expect(mintStatusWord({ online: false, archived: true })).toBe('Archived')
    expect(mintStatusWord({ online: false, degraded: true })).toBe('Offline 24h+')
    expect(mintStatusWord({ online: true })).toBe('Online')
    expect(mintStatusWord({ online: false })).toBe('Offline')
    expect(mintStatusWord({ online: null })).toBe('Unknown')
  })
})
