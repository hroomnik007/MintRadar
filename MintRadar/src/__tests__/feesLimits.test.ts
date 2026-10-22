import { describe, it, expect } from 'vitest'
import { feesView, feeUnitLabel, formatFeeRate, limitRows, limitsSource, reservedFeeLines, FEES_NOT_CHECKED, FEES_NO_ACTIVE_KEYSET, NO_INPUT_FEE, LIMIT_NOT_DECLARED, LIMITS_NOTE } from '@/utils/feesLimits'
import { feeExamplesOf, inputFeeFor } from '@/utils/feeExamples'
import { FEE_PER_COIN_TEXT, KEYSET_FEE_TEXT } from '@/utils/tooltipTexts'
import { feeExamplesOf as beFeeExamplesOf } from '../../backend/src/shared/feeExamples'

describe('NUT-02 arithmetic (frontend copy)', () => {
  it('rounds up: ppk 100 with 1, 10, 11 proofs; ppk 0; ppk 1000; ppk 999', () => {
    expect([1, 10, 11].map(n => inputFeeFor(100, n))).toEqual([1, 1, 2])
    expect(inputFeeFor(0, 100)).toBe(0)
    expect(inputFeeFor(1000, 16)).toBe(16)
    expect([1, 2, 1000].map(n => inputFeeFor(999, n))).toEqual([1, 2, 999])
  })
  it('gives the same examples as the backend copy', () => {
    const ks = [{ unit: 'sat', active: true, inputFeePpk: 250 }, { unit: 'usd', active: true, inputFeePpk: 7 }, { unit: 'sat', active: false, inputFeePpk: 9000 }]
    expect(feeExamplesOf(ks)).toEqual(beFeeExamplesOf(ks))
  })
})

describe('feeUnitLabel', () => {
  it('sat stays, usd and eur are cents, any other unit is shown as stated', () => {
    expect(feeUnitLabel('sat')).toBe('sat')
    expect(feeUnitLabel('usd')).toBe('cents')
    expect(feeUnitLabel('eur')).toBe('cents')
    expect(feeUnitLabel('lek')).toBe('lek')
    expect(feeUnitLabel('msat')).toBe('msat')
  })
  it('is case-insensitive for the known units and leaves an unknown unit exactly as it came', () => {
    expect(feeUnitLabel('USD')).toBe('cents')
    expect(feeUnitLabel('Sat')).toBe('sat')
    expect(feeUnitLabel('LEK')).toBe('LEK')
  })
  it('only the label changes: a usd fee keeps its numbers, never claims sat, and both lines use the unit label and the plain word "coins"', () => {
    const v = feesView([{ unit: 'sat', active: true, inputFeePpk: 100 }, { unit: 'usd', active: true, inputFeePpk: 100 }, { unit: 'eur', active: true, inputFeePpk: 1000 }, { unit: 'lek', active: true, inputFeePpk: 100 }])
    expect(v.rows.map(r => `${r.unit}: ${r.text} | ${r.examples}`)).toEqual([
      'sat: 0.1 sat per coin · 100 ppk | You pay (rounded up per payment): 1 / 2 / 10 sat for 1 / 16 / 100 coins',
      'eur: 1 cents per coin · 1000 ppk | You pay (rounded up per payment): 1 / 16 / 100 cents for 1 / 16 / 100 coins',
      'lek: 0.1 lek per coin · 100 ppk | You pay (rounded up per payment): 1 / 2 / 10 lek for 1 / 16 / 100 coins',
      'usd: 0.1 cents per coin · 100 ppk | You pay (rounded up per payment): 1 / 2 / 10 cents for 1 / 16 / 100 coins',
    ])
    for (const r of v.rows) expect(`${r.text} ${r.examples}`).not.toMatch(/proof|ecash note/i)
  })
  it('the tooltip text is the approved plain-language explanation and avoids the technical words', () => {
    expect(FEE_PER_COIN_TEXT).toBe('Your balance is made of many small coins. The mint charges a small fee per coin used and rounds the total up, so small payments cost relatively more. Fewer, larger coins keep fees low.')
    expect(FEE_PER_COIN_TEXT).not.toMatch(/proof|ecash note/i)
    expect(KEYSET_FEE_TEXT).toBe('Input fee in parts per thousand of the smallest unit, charged per coin spent from this keyset (150 ppk = 0.15 of a unit per coin).')
    expect(KEYSET_FEE_TEXT).not.toMatch(/proof|ecash note/i)
  })
})

