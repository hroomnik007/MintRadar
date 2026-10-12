import { pool } from './db.js'
import { DM_DAILY_CAP, DM_CAP_WINDOW_HOURS } from './notificationLimits.js'

// Per-subscriber daily cap on notification DMs (all mints, all five alert types).
//
// One row per pubkey in notification_dm_quota: the window starts with the first DM and lasts
// DM_CAP_WINDOW_HOURS; the first DM after it has passed starts a new window (count back to 1,
// summary flag cleared). The increment is ONE atomic upsert, so two probes or two backend processes
// cannot both take the same slot. The counter is capped at DM_DAILY_CAP + 1, so it stays bounded
// however many DMs are due; everything above the cap is dropped, never queued.
//
// window_start is stored with millisecond precision (date_trunc) on purpose: it is read back as a JS
// Date and used as a guard in later statements, and PostgreSQL's microseconds would never compare equal.

export interface DmSlot {
  /** false = the daily cap is reached: drop this DM. */
  allowed: boolean
  /** true for exactly one DM per window: the first one over the cap, which gets the summary DM. */
  sendSummary: boolean
  windowStart: Date
}

const WINDOW_PASSED = `q.window_start <= now() - make_interval(hours => $2::int)`

export async function reserveDmSlot(pubkey: string): Promise<DmSlot> {
  const res = await pool.query(
    `INSERT INTO notification_dm_quota AS q (pubkey, window_start, dm_count, summary_sent)
     VALUES ($1, date_trunc('milliseconds', now()), 1, false)
     ON CONFLICT (pubkey) DO UPDATE SET
       window_start = CASE WHEN ${WINDOW_PASSED} THEN date_trunc('milliseconds', now()) ELSE q.window_start END,
       dm_count     = CASE WHEN ${WINDOW_PASSED} THEN 1 ELSE LEAST(q.dm_count + 1, $3::int + 1) END,
       summary_sent = CASE WHEN ${WINDOW_PASSED} THEN false ELSE q.summary_sent END
     RETURNING dm_count, window_start`,
    [pubkey, DM_CAP_WINDOW_HOURS, DM_DAILY_CAP]
  )
  const row = res.rows[0] as { dm_count: number; window_start: Date }
  const windowStart = row.window_start
  if (row.dm_count <= DM_DAILY_CAP) return { allowed: true, sendSummary: false, windowStart }

  // Over the cap: exactly one caller per window flips the flag and sends the summary.
  const flip = await pool.query(
    `UPDATE notification_dm_quota SET summary_sent = true
      WHERE pubkey = $1 AND window_start = $2 AND summary_sent = false
      RETURNING 1`,
    [pubkey, windowStart]
  )
  return { allowed: false, sendSummary: (flip.rowCount ?? 0) > 0, windowStart }
}

/** A reserved DM never went out: give the slot back (only inside the window it was taken in). */
export async function releaseDmSlot(pubkey: string, windowStart: Date): Promise<void> {
  await pool.query(
    `UPDATE notification_dm_quota SET dm_count = GREATEST(dm_count - 1, 0)
      WHERE pubkey = $1 AND window_start = $2 AND dm_count <= $3`,
    [pubkey, windowStart, DM_DAILY_CAP]
  )
}

/** The summary DM failed to publish: allow the next dropped DM of this window to try again. */
export async function resetSummaryFlag(pubkey: string, windowStart: Date): Promise<void> {
  await pool.query(
    `UPDATE notification_dm_quota SET summary_sent = false WHERE pubkey = $1 AND window_start = $2`,
    [pubkey, windowStart]
  )
}
