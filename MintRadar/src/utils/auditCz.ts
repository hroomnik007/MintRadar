import type { AuditCzData, AuditCzDetail, AuditCzDirectionCounts, AuditCzPeriodView, AuditCzPeriods, AuditCzWeek } from '@/hooks/useAuditCz'
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

/** The 7-day figures above everything else: how many swaps ran, how many failed because of this mint, and the raw success rate. */
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
  /** Stored swaps of the last 30 days (the feed retention), newest first; the tab then keeps the selected 7- or 30-day window. */
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
  /** The single longer-window line; null while the long window is 7 days or shorter. Kept for helpers; the tab no longer shows it. */
  longer: { day: string; swaps: number; attributedFailures: number } | null
  /** Oldest stored swap for this mint (ISO); null when none. */
  swapsSince: string | null
  /** Official 7-day and 30-day views; d30 is null until the 30-day graph has been stored. */
  periods: AuditCzPeriods
  /** Stored weekly snapshots, oldest first; the tab shows the newest four that exist. */
  weeks: AuditCzWeek[]
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
export function auditDirections(d: AuditCzDetail, days: number = AUDIT_WINDOW_DAYS): AuditDirectionFigure[] {
  const s = d.swaps7d
  return [
    directionFigure('mints', 'Deposits (mint)', depositsTileText(days), s?.asDest),
    directionFigure('melts', 'Withdrawals (melt)', withdrawalsTileText(days), s?.asSource),
  ]
}

/** The tab's headline, bar and tiles for one official period (7 or 30 days). */
export function auditVerdictFromPeriod(p: AuditCzPeriodView): AuditVerdict {
  return { total: p.swaps, blamed: p.attributedFailures, failedElsewhere: p.failedElsewhere, ok: p.succeeded }
}

export function auditDirectionsFromPeriod(p: AuditCzPeriodView): AuditDirectionFigure[] {
  const asCounts = (s: { success: number; total: number; failed: number } | null): AuditCzDirectionCounts | undefined =>
    s ? { success: s.success, total: s.total, failed: s.failed } : undefined
  return [
    directionFigure('mints', 'Deposits (mint)', depositsTileText(p.days), asCounts(p.deposits)),
    directionFigure('melts', 'Withdrawals (melt)', withdrawalsTileText(p.days), asCounts(p.withdrawals)),
  ]
}

export function auditAvgFromPeriod(p: AuditCzPeriodView): string | null {
  return p.avgMs !== null && Number.isFinite(p.avgMs) ? formatAvgSwapTime(p.avgMs) : null
}

/** The numbers of the score's 7-day window: (total, blamed) are exactly what the audit part reads. */
export function auditVerdict(d: AuditCzDetail): AuditVerdict | null {
  const s = d.swaps7d
  const total = num(s?.all?.total), blamedRaw = num(s?.errorsBlamed)
  if (total === undefined || blamedRaw === undefined) return null
  const blamed = Math.min(blamedRaw, total)
  const failed = Math.min(Math.max(num(s?.all?.failed) ?? blamed, blamed), total)
  return { total, blamed, failedElsewhere: failed - blamed, ok: total - failed }
}

const swapsWord = (n: number) => (n === 1 ? '1 swap' : `${fmt(n)} swaps`)
const failuresWord = (n: number) => (n === 1 ? '1 failure' : `${fmt(n)} failures`)

/** True when the long window is one Methodology 8 would use: more than the 7-day window. */
export function isLongerAuditWindow<T extends { windowDays: number }>(l: T | null | undefined): l is T {
  return !!l && l.windowDays > AUDIT_WINDOW_DAYS
}

/**
 * The Audit tab's headline beside its big number (2026-11-19 redesign): the number is the failures cashu.info puts on
 * this mint, the words say of how many swaps over how long. "failures caused by this mint in 126 swaps over 7 days",
 * "failure caused by this mint in 1 swap over 7 days"; with no swaps the number is the 0 swaps: "swaps in the last 7 days".
 */
export function auditVerdictSentence(v: AuditVerdict, days: number = AUDIT_WINDOW_DAYS): { number: string; words: string } {
  if (v.total === 0) return { number: '0', words: `swaps in the last ${days} days` }
  return { number: fmt(v.blamed), words: `${v.blamed === 1 ? 'failure' : 'failures'} caused by this mint in ${swapsWord(v.total)} over ${days} days` }
}

/** "Last 7 days: 50 swaps, 0 failures caused by this mint"; with no swaps, only the count (the readout's aria name). */
export function auditVerdictHeadline(v: AuditVerdict, days: number = AUDIT_WINDOW_DAYS): string {
  if (v.total === 0) return `Last ${days} days: 0 swaps`
  return `Last ${days} days: ${swapsWord(v.total)}, ${failuresWord(v.blamed)} caused by this mint`
}

/** Successful swaps / all swaps in the last 7 days, to one decimal; null when there were none. */
export function auditSuccessRate(v: AuditVerdict): number | null {
  if (v.total <= 0) return null
  return Math.round((v.ok / v.total) * 1000) / 10
}

/** "92.4%" / "100%" (en-US, no trailing .0) or "—" when there were no swaps. */
export function auditSuccessRateText(v: AuditVerdict): string {
  const rate = auditSuccessRate(v)
  if (rate === null) return '—'
  return `${rate.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(rate) ? 0 : 1, maximumFractionDigits: 1 })}%`
}