describe('formatFeeRate', () => {
  it.each([
    [1, '0.001'], [10, '0.01'], [100, '0.1'], [150, '0.15'], [250, '0.25'], [333, '0.333'], [1000, '1'], [1500, '1.5'],
  ])('%i ppk -> "%s" per coin', (ppk, expected) => {
    expect(formatFeeRate(ppk)).toBe(expected)
  })
  it('has no floating-point artefacts and keeps whole numbers whole', () => {
    expect(formatFeeRate(7)).toBe('0.007')
    expect(formatFeeRate(1001)).toBe('1.001')
    expect(formatFeeRate(999)).toBe('0.999')
    expect(formatFeeRate(10_000)).toBe('10')
    expect(formatFeeRate(1_000_000)).toBe('1,000')
  })
})

describe('feesView', () => {
  it('shows the rate per coin first and the rounded examples for spending 1 / 16 / 100 coins', () => {
    expect(feesView([{ unit: 'sat', active: true, inputFeePpk: 100 }])).toEqual({
      rows: [{ unit: 'sat', text: '0.1 sat per coin · 100 ppk', examples: 'You pay (rounded up per payment): 1 / 2 / 10 sat for 1 / 16 / 100 coins' }], empty: null,
    })
    const r = feesView([{ unit: 'sat', active: true, inputFeePpk: 999 }]).rows[0]
    expect(r?.text).toBe('0.999 sat per coin · 999 ppk')
    expect(r?.examples).toBe('You pay (rounded up per payment): 1 / 16 / 100 sat for 1 / 16 / 100 coins')
  })
  it('150 ppk: one coin is 0.15, but the payment is rounded up per payment: 1 / 3 / 15 sat', () => {
    const r = feesView([{ unit: 'sat', active: true, inputFeePpk: 150 }]).rows[0]
    expect(r?.text).toBe('0.15 sat per coin · 150 ppk')
    expect(r?.examples).toBe('You pay (rounded up per payment): 1 / 3 / 15 sat for 1 / 16 / 100 coins')
  })
  it('the rate comes from the ACTIVE keyset, whatever the other keysets of the unit state (mint.macadamia.cash: 4 sat keysets, one active)', () => {
    const rate = (ks: { active: boolean; inputFeePpk: number | null }[]) => feesView(ks.map(k => ({ unit: 'sat', ...k }))).rows[0]?.text
    // inactive 0 ppk listed first, active 150 ppk
    expect(rate([{ active: false, inputFeePpk: 0 }, { active: true, inputFeePpk: 150 }])).toBe('0.15 sat per coin · 150 ppk')
    // the real shape: three inactive (150, 0, 0) and one active (150)
    expect(rate([{ active: false, inputFeePpk: 150 }, { active: false, inputFeePpk: 0 }, { active: false, inputFeePpk: 0 }, { active: true, inputFeePpk: 150 }])).toBe('0.15 sat per coin · 150 ppk')
    // an inactive keyset with a HIGHER fee does not raise the rate
    expect(rate([{ active: true, inputFeePpk: 150 }, { active: false, inputFeePpk: 5000 }])).toBe('0.15 sat per coin · 150 ppk')
  })
  it('several ACTIVE keysets of a unit with different fees: the highest is shown, never an average', () => {
    expect(feesView([{ unit: 'sat', active: true, inputFeePpk: 100 }, { unit: 'sat', active: true, inputFeePpk: 250 }]).rows[0]?.text).toBe('0.25 sat per coin · 250 ppk')
  })
  it('zero fee: "No input fee" and no examples line', () => {
    expect(feesView([{ unit: 'sat', active: true, inputFeePpk: 0 }]).rows[0]).toEqual({ unit: 'sat', text: NO_INPUT_FEE, examples: null })
  })
  it('several units: one row each', () => {
    const v = feesView([{ unit: 'usd', active: true, inputFeePpk: 0 }, { unit: 'sat', active: true, inputFeePpk: 1000 }])
    expect(v.rows.map(r => `${r.unit}: ${r.text}`)).toEqual(['sat: 1 sat per coin · 1000 ppk', `usd: ${NO_INPUT_FEE}`])
  })
  it('a keyset that states no fee uses the NUT-02 default 0: "No input fee"; a stated number in another unit is unchanged', () => {
    expect(feesView([{ unit: 'sat', active: true, inputFeePpk: null }]).rows.map(r => r.text)).toEqual([NO_INPUT_FEE])
    const v = feesView([{ unit: 'sat', active: true, inputFeePpk: null }, { unit: 'usd', active: true, inputFeePpk: 100 }])
    expect(v.rows.map(r => r.text)).toEqual([NO_INPUT_FEE, '0.1 cents per coin · 100 ppk'])
  })
  it('a missing fee on one active keyset does not lower the stated fee of another (max rule)', () => {
    expect(feesView([{ unit: 'sat', active: true, inputFeePpk: null }, { unit: 'sat', active: true, inputFeePpk: 100 }]).rows[0]?.text).toBe('0.1 sat per coin · 100 ppk')
  })
  it('no keysets: "Keyset data not available yet"; only inactive keysets: "No active keyset"', () => {
    expect(feesView(null).empty).toBe(FEES_NOT_CHECKED)
    expect(feesView([]).empty).toBe(FEES_NOT_CHECKED)
    expect(feesView([{ unit: 'sat', active: false, inputFeePpk: 5 }]).empty).toBe(FEES_NO_ACTIVE_KEYSET)
    expect(feesView([{ unit: 'sat', active: false, inputFeePpk: null }]).empty).toBe(FEES_NO_ACTIVE_KEYSET)
  })
})

