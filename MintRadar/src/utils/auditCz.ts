import type { AuditCzData } from '@/hooks/useAuditCz'
import { mintHostname } from '@/utils/mintFormatting'
import { auditFreshness } from '@/utils/auditFreshness'

// Adapter: audit.cashu.cz endpoint response → the shapes the existing Audit tab
// components render (summary tiles, outcome bar, Recent swaps table). Pure and
// display-only. Rules (see docs/claude/card-and-mint-detail-ui.md):
//  - a tile is filled only if it means the same as the audit.8333.space tile; else hidden
//  - numbers MintRadar counts itself (success rate, average time) come from the stored
//    swaps and are labelled as such in their tooltips; nothing is merged with 8333 values.

export const AUDIT_CZ_PAGE_PREFIX = 'https://audit.cashu.cz/'
export const AUDIT_CZ_NOT_RECENT_MS = 30 * 60 * 1000

export interface AuditSwapRow {
  swapId: string | number
  toUrl: string | null
  amount: number | null
  fee: number | null
  createdAt: string | null
  timeTakenMs: number | null
  state: string
  error: string | null
  /** audit.cashu.cz only: swap stage, shown after the state. */
  stage?: string | null
  /** audit.cashu.cz only: counterpart label ("to host" / "from host"); replaces the "To" cell. */
  counterpart?: string
  /** audit.cashu.cz only: pending/unknown status — neither a success nor a failure. */
  neutral?: boolean
}

export interface AuditCzView {
  sourceHref: string | null
  /** lastCheck of the source (ISO) for "checked …"; null when unknown. */
  lastCheck: string | null
  /** Our own sync (fetchedAt) older than 30 min. */
  notRecent: boolean
  swaps: AuditSwapRow[]
  /** success / (success + failed) over the swaps above; null when there is none. */
  success: { total: number; errors: number } | null
  /** Mean duration of successful swaps that carry a duration; null otherwise. */
  avgTimeMs: number | null
  verdict: { label: string; tone: 'ok' | 'warn' | 'error' | 'other' }
  /** Already formatted, e.g. "100% (24 h, 7 d, 30 d)" or "100% (24 h) · 99% (7 d)"; null when no value. */
  uptime: string | null
}

const STATE_LABEL: Record<string, string> = { ok: 'OK', warn: 'Warning', error: 'Error' }

const fmtPct = (v: number): string => `${Number.isInteger(v) ? v : v.toFixed(1)}%`

function uptimeText(u24: number | null, u7: number | null, u30: number | null): string | null {
  const parts: Array<[number, string]> = []
  if (u24 !== null) parts.push([u24, '24 h'])
  if (u7 !== null) parts.push([u7, '7 d'])
  if (u30 !== null) parts.push([u30, '30 d'])
  if (parts.length === 0) return null
  if (parts.every(([v]) => v === parts[0]![0])) {
    return `${fmtPct(parts[0]![0])} (${parts.map(([, l]) => l).join(', ')})`
  }
  return parts.map(([v, l]) => `${fmtPct(v)} (${l})`).join(' · ')
}

function swapState(status: string): { state: string; neutral: boolean } {
  if (status === 'success') return { state: 'OK', neutral: false }
  if (status === 'failed') return { state: 'failed', neutral: false }
  return { state: status, neutral: true }
}

/** Returns null when the mint is not covered (the caller then shows today's panel). */
export function adaptAuditCz(data: AuditCzData | undefined, now: number): AuditCzView | null {
  if (!data || !data.covered || !data.mint) return null
  const m = data.mint
  const swaps: AuditSwapRow[] = data.swaps.map(s => {
    const { state, neutral } = swapState(s.status)
    const other = s.otherMintUrl ? mintHostname(s.otherMintUrl) : (s.otherMintName ?? '—')
    return {
      swapId: s.id,
      toUrl: null,
      amount: s.amount,
      fee: s.fee,
      createdAt: s.at || null,
      timeTakenMs: s.durationMs,
      state,
      error: s.error,
      stage: s.stage,
      counterpart: other === '—' ? '—' : `${s.direction === 'from' ? 'to' : 'from'} ${other}`,
      neutral,
    }
  })
  const ok = data.swaps.filter(s => s.status === 'success')
  const failed = data.swaps.filter(s => s.status === 'failed')
  const decided = ok.length + failed.length
  const durations = ok.map(s => s.durationMs).filter((d): d is number => d !== null)
  const fetchedMs = data.fetchedAt ? new Date(data.fetchedAt).getTime() : NaN
  const tone = m.state === 'ok' || m.state === 'warn' || m.state === 'error' ? m.state : 'other'
  return {
    sourceHref: data.sourceUrl && data.sourceUrl.startsWith(AUDIT_CZ_PAGE_PREFIX) ? data.sourceUrl : null,
    lastCheck: m.lastCheck,
    notRecent: Number.isFinite(fetchedMs) && now - fetchedMs > AUDIT_CZ_NOT_RECENT_MS,
    swaps,
    success: decided > 0 ? { total: decided, errors: failed.length } : null,
    avgTimeMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    verdict: { label: STATE_LABEL[m.state] ?? m.state, tone },
    uptime: uptimeText(m.uptime24h, m.uptime7d, m.uptime30d),
  }
}

/**
 * Fallback condition (unchanged from 7769b23): the known-mints list has loaded and the
 * audit.8333.space data is missing (no auditNMints) or stale (auditor data >7d / our sync >24h).
 */
export function auditCzFallbackNeeded(
  knownMintsLoaded: boolean,
  /** auditNMints of the tracked mint; null when the mint is unknown OR has no audit data. */
  auditNMints: number | null | undefined,
  auditCheckedAt: string | null,
  auditSyncedAt: string | null,
  now: number,
): boolean {
  if (!knownMintsLoaded) return false
  if (auditNMints === null) return true
  const f = auditFreshness(auditCheckedAt, auditSyncedAt, now)
  return f.auditorDataOld || f.syncStale
}
