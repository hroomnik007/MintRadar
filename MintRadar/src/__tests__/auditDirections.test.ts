import { describe, it, expect } from 'vitest'
import { auditDirectionRows, AUDIT_DIRECTIONS_NOTE } from '@/utils/auditDirections'
import type { AuditCzDetail } from '@/hooks/useAuditCz'

const NOW = Date.parse('2026-10-21T10:00:00Z')
const DETAIL: AuditCzDetail = {
  fetchedAt: '2026-10-21T09:30:00Z',
  swaps7d: { all: { total: 126, success: 107, failed: 19 }, asSource: { total: 64, success: 51, failed: 13 }, asDest: { total: 62, success: 56, failed: 6 }, errorsBlamed: 2 },
}

describe('auditDirectionRows', () => {
  it('Deposits (mint) = swaps as destination, Withdrawals (melt) = swaps as source', () => {
    const [mint, melt] = auditDirectionRows(DETAIL, NOW)
    expect(mint).toMatchObject({ key: 'mint', label: 'Deposits (mint)', facts: { attempts: 62, failures: 6, window: '7 days' }, source: 'cashu.info', empty: null })
    expect(melt).toMatchObject({ key: 'melt', label: 'Withdrawals (melt)', facts: { attempts: 64, failures: 13, window: '7 days' } })
    expect(mint?.time).toEqual({ label: '30 min ago', title: '21 Oct 2026, 09:30 UTC' })
  })
  it('a small sample is shown as it is; no thresholds', () => {
    const [mint] = auditDirectionRows({ fetchedAt: DETAIL.fetchedAt, swaps7d: { asDest: { total: 1, failed: 1 } } }, NOW)
    expect(mint?.facts).toMatchObject({ attempts: 1, failures: 1 })
  })
  it('a direction without numbers: "No data from cashu.info", no time', () => {
    const [mint, melt] = auditDirectionRows({ fetchedAt: DETAIL.fetchedAt, swaps7d: { asSource: { total: 4, failed: 0 } } }, NOW)
    expect(mint).toMatchObject({ facts: null, empty: 'No data from cashu.info', time: null })
    expect(melt?.facts).toMatchObject({ attempts: 4, failures: 0 })
  })
  it('missing detail or malformed numbers: both rows say no data', () => {
    for (const d of [null, undefined, { fetchedAt: null }, { fetchedAt: null, swaps7d: { asSource: { total: -1, failed: 0 }, asDest: { total: 5 } } }] as Array<AuditCzDetail | null | undefined>) {
      expect(auditDirectionRows(d, NOW).map(r => r.empty)).toEqual(['No data from cashu.info', 'No data from cashu.info'])
    }
  })
  it('the sentence says the score uses the combined number', () => {
    expect(AUDIT_DIRECTIONS_NOTE).toContain('combined')
  })
})
