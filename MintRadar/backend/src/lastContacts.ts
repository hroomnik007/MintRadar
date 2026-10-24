// Last published NUT-06 contact entries for offline display on Mint Detail.
// Stored only for known mints, overwritten on every successful probe, cleared after 90 days offline
// or when the mint removes them. Never returned by the Wallet API.
//
// Privacy: only method + info that the mint itself publishes in /v1/info. Same caps and sanitization
// as contact checks (max 10 entries, value length limited, control characters stripped). No history.

import { CONTACT_CHECK_MAX_ENTRIES, CONTACT_CHECK_VALUE_MAX, kindOf } from './contactChecks.js'

export interface LastContact {
  method: string
  info: string
}

/** Extract and sanitize NUT-06 contact entries. Max 10, info truncated, control chars stripped. */
export function extractLastContacts(raw: unknown): LastContact[] {
  if (!Array.isArray(raw)) return []
  const out: LastContact[] = []
  for (const e of raw.slice(0, CONTACT_CHECK_MAX_ENTRIES)) {
    if (e === null || typeof e !== 'object') continue
    const rec = e as Record<string, unknown>
    const method = typeof rec['method'] === 'string' ? rec['method'].trim().slice(0, 40) : ''
    if (!method) continue
    const infoRaw = typeof rec['info'] === 'string' ? rec['info'] : ''
    // Strip control characters, then truncate. Empty after strip is skipped.
    const info = infoRaw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, CONTACT_CHECK_VALUE_MAX)
    if (!info) continue
    out.push({ method, info })
  }
  return out
}

/** Read the stored JSONB as LastContact[]; null when missing or malformed. */
export function readStoredLastContacts(raw: unknown): LastContact[] | null {
  if (!Array.isArray(raw)) return null
  const out: LastContact[] = []
  for (const e of raw) {
    if (e === null || typeof e !== 'object') return null
    const r = e as Record<string, unknown>
    if (typeof r['method'] !== 'string' || typeof r['info'] !== 'string') return null
    out.push({ method: r['method'], info: r['info'] })
  }
  return out
}
