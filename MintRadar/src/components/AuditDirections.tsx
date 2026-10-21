import { auditDirectionRows, AUDIT_DIRECTIONS_NOTE } from '@/utils/auditDirections'
import type { AuditCzDetail } from '@/hooks/useAuditCz'

/** Audit tab, cashu.info view: the 7-day swaps by direction. Facts only, one constant colour, no thresholds. */
export function AuditDirections({ detail, now }: { detail: AuditCzDetail | null | undefined; now: number }) {
  const rows = auditDirectionRows(detail, now)
  return (
    <div className="audit-directions" data-testid="audit-directions">
      <div className="md-info-grid md-info-list">
        {rows.map(r => (
          <div className="md-info-row" key={r.key} data-direction={r.key}>
            <span className="md-info-label">{r.label}</span>
            <span className="md-info-value">
              {r.facts ? (
                <>
                  {r.facts.attempts.toLocaleString('en-US')} {r.facts.attempts === 1 ? 'attempt' : 'attempts'}, {r.facts.failures.toLocaleString('en-US')} {r.facts.failures === 1 ? 'failure' : 'failures'}
                  {' · '}{r.facts.window}{' · '}{r.source}
                  {r.time && <>{' · '}<span title={r.time.title}>synced {r.time.label}</span></>}
                </>
              ) : r.empty}
            </span>
          </div>
        ))}
      </div>
      <p className="audit-cz-muted">{AUDIT_DIRECTIONS_NOTE}</p>
    </div>
  )
}
