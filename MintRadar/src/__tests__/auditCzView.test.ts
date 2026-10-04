import { describe, it, expect } from 'vitest'
import { adaptAuditCz, auditCzNeutralKind, auditCzSuccessTile, type AuditCzView } from '@/utils/auditCz'
import type { AuditCzData } from '@/hooks/useAuditCz'

type Row = AuditCzData['swaps'][number]
let n = 0
const row = (o: Partial<Row> = {}): Row => ({
  id: `x${n++}`, at: '2026-10-04T10:00:00Z', status: 'success', stage: null, error: null, amount: 10, fee: 1,
  durationMs: 900, direction: 'from', otherMintUrl: 'https://o.example', otherMintName: null, ...o,
})
const ok = (c: number) => Array.from({ length: c }, () => row())
const failed = (c: number, stage: string | null, error: string | null = null) =>
  Array.from({ length: c }, () => row({ status: 'failed', stage, error }))
const data = (swaps: Row[], detail7d?: AuditCzData['detail7d']): AuditCzData => ({
  source: 'audit.cashu.cz', sourceUrl: null, fetchedAt: null, covered: true,
  mint: { state: 'ok', uptime24h: 1, uptime7d: 1, uptime30d: 1, attributedFailures: 0, minted: 1, melted: 1, lastCheck: null },
  swaps, stats7d: null, ...(detail7d !== undefined ? { detail7d } : {}),
})
const view = (swaps: Row[], detail7d?: AuditCzData['detail7d']): AuditCzView => adaptAuditCz(data(swaps, detail7d), Date.now()) as AuditCzView
const tile = (swaps: Row[], detail7d?: AuditCzData['detail7d']) => {
  const t = auditCzSuccessTile(view(swaps, detail7d))
  return t.main ? `${t.main} · ${t.sub}` : t.sub
}

describe('Recent success rate tile = the displayed swaps minus the neutral ones', () => {
  it('Minibits-like: 5 OK + 3 melt failures -> 5 / 8 · 63% ok', () => {
    expect(tile([...ok(5), ...failed(3, 'melt', 'Payment failed')])).toBe('5 / 8 · 63% ok')
  })
  it('4 OK, 2 melt failures, 3 limits, 2 balance -> 4 / 6 · 67% ok', () => {
    expect(tile([...ok(4), ...failed(2, 'melt'), ...failed(3, 'limits'), ...failed(2, 'balance')])).toBe('4 / 6 · 67% ok')
  })
  it('pending swaps are not counted', () => {
    expect(tile([...ok(3), row({ status: 'pending' }), row({ status: 'pending' })])).toBe('3 / 3 · 100% ok')
  })
  it('every other stage and unknown tokens stay counted as failures', () => {
    expect(tile([...ok(2), ...failed(1, 'mint'), ...failed(1, 'mint_quote'), row({ status: 'cancelled' })])).toBe('2 / 5 · 40% ok')
  })
  it('counted below 3 -> n/a (also when only neutral rows exist)', () => {
    expect(tile([...ok(2), ...failed(5, 'limits')])).toBe('n/a')
    expect(tile([...failed(4, 'limits')])).toBe('n/a')
    expect(tile([])).toBe('n/a')
  })
  it('does not depend on the detail (errorsBlamed, success) at all', () => {
    const swaps = [...ok(5), ...failed(3, 'melt')]
    const d = { total: 179, success: 47, failed: 132, errorsBlamed: 0, minted: 26, melted: 21 }
    expect(tile(swaps, d)).toBe('5 / 8 · 63% ok')
    expect(tile(swaps, null)).toBe('5 / 8 · 63% ok')
  })
  it('still hands the detail on for the Mints / Melts tiles', () => {
    const v = view([], { total: 5, success: 1, failed: 4, errorsBlamed: 0, minted: 3, melted: 2 })
    expect(v.detail7d?.errorsBlamed).toBe(0)
    expect(v.nMints).toBe(3)
    expect(v.nMelts).toBe(2)
    expect(view([]).nMints).toBe(1) // list feed fallback
  })
  it('the table keeps listing every swap', () => {
    expect(view([...ok(2), ...failed(3, 'limits'), row({ status: 'pending' })]).swaps).toHaveLength(6)
  })
})

describe('neutral classification (adapter) and the error-text fallback', () => {
  const kind = (o: Partial<Row>) => view([row(o)]).swaps[0]?.neutral
  it('stage limits / balance / pending are neutral', () => {
    expect(kind({ status: 'failed', stage: 'limits' })).toBe('limits')
    expect(kind({ status: 'failed', stage: 'balance' })).toBe('balance')
    expect(kind({ status: 'pending' })).toBe('pending')
  })
  it('other failures and OK rows are not neutral', () => {
    expect(kind({ status: 'failed', stage: 'melt', error: 'Lightning payment failed: no_route' })).toBeUndefined()
    expect(kind({ status: 'failed', stage: 'mint' })).toBeUndefined()
    expect(kind({ status: 'failed', stage: null, error: 'Timeout' })).toBeUndefined()
    expect(kind({ status: 'success', stage: 'limits' })).toBeUndefined()
  })
  it('without a stage, the error text decides', () => {
    expect(kind({ status: 'failed', stage: null, error: 'Amount 61 sat is below the mint minimum of 100 sat' })).toBe('limits')
    expect(kind({ status: 'failed', stage: null, error: 'Insufficient balance: need 27 sat, have 20 sat' })).toBe('balance')
    expect(kind({ status: 'failed', stage: null, error: 'Amount 61 sat is fine' })).toBeUndefined()
    // a real stage wins over the text
    expect(kind({ status: 'failed', stage: 'melt', error: 'Insufficient balance: need 27 sat' })).toBeUndefined()
    expect(auditCzNeutralKind({ state: 'failed', stage: null, error: null })).toBeUndefined()
  })
  it('the text fallback feeds the tile too', () => {
    expect(tile([...ok(3), ...failed(2, null, 'Amount 61 sat is below the mint minimum of 100 sat')])).toBe('3 / 3 · 100% ok')
  })
})

describe('sinceLabel', () => {
  it('is the date of the oldest swap in the list (UTC)', () => {
    expect(view([row({ at: '2026-10-04T10:00:00Z' }), row({ at: '2026-10-02T23:30:00Z' })]).sinceLabel).toBe('2 Oct')
    expect(view([]).sinceLabel).toBeNull()
  })
})
