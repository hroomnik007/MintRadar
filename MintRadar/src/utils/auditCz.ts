import type { AuditCzData, AuditCzDetail, AuditCzDirectionCounts } from '@/hooks/useAuditCz'
import { depositsTileText, withdrawalsTileText, AUDIT_WINDOW_DAYS } from './tooltipTexts'
import { formatTimeAgo } from './mintFormatting'
import { formatDateTimeUtc } from './formatDate'

// Adapter: cashu.info endpoint response → what the cashu.info Audit tab renders (four tiles from
// the stored 7-day detail, the auditor's checks, the outcome bar and two swap tables from the swaps
// MintRadar stored). Pure and display-only; never merged with audit.8333.space values. cashu.info's
// own score, score parts and reviews are not part of the response and never shown.

// The only link we render: exactly https://cashu.info/mint/<id> (the backend builds it from a validated id).
const AUDIT_CZ_PAGE_RE = /^https:\/\/cashu\.info\/mint\/[A-Za-z0-9]{8,64}$/
/** The detail job runs every 30 minutes: older than three runs is "not updated recently". */
export const AUDIT_CZ_NOT_RECENT_MS = 90 * 60 * 1000

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
  /** cashu.info only: swap stage, shown in brackets after the state. */
  stage?: string | null
  /** cashu.info view only: why the row is neutral grey and not counted (never set for 8333 rows). */
  neutral?: AuditCzNeutralKind
  /** Unused for cashu.info from-only rows; the To cell uses toUrl. */
  counterpart?: string
  /** cashu.info view only: `from` = this mint paid out (the other column is the destination), `to` = this mint received. */
  direction?: 'from' | 'to'
  /** cashu.info view only, rows that are not OK: the sanitized failure text (cleanAuditError), shown as the State cell's tooltip and as visually hidden text. */
  reason?: string
}

/** The 7-day verdict above everything else: how many swaps failed because of this mint, of how many. */
export interface AuditVerdict {
  total: number
  /** Failures cashu.info attributes to this mint (never more than total). */
  blamed: number
  /** Failed swaps cashu.info does not attribute to this mint. */
  failedElsewhere: number
  ok: number
}

/** One direction (deposits / withdrawals) of the same 7 days; ok and total are null when the source sent no numbers. */
export interface AuditDirectionFigure {
  key: 'mints' | 'melts'
  label: string
  tooltip: string
  ok: number | null
  total: number | null
  failed: number
}

export interface AuditDay { day: string; ok: number; failed: number; other: number }

export type AuditSwapFilter = 'all' | 'deposits' | 'withdrawals' | 'failed'

export interface AuditCzView {
  sourceHref: string | null
  /** When our stored detail (else the feed) was last fetched (ISO); null when unknown. */
  checkedAt: string | null
  /** Older than 90 minutes (the detail job runs every 30). */
  notRecent: boolean
  /** The stored swaps of the last 7 days, both directions, newest first (at most the 100 the page loads). */
  swaps: AuditSwapRow[]
  /** Null when the source sent no usable totals. */
  verdict: AuditVerdict | null
  directions: AuditDirectionFigure[]
  /** "8.3 s"; null when the source sent no average. */
  avgSwapTime: string | null
  /** MintRadar's own count per UTC day, oldest first; empty when the server sent none. */
  daily: AuditDay[]
  /** The long window of the score; null while it holds no more than 7 days. */
  long: { windowDays: number; swaps: number; attributedFailures: number } | null
  /** Everything stored so far; null when nothing is, or when it is no more than the long window. */
  since: { day: string; swaps: number; attributedFailures: number } | null
}

function swapState(status: string): string {
  if (status === 'success') return 'OK'
  return status // failed → "failed"; pending / unknown tokens are shown as they are
}

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

/** Longest failure text the State cell tooltip carries (the "…" counts), and the cap on the hidden text (the endpoint already stops at 300). */
export const AUDIT_CZ_REASON_TITLE_MAX = 200
const AUDIT_CZ_REASON_MAX = 300

// Line breaks and tabs become spaces; every other control, zero-width and bidi-override character is dropped
// (a right-to-left override in an error string could reorder the text around it).
function isLayoutBreak(cp: number): boolean {
  return (cp >= 9 && cp <= 13) || cp === 0x85 || cp === 0x2028 || cp === 0x2029
}
function isStrippable(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x200b && cp <= 0x200f)
    || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2069) || cp === 0xfeff
}

/** Untrusted error text of a swap → plain text for display: control characters removed, whitespace collapsed, at most 300 characters. null when nothing is left. */
export function cleanAuditError(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  let out = ''
  for (const ch of raw) {
    const cp = ch.codePointAt(0) as number
    if (isLayoutBreak(cp)) out += ' '
    else if (!isStrippable(cp)) out += ch
  }
  const text = truncateText(out.replace(/\s+/g, ' ').trim(), AUDIT_CZ_REASON_MAX)
  return text === '' ? null : text
}

