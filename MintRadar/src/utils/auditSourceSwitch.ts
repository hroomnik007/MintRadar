// One-time Stats note under "Reliability Score movers": on this UTC date the audit part of the
// Reliability Score moved from audit.8333.space to cashu.info (failures attributed to each mint),
// so score changes around it include that switch. Shown for AUDIT_SWITCH_NOTE_DAYS days only.
// Set to the UTC date of the push that deployed the switch (ISO date).
export const AUDIT_SOURCE_SWITCH_DATE = '2026-10-08'
export const AUDIT_SWITCH_NOTE_DAYS = 30

/** True while `now` is less than AUDIT_SWITCH_NOTE_DAYS days after the switch date (a date in the future also shows it). */
export function showAuditSwitchNote(now: number, switchDate: string = AUDIT_SOURCE_SWITCH_DATE): boolean {
  const t = Date.parse(switchDate)
  if (!Number.isFinite(t)) return false
  return now - t < AUDIT_SWITCH_NOTE_DAYS * 86_400_000
}
