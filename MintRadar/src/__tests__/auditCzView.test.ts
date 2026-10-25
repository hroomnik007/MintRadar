import { describe, it, expect } from 'vitest'
import { adaptAuditCz, auditCzNeutralKind, auditCzSyncNote, AUDIT_CZ_NOT_RECENT_TEXT, auditCzStateTitle, cleanAuditError, formatAvgSwapTime, formatSwapDuration, type AuditCzView } from '@/utils/auditCz'
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
    errorsBlamed: 0, dleq: { valid: 56, invalid: 0, missing: 0 },
  },
  integrity: { proof_state: { checked: 9, spent: 0, pending: 0 } },
  fetchedAt: '2026-10-07T07:00:00.000Z',
}
const data = (swaps: Row[], detail: AuditCzData['detail'] = LNPAY, over: Partial<AuditCzData> = {}): AuditCzData => ({
  source: 'cashu.info', sourceUrl: null, fetchedAt: '2026-10-07T07:05:00.000Z', covered: true,
  mint: { state: 'ok', uptime24h: 1, uptime7d: 1, uptime30d: 1, attributedFailures: 0, minted: 1, melted: 1, lastCheck: null },
  swaps, stats7d: null, detail, ...over,
})
const view = (swaps: Row[], detail: AuditCzData['detail'] = LNPAY, over: Partial<AuditCzData> = {}, now = Date.parse('2026-10-07T07:30:00Z')): AuditCzView =>
  adaptAuditCz(data(swaps, detail, over), now) as AuditCzView
const tiles = (d: AuditCzDetail) => Object.fromEntries(view([], d).tiles.map(t => [t.key, t]))

