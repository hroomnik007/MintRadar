// The text of the explanatory tooltips (and the few visible captions that replaced one). Every number, window,
// threshold or label a text states comes from the constant or function the code uses, never typed into the string a
// second time: change the rule and the text changes with it, and src/__tests__/tooltipTexts.test.ts fails when a
// value here stops matching its source.
//
// Where the source lives in the backend only (it cannot be imported by the frontend: separate npm package), the value
// is declared here ONCE and the test compares it with the backend's exported constant or source line.
// The Network Health Index texts live in networkHealthIndex.ts, the latency text in constants/probeLocation.ts.
//
// Style (docs/claude/mobile-and-tooltips.md): English, plain words, one or two short sentences, 160 characters where
// possible and 220 at most, no ALL CAPS, no verdict words (safe, secure, trusted, guaranteed, recommended), nothing that
// implies solvency, the terms "Reliability Score", "Community Rating", "audit data from cashu.info", "attributed to this
// mint", "probe", "mint".
import { AUDIT_MAX_AGE_HOURS, AUDIT_MIN_SAMPLES, AUDIT_NEUTRAL, AUDIT_TAB_MIN_SAMPLES, auditComponent } from './auditScore'
import { NEW_MINT_MAX_DAYS, NEW_MINT_RELIABILITY_CAP, TRACKED_NUT_COUNT, contactComponent, nutComponent, uptimeComponent } from './reliabilityScore'
import { UNKNOWN_SOFTWARE_POINTS, pointsForMinorsBehind } from './versionRule'

// ── Facts that only the backend defines (compared with it by the unit test) ───────────────────────────────────
/** Window of the uptime figure (backend/src/prober.ts: the last 24 hours of probes). */
export const UPTIME_WINDOW_HOURS = 24
/** How many of an auditor's latest swaps audit.8333.space's recent figures cover (backend/src/discovery.ts AUDIT_SWAPS_WINDOW). */
export const AUDIT_SWAPS_WINDOW = 100
/** Review surge rule (backend/src/reviewSurge.ts): +10 reviews, or at least double from a base of 5, against the snapshot of about a week ago. */
export const SURGE_ABSOLUTE_GAIN = 10
export const SURGE_RATIO = 2
export const SURGE_RATIO_MIN_BASELINE = 5
/** A mint is "Outdated" this many minor versions behind the newest stable release (versionRule.ts: minorsBehind >= 2). */
export const OUTDATED_AFTER_MINORS = 2
/** "More alerts" (backend/src/alertTriggers.ts, notificationLimits.ts). */
export const MINT_MELT_BLAMED_RATIO = 0.5
export const MINT_MELT_MIN_SWAPS = 10
export const MINT_MELT_COOLDOWN_HOURS = 12
export const OTHER_ALERT_COOLDOWN_HOURS = 24

// ── Facts derived from the code's own functions (maximum of each score component) ────────────────────────────
const FIXED_NOW = Date.UTC(2026, 0, 1)
export const UPTIME_POINTS = uptimeComponent(100)
export const NUT_POINTS = nutComponent(TRACKED_NUT_COUNT)
export const VERSION_POINTS = pointsForMinorsBehind(0)
export const CONTACT_POINTS = contactComponent(99)
export const AUDIT_POINTS = auditComponent(0, AUDIT_MIN_SAMPLES, new Date(FIXED_NOW).toISOString(), FIXED_NOW)
/** Contacts that already give the full CONTACT_POINTS. */
export const CONTACT_FULL_AT = [0, 1, 2, 3, 4, 5].find(n => contactComponent(n) === CONTACT_POINTS) ?? 3
/** The audit window in whole days (the stored detail counts swaps of the last AUDIT_MAX_AGE_HOURS hours). */
export const AUDIT_WINDOW_DAYS = AUDIT_MAX_AGE_HOURS / 24

const WORDS: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six' }
/** "two", "Three" for small numbers; the digits otherwise. */
export function numberWord(n: number, capital = false): string {
  const w = WORDS[n] ?? String(n)
  return capital ? w.charAt(0).toUpperCase() + w.slice(1) : w
}
const RATIO_WORDS: Record<number, string> = { 2: 'double', 3: 'triple' }

// ── Texts ───────────────────────────────────────────────────────────────────────────────────────────────────
/** ⚠ next to a Community Rating on a card or on Mint Detail. */
export function reviewSurgeText(): string {
  return `${SURGE_ABSOLUTE_GAIN} or more new reviews in about a week, or at least ${RATIO_WORDS[SURGE_RATIO] ?? `${SURGE_RATIO} times`} the count from a base of ${SURGE_RATIO_MIN_BASELINE} or more. Ratings can be gamed, so read this one with care.`
}

/** Dashboard Filters > Unit. */
export const UNIT_FILTER_TEXT = 'Shows only mints that list a selected unit. Mints with unknown units are hidden while a unit is selected.'

