// Review 2026-11-28 (Tools + Stats): the token result block and the trend chart's axis (the geography sentence was removed on the owner's request).
import { describe, it, expect } from 'vitest'
import { tokenVerdict, signatureState, type TokenVerdictInput } from '@/utils/tokenVerdict'
import { trendScoreDomain } from '@/utils/trendTicks'

const base: TokenVerdictInput = { spent: null, checking: false, signaturesConfirmed: false, mintName: 'Minibits mint', mintHost: 'mint.minibits.cash' }
const checked = (total: number, unspent: number, spent: number, pending = 0) => ({ status: 'ok' as const, data: { total, unspent, spent, pending } })

// Second pass the same day (mockup ~/Claude/refs/mintradar-inspectors-mockup-1128): the spent state is a chip of its own
// beside the signature chip; the "Check if spent" note moved into the ⓘ after the buttons, the test-mint line is the component's.
describe('tokenVerdict, the spent chip', () => {
  it('before the spent check and while checking: no sentence, the chip says it', () => {
    expect(tokenVerdict(base)).toEqual({ tone: 'neutral', chip: 'Spent: not checked yet', sub: '' })
    expect(tokenVerdict({ ...base, checking: true })).toEqual({ tone: 'loading', chip: 'Spent: asking the mint…', sub: '' })
  })
  it('unspent: green only with confirmed signatures', () => {
    expect(tokenVerdict({ ...base, spent: checked(2, 2, 0), signaturesConfirmed: true })).toEqual({ tone: 'ok', chip: 'Not spent', sub: '' })
    expect(tokenVerdict({ ...base, spent: checked(2, 2, 0) })).toMatchObject({ tone: 'neutral', chip: 'Not spent' })
    expect(tokenVerdict({ ...base, spent: checked(2, 2, 0) }).sub).toContain('does not prove the token is genuine')
  })
  it('spent, partly spent, pending, error and a bad mint url', () => {
    expect(tokenVerdict({ ...base, spent: checked(3, 0, 3) })).toEqual({ tone: 'bad', chip: 'Already spent', sub: 'All 3 coins were redeemed elsewhere. Nothing left to redeem.' })
    expect(tokenVerdict({ ...base, spent: checked(1, 0, 1) }).sub).toBe('The coin was redeemed elsewhere. Nothing left to redeem.')
    expect(tokenVerdict({ ...base, spent: checked(5, 3, 2) })).toMatchObject({ tone: 'warn', chip: 'Partly spent', sub: '3 of 5 coins unspent, 2 already spent. A wallet can claim only the unspent ones.' })
    expect(tokenVerdict({ ...base, spent: checked(2, 0, 0, 2) })).toMatchObject({ tone: 'neutral', chip: 'Spent: pending' })
    expect(tokenVerdict({ ...base, spent: { status: 'error', message: 'Could not reach the mint.' } })).toEqual({ tone: 'warn', chip: 'Spent status unknown', sub: 'Could not reach the mint. We could not ask whether these coins are spent. This says nothing about the token itself.' })
    expect(tokenVerdict({ ...base, spent: { status: 'bad-mint-url', message: 'Not https.' } }).sub).toBe('Not https. A legitimate Cashu token points at a public https:// mint.')
  })
})

describe('signatureState, the signature chip', () => {
  it('names the mint when every coin is signed; the other outcomes in two or three words', () => {
    expect(signatureState(null, true, 'Testnut mint')).toEqual({ tone: 'loading', chip: 'Checking signatures…' })
    expect(signatureState({ status: 'valid', count: 3 }, false, 'Testnut mint')).toEqual({ tone: 'ok', chip: 'Signed by Testnut mint' })
    expect(signatureState({ status: 'partial', checked: 2, total: 3 }, false, 'X').chip).toBe('2 of 3 signatures checked')
    expect(signatureState({ status: 'no-dleq' }, false, 'X').chip).toBe("Signatures can't be checked")
    expect(signatureState({ status: 'invalid' }, false, 'X')).toEqual({ tone: 'warn', chip: "Signatures don't match this mint" })
    expect(signatureState({ status: 'unreachable' }, false, 'X')).toEqual({ tone: 'warn', chip: 'Signatures not checked' })
    expect(signatureState({ status: 'bad-mint-url', message: 'm' }, false, 'X')).toEqual({ tone: 'bad', chip: 'Not a usable mint' })
  })
})

describe('trendScoreDomain (S1)', () => {
  it('30 days 80 to 85 gives 75 to 90 in steps of 5', () => {
    expect(trendScoreDomain([85, 83, 80, 81])).toEqual({ lo: 75, hi: 90, ticks: [75, 80, 85, 90] })
  })
  it('stays inside 0 to 100, widens a flat line and uses steps of 10 for a wide span', () => {
    expect(trendScoreDomain([99, 100])).toEqual({ lo: 90, hi: 100, ticks: [90, 95, 100] })
    expect(trendScoreDomain([50, 50])).toEqual({ lo: 45, hi: 55, ticks: [45, 50, 55] })
    expect(trendScoreDomain([20, 90]).ticks).toEqual([15, 25, 35, 45, 55, 65, 75, 85, 95])
    expect(trendScoreDomain([])).toEqual({ lo: 0, hi: 100, ticks: [0, 25, 50, 75, 100] })
  })
})
