import { InfoTooltip } from '@/components/InfoTooltip'
import type { NetworkRows } from '@/utils/networkInfo'

// Overview "Network" card: public network facts about the mint host, all measured by our own backend. Label left,
// value right, hairline dividers (the .md-info-row recipe of the Mint info card). Text only.
export function MintNetworkCard({ rows }: { rows: NetworkRows }) {
  return (
    <div className="md-panel md-network-card" data-testid="mint-network-card">
      <div className="md-panel-title">Network</div>
      <div className="md-info-grid md-info-list">
        {rows.ip && (
          <div className="md-info-row"><span className="md-info-label">IP</span><span className="md-info-value">{rows.ip}</span></div>
        )}
        {rows.network && (
          <div className="md-info-row"><span className="md-info-label">Network</span><span className="md-info-value">{rows.network}</span></div>
        )}
        {rows.country && (
          <div className="md-info-row">
            <span className="md-info-label md-info-label-tip">
              Registered in
              <InfoTooltip text="Country where the IP block is registered, not where the server stands. For the server's city see Geographic Distribution on the Stats page." width={240} iconSize={11} label="About the registration country" />
            </span>
            <span className="md-info-value">{rows.country.name}</span>
          </div>
        )}
        {rows.tor && (
          <div className="md-info-row"><span className="md-info-label">Tor</span><span className="md-info-value">{rows.tor}</span></div>
        )}
      </div>
    </div>
  )
}
