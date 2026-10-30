import { pool } from './db.js'

// Minimal read/write helpers for the key/value table `app_state` (db.ts). Values are text; the caller owns the format.

/** app_state key: ISO 8601 UTC time of the last discovery run in which a relay completed the kind:38172 query. */
export const DISCOVERY_LAST_SUCCESS_KEY = 'discovery_last_success_at'

export async function getAppState(key: string): Promise<string | null> {
  const r = await pool.query('SELECT value FROM app_state WHERE key = $1', [key])
  return (r.rows[0]?.['value'] as string | undefined) ?? null
}

export async function setAppState(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  )
}

/** A stored ISO time as a normalised ISO string; null when missing or not a date (never a placeholder). */
export function appStateTimeIso(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}
