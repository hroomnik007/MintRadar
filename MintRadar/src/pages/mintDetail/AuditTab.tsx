// Mint Detail "Audit" tab: the Audit stats panel of cashu.info (the audit source of the Reliability Score) — the
// sync note, a 7/30-day period switch, the verdict, the bar, the four tiles, Swaps per day or Swaps per week, and one swap list.
// The audit query (useAuditCz) stays in MintDetail; this component holds the period switch (default 7 days) and
// AuditSyncNote's wrap measurement.
// audit.8333.space is no longer shown (the service has not answered since 2026-09-27); the backend still syncs and
// serves its fields (/api/mints/known, /api/mints/swaps, /health sources.audit8333) for API clients.
import { useLayoutEffect, useRef, useState } from 'react'
import { InfoTooltip } from '@/components/InfoTooltip'
import { AuditVerdictBlock, AuditStack, AuditDirections, AuditDays, AuditWeeks, AuditSwapList } from '@/components/AuditCzCards'
import type { AuditCzView } from '@/utils/auditCz'
import { auditVerdictFromPeriod, auditDirectionsFromPeriod, auditAvgFromPeriod, auditWeeksForChart, auditSwapsForPeriod, auditSwapsSinceNote } from '@/utils/auditCz'
import { auditNoDataText, cashuInfoViewText } from '@/utils/tooltipTexts'


// ⓘ next to the "Audit stats" heading. A local component so the identical icon can be dropped into both the desktop
// header and the mobile heading.
function AuditSourceInfoIcon({ text }: { text: string }) {
  return <InfoTooltip className="md-audit-info" iconSize={11} width={230} about="Audit stats" text={text} />
}

// The cashu.info sync note in the Audit stats header ("· synced 17 min ago" / "· not updated recently"). The time
// looks like the "fetched 5 min ago" under Fees & limits (muted 12 px, dotted underline) and its tooltip gives the
// exact sync time. When the note does not fit after the source ⓘ it wraps onto the next line and its leading "·" is
// hidden: the dot keeps its place in the layout (so the note never jumps back up once the dot is gone) and the note
// is shifted left by the dot's width with a transform, which does not change the layout, so the text starts at the
// left edge of the line.
function AuditSyncNote({ note, testId }: { note: { text: string; stale: boolean; tip: string | null }; testId: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [wrapped, setWrapped] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    const row = el?.parentElement
    const prev = el?.previousElementSibling as HTMLElement | null | undefined
    const dot = el?.querySelector<HTMLElement>('.md-audit-sync-sep')
    if (!el || !row || !prev || !dot) return
    const check = () => {
      const rowBox = row.getBoundingClientRect()
      if (rowBox.width === 0) return // the other (hidden) header
      const rowCs = getComputedStyle(row)
      el.style.setProperty('--md-sync-sep', `${dot.getBoundingClientRect().width}px`)
      const prevRight = prev.getBoundingClientRect().right + (parseFloat(getComputedStyle(prev).marginRight) || 0)
      const free = rowBox.right - (parseFloat(rowCs.paddingRight) || 0) - (parseFloat(rowCs.borderRightWidth) || 0) - prevRight - (parseFloat(rowCs.columnGap) || 0)
      setWrapped(el.getBoundingClientRect().width > free + 0.5)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(row)
    return () => ro.disconnect()
  }, [note.text])
  return (
    <span ref={ref} className={`md-audit-sync${note.stale ? ' md-audit-sync-stale' : ''}${wrapped ? ' md-audit-sync-wrapped' : ''}`} data-testid={testId}>
      <span className="md-audit-sync-sep" aria-hidden={wrapped || undefined}>·{' '}</span>
      {note.tip
        ? <InfoTooltip className="md-audit-sync-time" width={230} text={note.tip}>{note.text}</InfoTooltip>
        : <span>{note.text}</span>}
    </span>
  )
}

export interface AuditTabProps {
  auditCzLoading: boolean
  /** The cashu.info view of this mint; null when cashu.info has no stored detail for it. */
  czView: AuditCzView | null
  czSyncNote: { text: string; stale: boolean; tip: string | null } | null
  now: number
}

