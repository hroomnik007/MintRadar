import { describe, it, expect } from 'vitest'
import { feesView, feeUnitLabel, limitRows, limitsSource, reservedFeeLines, FEES_NOT_CHECKED, FEES_NO_ACTIVE_KEYSET, NO_INPUT_FEE, LIMIT_NOT_DECLARED, LIMITS_NOTE } from '@/utils/feesLimits'
import { feeExamplesOf, inputFeeFor } from '@/utils/feeExamples'
import { FEE_PER_COIN_TEXT } from '@/utils/tooltipTexts'
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
  it('only the label changes: a usd fee keeps its numbers, never claims sat, and the rows use the plain word "coins"', () => {
    const v = feesView([{ unit: 'sat', active: true, inputFeePpk: 100 }, { unit: 'usd', active: true, inputFeePpk: 100 }, { unit: 'eur', active: true, inputFeePpk: 1000 }, { unit: 'lek', active: true, inputFeePpk: 100 }])
    expect(v.rows.map(r => `${r.unit}: ${r.text}`)).toEqual([
      'sat: Fee when you spend 1 / 16 / 100 coins: 1 / 2 / 10 sat',
      'eur: Fee when you spend 1 / 16 / 100 coins: 1 / 16 / 100 cents',
      'lek: Fee when you spend 1 / 16 / 100 coins: 1 / 2 / 10 lek',
      'usd: Fee when you spend 1 / 16 / 100 coins: 1 / 2 / 10 cents',
    ])
    for (const r of v.rows) expect(r.text).not.toMatch(/proof|ecash note/i)
  })
  it('the tooltip text is the approved plain-language explanation and avoids the technical words', () => {
    expect(FEE_PER_COIN_TEXT).toBe('Your balance is made of many small coins. When you pay, the mint charges a small fee for each coin used. Wallets can keep this low by holding fewer, larger coins.')
    expect(FEE_PER_COIN_TEXT).not.toMatch(/proof|ecash note/i)
  })
})

describe('feesView', () => {
  it('shows the fee for spending 1 / 16 / 100 coins in the unit, rounded up', () => {
    expect(feesView([{ unit: 'sat', active: true, inputFeePpk: 100 }])).toEqual({ rows: [{ unit: 'sat', text: 'Fee when you spend 1 / 16 / 100 coins: 1 / 2 / 10 sat' }], empty: null })
    expect(feesView([{ unit: 'sat', active: true, inputFeePpk: 999 }]).rows[0]?.text).toBe('Fee when you spend 1 / 16 / 100 coins: 1 / 16 / 100 sat')
  })
  it('zero fee: "No input fee"', () => {
    expect(feesView([{ unit: 'sat', active: true, inputFeePpk: 0 }]).rows[0]?.text).toBe(NO_INPUT_FEE)
  })
  it('several units: one row each', () => {
    const v = feesView([{ unit: 'usd', active: true, inputFeePpk: 0 }, { unit: 'sat', active: true, inputFeePpk: 1000 }])
    expect(v.rows.map(r => `${r.unit}: ${r.text}`)).toEqual(['sat: Fee when you spend 1 / 16 / 100 coins: 1 / 16 / 100 sat', `usd: ${NO_INPUT_FEE}`])
  })
  it('a keyset that states no fee uses the NUT-02 default 0: "No input fee"; a stated number in another unit is unchanged', () => {
    expect(feesView([{ unit: 'sat', active: true, inputFeePpk: null }]).rows).toEqual([{ unit: 'sat', text: NO_INPUT_FEE }])
    const v = feesView([{ unit: 'sat', active: true, inputFeePpk: null }, { unit: 'usd', active: true, inputFeePpk: 100 }])
    expect(v.rows.map(r => r.text)).toEqual([NO_INPUT_FEE, 'Fee when you spend 1 / 16 / 100 coins: 1 / 2 / 10 cents'])
  })
  it('a missing fee on one active keyset does not lower the stated fee of another (max rule)', () => {
    expect(feesView([{ unit: 'sat', active: true, inputFeePpk: null }, { unit: 'sat', active: true, inputFeePpk: 100 }]).rows[0]?.text).toBe('Fee when you spend 1 / 16 / 100 coins: 1 / 2 / 10 sat')
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
