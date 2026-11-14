import { Fragment, useState, type ReactNode } from 'react'
import { InfoTooltip } from '@/components/InfoTooltip'
import {
  auditCzStateTitle, AUDIT_CZ_NEUTRAL_TEXT, AUDIT_CZ_NEUTRAL_TITLE, formatSwapDuration, filterAuditSwaps,
  auditVerdictHeadline, auditVerdictDetail, auditLongLine, auditSinceLine,
  type AuditCzView, type AuditSwapRow, type AuditSwapFilter, type AuditVerdict, type AuditDirectionFigure, type AuditDay,
} from '@/utils/auditCz'
import { mintHostname, formatTimeAgo } from '@/utils/mintFormatting'
import { formatDate, formatDateTimeUtc, DATE_MONTHS } from '@/utils/formatDate'

// The cashu.info view of the Audit tab below the header: one verdict for the 7 days the score reads, the same swaps
// as one bar and per direction, MintRadar's own count per day, and one swap list with a filter. Every string from
// the source is rendered as plain text (React escapes it).
//
// Colours: red is only the failures cashu.info attributes to THIS mint (a 7-day total, the verdict and the bar).
// A single failed swap is amber: the source does not say per swap who caused it.

const ROWS_DEFAULT = 8

/** The verdict: the attributed failures as the big number, what it is out of, and the points it gives. */
export function AuditVerdictBlock({ verdict, points, view }: { verdict: AuditVerdict; points: string | null; view: AuditCzView }) {
  return (
    <div className="au-verdict" data-testid="audit-verdict">
      <span className={`au-verdict-num${verdict.blamed > 0 ? ' au-verdict-num-bad' : ''}`} data-testid="audit-verdict-num">{verdict.blamed.toLocaleString('en-US')}</span>
      <div className="au-verdict-text">
        <strong>{auditVerdictHeadline(verdict)}</strong>
        <span>{auditVerdictDetail(verdict)}</span>
        {view.long && <span className="au-verdict-more" data-testid="audit-long-line">{auditLongLine(view.long)}</span>}
        {view.since && <span className="au-verdict-more" data-testid="audit-since-line">{auditSinceLine(view.since, formatDate(`${view.since.day}T00:00:00Z`))}</span>}
      </div>
      {points && <span className="au-pill" data-testid="audit-points-pill">Audit part {points}</span>}
    </div>
  )
}

/** The 7 days as one bar: succeeded, failed elsewhere, caused by this mint. The legend carries the numbers. */
export function AuditStack({ verdict }: { verdict: AuditVerdict }) {
  const n = (v: number) => v.toLocaleString('en-US')
  return (
    <div className="au-stack-wrap">
      <div className="au-stack" role="img" aria-label={`${n(verdict.ok)} succeeded, ${n(verdict.failedElsewhere)} failed elsewhere, ${n(verdict.blamed)} caused by this mint`}>
        {verdict.ok > 0 && <i className="au-seg-ok" style={{ flexGrow: verdict.ok }} />}
        {verdict.failedElsewhere > 0 && <i className="au-seg-else" style={{ flexGrow: verdict.failedElsewhere }} />}
        {verdict.blamed > 0 && <i className="au-seg-mint" style={{ flexGrow: verdict.blamed }} />}
      </div>
      <div className="au-legend" data-testid="audit-legend">
        <span><i className="au-seg-ok" />{n(verdict.ok)} succeeded</span>
        <span><i className="au-seg-else" />{n(verdict.failedElsewhere)} failed elsewhere</span>
        <span><i className="au-seg-mint" />{n(verdict.blamed)} caused by this mint</span>
      </div>
    </div>
  )
}

