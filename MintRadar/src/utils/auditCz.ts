import type { AuditCzData, AuditCzDetail7d } from '@/hooks/useAuditCz'
import { mintHostname } from '@/utils/mintFormatting'

// Adapter: audit.cashu.cz endpoint response → the data shape the existing audit.8333.space Audit
// tab components consume (strip tiles, outcome bar, Recent swaps table), so the same rendering
// code computes everything. Pure and display-only; numbers are counted by MintRadar from the
// swaps it stored and never merged with audit.8333.space values.

export const AUDIT_CZ_PAGE_PREFIX = 'https://audit.cashu.cz/'
export const AUDIT_CZ_NOT_RECENT_MS = 30 * 60 * 1000
const WINDOW_MS = 7 * 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Same shape as a row of GET /api/mints/swaps (audit.8333.space), plus two audit.cashu.cz extras. */
export interface AuditSwapRow {
  swapId: string | number
  toUrl: string | null
  amount: number | null
  fee: number | null
  createdAt: string | null
  timeTakenMs: number | null
  state: string
  error: string | null
  /** audit.cashu.cz only: swap stage, shown in brackets after the state. */
  stage?: string | null
  /** Unused for audit.cashu.cz from-only rows; the To cell uses toUrl. */
  counterpart?: string
}

export interface AuditCzView {
  sourceHref: string | null
  /** lastCheck of the source (ISO); null when unknown. */
  lastCheck: string | null
  /** Our own sync (fetchedAt) older than 30 min. */
  notRecent: boolean
  swaps: AuditSwapRow[]
  /** Like audit_recent_total / audit_recent_errors over the stored from-swaps, but swaps with stage
   *  "limits" and pending swaps are left out of both counts. errors = state !== 'OK'. null when nothing is counted. */
  recentTotal: number | null
  recentErrors: number | null
  /** The source's own 7-day counts (with errorsBlamed); null when unavailable (tile uses recentTotal/Errors). */
  detail7d: AuditCzDetail7d | null
  /** Mean duration of OK swaps with a known time (as computeSwapStats does); null otherwise. */
  avgTimeMs: number | null
  /** audit.cashu.cz swaps.minted / swaps.melted. null hides the tile. */
  nMints: number | null
  nMelts: number | null
  /** "3 Oct": start of the window the counts cover (collectedSince, at most 7 days back). */
  sinceLabel: string
  /** attributedFailures as published by audit.cashu.cz (its own window). */
  failuresAttributed: number | null
}

function swapState(status: string): string {
  if (status === 'success') return 'OK'
  return status // failed → "failed"; pending / unknown tokens are shown as they are
}

function sinceLabel(collectedSince: string | null | undefined, now: number): string {
  const t = collectedSince ? new Date(collectedSince).getTime() : NaN
  const start = new Date(Number.isFinite(t) ? Math.max(t, now - WINDOW_MS) : now - WINDOW_MS)
  return `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]}`
}

/** The auditor's pre-flight failures (e.g. amount below the mint's minimum): not an event on the mint. */
export const AUDIT_CZ_NEUTRAL_STAGE = 'limits'
export const AUDIT_CZ_MIN_SWAPS = 3

/** Failed with stage "limits": shown neutral in the table and bar. Every other non-OK row keeps the failed styling. */
export function isAuditCzNeutralRow(s: { state: string; stage?: string | null }): boolean {
  return s.state !== 'OK' && s.stage === AUDIT_CZ_NEUTRAL_STAGE
}

/**
 * Swap success as audit.cashu.cz's methodology defines it: "the share of the mint's swaps without a
 * failure attributed to it", counted from 3 swaps or from the first attributed failure. Failures the
 * auditor does not attribute to a mint therefore do not count against it. null = too few to show.
 */
export function auditCzSwapSuccess(d: AuditCzDetail7d): { good: number; total: number; pct: number } | null {
  if (d.total <= 0 || (d.total < AUDIT_CZ_MIN_SWAPS && d.errorsBlamed === 0)) return null
  const good = Math.max(0, d.total - d.errorsBlamed)
  return { good, total: d.total, pct: Math.round((good / d.total) * 100) }
}

/** Returns null when the mint is not covered (the caller then shows the audit.8333.space panel). */
export function adaptAuditCz(data: AuditCzData | undefined, now: number): AuditCzView | null {
  if (!data || !data.covered || !data.mint) return null
  const swaps: AuditSwapRow[] = data.swaps.map(s => ({
    swapId: s.id,
    toUrl: s.otherMintUrl,
    amount: s.amount,
    fee: s.fee,
    createdAt: s.at || null,
    timeTakenMs: s.durationMs,
    state: swapState(s.status),
    error: s.error,
    stage: s.stage,
  }))
  // Tile fallback counts: no "limits" stage, no pending; no other stage is excluded.
  const counted = swaps.filter(s => s.state !== 'pending' && s.stage !== AUDIT_CZ_NEUTRAL_STAGE)
  const okTimes = swaps.filter(s => s.state === 'OK' && s.timeTakenMs !== null).map(s => s.timeTakenMs as number)
  const fetchedMs = data.fetchedAt ? new Date(data.fetchedAt).getTime() : NaN
  return {
    sourceHref: data.sourceUrl && data.sourceUrl.startsWith(AUDIT_CZ_PAGE_PREFIX) ? data.sourceUrl : null,
    lastCheck: data.mint.lastCheck,
    notRecent: Number.isFinite(fetchedMs) && now - fetchedMs > AUDIT_CZ_NOT_RECENT_MS,
    swaps,
    recentTotal: counted.length > 0 ? counted.length : null,
    recentErrors: counted.length > 0 ? counted.filter(s => s.state !== 'OK').length : null,
    detail7d: data.detail7d ?? null,
    avgTimeMs: okTimes.length > 0 ? okTimes.reduce((a, b) => a + b, 0) / okTimes.length : null,
    nMints: data.mint.minted,
    nMelts: data.mint.melted,
    sinceLabel: '',
    failuresAttributed: data.mint.attributedFailures,
  }
}
