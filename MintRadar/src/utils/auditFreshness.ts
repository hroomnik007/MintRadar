// Audit-data age helpers (display only — never feeds the Reliability Score).
// Two different times exist per mint: auditCheckedAt (the auditor's own last
// check, audit.8333.space `updated_at`) and auditSyncedAt (when MintRadar's 6h
// job last wrote the data). Thresholds live here and nowhere else.
import { DATE_MONTHS, formatDate } from './formatDate'

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

/**
 * Network-level staleness of audit.8333.space (Stats page note). Takes every mint's `auditCheckedAt`
 * (the auditor's own `updated_at`, the same value Mint Detail's "data N days old" uses) and returns the
 * newest one as an ISO string when it is older than AUDIT_DATA_OLD_DAYS (same strict boundary as
 * auditFreshness().auditorDataOld), otherwise null: fresh data, or no usable timestamp at all.
 * `auditSyncedAt` is not used on purpose: our 6h cron advances it even when the upstream records are old.
 */
export function staleAuditSince(
  checkedAts: ReadonlyArray<string | null | undefined>,
  now: number = Date.now(),
): string | null {
  let newest: number | null = null
  for (const iso of checkedAts) {
    if (!iso) continue
    const t = new Date(iso).getTime()
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t
  }
  if (newest === null) return null
  const iso = new Date(newest).toISOString()
  return auditFreshness(iso, null, now).auditorDataOld ? iso : null
}


// "27 Sep 2026, 12:13 UTC" — fixed zone/locale so the notice reads the same everywhere.
export function formatAuditSyncDate(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCDate()} ${DATE_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

// "27 Sep 2026" — date part of formatAuditSyncDate().
export function formatAuditDate(iso: string): string {
  return formatDate(iso) || iso
}
