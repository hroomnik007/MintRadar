import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKnownMints, type KnownMint } from '@/hooks/useKnownMints'
import { MintFavicon } from '@/components/mint/MintFavicon'
import './Tools.css'

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

function normUrl(raw: string): string {
  try {
    const p = new URL(raw.trim())
    p.protocol = 'https:'
    p.hostname = p.hostname.toLowerCase()
    let r = p.toString()
    if (p.pathname === '/') r = r.replace(/\/$/, '')
    return r
  } catch { return raw.trim() }
}

interface TokenInfo {
  mint: string
  amount: number
  unit: string
  proofsCount: number
  version: string
}

function parseCashuToken(token: string): TokenInfo | null {
  try {
    if (token.startsWith('cashuA')) {
      const encoded = token.slice(6)
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
      const json = atob(padded)
      const data = JSON.parse(json) as {
        token?: Array<{ mint: string; proofs: Array<{ amount: number }> }>
        unit?: string
      }
      const tokenArr = data.token ?? []
      if (!Array.isArray(tokenArr) || tokenArr.length === 0) return null
      const first = tokenArr[0]
      if (!first) return null
      const mint = first.mint ?? ''
      const proofs = Array.isArray(first.proofs) ? first.proofs : []
      const amount = proofs.reduce((s, p) => s + (p.amount ?? 0), 0)
      return { mint, amount, unit: data.unit ?? 'sat', proofsCount: proofs.length, version: 'v3 (cashuA)' }
    }
  } catch { /* fall through */ }
  return null
}

function TokenInspector({ knownMints }: { knownMints: KnownMint[] }) {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [result, setResult] = useState<TokenInfo | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [inspected, setInspected] = useState(false)

  const knownMap = useMemo(() => {
    const m = new Map<string, KnownMint>()
    for (const mint of knownMints) m.set(mint.url, mint)
    return m
  }, [knownMints])

  const mintInfo = useMemo(() => {
    if (!result) return null
    const normalized = normUrl(result.mint)
    return knownMap.get(normalized) ?? knownMap.get(result.mint) ?? null
  }, [result, knownMap])

  const handleInspect = () => {
    const token = input.trim()
    if (!token) return
    setInspected(true)
    const parsed = parseCashuToken(token)
    if (!parsed) {
      setParseError('Invalid token format — only cashuA (v3) tokens are supported')
      setResult(null)
    } else {
      setParseError(null)
      setResult(parsed)
    }
  }

  const scoreColor = (s: number) => s >= 70 ? '#4ade80' : s >= 40 ? '#f59e0b' : '#E24B4A'

  return (
    <div className="tool-card">
      <div className="tool-header">
        <div className="tool-title">Token Inspector</div>
        <div className="tool-subtitle">Paste a Cashu token to inspect its mint, amount, and trust status before redeeming</div>
      </div>

      <textarea
        className="token-input"
        placeholder="cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8v..."
        value={input}
        onChange={e => { setInput(e.target.value); setInspected(false); setResult(null); setParseError(null) }}
        rows={3}
        spellCheck={false}
      />

      <button type="button" className="tool-btn-primary" onClick={handleInspect} disabled={!input.trim()}>
        Inspect Token
      </button>

      {parseError && inspected && (
        <div className="token-error">{parseError}</div>
      )}

      {result && (
        <>
          <div className="token-result-grid">
            <div className="token-result-cell">
              <div className="trc-label">Mint</div>
              <div className="trc-value">{mintInfo?.name ?? getHostname(result.mint)}</div>
              <div className="trc-sub">{getHostname(result.mint)}</div>
            </div>
            <div className="token-result-cell">
              <div className="trc-label">Amount</div>
              <div className="trc-value trc-accent">{result.amount.toLocaleString()}</div>
              <div className="trc-sub">{result.unit}</div>
            </div>
            <div className="token-result-cell">
              <div className="trc-label">Mint Status</div>
              {mintInfo ? (
                <>
                  <div className="trc-value" style={{ color: mintInfo.online === true ? '#17E87F' : '#E24B4A' }}>
                    {mintInfo.online === true ? '● Online' : mintInfo.online === false ? '● Offline' : '○ Unknown'}
                  </div>
                  {mintInfo.lastCheckedAt && (
                    <div className="trc-sub">
                      checked {Math.round((Date.now() - new Date(mintInfo.lastCheckedAt).getTime()) / 60000)}m ago
                    </div>
                  )}
                </>
              ) : (
                <div className="trc-value trc-muted">Not in database</div>
              )}
            </div>
            <div className="token-result-cell">
              <div className="trc-label">Trust Score</div>
              {mintInfo?.trustScore != null ? (
                <>
                  <div className="trc-value" style={{ color: scoreColor(mintInfo.trustScore) }}>{mintInfo.trustScore}%</div>
                  <div className="trc-sub" style={{ color: scoreColor(mintInfo.trustScore) }}>
                    {mintInfo.trustScore >= 70 ? 'High Trust' : mintInfo.trustScore >= 40 ? 'Moderate Trust' : 'Low Trust'}
                  </div>
                </>
              ) : (
                <div className="trc-value trc-muted">—</div>
              )}
            </div>
          </div>

          <div className="token-details-row">
            <span className="tdr-item"><span className="tdr-label">Version</span>{result.version}</span>
            <span className="tdr-sep">·</span>
            <span className="tdr-item"><span className="tdr-label">Proofs</span>{result.proofsCount}</span>
            <span className="tdr-sep">·</span>
            <span className="tdr-item"><span className="tdr-label">Unit</span>{result.unit}</span>
          </div>

          <div className="token-actions">
            {mintInfo && (
              <button type="button" className="token-action-btn" onClick={() => navigate(`/mint/${encodeURIComponent(result.mint)}`)}>
                → View Mint Detail
              </button>
            )}
            <a
              className="token-action-btn"
              href={`https://wallet.cashu.me/?token=${encodeURIComponent(input.trim())}`}
              target="_blank"
              rel="noreferrer"
            >
              ↗ Open in Cashu.me
            </a>
          </div>
        </>
      )}
    </div>
  )
}

