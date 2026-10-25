import { useState } from 'react'
import { InfoTooltip } from '@/components/InfoTooltip'
import { ChangeDate, PendingTag } from '@/components/mint/ChangeDate'
import { feeDates } from '@/utils/changeDates'
import type { MintChangesData } from '@/utils/mintChangeLog'
import type { FeeKeysetLike } from '@/utils/feeExamples'
import { feesView, limitRows, limitsSource, reservedFeeLines, LIMITS_NOTE, NO_INPUT_FEE } from '@/utils/feesLimits'
import { FEE_PER_COIN_TEXT } from '@/utils/tooltipTexts'

type MethodLike = { method: string; unit: string; [key: string]: unknown }

/**
 * NUTs tab card "Fees and limits": the input fee rate and rounded examples per unit (from the stored keysets) and the limits the mint
 * declares in /v1/info. Label left, value right (the .md-info-row recipe); every number is plain text.
 */
export function MintFeesLimits({ keysets, keysetsPending, units, mintMethods, meltMethods, disabled, fetchedAt, now, changes }: {
  keysets: readonly FeeKeysetLike[] | null | undefined
  /** The keysets have not arrived yet: reserve the height of the final rows instead of showing a state. */
  keysetsPending: boolean
  units: readonly string[] | null | undefined
  mintMethods: readonly MethodLike[] | null | undefined
  meltMethods: readonly MethodLike[] | null | undefined
  disabled: { mint: boolean; melt: boolean }
  fetchedAt: string | null | undefined
  now: number
  /** /api/mints/changes of the mint: "since <date>", the fee history and a fee seen once. Without it no dates show. */
  changes?: MintChangesData | null | undefined
}) {
  const [historyOpen, setHistoryOpen] = useState<string | null>(null)
  const fees = feesView(keysets)
  const limits = limitRows(mintMethods, meltMethods, disabled)
  const src = limitsSource(fetchedAt, now)
  const reserved = reservedFeeLines(units)
  // With the change data known, every fee row gets a dates line ("since" / "unchanged since"): reserve it too while waiting.
  const datesLine = !!changes && (changes.trackingSince !== null || changes.changes.length > 0)
  return (
    <div className="md-panel md-fees-limits" data-testid="mint-fees-limits">
      <div className="md-fl-head">
        <div className="md-panel-title">Fees and limits</div>
        <InfoTooltip iconSize={12} width={240} about="Fees and limits" text={LIMITS_NOTE} />
      </div>
      <div className="md-info-grid md-info-list md-fl-fees" style={keysetsPending ? { minHeight: `calc(${reserved} * (var(--md-fl-row-h)${datesLine ? ' + var(--md-fl-date-h)' : ''}))` } : undefined} data-testid="mint-fees">
        {keysetsPending ? (
          <div className="md-info-row"><span className="md-info-label">Checking keysets…</span></div>
        ) : fees.empty ? (
          <div className="md-info-row"><span className="md-info-label">{fees.empty}</span></div>
        ) : fees.rows.map(r => {
          const d = feeDates(r.unit, changes, now)
          const open = historyOpen === r.unit
          return (
            <div className="md-info-row md-fee-row" key={r.unit} data-testid={`fee-row-${r.unit}`}>
              <span className="md-info-label md-info-label-tip">
                Input fee · {r.unit}
                {r.text !== NO_INPUT_FEE && <InfoTooltip iconSize={11} width={240} about={`input fee in ${r.unit}`} text={FEE_PER_COIN_TEXT} />}
              </span>
              <span className="md-info-value">
                <span className="md-fee-rate">{r.text}</span>
                {r.examples && <span className="md-fee-examples">{r.examples}</span>}
              </span>
              {d && (d.since || d.unchangedSince || d.pending || d.history.length > 0) && (
                <div className="md-fee-dates">
                  {d.since && <ChangeDate prefix="since" mark={d.since} testId="fee-since" />}
                  {d.unchangedSince && <ChangeDate prefix="unchanged since" mark={d.unchangedSince} testId="fee-unchanged" />}
                  {d.pending && <PendingTag mark={d.pending} />}
                  {d.history.length > 0 && (
                    <button type="button" className="md-fee-history-toggle" aria-expanded={open} onClick={() => setHistoryOpen(open ? null : r.unit)}>
                      {open ? 'Hide fee history' : 'Show fee history'}
                    </button>
                  )}
                </div>
              )}
              {d && open && d.history.length > 0 && (
                <ul className="md-fee-history" data-testid="fee-history">
                  {d.history.map((h, i) => <li key={i} title={h.title}>{h.text}</li>)}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      <div className="md-info-grid md-info-list" data-testid="mint-limits">
        {limits.map(r => (
          <div className="md-info-row" key={r.key}>
            <span className="md-info-label">{r.label}</span>
            <span className="md-info-value">{r.value}</span>
          </div>
        ))}
      </div>
      <div className="md-fl-note">
        <div>
          {src.text}
          {src.time && <>{' · '}<span title={src.time.title}>fetched {src.time.label}</span></>}
        </div>
      </div>
    </div>
  )
}