export function AuditTab({ auditCzLoading, czView, czSyncNote, now }: AuditTabProps) {
  if (auditCzLoading) {
    return <div className="md-audit-loading" style={{fontSize:12.5,color:'var(--text3)',fontFamily:'var(--font-mono)'}} role="status">Loading audit data…</div>
  }
  if (czView === null) {
    return (
      <div className="md-panel">
        <div className="md-audit-header">
          <span className="md-panel-title" style={{marginBottom:0}}>Audit stats</span>
          <AuditSourceInfoIcon text={auditNoDataText()} />
        </div>
        <div style={{fontSize:13,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>No audit data available for this mint.</div>
      </div>
    )
  }
  const infoText = cashuInfoViewText()
  return <AuditTabBody czView={czView} czSyncNote={czSyncNote} now={now} infoText={infoText} />
}

function AuditTabBody({ czView, czSyncNote, now, infoText }: {
  czView: AuditCzView
  czSyncNote: { text: string; stale: boolean; tip: string | null } | null
  now: number
  infoText: string
}) {
  const [period, setPeriod] = useState<7 | 30>(7)
  const d7 = czView.periods.d7
  const d30 = czView.periods.d30
  const has30 = d30 !== null
  const days: 7 | 30 = period === 30 && has30 ? 30 : 7
  const selected = days === 30 ? d30 : d7
  const verdict = selected ? auditVerdictFromPeriod(selected) : (days === 7 ? czView.verdict : null)
  const directions = selected ? auditDirectionsFromPeriod(selected) : (days === 7 ? czView.directions : czView.directions.map(d => ({ ...d, ok: null, total: null, failed: 0, tooltip: d.tooltip })))
  const avgSwapTime = selected ? auditAvgFromPeriod(selected) : (days === 7 ? czView.avgSwapTime : null)
  const hasDays = czView.daily.some(d => d.ok + d.failed > 0)
  const hasWeeks = auditWeeksForChart(czView.weeks).some(w => w.swaps > 0)
  const swapRows = auditSwapsForPeriod(czView.swaps, days, now)
  const swapsSinceNote = auditSwapsSinceNote(czView.swapsSince, days, now)
  // 2026-11-19 redesign (phase 4e), 2026-11-22 period switch: the verdict panel, the four figures,
  // Swaps per day (7 days) or Swaps per week (30 days), and the swap list in its own panel.
  return (
    <div className="md-audit">
      <section className="md-panel md-audit-collapsible">
        {/* Desktop heading (the mobile one below is display:none here). */}
        <div className="md-audit-header md-audit-header-main">
          <span className="md-panel-title" style={{marginBottom:0}}>Audit stats</span>
          <span className="md-audit-via">· via cashu.info</span>
          <AuditSourceInfoIcon text={infoText} />
          {czSyncNote && <AuditSyncNote note={czSyncNote} testId="audit-cz-sync" />}
        </div>
        {/* Mobile heading (mirrors the desktop one above). */}
        <div className="md-audit-toggle">
          <span className="md-panel-title" style={{marginBottom:0}}>Audit stats</span>
          <span className="md-audit-via">· via cashu.info</span>
          <AuditSourceInfoIcon text={infoText} />
          {czSyncNote && <AuditSyncNote note={czSyncNote} testId="audit-cz-sync-mobile" />}
        </div>
        <div className="md-audit-period" data-testid="audit-period-switch">
          <div className="md-seg" role="group" aria-label="Period">
            <button type="button" className={days === 7 ? 'on' : ''} aria-pressed={days === 7} onClick={() => setPeriod(7)}>7 days</button>
            <button type="button" className={days === 30 ? 'on' : ''} aria-pressed={days === 30} disabled={!has30} onClick={() => setPeriod(30)}>30 days</button>
          </div>
          {!has30 && <p className="audit-cz-muted md-audit-period-note" data-testid="audit-period-missing">30-day swap figures are not stored yet.</p>}
        </div>
        {verdict && <AuditVerdictBlock verdict={verdict} days={days} />}
        {verdict && <AuditStack verdict={verdict} />}
        {/* The source under the verdict (owner, 2026-11-20: the "How the auditor tests" panel only repeated the verdict's
            own sentence, so it went). */}
        <p className="md-audit-src">
          Data from cashu.info{czSyncNote ? `, ${czSyncNote.text}` : ''}.
          {czView.sourceHref && <>{' '}<a href={czView.sourceHref} target="_blank" rel="noopener noreferrer" className="audit-external-link">Open this mint on cashu.info</a></>}
        </p>
      </section>

      <AuditDirections directions={directions} avgSwapTime={avgSwapTime} verdict={verdict} days={days} />

      {days === 7 && hasDays && (
        <section className="md-panel md-audit-days" aria-label="Swaps per day">
          <AuditDays daily={czView.daily} />
        </section>
      )}
      {days === 30 && hasWeeks && (
        <section className="md-panel md-audit-days" aria-label="Swaps per week">
          <AuditWeeks weeks={czView.weeks} />
        </section>
      )}

      <section className="md-panel md-audit-swaps" aria-labelledby="md-audit-swaps-title">
        <h2 id="md-audit-swaps-title" className="md-panel-title">
          Recent swaps
          {swapsSinceNote && <span className="md-audit-swaps-since" data-testid="audit-swaps-since">{swapsSinceNote}</span>}
        </h2>
        <AuditSwapList key={days} rows={swapRows} now={now} days={days} />
      </section>
    </div>
  )
}
