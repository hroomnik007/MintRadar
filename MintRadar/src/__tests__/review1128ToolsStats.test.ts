// Review 2026-11-28 (Tools + Stats): the token result block and the trend chart's axis (the geography sentence was removed on the owner's request).
import { describe, it, expect } from 'vitest'
import { tokenVerdict, type TokenVerdictInput } from '@/utils/tokenVerdict'
import { trendScoreDomain } from '@/utils/trendTicks'

const base: TokenVerdictInput = { spent: null, checking: false, signaturesConfirmed: false, mintName: 'Minibits mint', mintHost: 'mint.minibits.cash', testMint: false }
const checked = (total: number, unspent: number, spent: number, pending = 0) => ({ status: 'ok' as const, data: { total, unspent, spent, pending } })

describe('tokenVerdict (T1)', () => {
  it('before the spent check: neutral, says the mint will see the check', () => {
    const v = tokenVerdict(base)
    expect(v).toMatchObject({ tone: 'neutral', title: 'not checked yet' })
    expect(v.sub).toContain('The mint will see that you checked.')
  })
  it('while checking, names the host', () => {
    expect(tokenVerdict({ ...base, checking: true })).toMatchObject({ tone: 'loading', title: 'asking the mint…' })
  })
  it('unspent: green only with confirmed signatures', () => {
    expect(tokenVerdict({ ...base, spent: checked(2, 2, 0), signaturesConfirmed: true })).toEqual({ tone: 'ok', title: 'ready to redeem', sub: 'Signed by Minibits mint and not spent yet.' })
    expect(tokenVerdict({ ...base, spent: checked(2, 2, 0) })).toMatchObject({ tone: 'neutral', title: 'not spent yet' })
  })
  it('spent, partly spent, pending, error and a bad mint url', () => {
    expect(tokenVerdict({ ...base, spent: checked(3, 0, 3) })).toEqual({ tone: 'bad', title: 'already spent', sub: 'All 3 coins were redeemed elsewhere. Nothing left to redeem.' })
    expect(tokenVerdict({ ...base, spent: checked(1, 0, 1) }).sub).toBe('The coin was redeemed elsewhere. Nothing left to redeem.')
    expect(tokenVerdict({ ...base, spent: checked(5, 3, 2) })).toMatchObject({ tone: 'warn', title: 'partly spent', sub: '3 of 5 coins unspent, 2 already spent. A wallet can claim only the unspent ones.' })
    expect(tokenVerdict({ ...base, spent: checked(2, 0, 0, 2) })).toMatchObject({ tone: 'neutral', title: 'pending' })
    expect(tokenVerdict({ ...base, spent: { status: 'error', message: 'Could not reach the mint.' } })).toEqual({ tone: 'warn', title: 'spent status unknown', sub: 'Could not reach the mint. We could not ask whether these coins are spent. This says nothing about the token itself.' })
    expect(tokenVerdict({ ...base, spent: { status: 'bad-mint-url', message: 'Not https.' } }).sub).toBe('Not https. A legitimate Cashu token points at a public https:// mint.')
  })
  it('a test mint adds that its ecash has no value', () => {
    expect(tokenVerdict({ ...base, testMint: true, spent: checked(1, 1, 0) }).sub).toMatch(/Ecash from a test mint has no value\.$/)
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
