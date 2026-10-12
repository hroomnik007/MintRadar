// Named limits of the server-side notification pipeline (nostrService.ts, dmQuota.ts). Everything a
// future change might want to tune lives here; docs/claude/backend-api-and-data.md states the rules.

export type AlertKind = 'mint_melt' | 'version_outdated' | 'nut_loss'

/** Goes down / Goes up: at most one DM per subscriber, mint and direction per hour. */
export const UPDOWN_COOLDOWN_MINUTES = 60

/** "More alerts": minimum time between two DMs of the same type for one subscriber and mint. */
export const ALERT_COOLDOWN_HOURS: Record<AlertKind, number> = {
  mint_melt: 12,
  version_outdated: 24,
  nut_loss: 24,
}

/**
 * Hysteresis: after an alert condition has fired it is re-armed only after the condition has been
 * clear for this many consecutive probes (probes run every 5 minutes, so 12 is about one hour).
 * The streak is stored per mint (mints.alert_clear_streak_*), so it survives a restart.
 */
export const CLEAR_PROBES_TO_REARM = 12

/** At most this many notification DMs per subscriber pubkey (all mints, all five types) per window. */
export const DM_DAILY_CAP = 40
/** The window starts with the first DM and lasts this long; the first DM after it starts a new one. */
export const DM_CAP_WINDOW_HOURS = 24

/** Sent once per window when the cap is first exceeded; the rest of the window's DMs are dropped. */
export const DM_CAP_SUMMARY_TEXT =
  `MintRadar paused alerts for the next hours because more than ${DM_DAILY_CAP} were due; details: https://mintradar.org/watchlist`
