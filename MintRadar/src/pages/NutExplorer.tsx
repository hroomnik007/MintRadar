import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useKnownMints } from '@/hooks/useKnownMints'
import { MintFavicon } from '@/components/mint/MintFavicon'
import './NutExplorer.css'

interface NutData {
  nut: string
  percent: number
  mints: string[]
}

const NUT_META: Record<string, { short: string; desc: string; specNum: string }> = {
  'NUT-04': { short: 'Mint tokens', desc: 'Minting new Cashu tokens against a Lightning invoice.', specNum: '04' },
  'NUT-05': { short: 'Melt tokens', desc: 'Melting Cashu tokens to pay a Lightning invoice.', specNum: '05' },
  'NUT-07': { short: 'Token state', desc: 'Checking whether a proof has been spent or is still valid.', specNum: '07' },
  'NUT-08': { short: 'Overpay melt', desc: 'Overpaying melt fees and receiving change tokens back.', specNum: '08' },
  'NUT-09': { short: 'Restore', desc: 'Restoring blinded signatures from mint backup data.', specNum: '09' },
  'NUT-10': { short: 'Spending conditions', desc: 'Spending conditions that must be met to use a proof.', specNum: '10' },
  'NUT-11': { short: 'Pay-to-PK', desc: 'Lock tokens to a specific public key for secure transfers.', specNum: '11' },
  'NUT-12': { short: 'DLEQ proofs', desc: 'Discrete Log Equality proofs for verifiable blind signatures.', specNum: '12' },
  'NUT-14': { short: 'HTLCs', desc: 'Hash Time Locked Contracts for atomic swaps.', specNum: '14' },
  'NUT-15': { short: 'Multipart melt', desc: 'Split a melt payment across multiple Lightning invoices.', specNum: '15' },
  'NUT-17': { short: 'WebSocket', desc: 'Real-time mint updates via WebSocket subscription.', specNum: '17' },
  'NUT-19': { short: 'Cached responses', desc: 'Mints cache successful responses so wallets can replay after a network error.', specNum: '19' },
  'NUT-20': { short: 'Mint quote sig', desc: 'Mint signs quote requests for authenticity.', specNum: '20' },
  'NUT-29': { short: 'Batched minting', desc: 'Wallets can mint tokens for multiple quotes in a single atomic request.', specNum: '29' },
}

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

export default function NutExplorer() {
  const navigate = useNavigate()

  const { data: nutsData, isLoading: nutsLoading, error: nutsError } = useQuery({
    queryKey: ['nuts'],
    queryFn: async (): Promise<NutData[]> => {
      const res = await fetch('/api/nuts')
      if (!res.ok) throw new Error('Failed to fetch NUT data')
      return res.json() as Promise<NutData[]>
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: knownMintsData } = useKnownMints()
  const knownMintsMap = new Map(knownMintsData?.map(m => [m.url, m]) ?? [])

  return (
    <div className="nuts-page">
      <div className="nuts-header">
        <div className="nuts-title">NUT Explorer</div>
        <div className="nuts-subtitle">Cashu protocol NUT adoption across online mints</div>
      </div>

      {nutsLoading && (
        <div className="nuts-loading">Loading…</div>
      )}
      {(nutsError != null || (!nutsLoading && !nutsData)) && (
        <div className="nuts-loading">Failed to load NUT data</div>
      )}

      {nutsData && (
        <div className="nuts-grid">
          {nutsData.map(({ nut, percent, mints }) => {
            const meta = NUT_META[nut]
            if (!meta) return null
            const barColor = percent >= 70 ? '#639922' : percent >= 40 ? '#EF9F27' : '#E24B4A'
            const specUrl = `https://github.com/cashubtc/nuts/blob/main/${meta.specNum}.md`
            const shown = mints.slice(0, 5)
            const remaining = mints.length - shown.length

            return (
              <div key={nut} className="nut-explorer-card">
                <div className="nec-head">
                  <div className="nec-nut-tag">{nut}</div>
                  <div className="nec-name">{meta.short}</div>
                  <a
                    href={specUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="nec-spec-link"
                    onClick={e => e.stopPropagation()}
                  >
                    spec ↗
                  </a>
                </div>

                <div className="nec-desc">{meta.desc}</div>

                <div className="nec-bar-row">
                  <div className="nec-bar-track">
                    <div className="nec-bar-fill" style={{ width: `${percent}%`, background: barColor }} />
                  </div>
                  <span className="nec-pct" style={{ color: barColor }}>{percent}%</span>
                </div>
                <div className="nec-bar-label">{mints.length} mint{mints.length !== 1 ? 's' : ''} support this NUT</div>

                {mints.length > 0 && (
                  <div className="nec-mints">
                    {shown.map(url => {
                      const m = knownMintsMap.get(url)
                      const name = m?.name ?? getHostname(url)
                      return (
                        <div
                          key={url}
                          className="nec-mint-row"
                          onClick={() => navigate(`/mint/${encodeURIComponent(url)}`)}
                          title={url}
                        >
                          <MintFavicon url={url} iconUrl={m?.iconUrl ?? null} size={14} />
                          <span className="nec-mint-name">{name}</span>
                          <span
                            className="nec-mint-dot"
                            style={{ background: m?.online === true ? 'var(--accent)' : '#ff4d4d' }}
                          />
                        </div>
                      )
                    })}
                    {remaining > 0 && (
                      <div className="nec-more">+{remaining} more</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