/** The "Hide test mints" filter (the tag shown while it is on). */
export const HIDE_TEST_MINTS_TEXT = "Hides the mints on MintRadar's test-mint list (fake sats)."

/** Stats: tracked mints running outdated software. */
export function outdatedSoftwareText(): string {
  return `Share of tracked Nutshell and cdk-mintd mints that are ${numberWord(OUTDATED_AFTER_MINORS)} or more minor versions behind the newest stable release. Pre-releases of a current line are not counted. Not a security score.`
}

/** Stats: Network stability row of the index. */
export const NETWORK_STABILITY_TEXT = 'Share of mints tracked for a month or more. A stand-in for churn, which MintRadar cannot measure yet.'

/** Mint Detail: the Reliability Score formula (tooltip next to the title, and the visible line of the breakdown dialog). */
export function scoreFormulaText(): string {
  return `Score = Uptime×${UPTIME_POINTS}% + NUT support×${NUT_POINTS}% + Version×${VERSION_POINTS}% + Contact×${CONTACT_POINTS}% + Audit×${AUDIT_POINTS}%. New mints (first ${NEW_MINT_MAX_DAYS} days) are capped at ${NEW_MINT_RELIABILITY_CAP}.`
}

/** Breakdown rows. */
export function uptimeRowText(): string {
  return `Percentage of successful checks over the last ${UPTIME_WINDOW_HOURS}h. 100% uptime = full points.`
}
export function auditRowText(): string {
  return `Failures that cashu.info attributes to this mint, out of its swaps in the last ${AUDIT_WINDOW_DAYS} days (not the overall success rate). Under ${AUDIT_MIN_SAMPLES} swaps or no recent data: neutral ${AUDIT_NEUTRAL} of ${AUDIT_POINTS}.`
}
export const NUT_ROW_TEXT = 'Number of NUT specifications (cashu protocol features) this mint supports out of all tracked NUTs.'
export function versionRowText(): string {
  const p = pointsForMinorsBehind
  const middle = [OUTDATED_AFTER_MINORS, OUTDATED_AFTER_MINORS + 1, OUTDATED_AFTER_MINORS + 2]
    .map(n => `${n} = ${p(n)}${n === OUTDATED_AFTER_MINORS ? ' (Outdated)' : ''}`).join(', ')
  return `Compared with the newest stable release of the same software. 0-1 minor versions behind = ${p(0)} points; ${middle}, ${OUTDATED_AFTER_MINORS + 3} or more = ${p(OUTDATED_AFTER_MINORS + 3)}. Other software = ${UNKNOWN_SOFTWARE_POINTS}.`
}
export function contactRowText(): string {
  return `Email, Twitter and Nostr contacts the mint lists. ${numberWord(CONTACT_FULL_AT, true)} or more give the full ${CONTACT_POINTS} points.`
}

/** NUTs tab: the backup chips. */
export const BACKUP_SUPPORTED_TEXT = 'NUT-09 lets a wallet restore its ecash from a seed phrase after a lost or broken device.'
export const NO_BACKUP_TEXT = 'This mint does not support NUT-09, so wallets cannot restore ecash from a seed phrase here. Keep your own token backups.'

/** Audit tab strip (audit.8333.space). */
export const AUDIT_MINTS_TEXT = 'All-time count of mint operations that audit.8333.space has recorded for this mint.'
export const AUDIT_MELTS_TEXT = 'All-time count of melt operations (ecash back to Lightning) that audit.8333.space has recorded for this mint.'
export function auditSuccessRateText(): string {
  return `Successful swaps among the last ~${AUDIT_SWAPS_WINDOW} that audit.8333.space audited. Fewer than ${AUDIT_TAB_MIN_SAMPLES}: "too few to score". The score uses cashu.info instead.`
}

/** Reviews tab: Reviews · NIP-87. */
export const REVIEWS_NIP87_TEXT = 'Anyone can create a key, so ratings can be inflated. Treat them as a hint, not proof.'

/** Tools: the signature check of the Token Inspector. */
export const SIGNATURE_CHECK_TEXT = "Checks each proof's signature proof (NUT-12 DLEQ), when it has one. A pass means this mint signed it. It does not show the token is unspent or the mint is reliable."

/** Compare modal. */
export const INPUT_FEE_TEXT = "Fee per 1000 proofs spent, from the active keyset of the mint's main unit (NUT-02 input_fee_ppk). \"free\" = none, n/a = not reported."
export function compareAuditSuccessText(): string {
  return `Last ${AUDIT_WINDOW_DAYS} days from cashu.info; only failures attributed to the mint count. n/a below ${AUDIT_MIN_SAMPLES} swaps. Not a solvency or reserves signal.`
}

/** Community Rating tile: how many operator reviews it leaves out (the Reviews tab still lists them). */
export function operatorExcludedText(n: number): string {
  return `Excludes ${n} review${n === 1 ? '' : 's'} written by the mint's operator. The Reviews tab still lists ${n === 1 ? 'it' : 'them'}, marked Operator.`
}

