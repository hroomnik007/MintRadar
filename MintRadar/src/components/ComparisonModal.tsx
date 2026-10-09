import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import {
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { useModalFocus } from '@/hooks/useModalFocus'
import { IcShield } from '@/components/mint/IcShield'
import { type KnownMint } from '@/hooks/useKnownMints'
import { classifyMintVersion, latestMapFor } from '@/utils/versionRule'
import { TRACKED_NUT_KEYS } from '@/constants/nuts'
import { AUDIT_MIN_SAMPLES, auditDataState } from '@/utils/auditScore'
import { formatAuditSuccessRatio, auditReliabilityColor } from '@/utils/mintFormatting'
import { useNow } from '@/hooks/useNow'
import { useIsMobile } from '@/hooks/useIsMobile'
import { formatDate } from '@/utils/formatDate'
import { probeMint } from '@core/mint/api'
import { pickInputFee } from '@/utils/mintProbeDisplay'
import { useTapTooltip } from '@/hooks/useTapTooltip'

const IcClose = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)

function reliabilityScoreInfo(score: number) {
  if (score >= 70) return { label: 'High Reliability', color: 'var(--accent)', bg: 'var(--green-soft)', border: 'var(--green-soft-strong)' }
  if (score >= 40) return { label: 'Moderate Reliability', color: 'var(--amber)', bg: 'var(--amber-soft)', border: 'var(--amber-soft-strong)' }
  return { label: 'Low Reliability', color: 'var(--red)', bg: 'var(--red-soft)', border: 'var(--red-soft-strong)' }
}

function uptimeColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'var(--text3)'
  if (pct >= 80) return 'var(--accent)'
  if (pct >= 50) return 'var(--amber)'
  return 'var(--red)'
}

// "Audit success" row — the same cashu.info 7-day window, minimum-sample floor and staleness
// rule the Reliability Score's audit part scores on (auditDataState() from shared/auditScore.ts), so
// the row never disagrees with the Mint Detail breakdown. "Successes" here means swaps not
// attributed to the mint (cashu.info attributes only the failures the mint caused).
function auditSuccessDisplay(mint: KnownMint, now: number): { text: string; color: string } {
  const total = mint.auditCzTotal ?? null
  const blamed = mint.auditCzBlamed ?? null
  if (auditDataState(blamed, total, mint.auditCzFetchedAt ?? null, now) !== 'scored') {
    return { text: 'n/a', color: 'var(--text3)' }
  }
  return {
    text: formatAuditSuccessRatio(total, Math.min(blamed ?? 0, total ?? 0)),
    color: auditReliabilityColor(total, blamed, AUDIT_MIN_SAMPLES),
  }
}

function listReliabilityScore(mint: KnownMint): number {
  if (mint.online !== true) return 0
  return mint.reliabilityScore ?? 0
}

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

// Per-mint line colors for the historical trend overlay — reuses hues already
// established elsewhere in the app (Reliability Trend green, copper accent, the
// Fresh/OG badge blue and purple) rather than inventing new ones.
// Categorical series identity, not semantic status: these stay literal on purpose.
// [0] is the A-series green (deliberately not --accent); [1] is a real-value copy of
// var(--copper) and must be kept equal to it.
const MINT_COLORS = ['#17E87F', '#d98a5a', '#60a5fa', '#a78bfa']

type HistoryPeriod = '24h' | '7d' | '30d' | '90d'
type HistoryMetric = 'latency' | 'uptime' | 'reliability'

