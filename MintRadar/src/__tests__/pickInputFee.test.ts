import { describe, it, expect } from 'vitest'
import { pickInputFee, formatKeysetFee, compareFeeText } from '@/utils/mintProbeDisplay'

const ks = (id: string, unit: string, active: boolean, fee?: number) => ({ id, unit, active, ...(fee !== undefined ? { input_fee_ppk: fee } : {}) })

describe('pickInputFee', () => {
  it('uses the active sat keyset and formats like Mint Detail', () => {
    expect(pickInputFee([ks('a', 'sat', true, 100)])).toMatchObject({ label: '100 ppk', unit: 'sat' })
    expect(pickInputFee([ks('a', 'sat', true, 0)])).toMatchObject({ label: 'free', unit: 'sat' })
    expect(formatKeysetFee(0)).toBe('free')
  })
  it('ignores inactive keysets', () => {
    expect(pickInputFee([ks('old', 'sat', false, 500), ks('new', 'sat', true, 100)])).toMatchObject({ label: '100 ppk', unit: 'sat' })
  })
  it('prefers sat over other units; falls back to the first active unit', () => {
    expect(pickInputFee([ks('u', 'usd', true, 10), ks('s', 'sat', true, 100)])).toMatchObject({ label: '100 ppk', unit: 'sat' })
    expect(pickInputFee([ks('u', 'usd', true, 10)])).toMatchObject({ label: '10 ppk', unit: 'usd' })
  })
  it('shows a range when several active keysets of the unit disagree', () => {
    expect(pickInputFee([ks('a', 'sat', true, 0), ks('b', 'sat', true, 100)])).toMatchObject({ label: '0–100 ppk', unit: 'sat' })
    expect(pickInputFee([ks('a', 'sat', true, 100), ks('b', 'sat', true, 100)])).toMatchObject({ label: '100 ppk', unit: 'sat' })
  })
  it('returns null (n/a) when unknown', () => {
    expect(pickInputFee(null)).toBeNull()
    expect(pickInputFee(undefined)).toBeNull()
    expect(pickInputFee([])).toBeNull()
    expect(pickInputFee([ks('a', 'sat', true)])).toBeNull()
    expect(pickInputFee([ks('a', 'sat', false, 100)])).toBeNull()
  })
})

describe('compareFeeText (Compare redesign 2026-11-28)', () => {
  it('reads free, a rate per coin in the unit, or a ppk range', () => {
    expect(compareFeeText(pickInputFee([ks('a', 'sat', true, 0)])!)).toBe('free')
    expect(compareFeeText(pickInputFee([ks('a', 'sat', true, 200)])!)).toBe('0.2 sat per coin')
    expect(compareFeeText(pickInputFee([ks('a', 'usd', true, 250)])!)).toBe('0.25 cents per coin')
    expect(compareFeeText(pickInputFee([ks('a', 'sat', true, 0), ks('b', 'sat', true, 100)])!)).toBe('0–100 ppk')
  })
})
