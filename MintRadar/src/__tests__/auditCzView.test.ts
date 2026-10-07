import { describe, it, expect } from 'vitest'
import { adaptAuditCz, auditCzChecks, auditCzNeutralKind, auditCzStateTitle, cleanAuditError, formatAvgSwapTime, type AuditCzView } from '@/utils/auditCz'
import type { AuditCzData, AuditCzDetail } from '@/hooks/useAuditCz'

type Row = AuditCzData['swaps'][number]
let n = 0
const row = (o: Partial<Row> = {}): Row => ({
  id: `x${n++}`, at: '2026-10-04T10:00:00Z', status: 'success', stage: null, error: null, amount: 10, fee: 1,
  durationMs: 900, direction: 'from', otherMintUrl: 'https://o.example', otherMintName: null, ...o,
})
const ok = (c: number) => Array.from({ length: c }, () => row())
const failed = (c: number, stage: string | null, error: string | null = null) =>
  Array.from({ length: c }, () => row({ status: 'failed', stage, error }))

// The stored subset of the real mint.lnpay.cz detail.
const LNPAY: AuditCzDetail = {
  swaps7d: {
    all: { total: 126, success: 107, failed: 19, avgMs: 8289 },
    asSource: { total: 64, success: 51, failed: 13, avgMs: 11719 },
    asDest: { total: 62, success: 56, failed: 6, avgMs: 5166 },
    errorsBlamed: 0, dleq: { valid: 56, invalid: 0, missing: 0 }, quoteMs: 306, meltMs: 1342, mintMs: 166,
  },
  integrity: { proof_state: { ok: true, checked: 9, spent: 0, spentSat: 0, pending: 0 } },
  network: { ipv4: true, ipv6: true, asn: 14061, asName: 'DIGITALOCEAN-ASN - DigitalOcean, LLC, US', country: 'US' },
  fetchedAt: '2026-10-07T07:00:00.000Z',
}
const data = (swaps: Row[], detail: AuditCzData['detail'] = LNPAY, over: Partial<AuditCzData> = {}): AuditCzData => ({
  source: 'audit.cashu.cz', sourceUrl: null, fetchedAt: '2026-10-07T07:05:00.000Z', covered: true,
  mint: { state: 'ok', uptime24h: 1, uptime7d: 1, uptime30d: 1, attributedFailures: 0, minted: 1, melted: 1, lastCheck: null },
  swaps, stats7d: null, detail, ...over,
})
const view = (swaps: Row[], detail: AuditCzData['detail'] = LNPAY, over: Partial<AuditCzData> = {}, now = Date.parse('2026-10-07T07:30:00Z')): AuditCzView =>
  adaptAuditCz(data(swaps, detail, over), now) as AuditCzView
const tiles = (d: AuditCzDetail) => Object.fromEntries(view([], d).tiles.map(t => [t.key, t]))

describe('tiles from the stored detail (LNpay values)', () => {
  it('fractions, attributed caption and average time', () => {
    const t = tiles(LNPAY)
    expect(t['melts']).toMatchObject({ value: '51 / 64', label: 'Paid out melts' })
    expect(t['mints']).toMatchObject({ value: '56 / 62', label: 'Received mints' })
    expect(t['attributed']).toMatchObject({ value: '0', label: 'Attributed of 19 failed swaps' })
    expect(t['avg']).toMatchObject({ value: '8.3 s', label: 'Avg swap time' })
    expect(view([]).tiles.map(x => x.key)).toEqual(['melts', 'mints', 'attributed', 'avg'])
  })
  it('singular caption for one failed swap', () => {
    expect(tiles({ ...LNPAY, swaps7d: { ...LNPAY.swaps7d, all: { failed: 1 } } })['attributed']?.label).toBe('Attributed of 1 failed swap')
  })
  it('a tile whose field is missing is hidden', () => {
    expect(Object.keys(tiles({ fetchedAt: null, swaps7d: { asSource: { success: 1, total: 2 } } }))).toEqual(['melts'])
    expect(Object.keys(tiles({ fetchedAt: null, swaps7d: { asDest: { success: 3 } } }))).toEqual([])
    expect(Object.keys(tiles({ fetchedAt: null, network: { asn: 1 } }))).toEqual([])
    expect(tiles({ fetchedAt: null, swaps7d: { errorsBlamed: 2 } })['attributed']?.label).toBe('Attributed')
  })
  it('formats the average: seconds with one decimal, under a second in ms', () => {
    expect(formatAvgSwapTime(8289)).toBe('8.3 s')
    expect(formatAvgSwapTime(4868)).toBe('4.9 s')
    expect(formatAvgSwapTime(999.4)).toBe('999 ms')
    expect(formatAvgSwapTime(999.6)).toBe('1.0 s')
    expect(formatAvgSwapTime(0)).toBe('0 ms')
  })
  it('tooltips are the honest wording', () => {
    const t = tiles(LNPAY)
    expect(t['melts']?.tooltip).toBe('Swaps in the last 7 days in which this mint paid out a Lightning invoice, counted by cashu.info (successful of all)')
    expect(t['mints']?.tooltip).toBe('Swaps in the last 7 days in which this mint received ecash from another mint (successful of all)')
    expect(t['attributed']?.tooltip).toContain('Failures that cashu.info attributes to this mint.')
    expect(t['avg']?.tooltip).toBe('Average swap time over the last 7 days as reported by cashu.info.')
    expect(t['avg']?.tooltip).not.toMatch(/successful swaps/)
  })
  it('not covered or no detail stored: no view (the 8333 panel or the empty panel stays)', () => {
    expect(adaptAuditCz(data([], null), Date.now())).toBeNull()
    expect(adaptAuditCz({ ...data([]), detail: undefined } as unknown as AuditCzData, Date.now())).toBeNull()
    expect(adaptAuditCz({ ...data([]), covered: false, mint: null }, Date.now())).toBeNull()
  })
})

