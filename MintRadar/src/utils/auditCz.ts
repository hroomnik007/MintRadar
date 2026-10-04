import type { AuditCzData } from '@/hooks/useAuditCz'
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
  /** Like audit_recent_total / audit_recent_errors: every swap counted, errors = state !== 'OK'. null without swaps. */
  recentTotal: number | null
  recentErrors: number | null
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
  const okTimes = swaps.filter(s => s.state === 'OK' && s.timeTakenMs !== null).map(s => s.timeTakenMs as number)
  const fetchedMs = data.fetchedAt ? new Date(data.fetchedAt).getTime() : NaN
  return {
    sourceHref: data.sourceUrl && data.sourceUrl.startsWith(AUDIT_CZ_PAGE_PREFIX) ? data.sourceUrl : null,
    lastCheck: data.mint.lastCheck,
    notRecent: Number.isFinite(fetchedMs) && now - fetchedMs > AUDIT_CZ_NOT_RECENT_MS,
    swaps,
    recentTotal: swaps.length > 0 ? swaps.length : null,
    recentErrors: swaps.length > 0 ? swaps.filter(s => s.state !== 'OK').length : null,
    avgTimeMs: okTimes.length > 0 ? okTimes.reduce((a, b) => a + b, 0) / okTimes.length : null,
    nMints: data.mint.minted,
    nMelts: data.mint.melted,
    sinceLabel: '',
    failuresAttributed: data.mint.attributedFailures,
  }
}