/** Deposits, withdrawals and the average swap time of the same 7 days. */
export function AuditDirections({ directions, avgSwapTime }: { directions: AuditDirectionFigure[]; avgSwapTime: string | null }) {
  return (
    <div className="au-dirs">
      {directions.map(d => (
        <div className="au-dir" key={d.key} data-tile={d.key}>
          <span className="au-dir-label">{d.label}<InfoTooltip text={d.tooltip} width={240} iconSize={11} label={`About ${d.label}`} /></span>
          {d.ok === null || d.total === null ? (
            <span className="au-dir-value au-dir-nodata">No data</span>
          ) : (<>
            <span className="au-dir-value">{d.ok.toLocaleString('en-US')} <small>of {d.total.toLocaleString('en-US')}</small></span>
            {d.total > 0 && (
              <div className="au-mini" aria-hidden="true">
                {d.ok > 0 && <i className="au-seg-ok" style={{ flexGrow: d.ok }} />}
                {d.failed > 0 && <i className="au-seg-fail" style={{ flexGrow: d.failed }} />}
              </div>
            )}
            {d.failed > 0 && <span className="au-dir-sub">{d.failed.toLocaleString('en-US')} failed</span>}
          </>)}
        </div>
      ))}
      {avgSwapTime && (
        <div className="au-dir" data-tile="avg">
          <span className="au-dir-label">Average swap time</span>
          <span className="au-dir-value">{avgSwapTime}</span>
        </div>
      )}
    </div>
  )
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** MintRadar's own count of the stored swaps per UTC day. Nothing renders while no day has a swap. */
export function AuditDays({ daily }: { daily: AuditDay[] }) {
  const max = Math.max(0, ...daily.map(d => d.ok + d.failed))
  if (max === 0) return null
  const unit = 64 / max
  return (
    <div className="au-days-wrap" data-testid="audit-days">
      <div className="au-days-title">Swaps per day <span>UTC, as stored by MintRadar</span></div>
      <div className="au-days">
        {daily.map(d => {
          const t = new Date(`${d.day}T00:00:00Z`)
          const label = `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${DATE_MONTHS[t.getUTCMonth()]}`
          const count = d.ok + d.failed
          return (
            <div className="au-day" key={d.day} role="img" aria-label={`${label}: ${d.ok} succeeded, ${d.failed} failed`}>
              <span className="au-day-count">{count > 0 ? count : ''}</span>
              <div className="au-day-col">
                {d.failed > 0 && <i className="au-seg-fail" style={{ height: `${Math.max(2, d.failed * unit)}px` }} />}
                {d.ok > 0 && <i className="au-seg-ok" style={{ height: `${Math.max(2, d.ok * unit)}px` }} />}
              </div>
              <span className="au-day-label">{WEEKDAYS[t.getUTCDay()]}</span>
            </div>
          )
        })}
      </div>
      <div className="au-legend au-legend-small">
        <span><i className="au-seg-ok" />succeeded</span>
        <span><i className="au-seg-fail" />failed, whoever caused it</span>
      </div>
    </div>
  )
}

/**
 * A swap duration ("4 h 48 min", "2 d 3 h") whose value-and-unit pairs never split: on phones the narrow cell may wrap at the
 * space BETWEEN pairs ("4 h" / "48 min"), not inside one. The text stays exactly the formatted string.
 */
function DurationText({ text }: { text: string }) {
  const pairs = text.match(/\d+ [a-z]+/g)
  if (!pairs || pairs.length < 2 || pairs.join(' ') !== text) return <>{text}</>
  return <>{pairs.map((p, i) => <Fragment key={i}>{i > 0 ? ' ' : null}<span className="audit-dur-pair">{p}</span></Fragment>)}</>
}

/** A line-break opportunity after each "_" ("mint_quote" wraps as "mint_" / "quote", never inside a word); no <wbr> text is added. */
function breakAfterUnderscore(text: string): ReactNode {
  return text.split('_').map((part, i, all) => <Fragment key={i}>{part}{i < all.length - 1 ? <>_<wbr /></> : null}</Fragment>)
}

/**
 * The State cell text of a swap row: the state (or the grey-row wording) and, for a row that is not OK, the failure
 * text as an InfoTooltip on it and as visually hidden text (a title is not available on touch or to screen readers).
 * Plain text only.
 */
export function AuditStateText({ row: s }: { row: AuditSwapRow }) {
  const tip = auditCzStateTitle(s)
  const text = s.neutral === 'limits' || s.neutral === 'balance' ? AUDIT_CZ_NEUTRAL_TEXT[s.neutral] : <>{breakAfterUnderscore(s.state)}{s.stage ? <>{' ('}{breakAfterUnderscore(s.stage)}{')'}</> : null}</>
  return (
    <>
      {tip ? <InfoTooltip text={tip} width={240}><span>{text}</span></InfoTooltip> : text}
      {s.reason ? <>{' '}<span className="sr-only">{s.reason}</span></> : null}
    </>
  )
}

const FILTERS: ReadonlyArray<{ key: AuditSwapFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'deposits', label: 'Deposits' },
  { key: 'withdrawals', label: 'Withdrawals' },
  { key: 'failed', label: 'Failed' },
]

