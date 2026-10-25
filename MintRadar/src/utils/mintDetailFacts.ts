// Pure display helpers for Mint Detail facts from the 2026-10-25 data audit: the Outages tiles, the Reliability Score
// breakdown from the stored record, last known info of an unavailable mint, the History summary and small offline
// fallbacks. Operational facts only; no verdict wording.
import type { ContactCheckFact } from './contactChecks'
import { formatAuditSuccessRatio } from './mintFormatting'

// ── Outages ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface OutageEntry {
  startedAt: string
  durationMs: number
  /** Kept in the API for compatibility ('offline'); never shown. */
  error?: string
  ongoing?: boolean
  truncatedAtWindowStart?: boolean
}

export interface OutagesResponse {
  sinceLastOutageMs: number | null
  avgRecoveryMs: number | null
  outageCount: number
  recoveredCount?: number
  ongoing?: boolean
  currentOutage?: { startedAt: string; durationMs: number } | null
  outages: OutageEntry[]
}

export interface OutageTile { key: 'since' | 'down' | 'recover' | 'count'; label: string; value: string }

/**
 * The three tiles. While an outage is ongoing the first one reads "Down now" with its duration (never "Since last outage":
 * the mint has not recovered). "Time to recover" is the mean of recovered outages only, as the API computes it.
 */
export function outageTiles(data: OutagesResponse | undefined, countLabel: string, fmt: (ms: number) => string): OutageTile[] {
  const ongoing = data?.ongoing === true
  const first: OutageTile = ongoing
    ? { key: 'down', label: 'Down now', value: data?.currentOutage ? fmt(data.currentOutage.durationMs) : '—' }
    : { key: 'since', label: 'Since last outage', value: data?.sinceLastOutageMs != null ? fmt(data.sinceLastOutageMs) : '—' }
  const recovered = data?.recoveredCount
  const recoverLabel = typeof recovered === 'number' && ongoing ? `Time to recover (${recovered} recovered)` : 'Time to recover'
  return [
    first,
    { key: 'recover', label: recoverLabel, value: data?.avgRecoveryMs != null ? fmt(data.avgRecoveryMs) : '—' },
    { key: 'count', label: countLabel, value: data?.outageCount != null ? String(data.outageCount) : '—' },
  ]
}

/** Error cell of the details table: the stored last error (already sanitised by the caller) on the ongoing row only. */
export function outageErrorCell(o: Pick<OutageEntry, 'ongoing'>, lastError: string | null): string {
  return o.ongoing === true && lastError ? lastError : ''
}

// ── Reliability Score breakdown from the stored record ──────────────────────────────────────────────────────────────

export interface StoredPart { points: number; max: number }
export interface StoredScoreBreakdown {
  uptime: StoredPart
  audit: StoredPart
  nuts: StoredPart
  version: StoredPart
  contact: StoredPart
  newMintCap: { points: number; cap: number }
  sum: number
}
export type BreakdownPart = 'uptime' | 'audit' | 'nuts' | 'version' | 'contact'

/** The row's points: the stored part when the stored breakdown exists, else the live computation (null = pending). */
export function breakdownRowScore(stored: StoredScoreBreakdown | null | undefined, part: BreakdownPart, live: number | null): number | null {
  return stored ? stored[part].points : live
}

/** Colour by share of the part's maximum (the same bands the version and contact rows used: 80 % / 40 %). */
export function breakdownPointsColor(points: number | null, max: number): string {
  if (points === null) return 'var(--text3)'
  const r = max > 0 ? points / max : 0
  return r >= 0.8 ? 'var(--accent)' : r >= 0.4 ? 'var(--amber)' : 'var(--red)'
}

/** The rows' points plus the new-mint cap correction: equals the stored score. */
export function storedBreakdownTotal(stored: StoredScoreBreakdown): number {
  const parts = stored.uptime.points + stored.audit.points + stored.nuts.points + stored.version.points + stored.contact.points
  return Math.min(100, Math.round(parts)) + stored.newMintCap.points
}

const KIND_LABEL: Record<string, string> = { email: 'Email', twitter: 'Twitter', nostr: 'Nostr' }

/**
 * Contact row text when no contact value is known in this view: the kinds of the last contact checks ("Email + Nostr"),
 * never a value. null when there are none.
 */
export function contactKindsText(checks: readonly ContactCheckFact[] | null | undefined): string | null {
  const kinds = ['email', 'twitter', 'nostr'].filter(k => (checks ?? []).some(c => c.kind === k))
  return kinds.length > 0 ? kinds.map(k => KIND_LABEL[k]).join(' + ') : null
}

// ── Last known info of an unavailable mint ───────────────────────────────────────────────────────────────────────────

export interface LastInfo { motd: string | null; description: string | null; seenAt: string | null }

export interface InfoText { motd?: string; description?: string; lastSeenAt: string | null }