describe('Checks by the auditor', () => {
  const c = (o: Partial<AuditCzDetail>) => auditCzChecks({ fetchedAt: null, ...o })
  it('good state', () => {
    expect(c(LNPAY)).toEqual({
      signatures: 'Proof signatures 56 valid, 0 invalid — the mint signed them with its published key.',
      proofs: 'Our ecash 9 proofs still unspent — the mint has not marked them spent.',
    })
  })
  it('invalid signatures: no accusation words, missing appended', () => {
    const r = c({ swaps7d: { dleq: { valid: 40, invalid: 3, missing: 2 } } })
    expect(r?.signatures).toBe("Proof signatures 40 valid, 3 invalid — some signatures did not verify against the mint's published key. 2 without a proof.")
    expect(r?.signatures).not.toMatch(/fraud|cheat|fake|scam|steal/i)
  })
  it('spent and pending proofs', () => {
    expect(c({ integrity: { proof_state: { checked: 9, spent: 2, pending: 1 } } })?.proofs).toBe("2 of the auditor's 9 proofs were marked spent by the mint. 1 pending.")
    expect(c({ integrity: { proof_state: { checked: 9, spent: 0, pending: 2 } } })?.proofs).toBe('Our ecash 9 proofs still unspent — the mint has not marked them spent. 2 pending.')
  })
  it('lines without data are hidden, and the whole card when both are', () => {
    expect(c({ swaps7d: { dleq: { valid: 0, invalid: 0, missing: 0 } }, integrity: { proof_state: { checked: 0 } } })).toBeNull()
    expect(c({ network: { asn: 1 } })).toBeNull()
    expect(c({ integrity: { proof_state: { checked: 4, spent: 0, pending: 0 } } })).toEqual({ signatures: null, proofs: 'Our ecash 4 proofs still unspent — the mint has not marked them spent.' })
    expect(c({ swaps7d: { dleq: { valid: 5 } } })?.proofs).toBeNull()
    expect(view([], { fetchedAt: null, network: { asn: 1 } }).checks).toBeNull()
  })
  it('no swap-test line', () => {
    const r = c({ ...LNPAY, integrity: { swap_test: { ok: false, recentFail: 7 }, proof_state: LNPAY.integrity?.proof_state ?? {} } })
    expect(JSON.stringify(r)).not.toMatch(/swap test|swap_test/i)
  })
  it('hostile numbers cannot inject text (only numbers are interpolated)', () => {
    const r = c({ swaps7d: { dleq: { valid: '<b>1</b>' as unknown as number, invalid: 0, missing: 0 } } })
    expect(r).toBeNull()
  })
})

describe('the two tables, the bar rows and the freshness', () => {
  const mixed = [row({ direction: 'from', otherMintUrl: 'https://dest.example' }), row({ direction: 'to', otherMintUrl: 'https://src.example' }), row({ direction: 'from' })]
  it('splits by direction and keeps all rows for the bar, newest first order preserved', () => {
    const v = view(mixed)
    expect(v.swaps).toHaveLength(3)
    expect(v.fromRows.map(r => r.toUrl)).toEqual(['https://dest.example', 'https://o.example'])
    expect(v.toRows.map(r => r.toUrl)).toEqual(['https://src.example'])
  })
  it('collected since: only when the oldest stored swap is newer than 7 days', () => {
    const stats = (collectedSince: string | null) => ({ stats7d: { windowDays: 7 as const, collectedSince, melts: { paid: 0, failed: 0, pending: 0, amountPaid: 0, feesPaid: 0 }, mints: { paid: 0, failed: 0, pending: 0, amountPaid: 0, feesPaid: 0 }, avgDurationMsPaid: null, swapsCounted: 0 } })
    expect(view([], LNPAY, stats('2026-10-04T10:00:00Z')).collectedSince).toBe('4 Oct')
    expect(view([], LNPAY, stats('2026-09-20T10:00:00Z')).collectedSince).toBeNull()
    expect(view([], LNPAY, stats(null)).collectedSince).toBeNull()
    expect(view([]).collectedSince).toBeNull()
  })
  it('not updated recently only after 90 minutes (from the stored detail)', () => {
    expect(view([], LNPAY, {}, Date.parse('2026-10-07T08:29:00Z')).notRecent).toBe(false)
    expect(view([], LNPAY, {}, Date.parse('2026-10-07T08:31:00Z')).notRecent).toBe(true)
    expect(view([], { ...LNPAY, fetchedAt: null }, { fetchedAt: '2026-10-07T07:00:00Z' }, Date.parse('2026-10-07T09:00:00Z')).notRecent).toBe(true)
    expect(view([], { ...LNPAY, fetchedAt: null }, { fetchedAt: null }).notRecent).toBe(false)
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
  it('the text fallback classifies the rows', () => {
    expect(view([...ok(3), ...failed(2, null, 'Amount 61 sat is below the mint minimum of 100 sat')]).swaps.filter(s => s.neutral === 'limits')).toHaveLength(2)
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