interface HistorySegment {
  bucket: string
  online: boolean
  latencyMs: number | null
  total: number
  onlineCount: number
  uptimePct: number | null
  reliabilityScore: number | null
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

function useMintCompareData(mint: KnownMint) {
  const now = useNow()
  const isOnline = mint.online === true
  const displayName = mint.name ?? getHostname(mint.url)
  const hostname = getHostname(mint.url)
  const reliabilityScore = listReliabilityScore(mint)
  const tsInfo = reliabilityScoreInfo(reliabilityScore)
  const isNew = mint.discoveredAt != null && (now - new Date(mint.discoveredAt).getTime()) < 48 * 3600 * 1000
  const nutsLimits = (mint.nutsLimits ?? {}) as Record<string, unknown>
  // NUT-13 (deterministic secrets) is wallet-side only — mints never advertise
  // it in /v1/info. NUT-09 (restore signatures) is the mint-side capability
  // that actually gates backup/restore — matches MintDetail's supportsBackupRestore.
  const supportsBackupRestore = nutsLimits['9'] != null
  // Same rule and the same "latest" as everywhere else (versionRule.ts + the value the API sends with the mint).
  const isOutdated = classifyMintVersion(mint.version, latestMapFor(mint.version, mint.softwareLatest)).label === 'outdated'
  return { isOnline, displayName, hostname, reliabilityScore, tsInfo, isNew, nutsLimits, supportsBackupRestore, isOutdated }
}

export function ComparisonModal({ mints, onClose }: { mints: KnownMint[]; onClose: () => void }) {
  const dialogRef = useModalFocus()
  const now = useNow()

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Unconditional hook calls for up to 4 mint slots
  const d0 = useMintCompareData(mints[0] ?? EMPTY_MINT)
  const d1 = useMintCompareData(mints[1] ?? EMPTY_MINT)
  const d2 = useMintCompareData(mints[2] ?? EMPTY_MINT)
  const d3 = useMintCompareData(mints[3] ?? EMPTY_MINT)
  const allData = [d0, d1, d2, d3].slice(0, mints.length)

  const gridCols = `132px ${mints.map(() => 'minmax(150px, 1fr)').join(' ')}`

  const isMobile = useIsMobile()
  const backupInfoRef = useRef<HTMLSpanElement>(null)
  const backupInfoTooltip = useTapTooltip(backupInfoRef)
  const feeInfoRef = useRef<HTMLSpanElement>(null)
  const feeInfoTooltip = useTapTooltip(feeInfoRef)
  const auditInfoRef = useRef<HTMLSpanElement>(null)
  const auditInfoTooltip = useTapTooltip(auditInfoRef)
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('7d')
  const [metric, setMetric] = useState<HistoryMetric>('latency')
  // Mobile only: which mint's single-column stack is shown (see .cmp-mobile-*
  // layout below). The desktop side-by-side .cmp-grid ignores this entirely.
  const [activeIdx, setActiveIdx] = useState(0)
  const activeMintIdx = Math.min(activeIdx, mints.length - 1)

  // Input fee comes from the existing on-demand probe (/api/mint/probe → live
  // /v1/keysets), the same source Mint Detail's Keysets panel uses. Own query key
  // and no IndexedDB history write (unlike useMintProbe).
  const probeQueries = useQueries({
    queries: mints.map(m => ({
      queryKey: ['mint', 'compare-probe', m.url],
      queryFn: () => probeMint(m.url),
      staleTime: 2 * 60 * 1000,
      retry: 1,
    })),
  })
  const feeCell = (i: number) => {
    const q = probeQueries[i]
    if (!q || q.isLoading) return <span style={{ color: 'var(--text3)' }}>…</span>
    const fee = pickInputFee(q.data?.keysets)
    if (!fee) return <span style={{ color: 'var(--text3)' }}>n/a</span>
    return (
      <>
        <span>{fee.label}</span>
        <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{fee.unit}</span>
      </>
    )
  }
  const feeTooltipText = 'Input fee per 1000 proofs spent from the mint’s active keyset (NUT-02 input_fee_ppk), for its main unit. “free” = no fee. Lower is cheaper. n/a = the mint did not report it.'
  const feeTooltipBox = (
    <div style={{
      position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
      background: 'var(--bg)', border: '0.5px solid var(--border2)', borderRadius: 8,
      padding: '8px 10px', fontSize: 10, color: 'var(--text2)', lineHeight: 1.5,
      width: 200, zIndex: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      pointerEvents: 'none', whiteSpace: 'normal', textAlign: 'left',
      fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400,
    }}>{feeTooltipText}</div>
  )
  const feeLabelInfo = (
    <span
      ref={feeInfoRef}
      style={{ position: 'relative', display: 'inline-flex' }}
      onPointerEnter={feeInfoTooltip.onPointerEnter}
      onPointerLeave={feeInfoTooltip.onPointerLeave}
      onClick={feeInfoTooltip.onClick}
    >
      <Info size={11} color="#6b7280" style={{ cursor: 'help', flexShrink: 0 }} />
      {feeInfoTooltip.open && feeTooltipBox}
    </span>
  )

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
        : formatDate(d, { year: false, local: true })
      const row: Record<string, string | number | null> = { label }
      segMaps.forEach((map, i) => {
        const seg = map.get(bucket)
        const value = !seg ? null
          : metric === 'latency' ? seg.latencyMs
          : metric === 'uptime' ? seg.uptimePct
          : seg.reliabilityScore
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
      <div className="cmp-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="cmp-modal-title" ref={dialogRef}>
        <div className="cmp-modal-header">
          <div id="cmp-modal-title" style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text)' }}>Mint comparison</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4 }}><IcClose /></button>
        </div>

        {isMobile ? (
          <>
            <div className="cmp-mobile-tabs" role="tablist" aria-label="Select mint to view">
              {mints.map((mint, i) => {
                const d = allData[i]!
                return (
                  <button
                    key={mint.url}
                    type="button"
                    role="tab"
                    aria-selected={activeMintIdx === i}
                    className={`cmp-mobile-tab${activeMintIdx === i ? ' active' : ''}`}
                    onClick={() => setActiveIdx(i)}
                  >
                    <MintFavicon url={mint.url} iconUrl={mint.iconUrl} size={14} />
                    <span>{d.displayName}</span>
                  </button>
                )
              })}
            </div>

            {(() => {
              const mint = mints[activeMintIdx]!
              const d = allData[activeMintIdx]!
              const uptimePct = uptime24hQueries[activeMintIdx]?.data?.uptimePct ?? null
              const count = mint.reviewCount ?? 0
              const avg = mint.reviewAvgRating
              return (
                <div className="cmp-mobile-stack">
                  <div className="cmp-mobile-header-row">
                    <MintFavicon url={mint.url} iconUrl={mint.iconUrl} size={28} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="cmp-mobile-name">{d.displayName}</div>
                      <div className="cmp-mobile-host">{d.hostname}</div>
                    </div>
                    {d.isNew && <span className="cmp-mobile-badge" style={{ color: 'var(--accent)', background: 'var(--green-soft)', borderColor: 'var(--green-soft-strong)' }}>New</span>}
                  </div>

                  <div className="cmp-mobile-row">
                    <span className="cmp-mobile-lbl">Status</span>
                    <span className="cmp-mobile-val">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.isOnline ? 'var(--accent)' : 'var(--red)', display: 'inline-block', flexShrink: 0 }} />
                        {d.isOnline ? 'Online' : 'Offline'}
                      </span>
                    </span>
                  </div>

                  <div className="cmp-mobile-row">
                    <span className="cmp-mobile-lbl">Reliability Score</span>
                    <span className="cmp-mobile-val">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: d.tsInfo.color }}>
                        <IcShield size={12} />
                        <span style={{ fontSize: 15, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{d.isOnline ? `${d.reliabilityScore}%` : '—'}</span>
                      </span>
                      {d.isOnline && (
                        <span style={{ fontSize: 11, color: d.tsInfo.color, background: d.tsInfo.bg, border: `0.5px solid ${d.tsInfo.border}`, borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--font-mono)' }}>{d.tsInfo.label}</span>
                      )}
                    </span>
                  </div>

                  <div className="cmp-mobile-row">
                    <span className="cmp-mobile-lbl">Community Rating</span>
                    <span className="cmp-mobile-val">
                      {count > 0 && avg != null ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                          <span style={{ fontSize: 16, lineHeight: 1 }}>★</span>
                          <span style={{ fontSize: 15, fontWeight: 700 }}>{avg.toFixed(1)}</span>
                          <span style={{ fontSize: 12, color: 'var(--text3)' }}>({count})</span>
                        </span>
                      ) : (
                        <span style={{ fontSize: 14, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>—</span>
                      )}
                    </span>
                  </div>

                  <div className="cmp-mobile-row">
                    <span className="cmp-mobile-lbl">Uptime</span>
                    <span className="cmp-mobile-val" style={{ color: uptimeColor(uptimePct), fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600 }}>
                      {uptimePct !== null ? `${uptimePct}%` : '—'}
                    </span>
                  </div>

                  <div className="cmp-mobile-row">
                    <span className="cmp-mobile-lbl">Latency</span>
                    <span className="cmp-mobile-val" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600 }}>
                      {d.isOnline && mint.latencyMs != null ? `${mint.latencyMs}ms` : '—'}
                    </span>
                  </div>

                  <div className="cmp-mobile-row">
                    <span className="cmp-mobile-lbl" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Input fee{feeLabelInfo}</span>
                    <span className="cmp-mobile-val cmp-input-fee" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600 }}>
                      {feeCell(activeMintIdx)}
                    </span>
                  </div>

                  <div className="cmp-mobile-row">
                    <span className="cmp-mobile-lbl">NUT Count</span>
                    <span className="cmp-mobile-val" style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600 }}>
                      {mint.nutCount ?? 0} / {TRACKED_NUT_KEYS.length}
                    </span>
                  </div>

                  <div className="cmp-mobile-row cmp-mobile-row-wrap">
                    <span className="cmp-mobile-lbl">NUT Support</span>
                    <span className="cmp-mobile-val">
                      {TRACKED_NUT_KEYS.map(key => {
                        const supported = d.nutsLimits[key] != null
                        return (
                          <span key={key} style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', padding: '1px 5px', borderRadius: 3, background: supported ? 'var(--green-soft)' : 'var(--bg3)', color: supported ? 'var(--accent)' : 'var(--text3)', border: `0.5px solid ${supported ? 'var(--green-soft-strong)' : 'var(--border)'}` }}>
                            {key.padStart(2, '0')}
                          </span>
                        )
                      })}
                    </span>
                  </div>

                  <div className="cmp-mobile-row">
                    <span className="cmp-mobile-lbl">Version</span>
                    <span className="cmp-mobile-val">
                      <span title={mint.version ?? undefined} style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{mint.version ?? '—'}</span>
                      {d.isOutdated && (
                        <span style={{ fontSize: 10, color: 'color-mix(in srgb, var(--red) 75%, var(--text))', background: 'var(--red-soft)', border: '0.5px solid var(--red-soft-strong)', borderRadius: 3, padding: '0 4px', fontFamily: 'var(--font-mono)' }}>Outdated</span>
                      )}
                    </span>
                  </div>

                  <div className="cmp-mobile-row">
                    <span className="cmp-mobile-lbl" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      Audit success
                      <span
                        style={{ position: 'relative', display: 'inline-flex' }}
                        onPointerEnter={auditInfoTooltip.onPointerEnter}
                        onPointerLeave={auditInfoTooltip.onPointerLeave}
                        onClick={auditInfoTooltip.onClick}
                      >
                        <Info size={11} color="#6b7280" style={{ cursor: 'help', flexShrink: 0 }} />
                        {auditInfoTooltip.open && (
                          <div style={{
                            position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
                            background: 'var(--bg)', border: '0.5px solid var(--border2)', borderRadius: 8,
                            padding: '8px 10px', fontSize: 10, color: 'var(--text2)', lineHeight: 1.5,
                            width: 200, zIndex: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                            pointerEvents: 'none', whiteSpace: 'normal', textAlign: 'left',
                            fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400,
                          }}>
                            Last 7 days from cashu.info; only failures attributed to the mint count. n/a below 10 swaps. Not a solvency or reserves signal.
                          </div>
                        )}
                      </span>
                    </span>
                    <span className="cmp-mobile-val" style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600, color: auditSuccessDisplay(mint, now).color }}>
                      {auditSuccessDisplay(mint, now).text}
                    </span>
                  </div>

