import { InfoTooltip } from '@/components/InfoTooltip'
import { auditCzStateTitle, AUDIT_CZ_NEUTRAL_TEXT, AUDIT_CZ_NEUTRAL_TITLE, type AuditCzView, type AuditSwapRow } from '@/utils/auditCz'
import { mintHostname } from '@/utils/mintFormatting'

// The cashu.info view of the Audit tab below the header: four tiles, the auditor's checks and two
// swap tables. Every string from the source is rendered as plain text (React escapes it).

const ROWS_DEFAULT = 3

export function AuditCzTiles({ view }: { view: AuditCzView }) {
  if (view.tiles.length === 0) return null
  return (
    <div className="audit-summary-strip audit-cz-tiles">
      {view.tiles.map(t => (
        <div className="audit-summary-cell" key={t.key} data-tile={t.key}>
          <div className="audit-summary-value" style={{ color: 'var(--accent)' }}>{t.value}</div>
          <div className="audit-summary-label audit-cz-tile-label">
            <span>{t.label}</span>
            <InfoTooltip text={t.tooltip} width={240} iconSize={11} label={`About ${t.label}`} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function AuditCzChecks({ view }: { view: AuditCzView }) {
  if (!view.checks) return null
  return (
    <div className="audit-cz-card" data-testid="audit-cz-checks">
      <div className="audit-cz-card-title">Checks by the auditor</div>
      {view.checks.signatures && <p className="audit-cz-check-line">{view.checks.signatures}</p>}
      {view.checks.proofs && <p className="audit-cz-check-line">{view.checks.proofs}</p>}
      <p className="audit-cz-muted">Tests the auditor ran with its own small amounts. They do not prove that the mint can pay out everything it owes.</p>
    </div>
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
      <div className="audit-cz-card-title">{title}</div>
      {rows.length === 0 ? (
        <p className="audit-cz-muted">No swaps collected yet</p>
      ) : (
        <div className="audit-recent-swaps" style={{ marginTop: 0 }}>
          <div className="audit-swaps-table-wrap">
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
                    <td>{s.timeTakenMs !== null ? `${Math.round(s.timeTakenMs)} ms` : '—'}</td>
                    {/* Rows that are not OK: the failure text as tooltip and as visually hidden text (a title is not available on touch or to screen readers). Plain text only. */}
                    <td {...(auditCzStateTitle(s) ? { title: auditCzStateTitle(s) } : {})}>
                      {s.neutral === 'limits' || s.neutral === 'balance' ? AUDIT_CZ_NEUTRAL_TEXT[s.neutral] : <>{s.state}{s.stage ? ` (${s.stage})` : null}</>}
                      {s.reason ? <>{' '}<span className="sr-only">{s.reason}</span></> : null}
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

export function AuditCzSwapTables({ view, expandedFrom, expandedTo, onToggleFrom, onToggleTo }: {
  view: AuditCzView
  expandedFrom: boolean
  expandedTo: boolean
  onToggleFrom: () => void
  onToggleTo: () => void
}) {
  return (
    <>
      <SwapTable title="Swaps from this mint" firstHeader="To" rows={view.fromRows} expanded={expandedFrom} onToggle={onToggleFrom} />
      <SwapTable title="Swaps to this mint" firstHeader="From" rows={view.toRows} expanded={expandedTo} onToggle={onToggleTo} />
      {view.collectedSince && <p className="audit-cz-muted" data-testid="audit-cz-since">Collected by MintRadar since {view.collectedSince}</p>}
    </>
  )
}
