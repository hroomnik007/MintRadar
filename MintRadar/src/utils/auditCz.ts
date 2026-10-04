import type { AuditCzData, AuditCzDetail7d } from '@/hooks/useAuditCz'

// Adapter: audit.cashu.cz endpoint response → the data shape the existing audit.8333.space Audit
// tab components consume (strip tiles, outcome bar, Recent swaps table), so the same rendering
// code computes everything. Pure and display-only; numbers are counted by MintRadar from the
// swaps it stored and never merged with audit.8333.space values.

export const AUDIT_CZ_PAGE_PREFIX = 'https://audit.cashu.cz/'
export const AUDIT_CZ_NOT_RECENT_MS = 30 * 60 * 1000

/** Same shape as a row of GET /api/mints/swaps (audit.8333.space), plus two audit.cashu.cz extras. */
export type AuditCzNeutralKind = 'limits' | 'balance' | 'pending'

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
  /** audit.cashu.cz view only: why the row is neutral grey and not counted (never set for 8333 rows). */
  neutral?: AuditCzNeutralKind
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
  /** The tile's counts over the SAME swaps as the bar and the table: neutral rows (limits, balance, pending)
   *  are left out of both. recentTotal = counted swaps, recentErrors = counted swaps that are not OK. null when none counted. */
  recentTotal: number | null
  recentErrors: number | null
  /** "3 Oct": date of the oldest swap in the list (UTC); null without swaps. */
  sinceLabel: string | null
  /** The source's own 7-day counts; feeds Mints / Melts and the attributed-failures sentence of the tile tooltip. */
  detail7d: AuditCzDetail7d | null
  /** Mean duration of OK swaps with a known time (as computeSwapStats does); null otherwise. */
  avgTimeMs: number | null
  /** detail.asDest.success / asSource.success, else the list feed's swaps.minted / swaps.melted. null shows "—". */
  nMints: number | null
  nMelts: number | null
  /** attributedFailures as published by audit.cashu.cz (its own window). */
  failuresAttributed: number | null
}

function swapState(status: string): string {
  if (status === 'success') return 'OK'
  return status // failed → "failed"; pending / unknown tokens are shown as they are
}

export const AUDIT_CZ_MIN_SWAPS = 3

export const AUDIT_CZ_NEUTRAL_TEXT: Record<'limits' | 'balance', string> = {
  limits: 'below minimum',
  balance: 'auditor balance',
}
export const AUDIT_CZ_NEUTRAL_TITLE: Record<'limits' | 'balance', string> = {
  limits: "Not counted against the mint: the auditor's test was below the mint's minimum amount",
  balance: "Not counted against the mint: the auditor's wallet had too little balance",
}

/**
 * Failures that are not the mint's fault, and swaps without an outcome yet: neutral grey, not counted.
 * Stage "limits" = the auditor sent an amount below the mint's minimum; stage "balance" = the auditor's
 * own wallet could not fund the swap. A swap without a stage is recognised by its error text.
 * Everything else that is not OK (melt / mint failures, timeouts, unknown tokens) is counted and red.
 */
export function auditCzNeutralKind(s: { state: string; stage?: string | null; error?: string | null }): AuditCzNeutralKind | undefined {
  if (s.state === 'OK') return undefined
  if (s.state === 'pending') return 'pending'
  const stage = s.stage || null
  const err = s.error ?? ''
  if (stage === 'limits' || (stage === null && err.startsWith('Amount ') && err.includes('is below the mint minimum'))) return 'limits'
  if (stage === 'balance' || (stage === null && err.startsWith('Insufficient balance:'))) return 'balance'
  return undefined
}

/** Recent success rate tile of the cashu.cz view: "{ok} / {counted}" + "{pct}% ok", or n/a below 3 counted swaps. */
export function auditCzSuccessTile(v: { recentTotal: number | null; recentErrors: number | null }): { counted: number; main: string | null; sub: string } {
  const counted = v.recentTotal ?? 0
  if (counted < AUDIT_CZ_MIN_SWAPS) return { counted, main: null, sub: 'n/a' }
  const ok = counted - (v.recentErrors ?? 0)
  return { counted, main: `${ok} / ${counted}`, sub: `${Math.round((ok / counted) * 100)}% ok` }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function oldestLabel(swaps: AuditSwapRow[]): string | null {
  let oldest = Infinity
  for (const s of swaps) {
    const t = s.createdAt ? new Date(s.createdAt).getTime() : NaN
    if (Number.isFinite(t) && t < oldest) oldest = t
  }
  if (!Number.isFinite(oldest)) return null
  const d = new Date(oldest)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
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
  })).map(r => {
    const neutral = auditCzNeutralKind(r)
    return neutral ? { ...r, neutral } : r
  })
  // The tile counts exactly the rows the bar and the table show as OK or red.
  const counted = swaps.filter(s => !s.neutral)
  const okTimes = swaps.filter(s => s.state === 'OK' && s.timeTakenMs !== null).map(s => s.timeTakenMs as number)
  const fetchedMs = data.fetchedAt ? new Date(data.fetchedAt).getTime() : NaN
  return {
    sourceHref: data.sourceUrl && data.sourceUrl.startsWith(AUDIT_CZ_PAGE_PREFIX) ? data.sourceUrl : null,
    lastCheck: data.mint.lastCheck,
    notRecent: Number.isFinite(fetchedMs) && now - fetchedMs > AUDIT_CZ_NOT_RECENT_MS,
    swaps,
    recentTotal: counted.length > 0 ? counted.length : null,
    recentErrors: counted.length > 0 ? counted.filter(s => s.state !== 'OK').length : null,
    sinceLabel: oldestLabel(swaps),
    detail7d: data.detail7d ?? null,
    avgTimeMs: okTimes.length > 0 ? okTimes.reduce((a, b) => a + b, 0) / okTimes.length : null,
    nMints: data.detail7d?.minted ?? data.mint.minted,
    nMelts: data.detail7d?.melted ?? data.mint.melted,
    failuresAttributed: data.mint.attributedFailures,
  }
}
