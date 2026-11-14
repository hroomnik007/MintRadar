import { describe, it, expect } from 'vitest'
import { adaptAuditCz, auditCzNeutralKind, auditCzSyncNote, AUDIT_CZ_NOT_RECENT_TEXT, auditCzStateTitle, cleanAuditError, formatAvgSwapTime, formatSwapDuration, filterAuditSwaps, auditVerdictHeadline, auditVerdictDetail, auditLongLine, auditSinceLine, type AuditCzView } from '@/utils/auditCz'
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
const dirs = (d: AuditCzDetail) => Object.fromEntries(view([], d).directions.map(t => [t.key, t]))
const verdict = (all: Record<string, unknown>, errorsBlamed: unknown) => view([], { ...LNPAY, swaps7d: { ...LNPAY.swaps7d, all, errorsBlamed } } as AuditCzDetail).verdict

describe('verdict, directions and average from the stored detail (LNpay values)', () => {
  it('the verdict is the numbers the score reads; directions and the average come from the same detail', () => {
    const v = view([])
    expect(v.verdict).toEqual({ total: 126, blamed: 0, failedElsewhere: 19, ok: 107 })
    expect(auditVerdictHeadline(v.verdict!)).toBe('of 126 swaps failed because of this mint')
    expect(auditVerdictDetail(v.verdict!)).toBe('19 swaps failed for other reasons and do not count against it.')
    expect(dirs(LNPAY)['mints']).toMatchObject({ label: 'Deposits (mint)', ok: 56, total: 62, failed: 6 })
    expect(dirs(LNPAY)['melts']).toMatchObject({ label: 'Withdrawals (melt)', ok: 51, total: 64, failed: 13 })
    expect(v.directions.map(x => x.key)).toEqual(['mints', 'melts'])
    expect(v.avgSwapTime).toBe('8.3 s')
  })
  it('verdict: lnw.cash-like, 202 blamed of 229 with 207 failed', () => {
    const v = verdict({ total: 229, success: 22, failed: 207 }, 202)!
    expect(v).toEqual({ total: 229, blamed: 202, failedElsewhere: 5, ok: 22 })
    expect(auditVerdictDetail(v)).toBe('5 swaps failed for other reasons and do not count against it.')
  })
  it('verdict wording: singular, no other failure, a clean week', () => {
    expect(auditVerdictDetail(verdict({ total: 50, success: 49, failed: 1 }, 0)!)).toBe('1 swap failed for other reasons and does not count against it.')
    expect(auditVerdictDetail(verdict({ total: 50, success: 48, failed: 2 }, 2)!)).toBe('No other swap failed.')
    expect(auditVerdictDetail(verdict({ total: 50, success: 50, failed: 0 }, 0)!)).toBe('Every swap of the last 7 days succeeded.')
    expect(auditVerdictHeadline(verdict({ total: 1, success: 1, failed: 0 }, 0)!)).toBe('of 1 swap failed because of this mint')
  })
  it('verdict: fewer than 10 swaps still shows the numbers', () => {
    expect(verdict({ total: 4, success: 4, failed: 0 }, 0)).toEqual({ total: 4, blamed: 0, failedElsewhere: 0, ok: 4 })
  })
  it('verdict: hostile numbers are clamped or hide it', () => {
    expect(verdict({ total: 20, failed: 20 }, 999)).toEqual({ total: 20, blamed: 20, failedElsewhere: 0, ok: 0 })
    expect(verdict({ total: 20, failed: 999 }, 1)).toEqual({ total: 20, blamed: 1, failedElsewhere: 19, ok: 0 })
    expect(verdict({ total: 0, failed: 0 }, 0)).toBeNull()
    expect(verdict({ total: NaN }, 0)).toBeNull()
    expect(verdict({ total: -5 }, 0)).toBeNull()
    expect(verdict({ total: 20 }, NaN)).toBeNull()
    expect(verdict({ total: 20 }, -1)).toBeNull()
    expect(verdict({ total: 20, failed: -3 }, 0)).toEqual({ total: 20, blamed: 0, failedElsewhere: 0, ok: 20 })
  })
  it('a direction without numbers has no figures; nothing else is invented', () => {
    expect(dirs({ fetchedAt: null, swaps7d: { asSource: { success: 1, total: 2 } } })['mints']).toMatchObject({ ok: null, total: null })
    expect(dirs({ fetchedAt: null, swaps7d: { asSource: { success: 1, total: 2 } } })['melts']).toMatchObject({ ok: 1, total: 2 })
    expect(dirs({ fetchedAt: null, swaps7d: { asDest: { success: 3 } } })['mints']).toMatchObject({ ok: null })
    expect(dirs({ fetchedAt: null, swaps7d: { asDest: { success: -3, total: 4 } } })['mints']).toMatchObject({ ok: null })
    const none = view([], { fetchedAt: null })
    expect(none.verdict).toBeNull()
    expect(none.avgSwapTime).toBeNull()
    expect(view([], { fetchedAt: null, swaps7d: { errorsBlamed: 2 } }).verdict).toBeNull()
  })
  it('failed per direction: as sent, clamped to the attempts', () => {
    const t = dirs({ fetchedAt: null, swaps7d: { asSource: { total: 10, success: 10, failed: 0 }, asDest: { total: 1, success: 0, failed: 1 } } })
    expect(t['melts']).toMatchObject({ ok: 10, total: 10, failed: 0 })
    expect(t['mints']).toMatchObject({ ok: 0, total: 1, failed: 1 })
    expect(dirs({ fetchedAt: null, swaps7d: { asSource: { total: 3, success: 0, failed: 99 } } })['melts']).toMatchObject({ failed: 3 })
  })
  it('long window and since: shown only when they hold more than the shorter window', () => {
    const long = { windowDays: 28, swaps: 410, attributedFailures: 2 }
    expect(view([], LNPAY, { long }).long).toEqual(long)
    expect(auditLongLine(long)).toBe('Last 28 days: 2 of 410 swaps failed because of this mint.')
    expect(view([]).long).toBeNull()
    const since = { day: '2026-08-01', swaps: 900, attributedFailures: 3 }
    expect(view([], LNPAY, { long, since }).since).toEqual(since)
    expect(view([], LNPAY, { long, since: { ...since, swaps: 410 } }).since).toBeNull()
    expect(view([], LNPAY, { since: { ...since, swaps: 126 } }).since).toBeNull()
    expect(auditSinceLine(since, '1 Aug 2026')).toBe('Since 1 Aug 2026: 3 of 900 swaps.')
  })
  it('swaps per day pass through; a missing list is empty', () => {
    const daily7d = [{ day: '2026-10-07', ok: 3, failed: 1, other: 0 }]
    expect(view([], LNPAY, { daily7d }).daily).toEqual(daily7d)
    expect(view([]).daily).toEqual([])
  })
  it('formats the average: seconds with one decimal, under a second in ms', () => {
    expect(formatAvgSwapTime(8289)).toBe('8.3 s')
    expect(formatAvgSwapTime(4868)).toBe('4.9 s')
    expect(formatAvgSwapTime(999.4)).toBe('999 ms')
    expect(formatAvgSwapTime(999.6)).toBe('1.0 s')
    expect(formatAvgSwapTime(0)).toBe('0 ms')
  })
  it('formats a swap duration: ms under a second, seconds under a minute, a short human form from a minute on', () => {
    expect(formatSwapDuration(0)).toBe('0 ms')
    expect(formatSwapDuration(999)).toBe('999 ms')
    expect(formatSwapDuration(1759)).toBe('1.7 s')
    expect(formatSwapDuration(10934)).toBe('10.9 s')
    expect(formatSwapDuration(59999)).toBe('59.9 s')
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
    const t = dirs(LNPAY)
    expect(t['mints']?.tooltip).toBe('Deposits into this mint (mint operations) in the last 7 days, counted by cashu.info: successful of all.')
    expect(t['melts']?.tooltip).toBe('Withdrawals from this mint (melt operations) in the last 7 days, counted by cashu.info: successful of all.')
  })
  it('not covered or no detail stored: no view (the 8333 panel or the empty panel stays)', () => {
    expect(adaptAuditCz(data([], null), Date.now())).toBeNull()
    expect(adaptAuditCz({ ...data([]), detail: undefined } as unknown as AuditCzData, Date.now())).toBeNull()
    expect(adaptAuditCz({ ...data([]), covered: false, mint: null }, Date.now())).toBeNull()
  })
})

