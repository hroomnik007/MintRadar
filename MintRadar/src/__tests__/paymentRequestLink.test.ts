import { describe, it, expect } from 'vitest'
import { PaymentRequest } from '@cashu/cashu-ts'
import {
  parsePaymentRequest, bitcoinLinkNote, PAYMENT_REQUEST_PREFIX_ERROR, PAYMENT_REQUEST_INVALID, PAYMENT_REQUEST_CREQB_TOO_LONG,
  BITCOIN_LINK_TOO_LONG, BITCOIN_LINK_NO_CREQ, BITCOIN_LINK_MAX_LENGTH,
} from '../utils/paymentRequest'

// BIP-321 `bitcoin:` links that carry a NUT-26 `creq` parameter (nuts/26.md, "BIP-321 Integration").
const EXAMPLE = 'CREQB1QYQQWER9D4HNZV3NQGQQSQQQQQQQQQQRAQPSQQGQQSQQZQG9QQVXSAR5WPEN5TE0D45KUAPWV4UXZMTSD3JJUCM0D5RQQRJRDANXVET9YPCXZ7TDV4H8GXHR3TQ'
const B_MP_SM = 'CREQB1QYQQ2ETCWSKNZQSQPQQQQQQQQQQQQ9GRQQQSQPGQRF58GARSWVAZ7TMPD3CXSCFWD45KUAPWV4UXZMTSD3JSJQQPQY9QQZGPQQRXYMMVWSCNZZSQZ5QSQPM0DE3KSCTFDCPQQZQQQQQQQQQQQQEQ4HJCD4'
const A_MP_SM = 'creqApmFpZWV4dC0xYWEVYXVjc2F0YW2BeBpodHRwczovL2FscGhhLm1pbnQuZXhhbXBsZWJtcPVic22CoWJtbmZib2x0MTGiYm1uZ29uY2hhaW5ibWYYMg'
const LN = 'lnbc210n1p56amv8sp5v5gvxh0swyje66pcxtqtqh3qmzxd74fkxhjmzgzw7nff9fuhcdgqpp566zkpv'
const URI = `bitcoin:?creq=${EXAMPLE}`

function view(s: string) {
  const r = parsePaymentRequest(s)
  if (!r.ok) throw new Error(`not ok: ${r.message}`)
  return r
}