describe('tiles from the stored detail (LNpay values)', () => {
  it('fractions, the one success tile and average time', () => {
    const t = tiles(LNPAY)
    expect(t['mints']).toMatchObject({ value: '56 / 62', label: 'Deposits (mint)', sub: '6 failed' })
    expect(t['melts']).toMatchObject({ value: '51 / 64', label: 'Withdrawals (melt)', sub: '13 failed' })
    expect(t['clean']).toMatchObject({ value: '100%', label: 'Without a failure caused by this mint', tooltip: '126 of 126 swaps in the last 7 days, 19 failed for other reasons' })
    expect(t['clean']).not.toHaveProperty('caption')
    expect(t['clean']).not.toHaveProperty('captionNote')
    expect(t['avg']).toMatchObject({ value: '8.3 s', label: 'Avg swap time' })
    // four tiles, no overall "Success rate" that mixes in unattributed failures
    expect(view([]).tiles.map(x => x.key)).toEqual(['mints', 'melts', 'clean', 'avg'])
    expect(view([]).tiles.map(x => x.label)).not.toContain('Success rate')
  })
  it('success tile: LNpay-like, 0 blamed of 105 with 16 failed', () => {
    const t = tiles({ ...LNPAY, swaps7d: { ...LNPAY.swaps7d, all: { total: 105, success: 89, failed: 16 }, errorsBlamed: 0 } })['clean']
    expect(t).toMatchObject({ value: '100%', tooltip: '105 of 105 swaps in the last 7 days, 16 failed for other reasons' })
  })
  it('success tile: lnw.cash-like, 202 blamed of 229 with 207 failed', () => {
    const t = tiles({ ...LNPAY, swaps7d: { ...LNPAY.swaps7d, all: { total: 229, success: 22, failed: 207 }, errorsBlamed: 202 } })['clean']
    expect(t).toMatchObject({ value: '12%', tooltip: '27 of 229 swaps in the last 7 days, 202 attributed to this mint, 5 other failures' })
  })
  it('success tile: 1 blamed of 200 shows 99%, never 100%', () => {
    const t = tiles({ ...LNPAY, swaps7d: { ...LNPAY.swaps7d, all: { total: 200, success: 199, failed: 1 }, errorsBlamed: 1 } })['clean']
    expect(t).toMatchObject({ value: '99%', tooltip: '199 of 200 swaps in the last 7 days, 1 attributed to this mint' })
  })
  it('success tile: singular forms, no failures, never "x / y"', () => {
    const oneOther = tiles({ ...LNPAY, swaps7d: { ...LNPAY.swaps7d, all: { total: 50, success: 49, failed: 1 }, errorsBlamed: 0 } })['clean']
    expect(oneOther?.tooltip).toBe('50 of 50 swaps in the last 7 days, 1 failed for other reasons')
    const one = tiles({ ...LNPAY, swaps7d: { ...LNPAY.swaps7d, all: { total: 50, success: 47, failed: 3 }, errorsBlamed: 2 } })['clean']
    expect(one?.tooltip).toBe('48 of 50 swaps in the last 7 days, 2 attributed to this mint, 1 other failure')
    const none = tiles({ ...LNPAY, swaps7d: { ...LNPAY.swaps7d, all: { total: 50, success: 50, failed: 0 }, errorsBlamed: 0 } })['clean']
    expect(none).toMatchObject({ value: '100%', tooltip: '50 of 50 swaps in the last 7 days' })
    for (const t of [one, none, oneOther]) expect(t?.value).not.toContain('/')
  })
  it('success tile: fewer than 10 swaps still shows the number', () => {
    const t = tiles({ ...LNPAY, swaps7d: { ...LNPAY.swaps7d, all: { total: 4, success: 4, failed: 0 }, errorsBlamed: 0 } })['clean']
    expect(t).toMatchObject({ value: '100%', tooltip: '4 of 4 swaps in the last 7 days' })
  })
  it('success tile: hostile numbers are clamped or hide the tile', () => {
    const w = (all: Record<string, unknown>, errorsBlamed: unknown) => tiles({ ...LNPAY, swaps7d: { ...LNPAY.swaps7d, all, errorsBlamed } } as AuditCzDetail)['clean']
    expect(w({ total: 20, failed: 20 }, 999)).toMatchObject({ value: '0%', tooltip: '0 of 20 swaps in the last 7 days, 20 attributed to this mint' })
    expect(w({ total: 0, failed: 0 }, 0)).toBeUndefined()
    expect(w({ total: NaN }, 0)).toBeUndefined()
    expect(w({ total: -5 }, 0)).toBeUndefined()
    expect(w({ total: 20 }, NaN)).toBeUndefined()
    expect(w({ total: 20 }, -1)).toBeUndefined()
    expect(w({ total: 20, failed: -3 }, 0)).toMatchObject({ value: '100%', tooltip: '20 of 20 swaps in the last 7 days' })
  })
  it('a direction without numbers reads "No data"; the other tiles are hidden when their field is missing', () => {
    const keys = (d: AuditCzDetail) => view([], d).tiles.map(t => t.key)
    const dir = (d: AuditCzDetail) => tiles(d)
    expect(dir({ fetchedAt: null, swaps7d: { asSource: { success: 1, total: 2 } } })['mints']).toMatchObject({ value: 'No data', noData: true })
    expect(dir({ fetchedAt: null, swaps7d: { asSource: { success: 1, total: 2 } } })['melts']).toMatchObject({ value: '1 / 2' })
    expect(dir({ fetchedAt: null, swaps7d: { asDest: { success: 3 } } })['mints']).toMatchObject({ value: 'No data' })
    expect(dir({ fetchedAt: null, swaps7d: { asDest: { success: -3, total: 4 } } })['mints']).toMatchObject({ value: 'No data' })
    // no swaps block at all: the two direction tiles say "No data", nothing else is invented
    expect(keys({ fetchedAt: null })).toEqual(['mints', 'melts'])
    expect(dir({ fetchedAt: null })['melts']).toMatchObject({ value: 'No data' })
    expect(keys({ fetchedAt: null, swaps7d: { errorsBlamed: 2 } })).toEqual(['mints', 'melts'])
    expect(keys({ fetchedAt: null, swaps7d: { all: { total: 9 } } })).toEqual(['mints', 'melts'])
  })
  it('"N failed" only for a direction that has failures; one small sample is shown as it is', () => {
    const t = tiles({ fetchedAt: null, swaps7d: { asSource: { total: 10, success: 10, failed: 0 }, asDest: { total: 1, success: 0, failed: 1 } } })
    expect(t['melts']).toMatchObject({ value: '10 / 10' })
    expect(t['melts']).not.toHaveProperty('sub')
    expect(t['mints']).toMatchObject({ value: '0 / 1', sub: '1 failed' })
    // no failed count sent: no subtext, never a number derived from the others
    expect(tiles({ fetchedAt: null, swaps7d: { asSource: { total: 10, success: 7 } } })['melts']).not.toHaveProperty('sub')
    // a hostile failed count above the attempts is clamped
    expect(tiles({ fetchedAt: null, swaps7d: { asSource: { total: 3, success: 0, failed: 99 } } })['melts']).toMatchObject({ sub: '3 failed' })
  })
  it('formats the average: seconds with one decimal, under a second in ms', () => {
    expect(formatAvgSwapTime(8289)).toBe('8.3 s')
    expect(formatAvgSwapTime(4868)).toBe('4.9 s')
    expect(formatAvgSwapTime(999.4)).toBe('999 ms')
    expect(formatAvgSwapTime(999.6)).toBe('1.0 s')
    expect(formatAvgSwapTime(0)).toBe('0 ms')
  })
  it('formats a swap duration: ms under a minute, a short human form from a minute on', () => {
    expect(formatSwapDuration(0)).toBe('0 ms')
    expect(formatSwapDuration(1759)).toBe('1759 ms')
    expect(formatSwapDuration(59999)).toBe('59999 ms')
    expect(formatSwapDuration(60000)).toBe('1 min')
    expect(formatSwapDuration(62000)).toBe('1 min 2 s')
    expect(formatSwapDuration(3599999)).toBe('59 min 59 s')
    expect(formatSwapDuration(3600000)).toBe('1 h')
    expect(formatSwapDuration(17289722)).toBe('4 h 48 min')
    expect(formatSwapDuration(86399999)).toBe('23 h 59 min')
    expect(formatSwapDuration(86400000)).toBe('1 d')
    expect(formatSwapDuration(183600000)).toBe('2 d 3 h')
  })
  it('tooltips are the honest wording', () => {
    const t = tiles(LNPAY)
    expect(t['mints']?.tooltip).toBe('Deposits into this mint (mint operations) in the last 7 days, counted by cashu.info: successful of all.')
    expect(t['melts']?.tooltip).toBe('Withdrawals from this mint (melt operations) in the last 7 days, counted by cashu.info: successful of all.')
    expect(t['clean']?.tooltip).toBe('126 of 126 swaps in the last 7 days, 19 failed for other reasons')
    // The Avg swap time tile has no ⓘ: its label says it, the window and source are in the sibling tooltips.
    expect(t['avg']?.tooltip).toBeUndefined()
  })
  it('not covered or no detail stored: no view (the 8333 panel or the empty panel stays)', () => {
    expect(adaptAuditCz(data([], null), Date.now())).toBeNull()
    expect(adaptAuditCz({ ...data([]), detail: undefined } as unknown as AuditCzData, Date.now())).toBeNull()
    expect(adaptAuditCz({ ...data([]), covered: false, mint: null }, Date.now())).toBeNull()
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
  it('not updated recently only after 90 minutes (from the stored detail)', () => {
    expect(view([], LNPAY, {}, Date.parse('2026-10-07T08:29:00Z')).notRecent).toBe(false)
    expect(view([], LNPAY, {}, Date.parse('2026-10-07T08:31:00Z')).notRecent).toBe(true)
    expect(view([], { ...LNPAY, fetchedAt: null }, { fetchedAt: '2026-10-07T07:00:00Z' }, Date.parse('2026-10-07T09:00:00Z')).notRecent).toBe(true)
    expect(view([], { ...LNPAY, fetchedAt: null }, { fetchedAt: null }).notRecent).toBe(false)
  })
  it('header sync note: "synced …" while fresh, "not updated recently" (stale) after 90 minutes, nothing without a time', () => {
    const at = (iso: string) => Date.parse(iso)
    expect(auditCzSyncNote(view([], LNPAY, {}, at('2026-10-07T07:30:00Z')), at('2026-10-07T07:30:00Z'))).toEqual({ text: 'synced 30 min ago', stale: false })
    expect(auditCzSyncNote(view([], LNPAY, {}, at('2026-10-07T08:29:00Z')), at('2026-10-07T08:29:00Z'))).toEqual({ text: 'synced 1h ago', stale: false })
    expect(auditCzSyncNote(view([], LNPAY, {}, at('2026-10-07T08:31:00Z')), at('2026-10-07T08:31:00Z'))).toEqual({ text: AUDIT_CZ_NOT_RECENT_TEXT, stale: true })
    expect(AUDIT_CZ_NOT_RECENT_TEXT).toBe('not updated recently')
    expect(auditCzSyncNote({ checkedAt: null, notRecent: false }, at('2026-10-07T08:00:00Z'))).toBeNull()
    expect(auditCzSyncNote({ checkedAt: 'garbage', notRecent: false }, at('2026-10-07T08:00:00Z'))).toBeNull()
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
