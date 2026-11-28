import { describe, it, expect } from 'vitest'
import { compareMethodRows, compactAmount } from '@/utils/compareMethodRows'

// Compare, "Deposits and withdrawals" (redesign 2026-11-28): one row per method, cells from limitTable().
const m = (method: string, unit: string, min?: number, max?: number) => ({ method, unit, ...(min !== undefined ? { min_amount: min } : {}), ...(max !== undefined ? { max_amount: max } : {}) })
const minibits = { mintMethods: [m('bolt11', 'sat', 1, 1000000), m('onchain', 'sat', 10000, 5000000)], meltMethods: [m('bolt11', 'sat', 1, 1000000), m('onchain', 'sat', 10000, 1000000)], nutsLimits: null }
const cashuCz = { mintMethods: [m('bolt11', 'sat')], meltMethods: [m('bolt11', 'sat')], nutsLimits: null }

describe('compareMethodRows', () => {
  it('a row per method, Lightning first, every compared mint gets a cell', () => {
    const rows = compareMethodRows([minibits, cashuCz])
    expect(rows.map(r => r.label)).toEqual(['Lightning', 'On-chain'])
    expect(rows[0]!.cells.map(c => c.map(l => l.text))).toEqual([['1 to 1M sat'], ['no limits declared']])
    expect(rows[1]!.cells[0]!.map(l => [l.side, l.text])).toEqual([['in', '10k to 5M sat'], ['out', '10k to 1M sat']])
    expect(rows[1]!.cells[1]).toEqual([{ text: 'not offered', muted: true }])
  })

  it('the keys differ when the cells do, so "Only differences" keeps the row', () => {
    const rows = compareMethodRows([minibits, cashuCz])
    expect(new Set(rows[0]!.keys).size).toBe(2)
    expect(compareMethodRows([cashuCz, cashuCz])[0]!.keys).toEqual(['no limits declared', 'no limits declared'])
  })

  it('several units of one method are named, a side the mint switched off says so', () => {
    const forge = { mintMethods: [m('bolt11', 'sat', 0, 10000000), m('bolt11', 'usd', 0, 1000000)], meltMethods: [m('bolt11', 'sat'), m('bolt11', 'usd')], nutsLimits: null }
    const line = (l: { side?: string; text: string }) => (l.side ? `${l.side} ${l.text}` : l.text)
    expect(compareMethodRows([forge])[0]!.cells[0]!.map(line)).toEqual(['in 0 to 10M sat', 'out no limits declared (sat)', 'in 0 to 1M usd', 'out no limits declared (usd)'])
    const off = { ...cashuCz, nutsLimits: { '4': { disabled: true } } }
    expect(compareMethodRows([off])[0]!.cells[0]!.map(line)).toEqual(['in disabled by the mint', 'out no limits declared'])
    expect(compareMethodRows([off])[0]!.cells[0]!.every(l => l.muted)).toBe(true)
  })

  it('amounts are short only when exact: 10k, 5M, 1.5k, 500k; 12,345 and 999 stay as they are', () => {
    expect([10000, 5000000, 1500, 500000, 2100000, 12345, 999, 0, 1].map(compactAmount)).toEqual(['10k', '5M', '1.5k', '500k', '2.1M', '12,345', '999', '0', '1'])
  })
})
