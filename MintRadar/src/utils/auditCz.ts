import type { AuditCzData, AuditCzDetail } from '@/hooks/useAuditCz'

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

export interface AuditCzTile {
  key: 'melts' | 'mints' | 'clean' | 'avg'
  value: string
  /** Uppercase by CSS; a plain sentence-case string here. */
  label: string
  /** Muted small line under the label ("105 of 105 swaps"); absent when there is nothing to add. */
  caption?: string
  /** Second muted line ("16 failed for other reasons"); absent when no swap failed. */
  captionNote?: string
  tooltip: string
}

export interface AuditCzChecks {
  signatures: string | null
  proofs: string | null
}

export interface AuditCzView {
  sourceHref: string | null
  /** When our stored detail (else the feed) was last fetched (ISO); null when unknown. */
  checkedAt: string | null
  /** Older than 90 minutes (the detail job runs every 30). */
  notRecent: boolean
  /** Both directions, newest first: the outcome bar reads this. */
  swaps: AuditSwapRow[]
  /** This mint paid out ("Swaps from this mint", first column To = the destination). */
  fromRows: AuditSwapRow[]
  /** This mint received ("Swaps to this mint", first column From = the source). */
  toRows: AuditSwapRow[]
  tiles: AuditCzTile[]
  /** null hides the whole card. */
  checks: AuditCzChecks | null
  /** attributedFailures as published by the cashu.info feed (feeds the header tooltip sentence). */
  failuresAttributed: number | null
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

const fmt = (n: number) => n.toLocaleString('en-US')

function auditCzTiles(d: AuditCzDetail): AuditCzTile[] {
  const s = d.swaps7d
  if (!s) return []
  const tiles: AuditCzTile[] = []
  const meltsOk = num(s.asSource?.success), meltsAll = num(s.asSource?.total)
  if (meltsOk !== undefined && meltsAll !== undefined) tiles.push({
    key: 'melts', value: `${fmt(meltsOk)} / ${fmt(meltsAll)}`, label: 'Payouts',
    tooltip: 'Swaps in the last 7 days in which this mint paid out a Lightning invoice, counted by cashu.info (successful of all)',
  })
  const mintsOk = num(s.asDest?.success), mintsAll = num(s.asDest?.total)
  if (mintsOk !== undefined && mintsAll !== undefined) tiles.push({
    key: 'mints', value: `${fmt(mintsOk)} / ${fmt(mintsAll)}`, label: 'Receives',
    tooltip: 'Swaps in the last 7 days in which this mint received ecash from another mint (successful of all)',
  })
  // The one success figure of this view is the one the Reliability Score's audit part uses: swaps without a
  // failure that cashu.info attributes to this mint, (total - blamed) / total of the same 7-day window.
  // Never "x / y" in the big number; whole percent, capped at 99 while anything is attributed so "1 of 200 caused" cannot read as 100%.
  const total = num(s.all?.total), blamedRaw = num(s.errorsBlamed)
  if (total !== undefined && total > 0 && blamedRaw !== undefined) {
    const blamed = Math.min(blamedRaw, total)
    const clean = total - blamed
    const failed = Math.max(num(s.all?.failed) ?? blamed, blamed)
    const other = failed - blamed
    // One sentence for the tooltip. Nothing under the number: the two caption lines made the tile taller than the others.
    const sentence = failed === 0
      ? `${fmt(clean)} of ${fmt(total)} swaps last 7 days`
      : blamed === 0
        ? `${fmt(clean)} of ${fmt(total)} swaps, ${fmt(other)} failed for other reasons last 7 days`
        : `${fmt(clean)} of ${fmt(total)} swaps, ${fmt(blamed)} caused by this mint${other > 0 ? `, ${fmt(other)} failed for other reasons` : ''} last 7 days`
    tiles.push({
      key: 'clean', value: `${blamed > 0 ? Math.min(99, Math.round((clean / total) * 100)) : 100}%`,
      label: 'Without a failure caused by this mint',
      tooltip: `${sentence}. Failures caused by test amounts below the mint's minimum, the auditor's balance, Lightning routing or another mint are not counted against it. This is the figure the audit part of the Reliability Score uses; fewer than 10 swaps scores neutral.`,
    })
  }
  const avg = num(s.all?.avgMs)
  if (avg !== undefined) tiles.push({
    key: 'avg', value: formatAvgSwapTime(avg), label: 'Avg swap time',
    tooltip: 'Average swap time over the last 7 days as reported by cashu.info.',
  })
  return tiles
}

/** The two sentences of the "Checks by the auditor" card; null for a line without data, the card hides when both are null. */
export function auditCzChecks(d: AuditCzDetail): AuditCzChecks | null {
  const dl = d.swaps7d?.dleq
  const valid = num(dl?.valid) ?? 0, invalid = num(dl?.invalid) ?? 0, missing = num(dl?.missing) ?? 0
  let signatures: string | null = null
  if (valid + invalid + missing > 0) {
    const head = invalid > 0
      ? `Proof signatures ${valid} valid, ${invalid} invalid — some signatures did not verify against the mint's published key.`
      : valid > 0
        ? `Proof signatures ${valid} valid, 0 invalid — the mint signed them with its published key.`
        : 'Proof signatures 0 valid, 0 invalid.'
    signatures = missing > 0 ? `${head} ${missing} without a proof.` : head
  }
  const ps = d.integrity?.proof_state
  const checked = num(ps?.checked) ?? 0, spent = num(ps?.spent) ?? 0, pending = num(ps?.pending) ?? 0
  let proofs: string | null = null
  if (checked > 0) {
    const noun = checked === 1 ? 'proof' : 'proofs'
    const head = spent > 0
      ? `${spent} of the auditor's ${checked} ${noun} ${spent === 1 ? 'was' : 'were'} marked spent by the mint.`
      : `Our ecash ${checked} ${noun} still unspent — the mint has not marked ${checked === 1 ? 'it' : 'them'} spent.`
    proofs = pending > 0 ? `${head} ${pending} pending.` : head
  }
  return signatures === null && proofs === null ? null : { signatures, proofs }
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
  const checkedMs = checkedAt ? new Date(checkedAt).getTime() : NaN
  return {
    sourceHref: data.sourceUrl && AUDIT_CZ_PAGE_RE.test(data.sourceUrl) ? data.sourceUrl : null,
    checkedAt,
    notRecent: Number.isFinite(checkedMs) && now - checkedMs > AUDIT_CZ_NOT_RECENT_MS,
    swaps: rows,
    fromRows: rows.filter(r => r.direction === 'from'),
    toRows: rows.filter(r => r.direction === 'to'),
    tiles: auditCzTiles(data.detail),
    checks: auditCzChecks(data.detail),
    failuresAttributed: data.mint.attributedFailures,
  }
}
