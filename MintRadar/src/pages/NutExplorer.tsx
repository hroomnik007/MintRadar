import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useKnownMints } from '@/hooks/useKnownMints'
import { NUT_META, nutSpecUrl } from '@/constants/nuts'
import { MintFavicon } from '@/components/mint/MintFavicon'
import './NutExplorer.css'

interface NutData {
  nut: string
  percent: number
  mints: string[]
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
            const specUrl = nutSpecUrl(nut) ?? '#'
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