/** Card chip "Same op". */
export function sameOperatorText(hosts: readonly string[]): string {
  return `Same operator as ${hosts.join(', ')} (shared public key). Kept as separate mints.`
}

/** cashu.info tiles (Mint Detail > Audit). */
export function payoutsTileText(): string {
  return `Swaps in the last ${AUDIT_WINDOW_DAYS} days in which this mint paid out a Lightning invoice, counted by cashu.info (successful of all)`
}
export function receivesTileText(): string {
  return `Swaps in the last ${AUDIT_WINDOW_DAYS} days in which this mint received ecash from another mint (successful of all)`
}
/** The "without a failure" tile: `clean` of `total` swaps, `blamed` attributed to the mint, `other` failures for other reasons. */
export function cleanTileText(clean: number, total: number, blamed: number, other: number, fmt: (n: number) => string): string {
  const head = `${fmt(clean)} of ${fmt(total)} swaps in the last ${AUDIT_WINDOW_DAYS} days`
  if (blamed === 0 && other === 0) return head
  if (blamed === 0) return `${head}, ${fmt(other)} failed for other reasons`
  return `${head}, ${fmt(blamed)} attributed to this mint${other > 0 ? `, ${fmt(other)} other failure${other === 1 ? '' : 's'}` : ''}`
}

/** Audit tab: the ⓘ of the cashu.info view. */
export function cashuInfoViewText(o: { fallbackFrom8333: boolean; checkedMinutesAgo: number | null; notRecent: boolean; failuresAttributed: number | null }): string {
  const lead = o.fallbackFrom8333
    ? 'audit.8333.space has no recent data for this mint, so this tab shows cashu.info data'
    : 'This tab shows cashu.info data'
  const parts = [
    o.checkedMinutesAgo !== null && Number.isFinite(o.checkedMinutesAgo) ? `checked ${o.checkedMinutesAgo} minute${o.checkedMinutesAgo === 1 ? '' : 's'} ago` : null,
    o.notRecent ? 'not updated recently' : null,
  ].filter(Boolean)
  const failures = o.failuresAttributed !== null
    ? `cashu.info attributes ${o.failuresAttributed} failure${o.failuresAttributed === 1 ? '' : 's'} to this mint.`
    : 'Failures are attributed by cashu.info.'
  return `${lead}${parts.length ? `, ${parts.join(', ')}` : ''}. ${failures}`
}

/** Watchlist: the line under the "More alerts" pills. */
export function moreAlertsNote(): string {
  const half = MINT_MELT_BLAMED_RATIO === 0.5 ? 'half' : `${Math.round(MINT_MELT_BLAMED_RATIO * 100)}%`
  return `Mint/melt: ${half} or more of the last ${AUDIT_WINDOW_DAYS} days' swaps blamed on the mint. Version: ${OUTDATED_AFTER_MINORS}+ minor versions behind. NUT: NUT-04 or NUT-05 lost. At most one message per ${MINT_MELT_COOLDOWN_HOURS} h (mint/melt) or ${OTHER_ALERT_COOLDOWN_HOURS} h (others).`
}

// ── Mint Detail: why the mint's info request failed (the ⓘ beside the red error badge) ───────────────────────────
export const HTTP_ERROR_EXPLANATIONS: Record<string, string> = {
  '400': "The mint's info endpoint rejected the request as malformed — likely a misconfiguration on the mint's side",
  '401': "The mint's info endpoint unexpectedly requires authentication — likely a misconfiguration, NUT-06 should be public",
  '403': "The mint's info endpoint is blocking this request — may be a firewall rule or IP block",
  '404': "The mint's info endpoint returned 404 — it may not support NUT-06, or the URL has changed",
  '429': 'The mint is rate-limiting requests',
  '500': "The mint's server hit an internal error while handling the request",
  '502': "The mint's server is unreachable — the application behind the proxy may have crashed or restarted",
  '503': "The mint's server is temporarily unavailable — likely under maintenance or overloaded",
  '504': "The mint's server took too long to respond — likely overloaded or misconfigured",
}

export const NON_HTTP_ERROR_EXPLANATIONS: Record<string, string> = {
  'Invalid JSON response': "The mint returned a response that isn't valid JSON — its info endpoint may be misconfigured",
  'Invalid Cashu response': "The mint's info endpoint responded, but without the required nuts field — it may not be a Cashu mint",
  'DNS resolution failed': "The mint's domain name could not be resolved — it may no longer exist or its DNS is misconfigured",
  'Connection timeout': "The mint didn't respond in time — its server may be overloaded or unreachable",
  'Connection refused': "The mint's server actively refused the connection — it may be down or blocking this request",
  'TLS/SSL error': "The mint's HTTPS certificate could not be verified — it may be expired, invalid, or misconfigured",
  'Unreachable': 'The mint could not be reached — the server may be down or the network path is blocked',
}
