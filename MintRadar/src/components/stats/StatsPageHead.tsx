import { PageHead } from '@/components/layout/PageHead'
import { PROBE_LOCATION } from '@/constants/probeLocation'

// The Stats page header, the single source of its text. It is NOT lazy and needs no data: the /stats route fallback
// (App.tsx) paints it before the Stats chunk has arrived, and Stats.tsx renders the same component in its loading,
// error and loaded states, so the header never changes text or height while the page loads.
export function StatsPageHead() {
  return (
    <PageHead
      title="Network stats"
      srTitle="Cashu mints: uptime, Reliability Score & NUT adoption"
      description={`How the Cashu mint network is doing right now, measured from ${PROBE_LOCATION}.`}
    />
  )
}
