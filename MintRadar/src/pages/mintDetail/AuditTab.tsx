// Mint Detail "Audit" tab: the Audit stats panel of cashu.info (the audit source of the Reliability Score) — tiles, the
// sync note, the swap strip and the two swap tables. The audit query (useAuditCz), the expand states and every derived
// figure stay in MintDetail and are passed in, so fetch timing and caching are unchanged; this component holds no state
// of its own (AuditSyncNote keeps its local wrap measurement).
// audit.8333.space is no longer shown (the service has not answered since 2026-09-27); the backend still syncs and
// serves its fields (/api/mints/known, /api/mints/swaps, /health sources.audit8333) for API clients.
import { useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { InfoTooltip } from '@/components/InfoTooltip'
import { AuditCzTiles, AuditCzSwapTables } from '@/components/AuditCzCards'
import { formatDateTimeUtc } from '@/utils/formatDate'
import { AUDIT_CZ_NEUTRAL_TITLE, type AuditCzView, type AuditSwapRow } from '@/utils/auditCz'
import { swapStripLabel, swapStripText, SWAP_STRIP_FAILED_NOTE } from '@/utils/mintDetailFacts'
import { auditNoDataText, cashuInfoViewText } from '@/utils/tooltipTexts'

// The Audit tiles' ⓘ sits 3 px after the label (the trigger's hit-area padding is compensated by InfoTooltip.css).
const TT_GAP_LEFT = { '--tt-ml': '3px' } as CSSProperties

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
  /** auditScoredLine(): which swaps count towards the score; null while the Audit part is not scored. */
  scoredLine: string | null
  auditSwapBarItems: AuditSwapRow[]
  showAllCzFrom: boolean
  showAllCzTo: boolean
  setShowAllCzFrom: Dispatch<SetStateAction<boolean>>
  setShowAllCzTo: Dispatch<SetStateAction<boolean>>
}

export function AuditTab({
  auditCzLoading, czView, czSyncNote, scoredLine, auditSwapBarItems, showAllCzFrom, showAllCzTo, setShowAllCzFrom, setShowAllCzTo,
}: AuditTabProps) {
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
  return (
    <div className="md-panel md-audit-collapsible" style={{background:'var(--bg)'}}>
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

      {scoredLine && <p className="audit-cz-muted audit-scored-line" data-testid="audit-scored-line">{scoredLine}</p>}

      <AuditCzTiles view={czView} />

      {/* Outcome strip: the stored swaps, newest left. Nothing renders until there are swaps — never a fake/empty bar. */}
      {auditSwapBarItems.length > 0 && (<>
        <div className="audit-cz-muted audit-swap-bar-label" data-testid="audit-swap-bar-caption">
          {swapStripLabel(auditSwapBarItems.length)}
          <InfoTooltip iconSize={12} width={300} label="About the swap strip" style={TT_GAP_LEFT} text={swapStripText(auditSwapBarItems.length)} />
        </div>
        <div className="audit-swap-bar audit-swap-bar-labelled" title="Last swaps, newest first">
          {auditSwapBarItems.map(s => (
            <div
              key={s.swapId}
              className={`audit-swap-bar-mark ${s.state === 'OK' ? 'audit-swap-bar-ok' : s.neutral ? 'audit-swap-bar-neutral' : 'audit-swap-bar-fail'}`}
              title={s.neutral === 'limits' || s.neutral === 'balance' ? AUDIT_CZ_NEUTRAL_TITLE[s.neutral] : `${s.state}${s.stage ? ` (${s.stage})` : ''}${s.createdAt ? ` · ${formatDateTimeUtc(s.createdAt)}` : ''}`}
            />
          ))}
        </div>
        {auditSwapBarItems.some(s => s.state !== 'OK' && !s.neutral) && (
          <p className="audit-cz-muted audit-swap-bar-note" data-testid="audit-swap-bar-note">{SWAP_STRIP_FAILED_NOTE}</p>
        )}
      </>)}

      <AuditCzSwapTables view={czView} expandedFrom={showAllCzFrom} expandedTo={showAllCzTo} onToggleFrom={() => setShowAllCzFrom(v => !v)} onToggleTo={() => setShowAllCzTo(v => !v)} />

      {czView.sourceHref && (
        <a href={czView.sourceHref} target="_blank" rel="noopener noreferrer" className="audit-external-link">
          Open on cashu.info →
        </a>
      )}
    </div>
  )
}
