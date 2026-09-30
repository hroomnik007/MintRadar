// Audit-data age helpers (display only — never feeds the Reliability Score).
// Two different times exist per mint: auditCheckedAt (the auditor's own last
// check, audit.8333.space `updated_at`) and auditSyncedAt (when MintRadar's 6h
// job last wrote the data). Thresholds live here and nowhere else.
export const AUDIT_DATA_OLD_DAYS = 7
export const AUDIT_SYNC_STALE_HOURS = 24

export interface AuditFreshness {
  /** Whole days since the auditor's last check; null when unknown/unparseable. */
  auditorAgeDays: number | null
  /** Whole hours since MintRadar last synced; null when unknown/unparseable. */
  syncAgeHours: number | null
  /** Auditor data older than AUDIT_DATA_OLD_DAYS. */
  auditorDataOld: boolean
  /** MintRadar's own sync older than AUDIT_SYNC_STALE_HOURS. */
  syncStale: boolean
}

function ageMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? Math.max(0, now - t) : null
}

export function auditFreshness(
  auditCheckedAt: string | null | undefined,
  auditSyncedAt: string | null | undefined,
  now: number = Date.now(),
): AuditFreshness {
  const a = ageMs(auditCheckedAt, now)
  const s = ageMs(auditSyncedAt, now)
  return {
    auditorAgeDays: a === null ? null : Math.floor(a / 86_400_000),
    syncAgeHours: s === null ? null : Math.floor(s / 3_600_000),
    auditorDataOld: a !== null && a > AUDIT_DATA_OLD_DAYS * 86_400_000,
    syncStale: s !== null && s > AUDIT_SYNC_STALE_HOURS * 3_600_000,
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "27 Sep 2026, 12:13 UTC" — fixed zone/locale so the notice reads the same everywhere.
export function formatAuditSyncDate(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}
