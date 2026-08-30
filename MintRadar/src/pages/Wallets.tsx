import { WALLETS } from '@/constants/wallets'
import './Wallets.css'

function hostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export default function Wallets() {
  return (
    <div className="wallets-page">
      <div className="wallets-header">
        <div className="wallets-title">Wallets</div>
        <div className="wallets-subtitle">Cashu-compatible wallets — a plain list, no ranking or reviews</div>
      </div>

      <div className="wallets-grid">
        {WALLETS.map(w => (
          <div key={w.name} className="wallet-card">
            <div className="wallet-card-head">
              <span className="wallet-name">{w.name}</span>
              <div className="wallet-platforms">
                {w.platforms.map(p => (
                  <span key={p} className="wallet-platform-tag">{p}</span>
                ))}
              </div>
            </div>

            <p className="wallet-blurb">{w.blurb}</p>

            <a
              className="wallet-link"
              href={w.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {hostname(w.url)} ↗
            </a>
          </div>
        ))}
      </div>

      <div className="wallets-footnote">
        Listing a wallet here is not an endorsement. Always verify you trust a wallet before putting funds in it.
      </div>
    </div>
  )
}
