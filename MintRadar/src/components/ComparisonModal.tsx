import { useEffect } from 'react'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { type KnownMint } from '@/hooks/useKnownMints'
import { useMintHistory } from '@/hooks/useMintHistory'

const IcClose = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)

function trustScoreInfo(score: number) {
  if (score >= 70) return { label: 'High Trust', color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.25)' }
  if (score >= 40) return { label: 'Moderate Trust', color: '#ffa500', bg: 'rgba(255,165,0,0.1)', border: 'rgba(255,165,0,0.25)' }
  return { label: 'Low Trust', color: '#ff4d4d', bg: 'rgba(255,77,77,0.1)', border: 'rgba(255,77,77,0.25)' }
}

function mintAgeBadge(discoveredAt: string | null | undefined) {
  if (!discoveredAt) return null
  const months = (Date.now() - new Date(discoveredAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  if (months < 1) return { label: 'Fresh', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.25)' }
  if (months < 6) return { label: 'Established', color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.25)' }
  if (months < 12) return { label: 'Veteran', color: '#ffa500', bg: 'rgba(255,165,0,0.1)', border: 'rgba(255,165,0,0.25)' }
  return { label: 'OG', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' }
}

function uptimeColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'var(--text3)'
  if (pct >= 80) return '#4ade80'
  if (pct >= 50) return '#ffa500'
  return '#ff4d4d'
}

function listTrustScore(mint: KnownMint): number {
  if (mint.online !== true) return 0
  return mint.trustScore ?? 0
}

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

function parseMinorVer(v: string | null | undefined): number {
  if (!v) return 0
  const m = v.match(/\d+\.(\d+)/)
  return m ? parseInt(m[1] ?? '0', 10) : 0
}

const NUT_FILTER_KEYS = ['1','2','3','4','5','6','7','8','9','10','11','12','13','14']
const CMP_ROW_LABELS = ['Mint', 'Status', 'Trust Score', 'Uptime', 'Latency', 'NUT Count', 'NUT Support', 'Version', 'Backup (NUT-13)']

function CompareColumn({ mint, latestVersion }: { mint: KnownMint; latestVersion: string | null }) {
  const { records, uptimePercent } = useMintHistory(mint.url)
  const isOnline = mint.online === true
  const displayName = mint.name ?? getHostname(mint.url)
  const hostname = getHostname(mint.url)
  const uptimePct = records.length > 0 ? uptimePercent : (isOnline ? 100 : 0)
  const trustScore = listTrustScore(mint)
  const tsInfo = trustScoreInfo(trustScore)
  const ageBadge = mintAgeBadge(mint.discoveredAt)
  const isNew = mint.discoveredAt != null && (Date.now() - new Date(mint.discoveredAt).getTime()) < 48 * 3600 * 1000
  const nutsLimits = (mint.nutsLimits ?? {}) as Record<string, unknown>
  const supportsNut13 = nutsLimits['13'] != null
  const isOutdated = mint.version != null && latestVersion != null
    && (parseMinorVer(latestVersion) - parseMinorVer(mint.version)) > 2

  return (
    <div className="cmp-col">
      <div className="cmp-cell cmp-name">
        <MintFavicon url={mint.url} iconUrl={mint.iconUrl} size={20} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hostname}</div>
          {!isNew && ageBadge && (
            <span style={{ fontSize: 9, color: ageBadge.color, background: ageBadge.bg, border: `0.5px solid ${ageBadge.border}`, borderRadius: 3, padding: '0 4px', fontFamily: 'var(--font-mono)' }}>{ageBadge.label}</span>
          )}
          {isNew && <span style={{ fontSize: 9, color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '0.5px solid rgba(74,222,128,0.3)', borderRadius: 3, padding: '0 4px', fontFamily: 'var(--font-mono)' }}>New</span>}
        </div>
      </div>
      <div className="cmp-cell">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: isOnline ? 'var(--accent)' : '#ff4d4d', display: 'inline-block', flexShrink: 0 }} />
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      <div className="cmp-cell">
        <span style={{ fontSize: 10, color: tsInfo.color, background: tsInfo.bg, border: `0.5px solid ${tsInfo.border}`, borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--font-mono)' }}>{tsInfo.label}</span>
        <span style={{ marginLeft: 5, fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: tsInfo.color }}>{trustScore}%</span>
      </div>
      <div className="cmp-cell" style={{ color: uptimeColor(uptimePct), fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{uptimePct}%</div>
      <div className="cmp-cell" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
        {isOnline && mint.latencyMs != null ? `${mint.latencyMs}ms` : '—'}
      </div>
      <div className="cmp-cell" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{mint.nutCount ?? 0} / 14</div>
      <div className="cmp-cell">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {NUT_FILTER_KEYS.map(key => {
            const supported = nutsLimits[key] != null
            return (
              <span key={key} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', padding: '1px 4px', borderRadius: 3, background: supported ? 'rgba(74,222,128,0.1)' : 'var(--bg3)', color: supported ? '#4ade80' : 'var(--text3)', border: `0.5px solid ${supported ? 'rgba(74,222,128,0.3)' : 'var(--border)'}` }}>
                {key.padStart(2, '0')}
              </span>
            )
          })}
        </div>
      </div>
      <div className="cmp-cell">
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{mint.version ?? '—'}</span>
        {isOutdated && (
          <span style={{ marginLeft: 5, fontSize: 9, color: '#ff4d4d', background: 'rgba(255,77,77,0.1)', border: '0.5px solid rgba(255,77,77,0.3)', borderRadius: 3, padding: '0 4px', fontFamily: 'var(--font-mono)' }}>Outdated</span>
        )}
      </div>
      <div className="cmp-cell">
        {supportsNut13
          ? <span style={{ fontSize: 10, color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '0.5px solid rgba(74,222,128,0.3)', borderRadius: 4, padding: '1px 6px', fontFamily: 'var(--font-mono)' }}>✓ Supported</span>
          : <span style={{ fontSize: 10, color: 'var(--text3)', background: 'var(--bg3)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '1px 6px', fontFamily: 'var(--font-mono)' }}>No backup</span>
        }
      </div>
    </div>
  )
}

export function ComparisonModal({ mints, onClose }: { mints: KnownMint[]; onClose: () => void }) {
  const versions = mints.map(m => m.version).filter(Boolean) as string[]
  const latestVersion = versions.reduce<string | null>((best, v) => {
    if (!best) return v
    return parseMinorVer(v) > parseMinorVer(best) ? v : best
  }, null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="cmp-overlay" onClick={onClose}>
      <div className="cmp-modal" onClick={e => e.stopPropagation()}>
        <div className="cmp-modal-header">
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Porovnanie mintov</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4 }}><IcClose /></button>
        </div>
        <div className="cmp-table">
          <div className="cmp-col cmp-labels">
            {CMP_ROW_LABELS.map(label => (
              <div key={label} className="cmp-cell cmp-label-cell">{label}</div>
            ))}
          </div>
          {mints.map(mint => (
            <CompareColumn key={mint.url} mint={mint} latestVersion={latestVersion} />
          ))}
        </div>
      </div>
    </div>
  )
}
