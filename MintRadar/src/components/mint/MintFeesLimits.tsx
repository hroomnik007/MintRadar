import { useState } from 'react'
import { InfoTooltip } from '@/components/InfoTooltip'
import { ChangeDate, PendingTag } from '@/components/mint/ChangeDate'
import { feeDates } from '@/utils/changeDates'
import type { MintChangesData } from '@/utils/mintChangeLog'
import type { FeeKeysetLike } from '@/utils/feeExamples'
import { feesView, limitTable, limitsSource, reservedFeeLines, LIMITS_NOTE, NO_INPUT_FEE } from '@/utils/feesLimits'
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
  const limits = limitTable(mintMethods, meltMethods, disabled)
  const limitUnits = [...new Set(limits.map(r => r.key.split('|')[1]!))]
  const src = limitsSource(fetchedAt, now)
  const reserved = reservedFeeLines(units)
  // With the change data known, every fee row gets a dates line ("since" / "unchanged since"): reserve it too while waiting.
  const datesLine = !!changes && (changes.trackingSince !== null || changes.changes.length > 0)
  return (
    <div className="md-panel md-fees-limits" data-testid="mint-fees-limits">
      <div className="md-fl-head">
        <div>
          <div className="md-panel-title">Fees and limits</div>
          {/* What the numbers are, under the title (2026-11-19 mockup alignment): one unit is named here, not on every row. */}
          {limits.length > 0 && <p className="md-panel-sub">Per payment{limitUnits.length === 1 ? `, in ${limitUnits[0]}` : ''}.</p>}
        </div>
        <InfoTooltip iconSize={12} width={240} about="Fees and limits" text={LIMITS_NOTE} />
      </div>
      {/* Limits per payment as a table, method x deposit / withdrawal (2026-11-19 redesign; they were "Deposit (mint) ·
          bolt11 · sat" rows). The empty and switched-off cases keep their sentence. */}
      {limits.length === 0 ? (
        <div className="md-info-grid md-info-list" data-testid="mint-limits">
          <div className="md-info-row"><span className="md-info-label">Limits</span><span className="md-info-value">no methods declared</span></div>
        </div>
      ) : (
        <table className="md-limits-table" data-testid="mint-limits">
          <thead><tr><th scope="col">Method</th><th scope="col" className="n">Deposit</th><th scope="col" className="n">Withdrawal</th></tr></thead>
          <tbody>
            {limits.map(r => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td className="n">{r.deposit}</td>
                <td className="n">{r.withdrawal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/* The input fee under the limits (2026-11-19 mockup alignment; it headed the card). */}
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
      <div className="md-fl-note">
        <div>
          {src.text}
          {src.time && <>{' · '}<span title={src.time.title}>fetched {src.time.label}</span></>}
        </div>
      </div>
    </div>
  )
}