                  <div className="cmp-mobile-row cmp-mobile-row-last">
                    <span className="cmp-mobile-lbl" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      Backup
                      <span
                        ref={backupInfoRef}
                        style={{ position: 'relative', display: 'inline-flex' }}
                        onPointerEnter={backupInfoTooltip.onPointerEnter}
                        onPointerLeave={backupInfoTooltip.onPointerLeave}
                        onClick={backupInfoTooltip.onClick}
                      >
                        <Info size={11} color="#6b7280" style={{ cursor: 'help', flexShrink: 0 }} />
                        {backupInfoTooltip.open && (
                          <div style={{
                            position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
                            background: 'var(--bg)', border: '0.5px solid var(--border2)', borderRadius: 8,
                            padding: '8px 10px', fontSize: 10, color: 'var(--text2)', lineHeight: 1.5,
                            width: 200, zIndex: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                            pointerEvents: 'none', whiteSpace: 'normal', textAlign: 'left',
                            fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400,
                          }}>
                            Whether this mint supports NUT-09, letting wallets restore proofs after data loss.
                          </div>
                        )}
                      </span>
                    </span>
                    <span className="cmp-mobile-val">
                      {d.supportsBackupRestore
                        ? <span style={{ fontSize: 11.5, color: 'var(--accent)', background: 'var(--green-soft)', border: '0.5px solid var(--green-soft-strong)', borderRadius: 4, padding: '2px 7px', fontFamily: 'var(--font-mono)' }}>✓ Supported</span>
                        : <span style={{ fontSize: 11.5, color: 'var(--text3)', background: 'var(--bg3)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '2px 7px', fontFamily: 'var(--font-mono)' }}>No backup</span>
                      }
                    </span>
                  </div>
                </div>
              )
            })()}
          </>
        ) : (
        <div className="cmp-grid" style={{ gridTemplateColumns: gridCols }}>

          {/* ── Mint ── */}
          <div className="cmp-lbl cmp-row-mint">Mint</div>
          {mints.map((mint, i) => {
            const d = allData[i]!
            return (
              <div key={mint.url} className="cmp-val cmp-row-mint" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <MintFavicon url={mint.url} iconUrl={mint.iconUrl} size={20} />
                <div style={{ minWidth: 0, width: '100%' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.displayName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.hostname}</div>
                  {d.isNew && <span style={{ fontSize: 9, color: 'var(--accent)', background: 'var(--green-soft)', border: '0.5px solid var(--green-soft-strong)', borderRadius: 3, padding: '0 4px', fontFamily: 'var(--font-mono)' }}>New</span>}
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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.isOnline ? 'var(--accent)' : 'var(--red)', display: 'inline-block', flexShrink: 0 }} />
                  {d.isOnline ? 'Online' : 'Offline'}
                </span>
              </div>
            )
          })}

          {/* ── Reliability Score ── */}
          <div className="cmp-lbl">Reliability Score</div>
          {mints.map((mint, i) => {
            const d = allData[i]!
            return (
              <div key={mint.url} className="cmp-val">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: d.tsInfo.color }}>
                  <IcShield size={12} />
                  <span style={{ fontSize: 15, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{d.isOnline ? `${d.reliabilityScore}%` : '—'}</span>
                </span>
                {d.isOnline && (
                  <span style={{ marginLeft: 6, fontSize: 11, color: d.tsInfo.color, background: d.tsInfo.bg, border: `0.5px solid ${d.tsInfo.border}`, borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--font-mono)' }}>{d.tsInfo.label}</span>
                )}
              </div>
            )
          })}

          {/* ── Community Rating (NIP-87 reviews, matches the ★ badge on mint cards) ── */}
          <div className="cmp-lbl">Community Rating</div>
          {mints.map(mint => {
            const count = mint.reviewCount ?? 0
            const avg = mint.reviewAvgRating
            return (
              <div key={mint.url} className="cmp-val">
                {count > 0 && avg != null ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                    <span style={{ fontSize: 16, lineHeight: 1 }}>★</span>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{avg.toFixed(1)}</span>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>({count})</span>
                  </span>
                ) : (
                  <span style={{ fontSize: 14, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>—</span>
                )}
              </div>
            )
          })}

          {/* ── Uptime (24h, matches Mint Detail's header figure) ── */}
          <div className="cmp-lbl">Uptime</div>
          {mints.map((mint, i) => {
            const uptimePct = uptime24hQueries[i]?.data?.uptimePct ?? null
            return (
              <div key={mint.url} className="cmp-val" style={{ color: uptimeColor(uptimePct), fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600 }}>
                {uptimePct !== null ? `${uptimePct}%` : '—'}
              </div>
            )
          })}

          {/* ── Latency ── */}
          <div className="cmp-lbl">Latency</div>
          {mints.map((mint, i) => {
            const d = allData[i]!
            return (
              <div key={mint.url} className="cmp-val" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600 }}>
                {d.isOnline && mint.latencyMs != null ? `${mint.latencyMs}ms` : '—'}
              </div>
            )
          })}

          {/* ── Input fee ── */}
          <div className="cmp-lbl" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Input fee{feeLabelInfo}</div>
          {mints.map((mint, i) => (
            <div key={mint.url} className="cmp-val cmp-input-fee" style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600 }}>
              {feeCell(i)}
            </div>
          ))}

          {/* ── NUT Count ── */}
          <div className="cmp-lbl">NUT Count</div>
          {mints.map(mint => (
            <div key={mint.url} className="cmp-val" style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600 }}>
              {mint.nutCount ?? 0} / {TRACKED_NUT_KEYS.length}
            </div>
          ))}

          {/* ── NUT Support ── */}
          <div className="cmp-lbl">NUT Support</div>
          {mints.map((mint, i) => {
            const d = allData[i]!
            return (
              <div key={mint.url} className="cmp-val">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, width: '100%' }}>
                  {TRACKED_NUT_KEYS.map(key => {
                    const supported = d.nutsLimits[key] != null
                    return (
                      <span key={key} style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', padding: '1px 5px', borderRadius: 3, background: supported ? 'var(--green-soft)' : 'var(--bg3)', color: supported ? 'var(--accent)' : 'var(--text3)', border: `0.5px solid ${supported ? 'var(--green-soft-strong)' : 'var(--border)'}` }}>
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
                <span title={mint.version ?? undefined} style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{mint.version ?? '—'}</span>
                {d.isOutdated && (
                  <span style={{ marginLeft: 5, fontSize: 10, color: 'color-mix(in srgb, var(--red) 75%, var(--text))', background: 'var(--red-soft)', border: '0.5px solid var(--red-soft-strong)', borderRadius: 3, padding: '0 4px', fontFamily: 'var(--font-mono)' }}>Outdated</span>
                )}
              </div>
            )
          })}

          {/* ── Audit success (cashu.info 7-day window, same fields/threshold as the Reliability Score's audit part) ── */}
          <div className="cmp-lbl" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Audit success
            <span
              ref={auditInfoRef}
              style={{ position: 'relative', display: 'inline-flex' }}
              onPointerEnter={auditInfoTooltip.onPointerEnter}
              onPointerLeave={auditInfoTooltip.onPointerLeave}
              onClick={auditInfoTooltip.onClick}
            >
              <Info size={11} color="#6b7280" style={{ cursor: 'help', flexShrink: 0 }} />
              {auditInfoTooltip.open && (
                <div style={{
                  position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
                  background: 'var(--bg)', border: '0.5px solid var(--border2)', borderRadius: 8,
                  padding: '8px 10px', fontSize: 10, color: 'var(--text2)', lineHeight: 1.5,
                  width: 200, zIndex: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                  pointerEvents: 'none', whiteSpace: 'normal', textAlign: 'left',
                  fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400,
                }}>
                  Last 7 days from cashu.info; only failures attributed to the mint count. n/a below 10 swaps. Not a solvency or reserves signal.
                </div>
              )}
            </span>
          </div>
          {mints.map(mint => {
            const audit = auditSuccessDisplay(mint, now)
            return (
              <div key={mint.url} className="cmp-val" style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600, color: audit.color }}>
                {audit.text}
              </div>
            )
          })}

          {/* ── Backup ── */}
          <div className="cmp-lbl cmp-last" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            Backup
            <span
              ref={backupInfoRef}
              style={{ position: 'relative', display: 'inline-flex' }}
              onPointerEnter={backupInfoTooltip.onPointerEnter}
              onPointerLeave={backupInfoTooltip.onPointerLeave}
              onClick={backupInfoTooltip.onClick}
            >
              <Info size={11} color="#6b7280" style={{ cursor: 'help', flexShrink: 0 }} />
              {backupInfoTooltip.open && (
                <div style={{
                  position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
                  background: 'var(--bg)', border: '0.5px solid var(--border2)', borderRadius: 8,
                  padding: '8px 10px', fontSize: 10, color: 'var(--text2)', lineHeight: 1.5,
                  width: 200, zIndex: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                  pointerEvents: 'none', whiteSpace: 'normal', textAlign: 'left',
                  fontFamily: 'var(--font-body)', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400,
                }}>
                  Whether this mint supports NUT-09, letting wallets restore proofs after data loss.
                </div>
              )}
            </span>
          </div>
          {mints.map((mint, i) => {
            const d = allData[i]!
            return (
              <div key={mint.url} className="cmp-val cmp-last">
                {d.supportsBackupRestore
                  ? <span style={{ fontSize: 11.5, color: 'var(--accent)', background: 'var(--green-soft)', border: '0.5px solid var(--green-soft-strong)', borderRadius: 4, padding: '2px 7px', fontFamily: 'var(--font-mono)' }}>✓ Supported</span>
                  : <span style={{ fontSize: 11.5, color: 'var(--text3)', background: 'var(--bg3)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '2px 7px', fontFamily: 'var(--font-mono)' }}>No backup</span>
                }
              </div>
            )
          })}

        </div>
        )}

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
                  {(['latency', 'uptime', 'reliability'] as const).map(m => (
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
                    >{m === 'latency' ? 'Latency' : m === 'uptime' ? 'Uptime' : 'Reliability Score'}</button>
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
                    <div className="cmp-mobile-chart-name" style={{ fontSize: 10, fontWeight: 600, color: MINT_COLORS[i]!, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
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
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
              Software Version History{isMobile ? ` — ${allData[activeMintIdx]!.displayName}` : ''}
            </div>
            {isMobile ? (
              <div className="cmp-mobile-vh">
                {(() => {
                  const versionHistory = versionQueries[activeMintIdx]?.data?.history ?? []
                  return versionHistory.length === 0 ? (
                    <span className="cmp-vh-entry" style={{ color: 'var(--text3)' }}>No data</span>
                  ) : versionHistory.map((vh, j) => (
                    <div key={j} className="cmp-vh-entry">
                      <div className="cmp-vh-version" style={{ fontWeight: j === 0 ? 700 : 500 }}>{vh.version}</div>
                      <div className="cmp-vh-since">since {formatDate(vh.firstSeenAt, { local: true })}</div>
                    </div>
                  ))
                })()}
              </div>
            ) : (
              <div className="cmp-vh-grid" style={{ gridTemplateColumns: gridCols }}>
                <div className="cmp-lbl cmp-last">Versions</div>
                {mints.map((mint, i) => {
                  const versionHistory = versionQueries[i]?.data?.history ?? []
                  return (
                    <div key={mint.url} className="cmp-val cmp-last" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8, maxHeight: 140, overflowY: 'auto' }}>
                      {versionHistory.length === 0 ? (
                        <span className="cmp-vh-entry" style={{ color: 'var(--text3)' }}>No data</span>
                      ) : versionHistory.map((vh, j) => (
                        <div key={j} className="cmp-vh-entry">
                          <div className="cmp-vh-version" style={{ fontWeight: j === 0 ? 700 : 500 }}>{vh.version}</div>
                          <div className="cmp-vh-since">since {formatDate(vh.firstSeenAt, { local: true })}</div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
