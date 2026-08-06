import { useEffect, useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { type KnownMint } from '@/hooks/useKnownMints'
import { useNow } from '@/hooks/useNow'
import { useIsMobile } from '@/hooks/useIsMobile'

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

// Per-mint line colors for the historical trend overlay — reuses hues already
// established elsewhere in the app (Trust Trend green, copper accent, the
// Fresh/OG badge blue and purple) rather than inventing new ones.
const MINT_COLORS = ['#17E87F', '#c98058', '#60a5fa', '#a78bfa']

type HistoryPeriod = '24h' | '7d' | '30d' | '90d'
type HistoryMetric = 'latency' | 'uptime' | 'trust'

interface HistorySegment {
  bucket: string
  online: boolean
  latencyMs: number | null
  total: number
  onlineCount: number
  uptimePct: number | null
  trustScore: number | null
}

interface HistoryResponse {
  period: string
  segments: HistorySegment[]
  uptimePct: number | null
  avgLatencyMs: number | null
  prevUptimePct: number | null
  prevAvgLatencyMs: number | null
  earliestCheckedAt: string | null
  daysOfDataAvailable: number
  periodDays: number
  prevPeriodInsufficientHistory: boolean
}

interface VersionHistoryResponse {
  history: Array<{ version: string; firstSeenAt: string }>
  latestGlobalVersion: string | null
}

const EMPTY_MINT: KnownMint = {
  url: '', name: null, iconUrl: null, degraded: false, online: null,
  latencyMs: null, version: null, nutCount: null, tosUrl: null,
  descriptionLong: null, nutsLimits: null,
}

function useMintCompareData(mint: KnownMint, latestVersion: string | null) {
  const now = useNow()
  const isOnline = mint.online === true
  const displayName = mint.name ?? getHostname(mint.url)
  const hostname = getHostname(mint.url)
  const trustScore = listTrustScore(mint)
  const tsInfo = trustScoreInfo(trustScore)
  const ageBadge = mintAgeBadge(mint.discoveredAt)
  const isNew = mint.discoveredAt != null && (now - new Date(mint.discoveredAt).getTime()) < 48 * 3600 * 1000
  const nutsLimits = (mint.nutsLimits ?? {}) as Record<string, unknown>
  const supportsNut13 = nutsLimits['13'] != null
  const isOutdated = mint.version != null && latestVersion != null
    && (parseMinorVer(latestVersion) - parseMinorVer(mint.version)) > 2
  return { isOnline, displayName, hostname, trustScore, tsInfo, ageBadge, isNew, nutsLimits, supportsNut13, isOutdated }
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

  // Unconditional hook calls for up to 4 mint slots
  const d0 = useMintCompareData(mints[0] ?? EMPTY_MINT, latestVersion)
  const d1 = useMintCompareData(mints[1] ?? EMPTY_MINT, latestVersion)
  const d2 = useMintCompareData(mints[2] ?? EMPTY_MINT, latestVersion)
  const d3 = useMintCompareData(mints[3] ?? EMPTY_MINT, latestVersion)
  const allData = [d0, d1, d2, d3].slice(0, mints.length)

  const gridCols = `140px ${mints.map(() => 'minmax(160px, 1fr)').join(' ')}`

  const isMobile = useIsMobile()
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('7d')
  const [metric, setMetric] = useState<HistoryMetric>('latency')

  const historyQueries = useQueries({
    queries: mints.map(m => ({
      queryKey: ['mint', 'chart-history', m.url, historyPeriod],
      queryFn: async (): Promise<HistoryResponse> => {
        const res = await fetch(`/api/mints/history?url=${encodeURIComponent(m.url)}&period=${historyPeriod}`)
        if (!res.ok) throw new Error('Failed to fetch chart history')
        return res.json() as Promise<HistoryResponse>
      },
      staleTime: 5 * 60 * 1000,
    })),
  })

  // Summary-row Uptime — always the server's 24h figure, independent of the
  // chart's selected historyPeriod, so it matches Mint Detail's header. Same
  // queryKey shape as MintDetail's dedicated 24h query, so the two share cache.
  const uptime24hQueries = useQueries({
    queries: mints.map(m => ({
      queryKey: ['mint', 'history-api', m.url, '24h'],
      queryFn: async (): Promise<HistoryResponse> => {
        const res = await fetch(`/api/mints/history?url=${encodeURIComponent(m.url)}&period=24h`)
        if (!res.ok) throw new Error('Failed to fetch 24h uptime')
        return res.json() as Promise<HistoryResponse>
      },
      staleTime: 5 * 60 * 1000,
    })),
  })

  const versionQueries = useQueries({
    queries: mints.map(m => ({
      queryKey: ['mint', 'version-history', m.url],
      queryFn: async (): Promise<VersionHistoryResponse> => {
        const res = await fetch(`/api/mints/version-history?url=${encodeURIComponent(m.url)}`)
        if (!res.ok) throw new Error('Failed to fetch version history')
        return res.json() as Promise<VersionHistoryResponse>
      },
      staleTime: 10 * 60 * 1000,
    })),
  })

  const isLoadingHistory = historyQueries.some(q => q.isLoading)

  const loadedHistory = historyQueries.map(q => q.data).filter((d): d is HistoryResponse => d != null)
  const periodDaysValue = loadedHistory[0]?.periodDays ?? null
  const minDaysAvailable = loadedHistory.length > 0
    ? Math.min(...loadedHistory.map(d => d.daysOfDataAvailable))
    : null
  const coverageText = (periodDaysValue !== null && minDaysAvailable !== null && minDaysAvailable < periodDaysValue)
    ? `Showing ${minDaysAvailable} of ${periodDaysValue} days of data (history retention started recently)`
    : null

  const chartData = useMemo(() => {
    const bucketSet = new Set<string>()
    const segMaps = historyQueries.map(q => {
      const map = new Map<string, HistorySegment>()
      q.data?.segments.forEach(s => { map.set(s.bucket, s); bucketSet.add(s.bucket) })
      return map
    })
    const buckets = [...bucketSet].sort()
    return buckets.map(bucket => {
      const d = new Date(bucket)
      const label = historyPeriod === '24h'
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
        : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
      const row: Record<string, string | number | null> = { label }
      segMaps.forEach((map, i) => {
        const seg = map.get(bucket)
        const value = !seg ? null
          : metric === 'latency' ? seg.latencyMs
          : metric === 'uptime' ? seg.uptimePct
          : seg.trustScore
        row[`m${i}`] = value
      })
      return row
    })
  }, [historyQueries, historyPeriod, metric])

  const chartHasEnoughData = chartData.filter(
    row => mints.some((_, i) => row[`m${i}`] != null)
  ).length >= 2

  return (
    <div className="cmp-overlay" onClick={onClose}>
      <div className="cmp-modal" onClick={e => e.stopPropagation()}>
        <div className="cmp-modal-header">
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Mint Comparison</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4 }}><IcClose /></button>
        </div>

        <div className="cmp-grid" style={{ gridTemplateColumns: gridCols }}>

          {/* ── Mint ── */}
          <div className="cmp-lbl cmp-row-mint">Mint</div>
          {mints.map((mint, i) => {
            const d = allData[i]!
            const badge = d.ageBadge
            return (
              <div key={mint.url} className="cmp-val cmp-row-mint" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <MintFavicon url={mint.url} iconUrl={mint.iconUrl} size={20} />
                <div style={{ minWidth: 0, width: '100%' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.displayName}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.hostname}</div>
                  {!d.isNew && badge && (
                    <span style={{ fontSize: 9, color: badge.color, background: badge.bg, border: `0.5px solid ${badge.border}`, borderRadius: 3, padding: '0 4px', fontFamily: 'var(--font-mono)' }}>{badge.label}</span>
                  )}
                  {d.isNew && <span style={{ fontSize: 9, color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '0.5px solid rgba(74,222,128,0.3)', borderRadius: 3, padding: '0 4px', fontFamily: 'var(--font-mono)' }}>New</span>}
                </div>
              </div>
            )
          })}

          {/* ── Status ── */}
          <div className="cmp-lbl">Status</div>
          {mints.map((mint, i) => {
            const d = allData[i]!
            return (
              <div key={mint.url} className="cmp-val">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: d.isOnline ? 'var(--accent)' : '#ff4d4d', display: 'inline-block', flexShrink: 0 }} />
                  {d.isOnline ? 'Online' : 'Offline'}
                </span>
              </div>
            )
          })}

          {/* ── Trust Score ── */}
          <div className="cmp-lbl">Trust Score</div>
          {mints.map((mint, i) => {
            const d = allData[i]!
            return (
              <div key={mint.url} className="cmp-val">
                <span style={{ fontSize: 10, color: d.tsInfo.color, background: d.tsInfo.bg, border: `0.5px solid ${d.tsInfo.border}`, borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--font-mono)' }}>{d.tsInfo.label}</span>
                <span style={{ marginLeft: 5, fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: d.tsInfo.color }}>{d.trustScore}%</span>
              </div>
            )
          })}

          {/* ── Uptime (24h, matches Mint Detail's header figure) ── */}
          <div className="cmp-lbl">Uptime</div>
          {mints.map((mint, i) => {
            const uptimePct = uptime24hQueries[i]?.data?.uptimePct ?? null
            return (
              <div key={mint.url} className="cmp-val" style={{ color: uptimeColor(uptimePct), fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>
                {uptimePct !== null ? `${uptimePct}%` : '—'}
              </div>
            )
          })}

          {/* ── Latency ── */}
          <div className="cmp-lbl">Latency</div>
          {mints.map((mint, i) => {
            const d = allData[i]!
            return (
              <div key={mint.url} className="cmp-val" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                {d.isOnline && mint.latencyMs != null ? `${mint.latencyMs}ms` : '—'}
              </div>
            )
          })}

          {/* ── NUT Count ── */}
          <div className="cmp-lbl">NUT Count</div>
          {mints.map(mint => (
            <div key={mint.url} className="cmp-val" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              {mint.nutCount ?? 0} / 14
            </div>
          ))}

          {/* ── NUT Support ── */}
          <div className="cmp-lbl">NUT Support</div>
          {mints.map((mint, i) => {
            const d = allData[i]!
            return (
              <div key={mint.url} className="cmp-val">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, width: '100%' }}>
                  {NUT_FILTER_KEYS.map(key => {
                    const supported = d.nutsLimits[key] != null
                    return (
                      <span key={key} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', padding: '1px 4px', borderRadius: 3, background: supported ? 'rgba(74,222,128,0.1)' : 'var(--bg3)', color: supported ? '#4ade80' : 'var(--text3)', border: `0.5px solid ${supported ? 'rgba(74,222,128,0.3)' : 'var(--border)'}` }}>
                        {key.padStart(2, '0')}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* ── Version ── */}
          <div className="cmp-lbl">Version</div>
          {mints.map((mint, i) => {
            const d = allData[i]!
            return (
              <div key={mint.url} className="cmp-val">
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{mint.version ?? '—'}</span>
                {d.isOutdated && (
                  <span style={{ marginLeft: 5, fontSize: 9, color: '#ff4d4d', background: 'rgba(255,77,77,0.1)', border: '0.5px solid rgba(255,77,77,0.3)', borderRadius: 3, padding: '0 4px', fontFamily: 'var(--font-mono)' }}>Outdated</span>
                )}
              </div>
            )
          })}

          {/* ── Backup ── */}
          <div className="cmp-lbl cmp-last">Backup</div>
          {mints.map((mint, i) => {
            const d = allData[i]!
            return (
              <div key={mint.url} className="cmp-val cmp-last">
                {d.supportsNut13
                  ? <span style={{ fontSize: 10, color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '0.5px solid rgba(74,222,128,0.3)', borderRadius: 4, padding: '1px 6px', fontFamily: 'var(--font-mono)' }}>✓ Supported</span>
                  : <span style={{ fontSize: 10, color: 'var(--text3)', background: 'var(--bg3)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '1px 6px', fontFamily: 'var(--font-mono)' }}>No backup</span>
                }
              </div>
            )
          })}

        </div>

        <div style={{ padding: '4px 20px 20px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', margin: '12px 0 18px', lineHeight: 1.5 }}>
            The comparison above reflects each mint&apos;s current snapshot only — including NUT Support,
            which MintRadar does not track over time. The sections below add historical context where it does.
          </div>

          {/* ── Historical Trends ── */}
          <div style={{ marginBottom: 26 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Historical Trends</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 2, background: 'var(--bg3)', borderRadius: 6, padding: 2 }}>
                  {(['latency', 'uptime', 'trust'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setMetric(m)}
                      style={{
                        background: metric === m ? 'var(--bg2)' : 'transparent',
                        border: metric === m ? '1px solid var(--border2)' : '1px solid transparent',
                        borderRadius: 5, padding: '3px 10px',
                        fontSize: 10.5, fontFamily: 'var(--font-mono)',
                        color: metric === m ? 'var(--text)' : 'var(--text3)',
                        cursor: 'pointer',
                      }}
                    >{m === 'latency' ? 'Latency' : m === 'uptime' ? 'Uptime' : 'Trust Score'}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', background: 'var(--bg3)', borderRadius: 6, padding: 2, gap: 1 }}>
                  {(['24h', '7d', '30d', '90d'] as const).map(iv => (
                    <button
                      key={iv}
                      onClick={() => setHistoryPeriod(iv)}
                      style={{
                        background: historyPeriod === iv ? 'var(--accent)' : 'transparent',
                        color: historyPeriod === iv ? 'var(--bg)' : 'var(--text2)',
                        border: 'none', borderRadius: 4, padding: '2px 8px',
                        fontSize: 10, fontFamily: 'var(--font-mono)',
                        cursor: 'pointer', fontWeight: historyPeriod === iv ? 700 : 400,
                      }}
                    >{iv}</button>
                  ))}
                </div>
              </div>
            </div>

            {coverageText && (
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>{coverageText}</div>
            )}

            {isLoadingHistory ? (
              <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>Loading history…</p>
            ) : chartData.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>No historical data for this period.</p>
            ) : !chartHasEnoughData ? (
              <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>Not enough data for this period</p>
            ) : isMobile ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {mints.map((mint, i) => (
                  <div key={mint.url}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: MINT_COLORS[i]!, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                      {allData[i]!.displayName}
                    </div>
                    <ResponsiveContainer width="100%" height={90}>
                      <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 8, fill: 'var(--text3)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis
                          hide
                          domain={metric === 'latency'
                            ? [(dataMin: number) => dataMin * 0.9, (dataMax: number) => dataMax * 1.1]
                            : [0, 100]}
                        />
                        <Tooltip
                          contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                          formatter={(value) => [metric === 'latency' ? `${String(value)}ms` : `${String(value)}%`, allData[i]!.displayName]}
                        />
                        <Line type="monotone" dataKey={`m${i}`} stroke={MINT_COLORS[i]!} dot={false} strokeWidth={1.5} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData} margin={{ top: 4, right: 4, left: 10, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: 'var(--text3)' }}
                      axisLine={false} tickLine={false}
                      interval={historyPeriod === '24h' ? 3 : chartData.length <= 7 ? 0 : Math.ceil(chartData.length / 7) - 1}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: 'var(--text3)' }}
                      axisLine={false} tickLine={false}
                      width={44}
                      domain={metric === 'latency'
                        ? [(dataMin: number) => dataMin * 0.9, (dataMax: number) => dataMax * 1.1]
                        : [0, 100]}
                      tickFormatter={(v: number) => metric === 'latency' ? `${Math.round(v / 100) * 100}ms` : `${Math.round(v)}%`}
                    />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                      formatter={(value, name) => [metric === 'latency' ? `${String(value)}ms` : `${String(value)}%`, name]}
                    />
                    {mints.map((mint, i) => (
                      <Line
                        key={mint.url}
                        type="monotone"
                        dataKey={`m${i}`}
                        name={allData[i]!.displayName}
                        stroke={MINT_COLORS[i]!}
                        dot={false}
                        strokeWidth={2}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
                  {mints.map((mint, i) => (
                    <span key={mint.url} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: MINT_COLORS[i]!, display: 'inline-block', flexShrink: 0 }} />
                      {allData[i]!.displayName}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── Software Version History ── */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Software Version History</div>
            <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: '0 16px' }}>
              <div className="cmp-lbl cmp-last">Versions</div>
              {mints.map((mint, i) => {
                const versionHistory = versionQueries[i]?.data?.history ?? []
                return (
                  <div key={mint.url} className="cmp-val cmp-last" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 5, maxHeight: 140, overflowY: 'auto' }}>
                    {versionHistory.length === 0 ? (
                      <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>No data</span>
                    ) : versionHistory.map((vh, j) => (
                      <div key={j} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>
                        <span style={{ color: 'var(--text)', fontWeight: j === 0 ? 700 : 400 }}>{vh.version}</span>
                        <span style={{ color: 'var(--text3)' }}> since {new Date(vh.firstSeenAt).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