type Preference = 'speed' | 'trust' | 'features'
type SoftwarePref = 'any' | 'nutshell' | 'latest'
type SizeOption = 'small' | 'medium' | 'large'

interface WizardRec { url: string; mint: KnownMint; score: number; latencyMs: number | null }

function BestMintWizard({ knownMints }: { knownMints: KnownMint[] }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [size, setSize] = useState<SizeOption | null>(null)
  const [preference, setPreference] = useState<Preference | null>(null)
  const [softPref, setSoftPref] = useState<SoftwarePref | null>(null)
  const [finding, setFinding] = useState(false)
  const [recs, setRecs] = useState<WizardRec[] | null>(null)

  const ready = size !== null && preference !== null && softPref !== null

  const handleFind = async () => {
    if (!preference) return
    setFinding(true)
    setRecs(null)

    const candidates = knownMints
      .filter(m => m.online === true && m.trustScore != null)
      .filter(m => {
        if (softPref === 'nutshell') return m.version?.startsWith('Nutshell') ?? false
        if (softPref === 'latest') {
          if (!m.version) return false
          const ver = m.version.split('/')[1] ?? ''
          const latest = '0.20.0'
          return ver >= latest
        }
        return true
      })
      .sort((a, b) => (b.trustScore ?? 0) - (a.trustScore ?? 0))
      .slice(0, 20)

    const weights: Record<Preference, { latency: number; trust: number; nuts: number }> = {
      speed:    { latency: 0.6, trust: 0.3, nuts: 0.1 },
      trust:    { latency: 0.2, trust: 0.7, nuts: 0.1 },
      features: { latency: 0.2, trust: 0.3, nuts: 0.5 },
    }
    const w = weights[preference]

    const latencyResults = await Promise.allSettled(
      candidates.map(async m => {
        const start = Date.now()
        try {
          const r = await fetch(`${m.url}/v1/info`, { signal: AbortSignal.timeout(5000) })
          if (!r.ok) return { url: m.url, latencyMs: null }
          return { url: m.url, latencyMs: Date.now() - start }
        } catch { return { url: m.url, latencyMs: null } }
      })
    )

    const latencyMap = new Map<string, number | null>()
    for (const r of latencyResults) {
      if (r.status === 'fulfilled') latencyMap.set(r.value.url, r.value.latencyMs)
    }

    const maxLatency = Math.max(...[...latencyMap.values()].filter((v): v is number => v !== null), 1)
    const maxNuts = Math.max(...candidates.map(m => m.nutCount ?? 0), 1)

    const scored: WizardRec[] = candidates.map(m => {
      const latMs = latencyMap.get(m.url) ?? null
      const latScore = latMs !== null ? 1 - latMs / maxLatency : 0
      const trustScore = (m.trustScore ?? 0) / 100
      const nutsScore = (m.nutCount ?? 0) / maxNuts
      return {
        url: m.url,
        mint: m,
        score: w.latency * latScore + w.trust * trustScore + w.nuts * nutsScore,
        latencyMs: latMs,
      }
    }).sort((a, b) => b.score - a.score).slice(0, 3)

    setRecs(scored)
    setFinding(false)
  }

  const scoreColor = (s: number) => s >= 70 ? '#4ade80' : s >= 40 ? '#f59e0b' : '#E24B4A'

  return (
    <div className="tool-card">
      <div className="tool-header">
        <div className="tool-title">Best Mint for Me</div>
        <div className="tool-subtitle">Answer 3 quick questions and we'll recommend the best mints for your needs · latency measured from your browser</div>
      </div>

      <div className="wizard-steps">
        {[1, 2, 3].map(n => (
          <div key={n} className={`wizard-step-dot${step >= n ? ' active' : ''}${step > n ? ' done' : ''}`}>
            {step > n ? '✓' : n}
          </div>
        ))}
        <div className="wizard-step-line" />
      </div>

      {step === 1 && (
        <div className="wizard-step-body">
          <div className="wizard-q">How much do you plan to store?</div>
          <div className="wizard-options">
            {[
              { id: 'small' as SizeOption, label: 'Small', sub: '< 10k sats' },
              { id: 'medium' as SizeOption, label: 'Medium', sub: '10k–100k sats' },
              { id: 'large' as SizeOption, label: 'Large', sub: '> 100k sats' },
            ].map(opt => (
              <button key={opt.id} type="button" className={`wizard-opt${size === opt.id ? ' active' : ''}`}
                onClick={() => { setSize(opt.id); setStep(2) }}>
                <div className="wizard-opt-label">{opt.label}</div>
                <div className="wizard-opt-sub">{opt.sub}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-step-body">
          <div className="wizard-q">What matters most to you?</div>
          <div className="wizard-options">
            {[
              { id: 'speed' as Preference, label: '⚡ Speed', sub: 'I want the fastest mint from my location' },
              { id: 'trust' as Preference, label: '🛡 Trust', sub: 'I want the most reliable and audited mint' },
              { id: 'features' as Preference, label: '🧩 Features', sub: 'I need specific NUT support' },
            ].map(opt => (
              <button key={opt.id} type="button" className={`wizard-opt${preference === opt.id ? ' active' : ''}`}
                onClick={() => { setPreference(opt.id); setStep(3) }}>
                <div className="wizard-opt-label">{opt.label}</div>
                <div className="wizard-opt-sub">{opt.sub}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="wizard-step-body">
          <div className="wizard-q">Software preference?</div>
          <div className="wizard-options wizard-options-row">
            {[
              { id: 'any' as SoftwarePref, label: 'Any' },
              { id: 'nutshell' as SoftwarePref, label: 'Nutshell only' },
              { id: 'latest' as SoftwarePref, label: 'Latest version only' },
            ].map(opt => (
              <button key={opt.id} type="button" className={`wizard-opt${softPref === opt.id ? ' active' : ''}`}
                onClick={() => setSoftPref(opt.id)}>
                <div className="wizard-opt-label">{opt.label}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <button type="button" className="tool-btn-primary" disabled={!ready || finding} onClick={() => void handleFind()}>
          {finding ? 'Measuring latency…' : 'Find my mints →'}
        </button>
      )}

      {step > 1 && !recs && (
        <button type="button" className="wizard-back-btn" onClick={() => { setStep(s => s - 1); setRecs(null) }}>
          ← Back
        </button>
      )}

      {recs !== null && (
        <div className="wizard-results">
          {recs.length === 0 ? (
            <div className="wizard-no-results">No mints match your criteria. Try changing software preference.</div>
          ) : (
            recs.map((rec, idx) => {
              const hostname = getHostname(rec.url)
              const score = rec.mint.trustScore ?? 0
              return (
                <div key={rec.url} className="wizard-rec-row" onClick={() => navigate(`/mint/${encodeURIComponent(rec.url)}`)}>
                  <span className="wizard-rank">#{idx + 1}</span>
                  <MintFavicon url={rec.url} iconUrl={rec.mint.iconUrl ?? null} size={28} radius={6} />
                  <div className="wizard-rec-info">
                    <div className="wizard-rec-name">{rec.mint.name ?? hostname}</div>
                    <div className="wizard-rec-meta">
                      {rec.latencyMs != null && <span>{rec.latencyMs}ms from your location</span>}
                      {rec.mint.uptimePct24h != null && <span>· {rec.mint.uptimePct24h}% uptime</span>}
                      {rec.mint.nutCount != null && <span>· {rec.mint.nutCount} NUTs</span>}
                    </div>
                  </div>
                  <span className="wizard-rec-score" style={{ color: scoreColor(score) }}>{score}%</span>
                  <span className="wizard-rec-view">View →</span>
                </div>
              )
            })
          )}
          <button type="button" className="wizard-back-btn" style={{ marginTop: 8 }}
            onClick={() => { setStep(1); setSize(null); setPreference(null); setSoftPref(null); setRecs(null) }}>
            ← Start over
          </button>
        </div>
      )}
    </div>
  )
}

export default function Tools() {
  const { data: knownMintsData } = useKnownMints()
  const mints = knownMintsData ?? []

  return (
    <div className="tools-page">
      <div className="tools-grid">
        <TokenInspector knownMints={mints} />
        <BestMintWizard knownMints={mints} />
      </div>
    </div>
  )
}