describe('parsePaymentRequest: bitcoin: links', () => {
  it('the spec example URI decodes to the same view as the bare creqB string', () => {
    const r = view(URI)
    expect(r.view).toEqual(view(EXAMPLE).view)
    expect(r.view.id).toBe('demo123')
    expect(r.view.amount).toBe('1000')
    expect(r.view.unit).toBe('sat')
    expect(r.view.mints).toEqual(['https://mint.example.com'])
    expect(r.view.description).toBe('Coffee payment')
    expect(r.link).toEqual({ also: [], creqCount: 1 })
  })

  it('a bare creq string is unchanged and has no link info', () => {
    const r = view(EXAMPLE)
    expect(r.link).toBeUndefined()
    expect(Object.keys(r).sort()).toEqual(['ok', 'view'])
  })

  it('upper-case scheme and keys', () => {
    expect(view(`BITCOIN:?CREQ=${EXAMPLE}`).view).toEqual(view(EXAMPLE).view)
    expect(view(`BiTcOiN:?Creq=${EXAMPLE}`).view.id).toBe('demo123')
  })

  it('lower-case and mixed-case creqb1 value', () => {
    const mixed = EXAMPLE.slice(0, 20).toLowerCase() + EXAMPLE.slice(20)
    expect(view(`bitcoin:?creq=${EXAMPLE.toLowerCase()}`).view.id).toBe('demo123')
    expect(view(`bitcoin:?creq=${mixed}`).view.id).toBe('demo123')
  })

  it('lightning, lno and an address are listed, in that fixed order and nothing else', () => {
    const r = view(`bitcoin:bc1qexampleaddress?creq=${EXAMPLE}&lno=lno1abc&lightning=${LN}`)
    expect(r.link?.also).toEqual(['Lightning invoice', 'BOLT12 offer', 'on-chain address'])
    expect(bitcoinLinkNote(r.link!)).toBe('From a bitcoin: link. The link also offers: Lightning invoice, BOLT12 offer, on-chain address. Only the Cashu payment request (creq) is decoded here.')
    expect(view(`bitcoin:?lightning=${LN}&creq=${EXAMPLE}`).link?.also).toEqual(['Lightning invoice'])
    expect(view(`bitcoin:?lno=lno1abc&creq=${EXAMPLE}`).link?.also).toEqual(['BOLT12 offer'])
    expect(view(`bitcoin:bc1qx?creq=${EXAMPLE}`).link?.also).toEqual(['on-chain address'])
  })

  it('a URI with only creq lists nothing: the note is just "From a bitcoin: link."', () => {
    expect(bitcoinLinkNote(view(URI).link!)).toBe('From a bitcoin: link.')
    expect(view(`bitcoin:?creq=${EXAMPLE}&label=x&lightning=`).link?.also).toEqual([])
  })

  it('several creq parameters: the first is used and the note says so', () => {
    const r = view(`bitcoin:?creq=${EXAMPLE}&creq=garbage&CREQ=more`)
    expect(r.view.id).toBe('demo123')
    expect(r.link?.creqCount).toBe(3)
    expect(bitcoinLinkNote(r.link!)).toBe('From a bitcoin: link. The link has 3 creq parameters; the first one is shown.')
  })

  it('no creq parameter, and no query at all', () => {
    for (const s of [`bitcoin:?lightning=${LN}`, 'bitcoin:bc1qx', 'bitcoin:', 'bitcoin:?', 'bitcoin:?creqx=1&xcreq=2', `bitcoin:?label=a#creq=${EXAMPLE}`]) {
      const r = parsePaymentRequest(s)
      expect(r.ok, s).toBe(false)
      if (!r.ok) { expect(r.reason, s).toBe('no-creq'); expect(r.message).toBe(BITCOIN_LINK_NO_CREQ) }
    }
    expect(BITCOIN_LINK_NO_CREQ).toBe('This bitcoin: link has no creq parameter, so there is no Cashu payment request in it.')
  })

  it('an empty creq value is a calm failure, not the "empty" state', () => {
    for (const s of ['bitcoin:?creq=', 'bitcoin:?creq', 'bitcoin:?creq=%20']) {
      const r = parsePaymentRequest(s)
      expect(r.ok, s).toBe(false)
      if (!r.ok) { expect(r.reason, s).toBe('prefix'); expect(r.message).toBe(PAYMENT_REQUEST_PREFIX_ERROR) }
    }
  })

  it('a malformed percent sequence is a calm failure; "+" is not a space; valid escapes are decoded', () => {
    for (const s of ['bitcoin:?creq=%', 'bitcoin:?creq=%zz', `bitcoin:?creq=${EXAMPLE}%E0%A4%A`]) {
      const r = parsePaymentRequest(s)
      expect(r.ok, s).toBe(false)
      if (!r.ok) expect(r.message).toBe(PAYMENT_REQUEST_INVALID)
    }
    expect(parsePaymentRequest(`bitcoin:?creq=${EXAMPLE}+x`).ok).toBe(false)
    const escaped = EXAMPLE.replace(/^CREQB1/, 'CREQB%31')
    expect(view(`bitcoin:?creq=${escaped}`).view.id).toBe('demo123')
    // a malformed escape in a parameter that is not read does not matter
    expect(view(`bitcoin:?label=%&creq=${EXAMPLE}`).view.id).toBe('demo123')
  })

  it('a creqA value inside a URI behaves as if pasted alone', () => {
    const a = new PaymentRequest(undefined, 'req-42', 21, 'sat', ['https://alpha.mint.example'], 'Tea').toEncodedCreqA()
    expect(view(`bitcoin:?creq=${a}`).view).toEqual(view(a).view)
    expect(view(`bitcoin:?creq=${a}`).view.description).toBe('Tea')
  })

  it('a URI over 8,192 characters gets the link message; at the cap it is still read', () => {
    const over = `bitcoin:?lightning=${'a'.repeat(BITCOIN_LINK_MAX_LENGTH)}&creq=${EXAMPLE}`
    const r = parsePaymentRequest(over)
    expect(r).toEqual({ ok: false, reason: 'too-long', message: BITCOIN_LINK_TOO_LONG })
    expect(BITCOIN_LINK_TOO_LONG).toBe('This bitcoin: link is longer than 8,192 characters, more than this tool reads.')
    const pad = BITCOIN_LINK_MAX_LENGTH - `bitcoin:?lightning=&creq=${EXAMPLE}`.length
    const atCap = `bitcoin:?lightning=${'a'.repeat(pad)}&creq=${EXAMPLE}`
    expect(atCap.length).toBe(BITCOIN_LINK_MAX_LENGTH)
    expect(view(atCap).view.id).toBe('demo123')
  })

  it('a creqB value over 1,023 characters inside a URI keeps the creqB message', () => {
    const r = parsePaymentRequest(`bitcoin:?creq=CREQB1${'q'.repeat(1100)}`)
    expect(r).toEqual({ ok: false, reason: 'too-long', message: PAYMENT_REQUEST_CREQB_TOO_LONG })
  })

  it('only the first 32 query parameters are examined', () => {
    const filler = Array.from({ length: 31 }, (_, i) => `p${i}=1`).join('&')
    expect(view(`bitcoin:?${filler}&creq=${EXAMPLE}`).view.id).toBe('demo123') // creq is the 32nd
    const r = parsePaymentRequest(`bitcoin:?${filler}&x=1&creq=${EXAMPLE}`) // creq is the 33rd
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no-creq')
    const many = Array.from({ length: 40 }, () => `creq=${EXAMPLE}`).join('&')
    expect(view(`bitcoin:?${many}`).link?.creqCount).toBe(32)
  })

  it('mp and sm are still read: the supplementary decoder gets the extracted creq, not the URI', () => {
    for (const creq of [B_MP_SM, A_MP_SM]) {
      const viaLink = view(`bitcoin:bc1qx?lightning=${LN}&creq=${creq}`).view
      const alone = view(creq).view
      expect(viaLink).toEqual(alone)
      expect(viaLink.mintPreferred).toBe(true)
      expect(viaLink.supportedMethods?.map(m => m.method)).toEqual(['bolt11', 'onchain'])
    }
  })

  it('a bare "bitcoin" without the colon is not a link', () => {
    const r = parsePaymentRequest('bitcoin')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('prefix')
  })

  it('fuzz: random mutations of a valid URI never throw and stay fast', () => {
    let seed = 12345
    const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n }
    const alphabet = '%&=?#:+ abcCREQB1xyz09é\u0000'
    const base = `bitcoin:bc1qx?lightning=${LN}&lno=lno1abc&creq=${EXAMPLE}`
    const t0 = performance.now()
    let worst = 0
    for (let i = 0; i < 400; i++) {
      let s = base
      for (let k = 0, n = 1 + rnd(6); k < n; k++) {
        const pos = rnd(s.length + 1)
        const op = rnd(3)
        const ch = alphabet[rnd(alphabet.length)]!
        s = op === 0 ? s.slice(0, pos) + ch + s.slice(pos) : op === 1 ? s.slice(0, pos) + s.slice(pos + 1 + rnd(5)) : s.slice(0, pos) + ch + s.slice(pos + 1)
      }
      const a = performance.now()
      const r = parsePaymentRequest(s)
      worst = Math.max(worst, performance.now() - a)
      expect(typeof r.ok).toBe('boolean')
      if (!r.ok) expect(typeof r.message).toBe('string')
    }
    expect(performance.now() - t0).toBeLessThan(2000)
    expect(worst).toBeLessThan(100)
  })
})
