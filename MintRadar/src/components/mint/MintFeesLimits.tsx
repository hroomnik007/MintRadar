import { InfoTooltip } from '@/components/InfoTooltip'
import type { FeeKeysetLike } from '@/utils/feeExamples'
import { feesView, limitRows, limitsSource, reservedFeeLines, LIMITS_NOTE, NO_INPUT_FEE } from '@/utils/feesLimits'
import { FEE_PER_COIN_TEXT } from '@/utils/tooltipTexts'

type MethodLike = { method: string; unit: string; [key: string]: unknown }

/**
 * Overview group "Fees and limits": input fee examples per unit (from the stored keysets) and the limits the mint
 * declares in /v1/info. Label left, value right (the .md-info-row recipe); every number is plain text.
 */
export function MintFeesLimits({ keysets, keysetsPending, units, mintMethods, meltMethods, disabled, fetchedAt, now }: {
  keysets: readonly FeeKeysetLike[] | null | undefined
  /** The keysets have not arrived yet: reserve the height of the final rows instead of showing a state. */
  keysetsPending: boolean
  units: readonly string[] | null | undefined
  mintMethods: readonly MethodLike[] | null | undefined
  meltMethods: readonly MethodLike[] | null | undefined
  disabled: { mint: boolean; melt: boolean }
  fetchedAt: string | null | undefined
  now: number
}) {
  const fees = feesView(keysets)
  const limits = limitRows(mintMethods, meltMethods, disabled)
  const src = limitsSource(fetchedAt, now)
  const reserved = reservedFeeLines(units)
  return (
    <div className="md-panel md-fees-limits" data-testid="mint-fees-limits">
      <div className="md-fl-head">
        <div className="md-panel-title">Fees and limits</div>
        <InfoTooltip iconSize={12} width={240} about="Fees and limits" text={LIMITS_NOTE} />
      </div>
      <div className="md-info-grid md-info-list md-fl-fees" style={keysetsPending ? { minHeight: `calc(${reserved} * var(--md-fl-row-h))` } : undefined} data-testid="mint-fees">
        {keysetsPending ? (
          <div className="md-info-row"><span className="md-info-label">Checking keysets…</span></div>
        ) : fees.empty ? (
          <div className="md-info-row"><span className="md-info-label">{fees.empty}</span></div>
        ) : fees.rows.map(r => (
          <div className="md-info-row" key={r.unit}>
            <span className="md-info-label md-info-label-tip">
              Input fee · {r.unit}
              {r.text !== NO_INPUT_FEE && <InfoTooltip iconSize={11} width={240} about={`input fee in ${r.unit}`} text={FEE_PER_COIN_TEXT} />}
            </span>
            <span className="md-info-value">{r.text}</span>
          </div>
        ))}
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
