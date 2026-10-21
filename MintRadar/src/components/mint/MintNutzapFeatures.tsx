import { nutzapRows } from '@/utils/nutzapFeatures'
import { limitsSource } from '@/utils/feesLimits'

/**
 * Overview group "Nutzap-related features": NUT-07, NUT-10, NUT-11 and NUT-12 each as "supported" or "not declared",
 * with the source (the mint's own /v1/info) and the time of the latest successful info fetch. Label left, value right
 * (the .md-info-row recipe); no combined verdict.
 */
export function MintNutzapFeatures({ declared, fetchedAt, now }: {
  declared: ReadonlySet<string> | null
  fetchedAt: string | null | undefined
  now: number
}) {
  const src = limitsSource(fetchedAt, now)
  return (
    <div className="md-panel md-nutzap" data-testid="mint-nutzap">
      <div className="md-panel-title">Nutzap-related features</div>
      <div className="md-info-grid md-info-list">
        {nutzapRows(declared).map(r => (
          <div className="md-info-row" key={r.nut} data-testid={`nutzap-nut-${r.nut}`}>
            <span className="md-info-label">{r.label}</span>
            <span className="md-info-value">{r.value}</span>
          </div>
        ))}
      </div>
      <div className="md-fl-note">
        <div className="md-fl-source">
          {src.text}
          {src.time && <>{' · '}<span title={src.time.title}>fetched {src.time.label}</span></>}
        </div>
      </div>
    </div>
  )
}