/** One list of the stored swaps of the last 7 days with a filter (was two tables behind a From / To switch). */
export function AuditSwapList({ rows, now }: { rows: AuditSwapRow[]; now: number }) {
  const [filter, setFilter] = useState<AuditSwapFilter>('all')
  const [expanded, setExpanded] = useState(false)
  if (rows.length === 0) return <p className="audit-cz-muted" data-testid="audit-swaps-empty">No swaps collected in the last 7 days.</p>
  const filtered = filterAuditSwaps(rows, filter)
  const shown = expanded ? filtered : filtered.slice(0, ROWS_DEFAULT)
  return (
    <div className="au-swaps" data-testid="audit-swap-list">
      <div className="au-chips" role="group" aria-label="Filter swaps">
        {FILTERS.map(f => (
          <button key={f.key} type="button" className="au-chip" aria-pressed={filter === f.key} onClick={() => { setFilter(f.key); setExpanded(false) }}>
            {f.label} <span className="au-chip-n">{filterAuditSwaps(rows, f.key).length}</span>
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="audit-cz-muted" data-testid="audit-swaps-none">No swaps match this filter.</p>
      ) : (
        <div className="audit-swaps-table-wrap" tabIndex={0} role="group" aria-label="Swaps of the last 7 days (scrollable)">
          <table className="audit-swaps-table au-table">
            <thead>
              <tr><th className="au-col-when">When</th><th>Direction</th><th>Other mint</th><th className="au-num">Amount</th><th className="au-num au-col-fee">Fee</th><th className="au-num au-col-dur">Duration</th><th>Result</th></tr>
            </thead>
            <tbody>
              {shown.map(s => {
                const at = s.createdAt ? new Date(s.createdAt) : null
                return (
                  <tr key={s.swapId} className={s.state === 'OK' ? '' : s.neutral ? 'audit-swap-row-neutral' : 'au-row-fail'} {...(s.neutral === 'limits' || s.neutral === 'balance' ? { title: AUDIT_CZ_NEUTRAL_TITLE[s.neutral] } : {})}>
                    <td className="au-col-when">{at ? <time dateTime={at.toISOString()} title={formatDateTimeUtc(at)}>{formatTimeAgo(at, now)}</time> : '—'}</td>
                    <td>{s.direction === 'to' ? 'Deposit' : 'Withdrawal'}</td>
                    <td className="au-mono">{s.toUrl ? mintHostname(s.toUrl) : '—'}</td>
                    <td className="au-num">{s.amount !== null ? `${s.amount} sat` : '—'}</td>
                    <td className="au-num au-col-fee">{s.fee !== null ? s.fee : '—'}</td>
                    <td className="au-num au-col-dur">{s.timeTakenMs !== null ? <DurationText text={formatSwapDuration(s.timeTakenMs)} /> : '—'}</td>
                    <td><span className={`au-res ${s.state === 'OK' ? 'au-res-ok' : s.neutral ? 'au-res-neutral' : 'au-res-fail'}`}><AuditStateText row={s} /></span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > ROWS_DEFAULT && (
        <button type="button" className="audit-swaps-show-all-btn" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show fewer' : `Show all (${filtered.length})`}
        </button>
      )}
    </div>
  )
}
