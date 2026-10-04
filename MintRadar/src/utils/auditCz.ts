import type { AuditCzData } from '@/hooks/useAuditCz'
import { mintHostname } from '@/utils/mintFormatting'

// Adapter: audit.cashu.cz endpoint response → the shapes the Audit tab renders (Lightning swaps
// tiles, outcome bar, Recent swaps table). Pure and display-only. All tile numbers are counted by
// MintRadar from the swaps it stored (backend `stats7d`), never merged with audit.8333.space values.

export const AUDIT_CZ_PAGE_PREFIX = 'https://audit.cashu.cz/'
export const AUDIT_CZ_NOT_RECENT_MS = 30 * 60 * 1000
const WINDOW_MS = 7 * 86_400_000

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

export interface AuditCzDirectionView {
  paid: number
  /** paid + failed */
  total: number
  amountPaid: number
  feesPaid: number
}

export interface AuditCzLightning {
  swapsCounted: number
  paid: number
  failed: number
  pending: number
  melts: AuditCzDirectionView
  mints: AuditCzDirectionView
  avgDurationMsPaid: number | null
  /** "last 7 days" when the stored swaps cover the whole window, else "since 3 Oct". */
  windowLabel: string
}

export interface AuditCzView {
  sourceHref: string | null
  /** lastCheck of the source (ISO) for "checked …"; null when unknown. */
  lastCheck: string | null
  /** Our own sync (fetchedAt) older than 30 min. */
  notRecent: boolean
  swaps: AuditSwapRow[]
  /** null when the backend sent no stats (old backend / not covered). */
  lightning: AuditCzLightning | null
  /** attributedFailures as published by audit.cashu.cz (its own window). */
  failuresAttributed: number | null
  verdict: string
}

const STATE_LABEL: Record<string, string> = { ok: 'OK', warn: 'Warning', error: 'Error' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function swapState(status: string): { state: string; neutral: boolean } {
  if (status === 'success') return { state: 'OK', neutral: false }
  if (status === 'failed') return { state: 'failed', neutral: false }
  return { state: status, neutral: true }
}

function windowLabel(collectedSince: string | null, now: number): string {
  const t = collectedSince ? new Date(collectedSince).getTime() : NaN
  if (!Number.isFinite(t) || t <= now - WINDOW_MS) return 'last 7 days'
  const d = new Date(t)
  return `since ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

function lightningOf(stats: NonNullable<AuditCzData['stats7d']>, now: number): AuditCzLightning {
  const dir = (d: typeof stats.melts): AuditCzDirectionView => ({
    paid: d.paid, total: d.paid + d.failed, amountPaid: d.amountPaid, feesPaid: d.feesPaid,
  })
  return {
    swapsCounted: stats.swapsCounted,
    paid: stats.melts.paid + stats.mints.paid,
    failed: stats.melts.failed + stats.mints.failed,
    pending: stats.melts.pending + stats.mints.pending,
    melts: dir(stats.melts),
    mints: dir(stats.mints),
    avgDurationMsPaid: stats.avgDurationMsPaid,
    windowLabel: windowLabel(stats.collectedSince, now),
  }
}

/** Returns null when the mint is not covered (the caller then shows the audit.8333.space panel). */
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
  const fetchedMs = data.fetchedAt ? new Date(data.fetchedAt).getTime() : NaN
  return {
    sourceHref: data.sourceUrl && data.sourceUrl.startsWith(AUDIT_CZ_PAGE_PREFIX) ? data.sourceUrl : null,
    lastCheck: m.lastCheck,
    notRecent: Number.isFinite(fetchedMs) && now - fetchedMs > AUDIT_CZ_NOT_RECENT_MS,
    swaps,
    lightning: data.stats7d ? lightningOf(data.stats7d, now) : null,
    failuresAttributed: m.attributedFailures,
    verdict: STATE_LABEL[m.state] ?? m.state,
  }
}
