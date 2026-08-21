import './LearnDiagrams.css'

// Module 2 — the asymmetry at the heart of Cashu custody. The mint side is
// drawn solid and filled (real reserves); the holder side is dashed and
// dimmed (a claim, nothing more), and the link between them is deliberately
// one-way: value flows out of the mint, never the other way.

function IcVault() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="5.4" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
      <path d="M12 3v3.6M12 17.4V21M3 12h3.6M17.4 12H21" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}

function IcFragileToken() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.8" y="6.6" width="18.4" height="10.8" rx="2.2" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 2.6" />
      <path d="M12 6.6l-1.6 4.3 3 1.2-1.4 5.3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    </svg>
  )
}

export function RiskAsymmetryDiagram() {
  return (
    <div
      className="learn-diagram risk-diagram"
      role="img"
      aria-label="The mint holds real Bitcoin; you hold a bearer token whose value depends entirely on that mint."
    >
      <div className="risk-box risk-box-solid">
        <span className="risk-box-icon"><IcVault /></span>
        <span className="risk-box-title">Mint holds real Bitcoin</span>
        <span className="risk-box-sub">in their custody</span>
      </div>

      <div className="risk-link" aria-hidden="true">
        <svg className="risk-link-arrow" viewBox="0 0 44 12" fill="none">
          <path d="M42 6H6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M9.6 2.4 6 6l3.6 3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="risk-link-label">depends entirely on</span>
      </div>

      <div className="risk-box risk-box-fragile">
        <span className="risk-box-icon"><IcFragileToken /></span>
        <span className="risk-box-title">You hold a bearer token</span>
        <span className="risk-box-sub">a claim, not the coins</span>
      </div>
    </div>
  )
}