/** At most `max` characters (code points), ending in "…" when it was cut. */
export function truncateText(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

/**
 * Tooltip of the State cell of a row that is not OK (cashu.info view). Grey rows start with the fixed
 * "Not counted against the mint: …" explanation, followed by the failure text; other rows carry the failure
 * text alone. undefined when there is nothing to say (OK rows, 8333 rows, no error text).
 */
export function auditCzStateTitle(s: Pick<AuditSwapRow, 'state' | 'neutral' | 'reason'>): string | undefined {
  if (s.state === 'OK') return undefined
  const reason = s.reason ? truncateText(s.reason, AUDIT_CZ_REASON_TITLE_MAX) : null
  if (s.neutral === 'limits' || s.neutral === 'balance') {
    const why = AUDIT_CZ_NEUTRAL_TITLE[s.neutral]
    return reason ? `${why}. ${reason}` : why
  }
  return reason ?? undefined
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)

/** "8.3 s"; under one second "{n} ms". */
export function formatAvgSwapTime(ms: number): string {
  const r = Math.round(ms)
  return r < 1000 ? `${r} ms` : `${(r / 1000).toFixed(1)} s`
}

/**
 * The Duration cell of a swap row. Under 1 s: "{n} ms"; under 60 s: seconds with one decimal ("10.9 s"). From 60 s: the two biggest units, whole numbers
 * (cut, not rounded) and a zero part left out: "1 min 2 s", "4 h 48 min", "2 d 3 h", "1 d". A failed swap can run for hours
 * before it fails or expires, which was unreadable in milliseconds.
 */
export function formatSwapDuration(ms: number): string {
  const r = Math.round(ms)
  if (r < 1000) return `${r} ms`
  if (r < 60_000) return `${(Math.floor(r / 100) / 10).toFixed(1)} s` // cut, not rounded: 59 999 ms is never "60.0 s"
  const parts = (big: number, bigUnit: string, rest: number, restUnit: string) => (rest > 0 ? `${big} ${bigUnit} ${rest} ${restUnit}` : `${big} ${bigUnit}`)
  const totalS = Math.floor(r / 1000)
  if (totalS < 3600) return parts(Math.floor(totalS / 60), 'min', totalS % 60, 's')
  const totalMin = Math.floor(totalS / 60)
  if (totalMin < 1440) return parts(Math.floor(totalMin / 60), 'h', totalMin % 60, 'min')
  const totalH = Math.floor(totalMin / 60)
  return parts(Math.floor(totalH / 24), 'd', totalH % 24, 'h')
}

const fmt = (n: number) => n.toLocaleString('en-US')

function directionFigure(key: 'mints' | 'melts', label: string, tooltip: string, d: AuditCzDirectionCounts | undefined): AuditDirectionFigure {
  const ok = num(d?.success), all = num(d?.total), failed = num(d?.failed)
  if (ok === undefined || all === undefined) return { key, label, tooltip, ok: null, total: null, failed: 0 }
  return { key, label, tooltip, ok: Math.min(ok, all), total: all, failed: Math.min(failed ?? all - ok, all) }
}

/** Deposits (mint) first: asDest = this mint was the destination of a swap. Withdrawals (melt) = asSource. */
export function auditDirections(d: AuditCzDetail): AuditDirectionFigure[] {
  const s = d.swaps7d
  return [
    directionFigure('mints', 'Deposits (mint)', depositsTileText(), s?.asDest),
    directionFigure('melts', 'Withdrawals (melt)', withdrawalsTileText(), s?.asSource),
  ]
}

/** The numbers of the score's 7-day window: (total, blamed) are exactly what the audit part reads. */
export function auditVerdict(d: AuditCzDetail): AuditVerdict | null {
  const s = d.swaps7d
  const total = num(s?.all?.total), blamedRaw = num(s?.errorsBlamed)
  if (total === undefined || total <= 0 || blamedRaw === undefined) return null
  const blamed = Math.min(blamedRaw, total)
  const failed = Math.min(Math.max(num(s?.all?.failed) ?? blamed, blamed), total)
  return { total, blamed, failedElsewhere: failed - blamed, ok: total - failed }
}

const swapsWord = (n: number) => (n === 1 ? '1 swap' : `${fmt(n)} swaps`)

/** "of 53 swaps failed because of this mint" (the number in front of it is `blamed`). */
export function auditVerdictHeadline(v: AuditVerdict): string {
  return `of ${swapsWord(v.total)} failed because of this mint`
}

/** The line under the headline: what happened to the other swaps. */
export function auditVerdictDetail(v: AuditVerdict): string {
  if (v.failedElsewhere === 0) return v.blamed === 0 ? `Every swap of the last ${AUDIT_WINDOW_DAYS} days succeeded.` : 'No other swap failed.'
  return `${swapsWord(v.failedElsewhere)} failed for other reasons and ${v.failedElsewhere === 1 ? 'does' : 'do'} not count against it.`
}

/** "Last 28 days: 2 of 212 swaps failed because of this mint." */
export function auditLongLine(l: { windowDays: number; swaps: number; attributedFailures: number }): string {
  return `Last ${l.windowDays} days: ${fmt(l.attributedFailures)} of ${swapsWord(l.swaps)} failed because of this mint.`
}

/** "Since 13 Nov 2026: 3 of 420 swaps." (`dayText` is the formatted first day.) */
export function auditSinceLine(s: { swaps: number; attributedFailures: number }, dayText: string): string {
  return `Since ${dayText}: ${fmt(s.attributedFailures)} of ${swapsWord(s.swaps)}.`
}

/** The rows a filter chip shows. "Failed" leaves out the grey rows that are not counted against the mint. */
export function filterAuditSwaps(rows: AuditSwapRow[], filter: AuditSwapFilter): AuditSwapRow[] {
  if (filter === 'deposits') return rows.filter(r => r.direction === 'to')
  if (filter === 'withdrawals') return rows.filter(r => r.direction === 'from')
  if (filter === 'failed') return rows.filter(r => r.state !== 'OK' && !r.neutral)
  return rows
}

/** Returns null when the mint is not covered or no detail is stored (the caller then shows the audit.8333.space panel or the empty panel). */
export function adaptAuditCz(data: AuditCzData | undefined, now: number): AuditCzView | null {
  if (!data || !data.covered || !data.mint || !data.detail) return null
  const rows: AuditSwapRow[] = data.swaps.map(s => {
    const state = swapState(s.status)
    const reason = state === 'OK' ? null : cleanAuditError(s.error)
    return {
      swapId: s.id,
      toUrl: s.otherMintUrl,
      amount: s.amount,
      fee: s.fee,
      createdAt: s.at || null,
      timeTakenMs: s.durationMs,
      state,
      error: s.error,
      stage: s.stage,
      direction: s.direction,
      ...(reason ? { reason } : {}),
    }
  }).map(r => {
    const neutral = auditCzNeutralKind(r)
    return neutral ? { ...r, neutral } : r
  })
  const checkedAt = data.detail.fetchedAt ?? data.fetchedAt
  const avg = num(data.detail.swaps7d?.all?.avgMs)
  const checkedMs = checkedAt ? new Date(checkedAt).getTime() : NaN
  return {
    sourceHref: data.sourceUrl && AUDIT_CZ_PAGE_RE.test(data.sourceUrl) ? data.sourceUrl : null,
    checkedAt,
    notRecent: Number.isFinite(checkedMs) && now - checkedMs > AUDIT_CZ_NOT_RECENT_MS,
    swaps: rows.filter(r => {
      const t = r.createdAt ? new Date(r.createdAt).getTime() : NaN
      return !Number.isFinite(t) || now - t <= AUDIT_WINDOW_DAYS * 86_400_000
    }),
    verdict: auditVerdict(data.detail),
    directions: auditDirections(data.detail),
    avgSwapTime: avg !== undefined ? formatAvgSwapTime(avg) : null,
    daily: Array.isArray(data.daily7d) ? data.daily7d : [],
    long: data.long ?? null,
    since: data.since && (!data.long || data.since.swaps > data.long.swaps) && data.since.swaps > (num(data.detail.swaps7d?.all?.total) ?? 0) ? data.since : null,
  }
}

export const AUDIT_CZ_NOT_RECENT_TEXT = 'not updated recently'

/**
 * The sync note after "via cashu.info" in the Audit stats header: "synced 2h ago", or "not updated recently"
 * (warning colour) once the stored detail is older than AUDIT_CZ_NOT_RECENT_MS. `tip` is the exact sync time
 * (UTC, like the "fetched …" time under Fees & limits), shown in a tooltip; null when the time is unknown.
 * The whole note is null when there is nothing to say.
 */
export function auditCzSyncNote(view: Pick<AuditCzView, 'checkedAt' | 'notRecent'>, now: number): { text: string; stale: boolean; tip: string | null } | null {
  const at = view.checkedAt ? new Date(view.checkedAt) : null
  const valid = !!at && Number.isFinite(at.getTime())
  const exact = valid ? formatDateTimeUtc(at) : ''
  if (view.notRecent) {
    return { text: AUDIT_CZ_NOT_RECENT_TEXT, stale: true, tip: exact ? `Last synced from cashu.info: ${exact}, more than 90 minutes ago.` : null }
  }
  if (!valid) return null
  return { text: `synced ${formatTimeAgo(at, now)}`, stale: false, tip: `Last synced from cashu.info: ${exact}.` }
}
