import { describe, it, expect } from 'vitest'
import { Amount, getEncodedToken } from '@cashu/cashu-ts'
import { parseCashuToken } from '../utils/cashuToken'

const MINT = 'https://testnut.cashu.space'
const PROOFS = [
  { id: '009a1f293253e41e', amount: Amount.from(2), secret: '407915bc212be61a77e3e6d2aeb4c727980bda51cd06a6afc29e2861768a7837', C: '02bc9097997d81afb2cc7346b5e4345a9346bd2a506eb7958598a72f0cf85163ea' },
  { id: '009a1f293253e41e', amount: Amount.from(8), secret: 'fe15109314e61d7756b0f8ee0f23a624acaa3f4e042f61433c728c7057b931be', C: '029e8e5050b890a7d6c0968db16bc1d5d5fa040ea1de284f6ec69d61299f671059' },
]

const V4_TOKEN = getEncodedToken({ mint: MINT, unit: 'sat', proofs: PROOFS })

// v3 is the legacy base64url-JSON encoding; cashu-ts only *emits* v4, so the
// v3 fixture is built by hand the way an old wallet would have encoded it.
const V3_TOKEN = 'cashuA' + Buffer.from(JSON.stringify({
  token: [{ mint: MINT, proofs: PROOFS.map(p => ({ ...p, amount: p.amount.toNumber() })) }],
  unit: 'usd',
  memo: 'lunch',
})).toString('base64url')

describe('parseCashuToken', () => {
  it('decodes a v4 (cashuB) token', () => {
    const { info, error } = parseCashuToken(V4_TOKEN)
    expect(error).toBeNull()
    expect(info).toMatchObject({ mint: MINT, unit: 'sat', amount: 10, proofsCount: 2, version: 'v4 (cashuB)' })
  })

  it('decodes a v3 (cashuA) token, including unit and memo', () => {
    const { info, error } = parseCashuToken(V3_TOKEN)
    expect(error).toBeNull()
    expect(info).toMatchObject({ mint: MINT, unit: 'usd', amount: 10, proofsCount: 2, version: 'v3 (cashuA)', memo: 'lunch' })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseCashuToken(`  ${V4_TOKEN}\n`).info?.mint).toBe(MINT)
  })

  it('rejects an empty input without throwing', () => {
    const { info, error } = parseCashuToken('   ')
    expect(info).toBeNull()
    expect(error).toBeTruthy()
  })

  it('rejects a non-Cashu string without throwing', () => {
    const { info, error } = parseCashuToken('lnbc1invoice')
    expect(info).toBeNull()
    expect(error).toContain('cashuA')
  })

  it('reports a truncated token as undecodable instead of throwing', () => {
    const { info, error } = parseCashuToken(V4_TOKEN.slice(0, V4_TOKEN.length - 20))
    expect(info).toBeNull()
    expect(error).toBeTruthy()
  })

  it('reports garbage after a valid prefix as undecodable', () => {
    const { info, error } = parseCashuToken('cashuBnot-a-real-token')
    expect(info).toBeNull()
    expect(error).toBeTruthy()
  })
})
