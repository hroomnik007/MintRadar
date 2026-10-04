import { describe, it, expect } from 'vitest'
import { adaptAuditCz, auditCzSwapSuccess, isAuditCzNeutralRow } from '@/utils/auditCz'
import type { AuditCzData } from '@/hooks/useAuditCz'

const row = (o: Partial<AuditCzData['swaps'][number]> = {}): AuditCzData['swaps'][number] => ({
  id: 'x', at: '2026-10-04T10:00:00Z', status: 'success', stage: null, error: null, amount: 10, fee: 1,
  durationMs: 900, direction: 'from', otherMintUrl: 'https://o.example', otherMintName: null, ...o,
})
const data = (swaps: AuditCzData['swaps'], detail7d?: AuditCzData['detail7d']): AuditCzData => ({
  source: 'audit.cashu.cz', sourceUrl: null, fetchedAt: null, covered: true,
  mint: { state: 'ok', uptime24h: 1, uptime7d: 1, uptime30d: 1, attributedFailures: 0, minted: 1, melted: 1, lastCheck: null },
  swaps, stats7d: null, ...(detail7d !== undefined ? { detail7d } : {}),
})

const d = (o: Partial<NonNullable<AuditCzData['detail7d']>>): NonNullable<AuditCzData['detail7d']> =>
  ({ total: 0, success: 0, failed: 0, errorsBlamed: 0, minted: null, melted: null, ...o })

describe('auditCzSwapSuccess (only swaps attributed to the mint count)', () => {
  it('Coinos-like: 179 total, 47 ok, 132 failed, 0 blamed -> 47 / 47, 100%', () => {
    expect(auditCzSwapSuccess(d({ total: 179, success: 47, failed: 132, errorsBlamed: 0 }))).toEqual({ good: 47, total: 47, pct: 100 })
  })
  it('blamed failures: success 8, errorsBlamed 4 -> 8 / 12, 67%', () => {
    expect(auditCzSwapSuccess(d({ total: 20, success: 8, failed: 12, errorsBlamed: 4 }))).toEqual({ good: 8, total: 12, pct: 67 })
  })
  it('n/a below 3 attributable swaps', () => {
    expect(auditCzSwapSuccess(d({ total: 100, success: 2, failed: 98, errorsBlamed: 0 }))).toBeNull()
    expect(auditCzSwapSuccess(d({ total: 5, success: 1, failed: 4, errorsBlamed: 1 }))).toBeNull()
    expect(auditCzSwapSuccess(d({ total: 5, success: 1, failed: 4, errorsBlamed: 2 }))).toEqual({ good: 1, total: 3, pct: 33 })
  })
})

describe('fallback counts from the stored swaps', () => {
  it('leaves out stage "limits" and pending, keeps every other failure', () => {
    const v = adaptAuditCz(data([
      row({ id: '1' }), row({ id: '2', status: 'failed', stage: 'melt' }), row({ id: '3', status: 'failed', stage: 'limits' }),
      row({ id: '4', status: 'pending' }), row({ id: '5', status: 'failed', stage: 'mint_quote' }),
    ]), Date.now())
    expect(v?.recentTotal).toBe(3)
    expect(v?.recentErrors).toBe(2)
    expect(v?.swaps).toHaveLength(5) // table and bar still list them all
  })
  it('null counts when only limits/pending swaps exist; detail7d passes through', () => {
    const v = adaptAuditCz(data([row({ status: 'failed', stage: 'limits' })], { total: 5, success: 1, failed: 4, errorsBlamed: 0, minted: 3, melted: 2 }), Date.now())
    expect(v?.recentTotal).toBeNull()
    expect(v?.detail7d).toEqual({ total: 5, success: 1, failed: 4, errorsBlamed: 0, minted: 3, melted: 2 })
    expect(v?.nMints).toBe(3) // detail.asDest.success wins over the list feed's swaps.minted
    expect(v?.nMelts).toBe(2)
  })
})

describe('Mints / Melts tiles', () => {
  it('fall back to the list feed values without detail or without the direction counts', () => {
    expect(adaptAuditCz(data([]), Date.now())).toMatchObject({ nMints: 1, nMelts: 1 })
    expect(adaptAuditCz(data([], d({ minted: null, melted: 7 })), Date.now())).toMatchObject({ nMints: 1, nMelts: 7 })
  })
})

describe('neutral rows', () => {
  it('only failed rows with stage "limits" are neutral', () => {
    expect(isAuditCzNeutralRow({ state: 'failed', stage: 'limits' })).toBe(true)
    expect(isAuditCzNeutralRow({ state: 'failed', stage: 'melt' })).toBe(false)
    expect(isAuditCzNeutralRow({ state: 'pending', stage: null })).toBe(false)
    expect(isAuditCzNeutralRow({ state: 'OK', stage: 'limits' })).toBe(false)
  })
})