describe('the swap list, its filter and the freshness', () => {
  const mixed = [row({ direction: 'from', otherMintUrl: 'https://dest.example' }), row({ direction: 'to', otherMintUrl: 'https://src.example' }), row({ direction: 'from', status: 'failed', stage: 'melt' }), row({ direction: 'to', status: 'failed', stage: 'limits' })]
  it('one list, newest first order preserved; the filter splits it', () => {
    const v = view(mixed)
    expect(v.swaps).toHaveLength(4)
    expect(filterAuditSwaps(v.swaps, 'all')).toHaveLength(4)
    expect(filterAuditSwaps(v.swaps, 'withdrawals').map(r => r.toUrl)).toEqual(['https://dest.example', 'https://o.example'])
    expect(filterAuditSwaps(v.swaps, 'deposits').map(r => r.toUrl)).toEqual(['https://src.example', 'https://o.example'])
    // "Failed" leaves out the grey rows that are not counted against the mint
    expect(filterAuditSwaps(v.swaps, 'failed')).toHaveLength(1)
  })
  it('only the swaps of the last 7 days are listed (the window of the figures above)', () => {
    const v = view([row({ at: '2026-10-06T10:00:00Z' }), row({ at: '2026-09-29T10:00:00Z' })])
    expect(v.swaps).toHaveLength(1)
  })
  it('not updated recently only after 90 minutes (from the stored detail)', () => {
    expect(view([], LNPAY, {}, Date.parse('2026-10-07T08:29:00Z')).notRecent).toBe(false)
    expect(view([], LNPAY, {}, Date.parse('2026-10-07T08:31:00Z')).notRecent).toBe(true)
    expect(view([], { ...LNPAY, fetchedAt: null }, { fetchedAt: '2026-10-07T07:00:00Z' }, Date.parse('2026-10-07T09:00:00Z')).notRecent).toBe(true)
    expect(view([], { ...LNPAY, fetchedAt: null }, { fetchedAt: null }).notRecent).toBe(false)
  })
  it('header sync note: "synced …" while fresh, "not updated recently" (stale) after 90 minutes, nothing without a time', () => {
    const at = (iso: string) => Date.parse(iso)
    expect(auditCzSyncNote(view([], LNPAY, {}, at('2026-10-07T07:30:00Z')), at('2026-10-07T07:30:00Z'))).toEqual({ text: 'synced 30 min ago', stale: false, tip: 'Last synced from cashu.info: 7 Oct 2026, 07:00 UTC.' })
    expect(auditCzSyncNote(view([], LNPAY, {}, at('2026-10-07T08:29:00Z')), at('2026-10-07T08:29:00Z'))).toMatchObject({ text: 'synced 1h ago', stale: false })
    expect(auditCzSyncNote(view([], LNPAY, {}, at('2026-10-07T08:31:00Z')), at('2026-10-07T08:31:00Z'))).toEqual({ text: AUDIT_CZ_NOT_RECENT_TEXT, stale: true, tip: 'Last synced from cashu.info: 7 Oct 2026, 07:00 UTC, more than 90 minutes ago.' })
    expect(auditCzSyncNote({ checkedAt: null, notRecent: true }, at('2026-10-07T08:00:00Z'))).toEqual({ text: AUDIT_CZ_NOT_RECENT_TEXT, stale: true, tip: null })
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