/**
 * MOTD and description to show: the live values when the live /v1/info is present, else the last confirmed values of a
 * known mint with the time they were last seen (the caller renders the muted "last seen" label only then).
 */
export function infoTextFor(liveInfo: { motd?: string; description?: string } | null | undefined, lastInfo: LastInfo | null | undefined): InfoText {
  if (liveInfo) return { ...(liveInfo.motd ? { motd: liveInfo.motd } : {}), ...(liveInfo.description ? { description: liveInfo.description } : {}), lastSeenAt: null }
  if (!lastInfo || (!lastInfo.motd && !lastInfo.description)) return { lastSeenAt: null }
  return { ...(lastInfo.motd ? { motd: lastInfo.motd } : {}), ...(lastInfo.description ? { description: lastInfo.description } : {}), lastSeenAt: lastInfo.seenAt }
}

/** The probe answer's `lastInfo`, or undefined when absent or malformed. */
export function readLastInfo(raw: unknown): LastInfo | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)
  return { motd: str(r['motd']), description: str(r['description']), seenAt: str(r['seenAt']) }
}

// ── History summary ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Mean of the period's non-null segment reliability scores, rounded; null when there is none. */
export function averageReliability(segments: ReadonlyArray<{ reliabilityScore: number | null }> | null | undefined): number | null {
  const v = (segments ?? []).map(s => s.reliabilityScore).filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  if (v.length === 0) return null
  return Math.round(v.reduce((a, b) => a + b, 0) / v.length)
}

const PERIOD_TEXT = { '24h': 'the last 24 hours', '7d': 'the last 7 days', '30d': 'the last 30 days', '90d': 'the last 90 days' } as const
export type HistoryPeriod = keyof typeof PERIOD_TEXT

/**
 * "Median 120 ms · p95 480 ms over the last 7 days": the ⓘ next to the average latency of the History summary
 * (a tooltip, not a line under the value, so the summary keeps its width). Null when neither is known.
 */
export function latencyPercentilesText(p50: number | null | undefined, p95: number | null | undefined, period?: HistoryPeriod): string | null {
  if (p50 == null && p95 == null) return null
  const f = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} ms`)
  return `Median ${f(p50)} · p95 ${f(p95)}${period ? ` over ${PERIOD_TEXT[period]}` : ''}`
}

/** The muted label above the swap strip on the Audit tab (its ⓘ sits next to it): "Last 35 swaps". */
export function swapStripLabel(count: number): string {
  return count === 1 ? 'Last swap' : `Last ${count} swaps`
}

/** The swap strip's ⓘ on the Audit tab: what the coloured marks are (was a paragraph under the strip). */
export function swapStripText(count: number): string {
  return `The ${count === 1 ? 'latest swap' : `latest ${count} swaps`} MintRadar stored from cashu.info, both directions, newest first. Green: succeeded. Red: failed. Grey: not counted against the mint (below the mint's minimum, the auditor's balance, or no outcome yet).`
}

// ── Small offline fallbacks ──────────────────────────────────────────────────────────────────────────────────────────

/** Tor row: the tracked URL is .onion, the live /v1/info lists one, or the stored record says it did. */
export function showTorFor(trackedIsOnion: boolean, liveHasOnion: boolean, storedHasOnion: boolean | null | undefined): boolean {
  return trackedIsOnion || liveHasOnion || storedHasOnion === true
}

export const CONTACTS_NOT_SAVED_TEXT = 'Contacts not saved yet; stored from the next successful check'

/** Contact checks exist but no contact value is known (live or stored): say so instead of only the check line. */
export function contactsNotSavedYet(checks: readonly ContactCheckFact[] | null | undefined, contactValueCount: number): boolean {
  return (checks?.length ?? 0) > 0 && contactValueCount === 0
}

/** knownMint.lastKeysets in the probe's keyset shape, for the Compare input fee fallback. */
export function storedKeysetsAsLive(last: ReadonlyArray<{ id: string; unit: string; active: boolean; inputFeePpk: number | null }> | null | undefined): Array<{ id: string; unit: string; active: boolean; input_fee_ppk?: number }> | null {
  if (!last || last.length === 0) return null
  return last.map(k => ({ id: k.id, unit: k.unit, active: k.active, ...(typeof k.inputFeePpk === 'number' ? { input_fee_ppk: k.inputFeePpk } : {}) }))
}

/**
 * Compare audit-row value ("No mint fault (7d)", was "Audit success") from cashu.info's stored 7-day figures (auditCzTotal / auditCzBlamed): swaps without a
 * failure attributed to the mint, out of all its swaps. The breakdown's Audit row and Compare's "No mint fault (7d)"
 * row both use it, so the two always show the same "x / y". Null without a stored total (callers show neutral / n/a).
 */
export function auditSuccessText(blamed: number | null | undefined, total: number | null | undefined): string | null {
  if (total === null || total === undefined) return null
  return formatAuditSuccessRatio(total, Math.min(blamed ?? 0, total))
}
