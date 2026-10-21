// Deposits (mint) and Withdrawals (melt) rows of the cashu.info Audit view: the 7-day swaps split by direction, the same
// stored data the audit part of the Reliability Score counts in total. Never scored or coloured here.
import type { AuditCzDetail } from '@/hooks/useAuditCz'
import { formatTimeAgo } from './mintFormatting'
import { formatDateTimeUtc } from './formatDate'
import { AUDIT_WINDOW_DAYS } from './tooltipTexts'

export const AUDIT_DIRECTION_SOURCE = 'cashu.info'
export const AUDIT_DIRECTIONS_NOTE =
  'The Reliability Score uses the combined number. These rows are the same data split by direction.'

export interface AuditDirectionRow {
  key: 'mint' | 'melt'
  label: string
  /** null: no numbers stored for this direction. */
  facts: { attempts: number; failures: number; window: string } | null
  /** "No data from cashu.info" when facts is null. */
  empty: string | null
  source: string
  time: { label: string; title: string } | null
}

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null)

function factsOf(d: { total?: number; failed?: number } | undefined): AuditDirectionRow['facts'] {
  const attempts = count(d?.total), failed = count(d?.failed)
  if (attempts === null || failed === null) return null
  return { attempts, failures: Math.min(failed, attempts), window: `${AUDIT_WINDOW_DAYS} days` }
}

/** asDest = this mint was the destination of a swap (a deposit / mint), asSource = it was the source (a withdrawal / melt). */
export function auditDirectionRows(detail: AuditCzDetail | null | undefined, now: number): AuditDirectionRow[] {
  const at = detail?.fetchedAt ? new Date(detail.fetchedAt) : null
  const time = at && Number.isFinite(at.getTime()) ? { label: formatTimeAgo(at, now), title: formatDateTimeUtc(at) } : null
  const mk = (key: 'mint' | 'melt', label: string, d: { total?: number; failed?: number } | undefined): AuditDirectionRow => {
    const facts = factsOf(d)
    return { key, label, facts, empty: facts ? null : `No data from ${AUDIT_DIRECTION_SOURCE}`, source: AUDIT_DIRECTION_SOURCE, time: facts ? time : null }
  }
  return [
    mk('mint', 'Deposits (mint)', detail?.swaps7d?.asDest),
    mk('melt', 'Withdrawals (melt)', detail?.swaps7d?.asSource),
  ]
}
