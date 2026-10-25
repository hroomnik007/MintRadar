// Change dates on Mint Detail: confirmed changes in a mint's public data (backend/src/mintChanges.ts), read from
// /api/mints/changes and shown where the data lives (keysets, fees, mint info; see utils/changeDates.ts). Plain facts with
// a date, never a verdict: a change is neither good nor bad here.

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

/** A value seen once that waits for its confirming observation. Never a confirmed date. */
export interface PendingMintChange {
  type: string
  field: string
  oldValue: string | null
  newValue: string | null
  /** ISO 8601: when the value was seen. */
  firstSeenAt: string
}

export interface MintChangesPending {
  firstSeenAt: string
  diff: PendingMintChange[]
}

/** When MintRadar first and last saw a keyset in a keysets check (mint_keysets). */
export interface KeysetSeen {
  id: string
  firstSeenAt: string
  lastSeenAt: string
}

export interface MintChangesData {
  url: string
  /** ISO 8601: when MintRadar started tracking this mint's public data, or null. */
  trackingSince: string | null
  /** Newest first (the route's order). */
  changes: MintChange[]
  /** null when nothing waits for confirmation. */
  pending: MintChangesPending | null
  keysetsSeen: KeysetSeen[]
}

/** The text of the day-summary row the backend writes when a mint changes more than 20 times in a UTC day. */
export const MULTIPLE_CHANGES_TEXT = 'multiple changes'

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function parsePending(raw: unknown): MintChangesPending | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r['diff'])) return null
  const diff: PendingMintChange[] = []
  for (const e of r['diff'] as unknown[]) {
    if (typeof e !== 'object' || e === null) continue
    const c = e as Record<string, unknown>
    if (typeof c['type'] !== 'string' || typeof c['field'] !== 'string' || typeof c['firstSeenAt'] !== 'string') continue
    diff.push({ type: c['type'], field: c['field'], oldValue: str(c['oldValue']), newValue: str(c['newValue']), firstSeenAt: c['firstSeenAt'] })
  }
  if (diff.length === 0) return null
  return { firstSeenAt: str(r['firstSeenAt']) ?? diff[0]!.firstSeenAt, diff }
}

function parseKeysetsSeen(raw: unknown): KeysetSeen[] {
  if (!Array.isArray(raw)) return []
  const out: KeysetSeen[] = []
  for (const e of raw as unknown[]) {
    if (typeof e !== 'object' || e === null) continue
    const k = e as Record<string, unknown>
    if (typeof k['id'] !== 'string' || typeof k['firstSeenAt'] !== 'string') continue
    out.push({ id: k['id'], firstSeenAt: k['firstSeenAt'], lastSeenAt: str(k['lastSeenAt']) ?? k['firstSeenAt'] })
  }
  return out
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
      oldValue: str(c['oldValue']),
      newValue: str(c['newValue']),
      observedAt: c['observedAt'], firstSeenAt: c['firstSeenAt'],
    })
  }
  return {
    url: str(r['url']) ?? '',
    trackingSince: str(r['trackingSince']),
    changes,
    pending: parsePending(r['pending']),
    keysetsSeen: parseKeysetsSeen(r['keysetsSeen']),
  }
}
