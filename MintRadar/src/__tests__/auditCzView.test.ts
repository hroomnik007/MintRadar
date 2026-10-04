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

describe('auditCzSwapSuccess (methodology: swaps without an attributed failure)', () => {
  it('Coinos: 179 swaps, 47 ok, 0 blamed -> 179 / 179, 100%', () => {
    expect(auditCzSwapSuccess({ total: 179, success: 47, failed: 132, errorsBlamed: 0 })).toEqual({ good: 179, total: 179, pct: 100 })
  })
  it('counts attributed failures against the mint', () => {
    expect(auditCzSwapSuccess({ total: 20, success: 10, failed: 10, errorsBlamed: 5 })).toEqual({ good: 15, total: 20, pct: 75 })
  })
  it('n/a below 3 swaps unless there is an attributed failure', () => {
    expect(auditCzSwapSuccess({ total: 2, success: 2, failed: 0, errorsBlamed: 0 })).toBeNull()
    expect(auditCzSwapSuccess({ total: 2, success: 1, failed: 1, errorsBlamed: 1 })).toEqual({ good: 1, total: 2, pct: 50 })
    expect(auditCzSwapSuccess({ total: 0, success: 0, failed: 0, errorsBlamed: 0 })).toBeNull()
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
    const v = adaptAuditCz(data([row({ status: 'failed', stage: 'limits' })], { total: 5, success: 1, failed: 4, errorsBlamed: 0 }), Date.now())
    expect(v?.recentTotal).toBeNull()
    expect(v?.detail7d).toEqual({ total: 5, success: 1, failed: 4, errorsBlamed: 0 })
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
