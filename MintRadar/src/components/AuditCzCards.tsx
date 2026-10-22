import { Fragment, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { InfoTooltip } from '@/components/InfoTooltip'
import { auditCzStateTitle, auditCzSourceLine, AUDIT_CZ_NEUTRAL_TEXT, AUDIT_CZ_NEUTRAL_TITLE, formatSwapDuration, type AuditCzView, type AuditSwapRow } from '@/utils/auditCz'
import { mintHostname } from '@/utils/mintFormatting'

// The cashu.info view of the Audit tab below the header: four tiles, the auditor's checks and two
// swap tables. Every string from the source is rendered as plain text (React escapes it).

const ROWS_DEFAULT = 5

export function AuditCzTiles({ view }: { view: AuditCzView }) {
  if (view.tiles.length === 0) return null
  return (
    <div className="audit-summary-strip audit-cz-tiles">
      {view.tiles.map(t => {
        // The icon stays glued to the last word, so a wrapped label never leaves it alone on a line.
        const cut = t.label.lastIndexOf(' ') + 1
        const lead = t.label.slice(0, cut), last = t.label.slice(cut)
        return (
        <div className="audit-summary-cell" key={t.key} data-tile={t.key}>
          <div className={`audit-summary-value${t.noData ? ' audit-cz-tile-nodata' : ''}`} {...(t.noData ? {} : { style: { color: 'var(--accent)' } })}>{t.value}</div>
          <div className="audit-summary-label audit-cz-tile-label">
            {lead}
            <span className="audit-cz-tile-tail">{last}{t.tooltip ? <InfoTooltip text={t.tooltip} width={240} iconSize={11} label={`About ${t.label}`} /> : null}</span>
          </div>
          {t.sub && <div className="audit-cz-tile-sub">{t.sub}</div>}
        </div>
        )
      })}
    </div>
  )
}

/** One muted line under the tiles: where the numbers come from, which window, when they were stored. */
export function AuditCzSourceLine({ view, now }: { view: AuditCzView; now: number }) {
  const line = auditCzSourceLine(view, now)
  return (
    <p className="audit-cz-muted audit-cz-source" data-testid="audit-cz-source">
      {line.parts.join(' · ')}
      {line.time && <>{' · '}<span title={line.time.title}>{line.time.verb} {line.time.label}</span></>}
    </p>
  )
}

function SwapTable({ title, firstHeader, rows, expanded, onToggle }: {
  title: string
  firstHeader: 'To' | 'From'
  rows: AuditSwapRow[]
  expanded: boolean
  onToggle: () => void
}) {
  const shown = expanded ? rows : rows.slice(0, ROWS_DEFAULT)
  return (
    <div className="audit-cz-card" data-testid="audit-cz-table">
      {rows.length === 0 ? (
        <p className="audit-cz-muted">No swaps collected yet</p>
      ) : (
        <div className="audit-recent-swaps" style={{ marginTop: 0 }}>
          <div className="audit-swaps-table-wrap" tabIndex={0} role="group" aria-label={`${title} (scrollable)`}>
            <table className="audit-swaps-table">
              <thead>
                <tr><th>{firstHeader}</th><th>Amount</th><th>Fee</th><th>Duration</th><th>State</th></tr>
              </thead>
              <tbody>
                {shown.map(s => (
                  <tr key={s.swapId} className={s.state === 'OK' ? '' : s.neutral ? 'audit-swap-row-neutral' : 'audit-swap-row-fail'} {...(s.neutral === 'limits' || s.neutral === 'balance' ? { title: AUDIT_CZ_NEUTRAL_TITLE[s.neutral] } : {})}>
                    <td>{s.toUrl ? mintHostname(s.toUrl) : '—'}</td>
                    <td>{s.amount !== null ? `${s.amount} sat` : '—'}</td>
                    <td>{s.fee !== null ? s.fee : '—'}</td>
                    <td>{s.timeTakenMs !== null ? formatSwapDuration(s.timeTakenMs) : '—'}</td>
                    {/* Rows that are not OK: the failure text as tooltip and as visually hidden text (a title is not available on touch or to screen readers). Plain text only. */}
                    <td>
                      <AuditStateText row={s} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > ROWS_DEFAULT && (
            <button type="button" className="audit-swaps-show-all-btn" onClick={onToggle}>
              {expanded ? 'Show fewer' : `Show all (${rows.length})`}
            </button>
          )}
        </div>
      )}
    </div>
  )
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

type SwapPanel = 'from' | 'to'
const PANELS: readonly SwapPanel[] = ['from', 'to']

/**
 * The two swap tables behind one segmented control (a tablist): "From this mint (N) | To this mint (M)", one table at a time,
 * "From this mint" first. Arrow keys / Home / End move between the tabs (automatic activation); only the active panel is in the DOM.
 */
export function AuditCzSwapTables({ view, expandedFrom, expandedTo, onToggleFrom, onToggleTo }: {
  view: AuditCzView
  expandedFrom: boolean
  expandedTo: boolean
  onToggleFrom: () => void
  onToggleTo: () => void
}) {
  const [active, setActive] = useState<SwapPanel>('from')
  const uid = useId()
  const tabRefs = useRef<Record<SwapPanel, HTMLButtonElement | null>>({ from: null, to: null })
  const tabId = (p: SwapPanel) => `${uid}-tab-${p}`
  const panelId = (p: SwapPanel) => `${uid}-panel-${p}`
  const labels: Record<SwapPanel, string> = {
    from: `From this mint (${view.fromRows.length})`,
    to: `To this mint (${view.toRows.length})`,
  }
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const i = PANELS.indexOf(active)
    let next: SwapPanel | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = PANELS[(i + 1) % PANELS.length] ?? null
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = PANELS[(i + PANELS.length - 1) % PANELS.length] ?? null
    else if (e.key === 'Home') next = PANELS[0] ?? null
    else if (e.key === 'End') next = PANELS[PANELS.length - 1] ?? null
    if (!next) return
    e.preventDefault()
    setActive(next)
    tabRefs.current[next]?.focus()
  }
  return (
    <div className="audit-cz-swaps">
      <div className="audit-cz-seg" role="tablist" aria-label="Swap direction">
        {PANELS.map(p => (
          <button
            key={p}
            type="button"
            role="tab"
            id={tabId(p)}
            ref={el => { tabRefs.current[p] = el }}
            aria-selected={active === p}
            aria-controls={panelId(p)}
            tabIndex={active === p ? 0 : -1}
            className={`audit-cz-seg-btn${active === p ? ' active' : ''}`}
            onClick={() => setActive(p)}
            onKeyDown={onKeyDown}
          >
            {labels[p]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId(active)} aria-labelledby={tabId(active)}>
        {active === 'from'
          ? <SwapTable title="Swaps from this mint" firstHeader="To" rows={view.fromRows} expanded={expandedFrom} onToggle={onToggleFrom} />
          : <SwapTable title="Swaps to this mint" firstHeader="From" rows={view.toRows} expanded={expandedTo} onToggle={onToggleTo} />}
      </div>
    </div>
  )
}
