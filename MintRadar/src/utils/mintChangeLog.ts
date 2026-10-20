// Mint change log on Mint Detail: confirmed changes in a mint's public data (backend/src/mintChanges.ts), shown as facts
// with a time. Plain words for the type, never a verdict: a change is neither good nor bad here.

export interface MintChange {
  type: string
  field: string
  oldValue: string | null
  newValue: string | null
  /** ISO 8601: when the change was confirmed by the second consecutive observation. */
  observedAt: string
  /** ISO 8601: when the new value was first seen. */
  firstSeenAt: string
}

export interface MintChangesData {
  url: string
  /** ISO 8601: when MintRadar started tracking this mint's public data, or null. */
  trackingSince: string | null
  changes: MintChange[]
}

/** The page shows this many rows; "Show all" expands to everything the route returned (up to 100). */
export const CHANGES_VISIBLE = 10

export const CHANGE_LABELS: Record<string, string> = {
  pubkey_changed: 'Public key changed',
  input_fee_changed: 'Input fee changed',
  keyset_added: 'Keyset added',
  keyset_removed: 'Keyset removed',
  keyset_deactivated: 'Keyset deactivated',
  keyset_reactivated: 'Keyset reactivated',
  keyset_final_expiry_changed: 'Keyset final expiry changed',
  motd_changed: 'Message of the day changed',
  name_changed: 'Name changed',
  description_changed: 'Description changed',
  contact_changed: 'Contact methods changed',
  version_changed: 'Version changed',
  nuts_changed: 'Supported NUTs changed',
  methods_changed: 'Payment methods changed',
}

/** A type this build does not know (a later addition) still reads as plain words. */
export function changeLabel(type: string): string {
  return CHANGE_LABELS[type] ?? 'Change recorded'
}

/** The text of the day-summary row the backend writes when a mint changes more than 20 times in a UTC day. */
export const MULTIPLE_CHANGES_TEXT = 'multiple changes'

/**
 * A change is confirmed by a second observation: one probe interval later for /v1/info data, one keysets check (an hour) later
 * for keyset data. "Seen first" is shown only when the gap is clearly longer than that (a restart or an outage delayed it).
 */
const INFO_CONFIRM_GAP_MS = 10 * 60_000
const KEYSETS_CONFIRM_GAP_MS = 70 * 60_000

export function confirmationGapMs(type: string): number {
  return type.startsWith('keyset_') || type === 'input_fee_changed' ? KEYSETS_CONFIRM_GAP_MS : INFO_CONFIRM_GAP_MS
}

export function showFirstSeen(c: MintChange): boolean {
  const first = Date.parse(c.firstSeenAt)
  const seen = Date.parse(c.observedAt)
  return Number.isFinite(first) && Number.isFinite(seen) && seen - first > confirmationGapMs(c.type)
}

/** A route answer in the expected shape, or null (anything else is treated as "not available", never as "no changes"). */
export function parseMintChanges(raw: unknown): MintChangesData | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r['changes'])) return null
  const changes: MintChange[] = []
  for (const e of r['changes'] as unknown[]) {
    if (typeof e !== 'object' || e === null) return null
    const c = e as Record<string, unknown>
    if (typeof c['type'] !== 'string' || typeof c['field'] !== 'string' || typeof c['observedAt'] !== 'string' || typeof c['firstSeenAt'] !== 'string') return null
    changes.push({
      type: c['type'], field: c['field'],
      oldValue: typeof c['oldValue'] === 'string' ? c['oldValue'] : null,
      newValue: typeof c['newValue'] === 'string' ? c['newValue'] : null,
      observedAt: c['observedAt'], firstSeenAt: c['firstSeenAt'],
    })
  }
  return {
    url: typeof r['url'] === 'string' ? r['url'] : '',
    trackingSince: typeof r['trackingSince'] === 'string' ? r['trackingSince'] : null,
    changes,
  }
}
