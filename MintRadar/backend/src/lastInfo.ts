// `lastInfo` on /api/mint/probe (known mints only): the last CONFIRMED MOTD and short description from the change-log
// baseline (mint_change_state.info, written by mintChanges.ts after two consecutive observations), so Mint Detail can
// show them, muted with "last seen", while the live /v1/info is missing. Values are already sanitised there (plain text,
// URLs replaced by [link], at most 200 characters); they are read through normalizeStoredInfo again and never recomputed.
// seenAt: the last successful probe (mints.last_online_at), the newest time MintRadar saw the mint's /v1/info.

import { normalizeStoredInfo } from './mintChanges.js'

export interface LastInfo {
  motd: string | null
  description: string | null
  seenAt: string | null
}

const text = (v: string | undefined): string | null => (v !== undefined && v.trim() !== '' ? v : null)

/** null when nothing usable is stored (no baseline, or neither a MOTD nor a description). */
export function lastInfoOf(stateInfo: unknown, lastOnlineAt: unknown): LastInfo | null {
  const info = normalizeStoredInfo(stateInfo)
  const motd = text(info['motd'])
  const description = text(info['description'])
  if (motd === null && description === null) return null
  const t = lastOnlineAt instanceof Date || typeof lastOnlineAt === 'string' ? new Date(lastOnlineAt) : null
  return { motd, description, seenAt: t && Number.isFinite(t.getTime()) ? t.toISOString() : null }
}