export function auditSuccessRateCaption(days: number = AUDIT_WINDOW_DAYS): string {
  return `Success rate · ${days} days`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** Exact label for a stored week, e.g. "7–14 Nov", "28 Oct–4 Nov", "30 Dec 2025–6 Jan 2026". */
export function auditWeekLabel(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`)
  const e = new Date(`${end}T00:00:00Z`)
  if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime())) return `${start}–${end}`
  const sm = MONTHS[s.getUTCMonth()]
  const em = MONTHS[e.getUTCMonth()]
  const sd = s.getUTCDate()
  const ed = e.getUTCDate()
  const sy = s.getUTCFullYear()
  const ey = e.getUTCFullYear()
  if (sy !== ey) return `${sd} ${sm} ${sy}–${ed} ${em} ${ey}`
  if (sm === em) return `${sd}–${ed} ${sm}`
  return `${sd} ${sm}–${ed} ${em}`
}

/** The newest stored weekly snapshots, at most `limit`, in chronological order. No empty placeholder weeks. */
export function auditWeeksForChart(weeks: AuditCzWeek[] | undefined | null, limit = 4): AuditCzWeek[] {
  if (!Array.isArray(weeks) || weeks.length === 0 || limit <= 0) return []
  return weeks.slice(-limit)
}

/** Under the success rate: the score still ignores failures the source does not attribute to this mint. */
export const AUDIT_SCORE_HINT = 'The Reliability Score counts only the failures cashu.info puts on this mint. A payment that fails somewhere else on Lightning is not held against it.'

/**
 * The one longer-window figure the Audit tab shows. Hidden while the long window is 7 days or
 * shorter (methodology 8 ignores it then). When `since` holds more than the long window, those
 * totals and its start day are used; otherwise the long window's totals, with `since.day` when
 * the server sent one, or a start day `windowDays` back from `now`.
 */
export function auditLongerWindow(
  long: { windowDays: number; swaps: number; attributedFailures: number } | null | undefined,
  since: { day: string; swaps: number; attributedFailures: number } | null | undefined,
  now: number,
): { day: string; swaps: number; attributedFailures: number } | null {
  if (!isLongerAuditWindow(long)) return null
  if (since && since.swaps > long.swaps) return since
  const day = since?.day ?? new Date(now - long.windowDays * 86_400_000).toISOString().slice(0, 10)
  return { day, swaps: long.swaps, attributedFailures: long.attributedFailures }
}

/** "Longer window (since 13 Nov 2026): 420 swaps, 3 failures caused by this mint" (`dayText` is the formatted first day.) */
export function auditSinceLine(s: { swaps: number; attributedFailures: number }, dayText: string): string {
  return `Longer window (since ${dayText}): ${swapsWord(s.swaps)}, ${failuresWord(s.attributedFailures)} caused by this mint`
}

/** The rows a filter chip shows. "Failed" leaves out the grey rows that are not counted against the mint. */
export function filterAuditSwaps(rows: AuditSwapRow[], filter: AuditSwapFilter): AuditSwapRow[] {
  if (filter === 'deposits') return rows.filter(r => r.direction === 'to')
  if (filter === 'withdrawals') return rows.filter(r => r.direction === 'from')
  if (filter === 'failed') return rows.filter(r => r.state !== 'OK' && !r.neutral)
  return rows
}

export const AUDIT_SWAPS_MAX_DAYS = 30

/** Swaps whose time falls in the last `days` days (rows without a time are kept). */
export function auditSwapsForPeriod(rows: AuditSwapRow[], days: 7 | 30, now: number): AuditSwapRow[] {
  const maxAge = days * 86_400_000
  return rows.filter(r => {
    const t = r.createdAt ? new Date(r.createdAt).getTime() : NaN
    return !Number.isFinite(t) || now - t <= maxAge
  })
}

/** "since 8 Nov" when the 30-day list does not reach back a full 30 days; otherwise null. */
export function auditSwapsSinceNote(swapsSince: string | null | undefined, days: 7 | 30, now: number): string | null {
  if (days !== 30 || !swapsSince) return null
  const t = new Date(swapsSince).getTime()
  if (!Number.isFinite(t) || now - t >= AUDIT_SWAPS_MAX_DAYS * 86_400_000) return null
  const d = new Date(swapsSince)
  const month = MONTHS[d.getUTCMonth()]
  const day = d.getUTCDate()
  const year = d.getUTCFullYear()
  const nowYear = new Date(now).getUTCFullYear()
  return year !== nowYear ? `since ${day} ${month} ${year}` : `since ${day} ${month}`
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
    swaps: auditSwapsForPeriod(rows, AUDIT_SWAPS_MAX_DAYS, now),
    verdict: auditVerdict(data.detail),
    directions: auditDirections(data.detail),
    avgSwapTime: avg !== undefined ? formatAvgSwapTime(avg) : null,
    daily: Array.isArray(data.daily7d) ? data.daily7d : [],
    long: isLongerAuditWindow(data.long) ? data.long : null,
    // Hidden while the long window is 7 days or shorter (Methodology 8 ignores it then), or when it adds nothing beyond that window.
    since: data.since && isLongerAuditWindow(data.long) && data.since.swaps > data.long.swaps ? data.since : null,
    longer: auditLongerWindow(data.long, data.since, now),
    periods: {
      d7: data.periods?.d7 ?? null,
      d30: data.periods?.d30 ?? null,
    },
    weeks: Array.isArray(data.weeks) ? data.weeks : [],
    swapsSince: data.swapsSince ?? null,
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