describe('limitRows', () => {
  it('per method and unit, deposit first; an undeclared limit reads "not declared", never a number', () => {
    const rows = limitRows(
      [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 1000000 }, { method: 'bolt12', unit: 'sat', min_amount: 10 }],
      [{ method: 'bolt11', unit: 'sat' }],
    )
    expect(rows.map(r => `${r.label} | ${r.value}`)).toEqual([
      'Deposit (mint) · bolt11 · sat | min 1, max 1,000,000',
      `Deposit (mint) · bolt12 · sat | min 10, max ${LIMIT_NOT_DECLARED}`,
      `Withdrawal (melt) · bolt11 · sat | min ${LIMIT_NOT_DECLARED}, max ${LIMIT_NOT_DECLARED}`,
    ])
  })
  it('a value that is not a non-negative integer is "not declared"', () => {
    const [r] = limitRows([{ method: 'bolt11', unit: 'sat', min_amount: '5', max_amount: -3 }], [{ method: 'bolt11', unit: 'sat' }])
    expect(r?.value).toBe(`min ${LIMIT_NOT_DECLARED}, max ${LIMIT_NOT_DECLARED}`)
  })
  it('zero is a declared limit', () => {
    expect(limitRows([{ method: 'bolt11', unit: 'sat', min_amount: 0, max_amount: 0 }], null)[0]?.value).toBe('min 0, max 0')
  })
  it('a direction with no methods, or disabled, says so; units are ordered sat first', () => {
    expect(limitRows(null, null).map(r => r.value)).toEqual(['no methods declared', 'no methods declared'])
    expect(limitRows([{ method: 'bolt11', unit: 'sat', min_amount: 1 }], null, { mint: true }).map(r => r.value)).toEqual(['disabled by the mint', 'no methods declared'])
    const labels = limitRows([{ method: 'bolt11', unit: 'usd' }, { method: 'bolt11', unit: 'sat' }], null).map(r => r.label)
    expect(labels.slice(0, 2)).toEqual(['Deposit (mint) · bolt11 · sat', 'Deposit (mint) · bolt11 · usd'])
  })
  it('hostile method or unit text is dropped', () => {
    const rows = limitRows([{ method: '<img src=x>', unit: 'sat' }, { method: 'bolt11', unit: 'sat;drop' }], null)
    expect(rows[0]?.value).toBe('no methods declared')
  })
})

describe('source and note', () => {
  it('relative time with the absolute UTC time as title', () => {
    const now = Date.parse('2026-10-21T10:00:00Z')
    const s = limitsSource('2026-10-21T09:55:00Z', now)
    expect(s.text).toBe('declared by the mint in /v1/info')
    expect(s.time).toEqual({ label: '5 min ago', title: '21 Oct 2026, 09:55 UTC' })
    expect(limitsSource(null, now).time).toBeNull()
    expect(limitsSource('garbage', now).time).toBeNull()
  })
  it('the tooltip text says the mint declares the limits and names the quote-time fee reserves, within the tooltip length limit', () => {
    expect(LIMITS_NOTE).toBe('Limits are declared by the mint. Lightning fee reserves depend on the invoice and are known only when a quote is requested, so MintRadar does not show them.')
    expect(LIMITS_NOTE.length).toBeLessThanOrEqual(220)
  })
  it('reserves one line per listed unit, at least one', () => {
    expect(reservedFeeLines(['sat', 'usd'])).toBe(2)
    expect(reservedFeeLines(null)).toBe(1)
  })
})
