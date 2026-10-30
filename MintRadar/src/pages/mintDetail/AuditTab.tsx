// Mint Detail "Audit" tab: the Audit stats panel (audit.8333.space or cashu.info view, the source switch, the sync note,
// summary strip, swap strip and swap tables). Extracted verbatim from MintDetail.tsx (pure refactor: same DOM, classes,
// inline styles, aria and tooltips). The audit queries (useAuditCz, /api/mints/swaps), the source pick, the expand states
// and every derived figure stay in MintDetail and are passed in, so fetch timing and caching are unchanged; this
// component holds no state of its own (AuditSyncNote keeps its local wrap measurement, as before).
import { useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { InfoTooltip } from '@/components/InfoTooltip'
import { AuditCzTiles, AuditCzSwapTables, AuditStateText } from '@/components/AuditCzCards'
import { formatDateTimeUtc } from '@/utils/formatDate'
import { mintHostname } from '@/utils/mintFormatting'
import { AUDIT_CZ_NEUTRAL_TITLE, type AuditCzView, type AuditSwapRow } from '@/utils/auditCz'
import { swapStripLabel, swapStripText } from '@/utils/mintDetailFacts'
import { AUDIT_SWAPS_WINDOW, AUDIT_WINDOW_DAYS, auditNoDataText } from '@/utils/tooltipTexts'

/** Rows of the "Recent swaps" table shown before "Show all". */
export const AUDIT_SWAP_ROWS_DEFAULT = 8

// The Audit tiles' ⓘ sits 3 px after the label (the trigger's hit-area padding is compensated by InfoTooltip.css).
const TT_GAP_LEFT = { '--tt-ml': '3px' } as CSSProperties

// ⓘ next to the "Audit stats" heading: the shared InfoTooltip with the audit explanation (or the given text). A local
// component so the identical icon can be dropped into both the desktop header and the mobile heading.
function AuditSourceInfoIcon({ text }: { text?: string }) {
  return (
    <InfoTooltip
      className="md-audit-info"
      iconSize={11}
      width={230}
      about="Audit stats"
      text={text ?? 'These stats come from audit.8333.space, an independent service that repeatedly mints and melts real ecash through this mint — how many operations it ran, how many failed, and when it last checked.'}
    />
  )
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
  czView: AuditCzView | null
  /** audit.8333.space data present and fresh (MintDetail's !auditNeedsFallback); false hides every 8333 element. */
  show8333Audit: boolean
  czInfoText: string | null
  czSyncNote: { text: string; stale: boolean; tip: string | null } | null
  auditSwitch: ReactNode
  audit8333Stale: string | null
  czData: AuditCzView | null
  stripMints: number | null
  stripMelts: number | null
  stripReliabilityColor: string
  stripRecentSuccessDisplay: string
  stripRecentSuccessSub: string
  stripAvgTimeDisplay: string
  tipMints: string
  tipMelts: string
  tipSuccess: string
  tipAvg: string
  auditSwapBarItems: AuditSwapRow[]
  auditRecentSwapRows: AuditSwapRow[]
  auditSwaps: AuditSwapRow[]
  showAllAuditSwaps: boolean
  setShowAllAuditSwaps: Dispatch<SetStateAction<boolean>>
  showAllCzFrom: boolean
  showAllCzTo: boolean
  setShowAllCzFrom: Dispatch<SetStateAction<boolean>>
  setShowAllCzTo: Dispatch<SetStateAction<boolean>>
  auditSwapsLoading: boolean
  auditSwapsError: boolean
  refetchAuditSwaps: () => Promise<unknown>
}

export function AuditTab({
  auditCzLoading, czView, show8333Audit, czInfoText, czSyncNote, auditSwitch,
  audit8333Stale, czData, stripMints, stripMelts, stripReliabilityColor, stripRecentSuccessDisplay,
  stripRecentSuccessSub, stripAvgTimeDisplay, tipMints, tipMelts, tipSuccess, tipAvg,
  auditSwapBarItems, auditRecentSwapRows, auditSwaps, showAllAuditSwaps, setShowAllAuditSwaps, showAllCzFrom,
  showAllCzTo, setShowAllCzFrom, setShowAllCzTo, auditSwapsLoading, auditSwapsError, refetchAuditSwaps,
}: AuditTabProps) {
  return (<>
            {auditCzLoading ? (
              <div className="md-audit-loading" style={{fontSize:12.5,color:'var(--text3)',fontFamily:'var(--font-mono)'}} role="status">Loading audit data…</div>
            ) : (czView !== null || show8333Audit) ? (
              <div className="md-panel md-audit-collapsible" style={{background:'var(--bg)'}}>
                {/* Desktop heading (the mobile collapse toggle below is display:none here). */}
                <div className="md-audit-header md-audit-header-main">
                  <span className="md-panel-title" style={{marginBottom:0}}>Audit stats</span>
                  <span className="md-audit-via">· via {czView ? 'cashu.info' : 'audit.8333.space'}</span>
                  <AuditSourceInfoIcon {...(czInfoText ? { text: czInfoText } : {})} />
                  {czSyncNote && <AuditSyncNote note={czSyncNote} testId="audit-cz-sync" />}
                  {auditSwitch}
                </div>
                {/* Mobile heading (mirrors the desktop one above; the collapse
                    toggle was removed once the Audit tab lost its collapsible body). */}
                <div className="md-audit-toggle">
                  <span className="md-panel-title" style={{marginBottom:0}}>Audit stats</span>
                  <span className="md-audit-via">· via {czView ? 'cashu.info' : 'audit.8333.space'}</span>
                  <AuditSourceInfoIcon {...(czInfoText ? { text: czInfoText } : {})} />
                  {czSyncNote && <AuditSyncNote note={czSyncNote} testId="audit-cz-sync-mobile" />}
                  {auditSwitch}
                </div>

                {!czView && audit8333Stale && <p className="audit-cz-muted">{audit8333Stale}</p>}
                {!czView && <p className="audit-cz-muted">{czData !== null
                  ? `The Reliability Score uses cashu.info's last ${AUDIT_WINDOW_DAYS} days; this view shows audit.8333.space's last ~${AUDIT_SWAPS_WINDOW} swaps.`
                  : `This view shows audit.8333.space's last ~${AUDIT_SWAPS_WINDOW} swaps; the Reliability Score does not use it.`}</p>}
                {czView ? <AuditCzTiles view={czView} /> : (<>
                {/* 5-second overview — always visible, never inside the mobile
                    collapse. Mints/Melts are audit.8333.space lifetime counts;
                    Recent success rate is the rolling ~100-swap window; Last
                    checked is OUR 6h cron's write time (auditSyncedAt). */}
                <div className="audit-summary-strip">
                  <div className="audit-summary-cell">
                    <div className="audit-summary-value" style={{color:'var(--accent)'}}>{stripMints === null ? '—' : stripMints.toLocaleString()}</div>
                    <div className="audit-summary-label">
                      Mints
                      <InfoTooltip iconSize={11} width={180} about="Mints" style={TT_GAP_LEFT} text={tipMints} />
                    </div>
                  </div>
                  <div className="audit-summary-cell">
                    <div className="audit-summary-value" style={{color:'var(--accent)'}}>{stripMelts === null ? '—' : stripMelts.toLocaleString()}</div>
                    <div className="audit-summary-label">
                      Melts
                      <InfoTooltip iconSize={11} width={180} about="Melts" style={TT_GAP_LEFT} text={tipMelts} />
                    </div>
                  </div>
                  <div className="audit-summary-cell">
                    <div className="audit-summary-value" style={{color: stripReliabilityColor}}>
                      {stripRecentSuccessDisplay !== '—' && (
                        <>
                          <span className="audit-summary-main">{stripRecentSuccessDisplay}</span>
                          <span className="audit-summary-dot">·</span>
                        </>
                      )}
                      <span className="audit-summary-sub">{stripRecentSuccessSub}</span>
                    </div>
                    <div className="audit-summary-label">
                      Recent success rate
                      <InfoTooltip iconSize={11} width={180} about="Recent success rate" style={TT_GAP_LEFT} text={tipSuccess} />
                    </div>
                  </div>
                  <div className="audit-summary-cell">
                    <div className="audit-summary-value" style={{fontSize:15}}>{stripAvgTimeDisplay}</div>
                    <div className="audit-summary-label">
                      Avg swap time
                      <InfoTooltip iconSize={11} width={180} about="Avg swap time" style={TT_GAP_LEFT} text={tipAvg} />
                    </div>
                  </div>
                </div>
                </>)}

                {/* Outcome bar — last ≤44 swaps, newest left (the backend
                    already orders by created_at DESC, so no client-side
                    reverse is needed). Nothing renders here until the swap
                    fetch actually resolves with data — never a fake/empty bar. */}
                {czView && auditSwapBarItems.length > 0 && (
                  <div className="audit-cz-muted audit-swap-bar-label" data-testid="audit-swap-bar-caption">
                    {swapStripLabel(auditSwapBarItems.length)}
                    <InfoTooltip iconSize={12} width={300} label="About the swap strip" style={TT_GAP_LEFT} text={swapStripText(auditSwapBarItems.length)} />
                  </div>
                )}
                {auditSwapBarItems.length > 0 && (
                  <div className={`audit-swap-bar${czView ? ' audit-swap-bar-labelled' : ''}`} title="Last swaps, newest first">
                    {auditSwapBarItems.map(s => (
                      <div
                        key={s.swapId}
                        className={`audit-swap-bar-mark ${s.state === 'OK' ? 'audit-swap-bar-ok' : s.neutral ? 'audit-swap-bar-neutral' : 'audit-swap-bar-fail'}`}
                        title={s.neutral === 'limits' || s.neutral === 'balance' ? AUDIT_CZ_NEUTRAL_TITLE[s.neutral] : `${s.state}${s.stage ? ` (${s.stage})` : ''}${s.createdAt ? ` · ${formatDateTimeUtc(s.createdAt)}` : ''}`}
                      />
                    ))}
                  </div>
                )}

                {czView ? (<>
                  <AuditCzSwapTables view={czView} expandedFrom={showAllCzFrom} expandedTo={showAllCzTo} onToggleFrom={() => setShowAllCzFrom(v => !v)} onToggleTo={() => setShowAllCzTo(v => !v)} />
                </>) : (<>
                {/* Recent swaps — last 8, newest first. Failed rows are muted red. */}
                {auditRecentSwapRows.length > 0 && (
                  <div className="audit-recent-swaps">
                    <div className="audit-recent-swaps-title">Recent swaps</div>
                    <div className="audit-swaps-table-wrap" tabIndex={0} role="group" aria-label="Recent swaps (scrollable)">
                      <table className="audit-swaps-table">
                        <thead>
                          <tr>
                            <th>To</th>
                            <th>Amount</th>
                            <th>Fee</th>
                            <th>Duration</th>
                            <th>State</th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditRecentSwapRows.map(s => (
                            <tr key={s.swapId} className={s.state === 'OK' ? '' : s.neutral ? 'audit-swap-row-neutral' : 'audit-swap-row-fail'} {...(s.neutral === 'limits' || s.neutral === 'balance' ? { title: AUDIT_CZ_NEUTRAL_TITLE[s.neutral] } : {})}>
                              <td>{s.counterpart ?? (s.toUrl ? mintHostname(s.toUrl) : '—')}</td>
                              <td>{s.amount !== null ? `${s.amount} sat` : '—'}</td>
                              <td>{s.fee !== null ? s.fee : '—'}</td>
                              <td>{s.timeTakenMs !== null ? `${Math.round(s.timeTakenMs)} ms` : '—'}</td>
                              {/* cz rows that are not OK: the failure text as tooltip and as visually hidden text (a title is not available on touch or to screen readers). Plain text only. */}
                              <td>
                                <AuditStateText row={s} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {auditSwaps.length > AUDIT_SWAP_ROWS_DEFAULT && (
                      <button
                        type="button"
                        className="audit-swaps-show-all-btn"
                        onClick={() => setShowAllAuditSwaps(v => !v)}
                      >
                        {showAllAuditSwaps ? 'Show fewer' : `Show all (${auditSwaps.length})`}
                      </button>
                    )}
                  </div>
                )}
                {!czView && auditSwapsLoading && auditSwaps.length === 0 && (
                  <div style={{fontSize:12.5,color:'var(--text3)',fontFamily:'var(--font-mono)',marginTop:4}}>Loading recent swaps…</div>
                )}
                {!czView && auditSwapsError && (
                  <div className="audit-swaps-error-banner" role="status">
                    Couldn't load recent swaps
                    <button type="button" className="audit-swaps-retry-btn" onClick={() => void refetchAuditSwaps()}>
                      Retry
                    </button>
                  </div>
                )}
                </>)}

                {czView ? (czView.sourceHref && (
                  <a
                    href={czView.sourceHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="audit-external-link"
                  >
                    Open on cashu.info →
                  </a>
                )) : (
                <a
                  href="https://audit.8333.space/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="audit-external-link"
                >
                  Open on audit.8333.space →
                </a>
                )}
              </div>
            ) : (
              <div className="md-panel">
                <div className="md-audit-header">
                  <span className="md-panel-title" style={{marginBottom:0}}>Audit stats</span>
                  <AuditSourceInfoIcon text={auditNoDataText()} />
                </div>
                <div style={{fontSize:13,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>No audit data available for this mint.</div>
              </div>
            )}
          </>)
}
