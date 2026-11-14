// The two windows of the audit part (methodology 8) as the pages need them: the long window of a mint from
// /api/mints/known, and which of the two windows decides the part (so a row shows the numbers behind its points).
// The scoring itself stays in auditScore.ts (the copy of backend/src/shared/auditScore.ts).
import { AUDIT_MIN_SAMPLES, auditComponent, type AuditLongWindow } from './auditScore'
import { AUDIT_WINDOW_DAYS } from './tooltipTexts'

export interface AuditLongFields {
  auditCzLongBlamed?: number | null
  auditCzLongTotal?: number | null
  auditCzLongDays?: number | null
}

/** The long window of a mint; every field null while the server has not stored one. */
export function auditLongOf(m: AuditLongFields | null | undefined): AuditLongWindow {
  return { blamed: m?.auditCzLongBlamed ?? null, total: m?.auditCzLongTotal ?? null, days: m?.auditCzLongDays ?? null }
}

export interface AuditWindowFigures { blamed: number; total: number; days: number }

/**
 * The window whose result the audit part takes: the one with the lower points, the 7-day window on a tie. Null
 * when neither window has enough swaps. Freshness is not checked here (auditDataState does that).
 */
export function decidingAuditWindow(
  blamed: number | null | undefined,
  total: number | null | undefined,
  long: AuditLongWindow | null | undefined,
): AuditWindowFigures | null {
  const now = 0
  const at = new Date(now)
  const short = typeof total === 'number' && typeof blamed === 'number' && total >= AUDIT_MIN_SAMPLES
    ? { blamed: Math.min(blamed, total), total, days: AUDIT_WINDOW_DAYS }
    : null
  const l = long && typeof long.total === 'number' && typeof long.blamed === 'number' && typeof long.days === 'number'
    && long.days > AUDIT_WINDOW_DAYS && long.total >= AUDIT_MIN_SAMPLES
    ? { blamed: Math.min(long.blamed, long.total), total: long.total, days: long.days }
    : null
  if (!short) return l
  if (!l) return short
  const sp = auditComponent(short.blamed, short.total, at, now)
  const lp = auditComponent(l.blamed, l.total, at, now)
  return lp < sp ? l : short
}
