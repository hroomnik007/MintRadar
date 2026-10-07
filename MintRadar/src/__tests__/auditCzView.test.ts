import { describe, it, expect } from 'vitest'
import { adaptAuditCz, auditCzNeutralKind, auditCzStateTitle, auditCzSuccessTile, cleanAuditError, type AuditCzView } from '@/utils/auditCz'
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

describe('failure reason of a swap (State cell tooltip + hidden text)', () => {
  const one = (o: Partial<Row>) => view([row(o)]).swaps[0]!

  it('cleanAuditError strips control / bidi characters and collapses whitespace', () => {
    expect(cleanAuditError('  Lightning payment\n failed:\t no_route.  ')).toBe('Lightning payment failed: no_route.')
    expect(cleanAuditError('a\u0000b\u202Ec\u200Bd\u007f')).toBe('abcd')
    expect(cleanAuditError('\u0001\u0002 \n')).toBeNull()
    expect(cleanAuditError(null)).toBeNull()
    expect(cleanAuditError('x'.repeat(500))).toHaveLength(300)
  })
  it('keeps hostile markup as plain characters', () => {
    expect(cleanAuditError('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
  })
  it('only rows that are not OK carry a reason', () => {
    expect(one({ status: 'success', error: 'should not show' }).reason).toBeUndefined()
    expect(one({ status: 'failed', stage: 'melt', error: 'Payment failed' }).reason).toBe('Payment failed')
    expect(one({ status: 'failed', stage: 'melt', error: null }).reason).toBeUndefined()
    expect(one({ status: 'failed', stage: 'melt', error: '\n \u0001' }).reason).toBeUndefined()
  })
  it('title: red rows carry the text alone, truncated to 200 characters', () => {
    expect(auditCzStateTitle(one({ status: 'failed', stage: 'melt', error: 'Timeout after 60s' }))).toBe('Timeout after 60s')
    const long = auditCzStateTitle(one({ status: 'failed', stage: 'melt', error: 'e'.repeat(300) }))!
    expect(long).toHaveLength(200)
    expect(long.endsWith('…')).toBe(true)
    expect(auditCzStateTitle(one({ status: 'failed', stage: 'melt', error: 'x'.repeat(200) }))).toHaveLength(200)
  })
  it('title: grey rows start with the fixed explanation, then the text', () => {
    expect(auditCzStateTitle(one({ status: 'failed', stage: 'limits', error: 'Amount 61 sat is below the mint minimum of 100 sat' })))
      .toBe("Not counted against the mint: the auditor's test was below the mint's minimum amount. Amount 61 sat is below the mint minimum of 100 sat")
    expect(auditCzStateTitle(one({ status: 'failed', stage: 'balance', error: null })))
      .toBe("Not counted against the mint: the auditor's wallet had too little balance")
  })
  it('no title for OK rows, pending without text, and rows without a reason (8333 rows)', () => {
    expect(auditCzStateTitle(one({}))).toBeUndefined()
    expect(auditCzStateTitle(one({ status: 'pending' }))).toBeUndefined()
    expect(auditCzStateTitle({ state: 'failed' })).toBeUndefined()
  })
})

describe('sourceHref accepts only https://cashu.info/mint/<id>', () => {
  const href = (sourceUrl: string | null) => (adaptAuditCz({ ...data(ok(1)), sourceUrl }, Date.now()) as AuditCzView).sourceHref
  it('keeps the exact page URL', () => {
    expect(href('https://cashu.info/mint/cmmx4oml50000a5l3z6b7qr83')).toBe('https://cashu.info/mint/cmmx4oml50000a5l3z6b7qr83')
  })
  it.each([
    'http://cashu.info/mint/abc12345',
    'https://cashu.info.evil.example/mint/abc12345',
    'https://evilcashu.info/mint/abc12345',
    'https://cashu.info@evil.example/mint/abc12345',
    'https://evil.example/https://cashu.info/mint/abc12345',
    'https://audit.cashu.cz/mint/abc12345',
    'https://cashu.info/mint/abc',
    'https://cashu.info/mint/abc12345/extra',
    'https://cashu.info/other/abc12345',
    'javascript:alert(1)',
    null,
  ])('rejects %s', u => { expect(href(u)).toBeNull() })
})
