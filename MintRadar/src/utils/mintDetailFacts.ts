// Pure display helpers for Mint Detail facts from the 2026-10-25 data audit: the Outages tiles, the Reliability Score
// breakdown from the stored record, last known info of an unavailable mint, the History summary and small offline
// fallbacks. Operational facts only; no verdict wording.
import type { ContactCheckFact } from './contactChecks'
import { formatAuditSuccessRatio } from './mintFormatting'
import { limitsSource } from './feesLimits'

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
  /** Longest outage of the window in ms (an ongoing one up to now), 0 without one; absent from an older API. */
  longestOutageMs?: number
  outages: OutageEntry[]
}

/** "45 min", "3h 20m", "6d 18h": a duration of the Outages panel and of the score's longest-outage figure. */
export function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.round(ms / 60000)} min`
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`
}

// ── Reliability Score breakdown from the stored record ──────────────────────────────────────────────────────────────

export interface StoredPart { points: number; max: number }
/** The four parts of the uptime component and the 30-day figures they used (methodology 7; backend scoreBreakdown.ts). */
export interface StoredUptimeParts { last24h: StoredPart; last30d: StoredPart; longestOutage: StoredPart; outageCount: StoredPart }
export interface StoredUptimeInputs { uptime24hPct: number; uptime30dPct: number; outageCount30d: number; longestOutage30dMs: number; ongoingOutage: boolean }
export interface StoredScoreBreakdown {
  uptime: StoredPart
  /** Absent in a record stored before methodology 7. */
  uptimeParts?: StoredUptimeParts
  uptimeInputs?: StoredUptimeInputs
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
 * never a value. Only kinds with a recognised format, the ones the score counts (methodology 9). null when there are none.
 */
export function contactKindsText(checks: readonly ContactCheckFact[] | null | undefined): string | null {
  const kinds = ['email', 'twitter', 'nostr'].filter(k => (checks ?? []).some(c => c.kind === k && c.formatValid))
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

/** " · 1 outage" next to a 30-day uptime of a rounded 100 % that still had outages in the window; '' otherwise. */
export function uptime30dOutageNote(pct: number | null | undefined, outageCount: number | null | undefined): string {
  if (pct !== 100 || !outageCount || outageCount <= 0) return ''
  return ` · ${outageCount === 1 ? '1 outage' : `${outageCount} outages`}`
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

// ── NUTs tab: the nutzap sentence under the NUT grid ─────────────────────────────────────────────────────────────────

/** Which NUTs nutzaps (NIP-61) rely on. No verdict about the mint. */
export const NUTZAP_NUTS_NOTE = 'NUT-07, NUT-10, NUT-11 and NUT-12 are the ones nutzaps (NIP-61) rely on'

/**
 * The sentence with the source and time of the grid above: " · from the mint's /v1/info, checked 5 min ago" (the exact
 * UTC time as `title`, like "fetched …" under Fees and limits, same helper). `fetchedAt` is the page's latest successful
 * /v1/info time (the latest probe while online, else the last time the mint was seen online). Without a time the source
 * stays and the time is left out.
 */
export function nutzapNote(fetchedAt: string | null | undefined, now: number): { lead: string; time: { label: string; title: string } | null } {
  const src = limitsSource(fetchedAt, now)
  return { lead: `${NUTZAP_NUTS_NOTE} · from the mint's /v1/info`, time: src.time }
}

// ── Uptime 24h tile (Mint Detail header) ─────────────────────────────────────────────────────────────────────────────

export interface UptimeTileInput {
  /** The dedicated 24 h history query: 'pending' before its first answer, 'error' when it failed. */
  state: 'pending' | 'error' | 'ready'
  /** uptimePct of that answer (null when it had no checks). */
  pct: number | null
  onlineChecks: number
  totalChecks: number
  /** The 24 h uptime already in the known-mints list, shown while the history loads (no "0 / 0 checks" flash). */
  listPct: number | null | undefined
}

/** Value and sub-line of the Uptime 24h tile. Never "0 / 0 checks" for a query that has not answered yet. */
export function uptimeTileText(i: UptimeTileInput): { pct: number | null; value: string; sub: string } {
  if (i.state !== 'ready') {
    const pct = typeof i.listPct === 'number' ? i.listPct : null
    return { pct, value: pct !== null ? `${pct}%` : '—', sub: i.state === 'pending' ? 'loading checks…' : 'checks not loaded' }
  }
  const value = i.pct !== null ? `${i.pct}%` : '—'
  if (i.totalChecks === 0) return { pct: i.pct, value, sub: 'no checks yet' }
  if (i.totalChecks === 1) return { pct: i.pct, value, sub: `${i.onlineChecks} check` }
  return { pct: i.pct, value, sub: `${i.onlineChecks} / ${i.totalChecks} checks` }
}
