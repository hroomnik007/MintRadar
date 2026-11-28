import { INPUT_FEE_TEXT, compareAuditSuccessText } from '@/utils/tooltipTexts'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { useModalFocus } from '@/hooks/useModalFocus'
import { offeredNutKeys } from '@/utils/nutSupport'
import { type KnownMint } from '@/hooks/useKnownMints'
import { classifyMintVersion, latestMapFor } from '@/utils/versionRule'
import { TRACKED_NUT_KEYS, NUT_NAMES } from '@/constants/nuts'
import { AUDIT_MIN_SAMPLES, auditDataState } from '@/utils/auditScore'
import { auditLongOf } from '@/utils/auditWindows'
import { auditReliabilityColor, formatTimeAgo, LOW_RELIABILITY_TEXT, mintStatusLabel, uptime30dColor, uptime30dShown, formatUptime30d } from '@/utils/mintFormatting'
import { mintStatus } from '@/utils/mintStatus'
import { useNow } from '@/hooks/useNow'
import { useIsMobile } from '@/hooks/useIsMobile'
import { formatDate } from '@/utils/formatDate'
import { probeMint } from '@core/mint/api'
import { pickInputFee, compareFeeText, type CompareInputFee } from '@/utils/mintProbeDisplay'
import { InfoTooltip } from '@/components/InfoTooltip'
import { IcClose } from '@/components/IcClose'
import './ComparisonModal.css'
import { auditSuccessText, storedKeysetsAsLive } from '@/utils/mintDetailFacts'
import { visibleCompareRows, type CompareRowKeys } from '@/utils/compareDiff'
import { compareMethodRows } from '@/utils/compareMethodRows'
import { sortUnits } from '@/utils/sortUnits'
import { SCORE_PART_ROWS, COMPARE_CONTACT_LABEL, COMPARE_NIP87_LABEL, scorePointsText, contactMethodsText, nip87RowText } from '@/utils/compareScoreRows'
import { bestFlags } from '@/utils/compareBest'
import { COMPARE_UPTIME_LABEL, COMPARE_UPTIME_30D_LABEL, COMPARE_LATENCY_LABEL, COMPARE_LATENCY_TITLE, COMPARE_AUDIT_LABEL, COMPARE_BROWSER_LATENCY_LABEL, COMPARE_BROWSER_LATENCY_TITLE, COMPARE_NUT_COUNT_LABEL } from '@/utils/compareLabels'
import { measureMintLatency } from '@/utils/browserLatency'

// Compare, redesign of 2026-11-28 (owner-approved mockup ~/Claude/refs/mintradar-compare-mockup-1127, inspired by
// cashu.info/compare): mint cards on top (icon, name with its status dot, host, score), a slim bar with the names that
// sticks once the cards have scrolled away, then sections as panels where each row's label sits ABOVE its values and
// the values sit in the columns of the cards. One layout for every width: phones get the same columns, nothing scrolls
// sideways. BEST marks the single best value of a row (not on the community rating). "Only differences" is unchanged
// and also brings in one row per NUT the mints disagree on. Score points and History are folded.

function scoreColor(score: number): string {
  if (score >= 70) return 'var(--accent)'
  if (score >= 40) return 'var(--amber)'
  return LOW_RELIABILITY_TEXT
}

// Audit row (COMPARE_AUDIT_LABEL): the same cashu.info 7-day window, minimum-sample floor and staleness rule the
// Reliability Score's audit part scores on (auditDataState() from shared/auditScore.ts). "Without a mint fault" means
// swaps not attributed to the mint (cashu.info attributes only the failures the mint caused).
function auditSuccessDisplay(mint: KnownMint, now: number): { text: string; color: string } {
  const total = mint.auditCzTotal ?? null
  const blamed = mint.auditCzBlamed ?? null
  const long = auditLongOf(mint)
  if (auditDataState(blamed, total, mint.auditCzFetchedAt ?? null, now, long) !== 'scored' || total === null || total < AUDIT_MIN_SAMPLES) {
    return { text: 'n/a', color: 'var(--text3)' }
  }
  return { text: auditSuccessText(blamed, total) ?? 'n/a', color: auditReliabilityColor(total, blamed, AUDIT_MIN_SAMPLES) }
}

// "BEST" after the single best value of a row (utils/compareBest.ts); the value itself turns accent.
function BestTag() {
  return <span className="cmp-best" data-testid="cmp-best">Best</span>
}

/** A name split before its last word, so the status dot can be held to that word. */
function nameHead(name: string): string { const i = name.lastIndexOf(' '); return i === -1 ? '' : name.slice(0, i + 1) }
function nameTail(name: string): string { const i = name.lastIndexOf(' '); return i === -1 ? name : name.slice(i + 1) }

/** "cdk-mintd/0.18.3" may wrap after the slash on a narrow column, never inside the number (a <wbr>, so the text
 *  itself stays "cdk-mintd/0.18.3" for find-in-page and copying). */
function breakAfterSlash(text: string): ReactNode {
  const parts = text.split('/')
  return parts.map((p, i) => (i === 0 ? p : <span key={i}>/<wbr />{p}</span>))
}

function listReliabilityScore(mint: KnownMint): number {
  if (mint.online !== true) return 0
  return mint.reliabilityScore ?? 0
}

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

// Per-mint line colours of the History chart (categorical identity, not health): blue, orange, cyan, violet, none of
// them the health green / amber / red. The legend under the chart names each.
const MINT_COLORS = ['#6aa6e8', '#e8a06a', '#7fd0d8', '#c48ee8']

type HistoryPeriod = '24h' | '7d' | '30d' | '90d'
type HistoryMetric = 'latency' | 'uptime' | 'reliability'
type SectionId = 'reliability' | 'speed' | 'money' | 'features' | 'operator' | 'points'
const SECTIONS: ReadonlyArray<{ id: Exclude<SectionId, 'points'>; heading: string }> = [
  { id: 'reliability', heading: 'Reliability' },
  { id: 'speed', heading: 'Speed' },
  { id: 'money', heading: 'Deposits and withdrawals' },
  { id: 'features', heading: 'Features' },
  { id: 'operator', heading: 'Operator' },
]
/** Versions shown per mint before "All versions". */
const VERSIONS_SHOWN = 2

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

interface CompareRow extends CompareRowKeys {
  section: SectionId
  label: ReactNode
  cell: (i: number) => ReactNode
}

const EMPTY_MINT: KnownMint = {
  url: '', name: null, iconUrl: null, degraded: false, online: null,
  latencyMs: null, version: null, nutCount: null, tosUrl: null,
  descriptionLong: null, nutsLimits: null,
}

function useMintCompareData(mint: KnownMint) {
  const now = useNow()
  const isOnline = mint.online === true
  // Same status rule and word as the card, Mint detail and the wallet API (utils/mintStatus.ts).
  const status = mintStatus(mint)
  const statusLabel = mintStatusLabel(status)
  const displayName = mint.name ?? getHostname(mint.url)
  const hostname = getHostname(mint.url)
  const reliabilityScore = listReliabilityScore(mint)
  const isNew = mint.discoveredAt != null && (now - new Date(mint.discoveredAt).getTime()) < 48 * 3600 * 1000
  const nutsLimits = (mint.nutsLimits ?? {}) as Record<string, unknown>
  // One NUT rule with Mint Detail (utils/nutSupport.ts): absent, null and `supported: false` are not support, and a
  // switched-off NUT-04/05 (`disabled: true`) is not offered.
  const supportedNuts = offeredNutKeys(nutsLimits)
  const trackedCount = TRACKED_NUT_KEYS.filter(k => supportedNuts.has(k)).length
  // Same rule and the same "latest" as everywhere else (versionRule.ts + the value the API sends with the mint).
  const isOutdated = classifyMintVersion(mint.version, latestMapFor(mint.version, mint.softwareLatest)).label === 'outdated'
  const units = sortUnits(mint.units)
  return { isOnline, status, statusLabel, displayName, hostname, reliabilityScore, isNew, supportedNuts, trackedCount, isOutdated, units }
}

export function ComparisonModal({ mints, onClose }: { mints: KnownMint[]; onClose: () => void }) {
  const dialogRef = useModalFocus()
  const now = useNow()
  const isMobile = useIsMobile()

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

  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('7d')
  const [metric, setMetric] = useState<HistoryMetric>('latency')
  // The History panel is folded; its requests start the first time it is opened.
  const [historyOpened, setHistoryOpened] = useState(false)
  const [allVersions, setAllVersions] = useState<ReadonlySet<number>>(() => new Set())
  // Off every time the modal opens.
  const [onlyDifferences, setOnlyDifferences] = useState(false)

  // Input fee and contact kinds come from the existing on-demand probe (/api/mint/probe → live /v1/keysets), the same
  // source Mint Detail's Keysets panel uses. Own query key and no IndexedDB history write (unlike useMintProbe).
  const probeQueries = useQueries({
    queries: mints.map(m => ({
      queryKey: ['mint', 'compare-probe', m.url],
      queryFn: () => probeMint(m.url),
      staleTime: 2 * 60 * 1000,
      retry: 1,
    })),
  })
  /** The fee and whether it is the stored one; 'pending' while the probe runs. Live keysets first, then the last stored ones. */
  const feeOf = (i: number): { fee: CompareInputFee; stored: boolean } | null | 'pending' => {
    const q = probeQueries[i]
    if (!q || q.isLoading) return 'pending'
    const live = pickInputFee(q.data?.keysets)
    if (live) return { fee: live, stored: false }
    const stored = pickInputFee(storedKeysetsAsLive(mints[i]?.lastKeysets))
    return stored ? { fee: stored, stored: true } : null
  }

  const historyQueries = useQueries({
    queries: mints.map(m => ({
      queryKey: ['mint', 'chart-history', m.url, historyPeriod],
      queryFn: async (): Promise<HistoryResponse> => {
        const res = await fetch(`/api/mints/history?url=${encodeURIComponent(m.url)}&period=${historyPeriod}`)
        if (!res.ok) throw new Error('Failed to fetch chart history')
        return res.json() as Promise<HistoryResponse>
      },
      enabled: historyOpened,
      staleTime: 5 * 60 * 1000,
    })),
  })

  // Uptime 24 h: always the server's 24 h figure, independent of the chart's period, so it matches Mint Detail's header.
  // Same queryKey shape as MintDetail's dedicated 24 h query, so the two share cache.
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
      enabled: historyOpened,
      staleTime: 10 * 60 * 1000,
    })),
  })

  // Latency from the visitor's browser: measured for every online compared mint when the modal opens. Offline / archived
  // mints are not contacted. Never cached across opens (gcTime 0).
  const browserLatencyQueries = useQueries({
    queries: mints.map((m, i) => ({
      queryKey: ['mint', 'browser-latency', m.url],
      queryFn: () => measureMintLatency(m.url),
      enabled: allData[i]!.isOnline,
      staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false,
    })),
  })
  /** number = measured ms; null = no answer in time; 'pending' = measuring; 'offline' = not contacted. */
  const browserLatency = (i: number): number | null | 'pending' | 'offline' => {
    if (!allData[i]!.isOnline) return 'offline'
    const q = browserLatencyQueries[i]
    if (!q || q.isPending) return 'pending'
    return q.data ?? null
  }

  const contactText = (i: number): string | null | 'pending' => {
    const q = probeQueries[i]
    if (!q || q.isLoading) return 'pending'
    return q.data ? contactMethodsText(q.data) : null
  }

  // BEST per row: only rows with a direction; a missing / pending value or a tie at the top gives no tag
  // (utils/compareBest.ts). Not on the community rating (owner, 2026-11-28).
  const feeNumbers = mints.map((_, i) => { const f = feeOf(i); return f && f !== 'pending' ? f.fee.min : null })
  const best = {
    reliability: bestFlags(mints.map((m, i) => (allData[i]!.isOnline && typeof m.reliabilityScore === 'number' ? m.reliabilityScore : null)), 'higher'),
    uptime: bestFlags(mints.map((_, i) => {
      const q = uptime24hQueries[i]
      return !q || q.isLoading ? null : (q.data?.uptimePct ?? null)
    }), 'higher'),
    // The unrounded share cut down to one decimal, as on the cards and Mint Detail.
    uptime30d: bestFlags(mints.map(m => uptime30dShown(m.uptimePct30dExact, m.uptimePct30d)), 'higher'),
    latency: bestFlags(mints.map((_, i) => { const v = browserLatency(i); return typeof v === 'number' ? v : null }), 'lower'),
    fee: bestFlags(feeNumbers, 'lower'),
    nuts: bestFlags(allData.map(d => d.trackedCount), 'higher'),
  }
  const value = (text: ReactNode, isBest = false, color?: string): ReactNode => (
    <>
      <span className={isBest ? 'cx-best-value' : undefined} style={!isBest && color ? { color } : undefined}>{text}</span>
      {isBest && <BestTag />}
    </>
  )
  const muted = (text: ReactNode) => <span className="cx-muted">{text}</span>

  const methodRows = compareMethodRows(mints)
  // One row per NUT the mints disagree on, only while "Only differences" is on (owner, 2026-11-28).
  const nutDiffRows: CompareRow[] = onlyDifferences
    ? TRACKED_NUT_KEYS.filter(k => new Set(allData.map(d => d.supportedNuts.has(k))).size > 1).map(k => {
      const tag = `NUT-${k.padStart(2, '0')}`
      return {
        id: `nut-${k}`, section: 'features' as const,
        label: <><span className="cx-nut-tag">{tag}</span> {NUT_NAMES[tag] ?? ''}</>,
        keys: allData.map(d => (d.supportedNuts.has(k) ? 'yes' : 'no')),
        cell: (i: number) => (allData[i]!.supportedNuts.has(k)
          ? <span className="cx-yes">✓ Supported</span>
          : <span className="cx-no">– Not supported</span>),
      }
    })
    : []

  const rows: CompareRow[] = [
    {
      id: 'uptime', section: 'reliability', label: COMPARE_UPTIME_LABEL,
      keys: mints.map((_, i) => { const q = uptime24hQueries[i]; return !q || q.isLoading ? null : String(q.data?.uptimePct ?? '—') }),
      cell: i => {
        const pct = uptime24hQueries[i]?.data?.uptimePct ?? null
        return pct === null ? muted('—') : value(`${pct}%`, best.uptime[i])
      },
    },
    {
      id: 'uptime-30d', section: 'reliability', label: COMPARE_UPTIME_30D_LABEL,
      keys: mints.map(m => { const v = uptime30dShown(m.uptimePct30dExact, m.uptimePct30d); return v === null ? '—' : formatUptime30d(v) }),
      cell: i => {
        const pct = uptime30dShown(mints[i]!.uptimePct30dExact, mints[i]!.uptimePct30d)
        return pct === null ? muted('—') : value(`${formatUptime30d(pct)}%`, best.uptime30d[i], uptime30dColor(pct))
      },
    },
    {
      id: 'audit', section: 'reliability',
      label: <>{COMPARE_AUDIT_LABEL}<InfoTooltip iconSize={11} width={220} about={COMPARE_AUDIT_LABEL} text={compareAuditSuccessText()} /></>,
      keys: mints.map(m => auditSuccessDisplay(m, now).text),
      cell: i => { const a = auditSuccessDisplay(mints[i]!, now); return value(a.text, false, a.color === 'var(--fast)' ? undefined : a.color) },
    },
    {
      id: 'rating', section: 'reliability', label: 'Community rating',
      keys: mints.map(m => ((m.reviewCount ?? 0) > 0 && m.reviewAvgRating != null ? `${m.reviewAvgRating.toFixed(1)}|${m.reviewCount}` : '—')),
      cell: i => {
        const m = mints[i]!
        const count = m.reviewCount ?? 0
        return count > 0 && m.reviewAvgRating != null
          ? <><span className="cx-star" aria-hidden="true">★</span> {m.reviewAvgRating.toFixed(1)} <span className="cx-count">({count})</span></>
          : muted('—')
      },
    },
    {
      id: 'browser-latency', section: 'speed',
      label: <>{COMPARE_BROWSER_LATENCY_LABEL}<InfoTooltip iconSize={11} width={220} about={COMPARE_BROWSER_LATENCY_LABEL} text={COMPARE_BROWSER_LATENCY_TITLE} /></>,
      keys: mints.map((_, i) => { const v = browserLatency(i); return v === 'pending' ? null : v === 'offline' ? '—' : v === null ? 'no answer' : String(v) }),
      cell: i => {
        const v = browserLatency(i)
        if (v === 'pending') return muted('measuring…')
        if (v === 'offline') return muted('—')
        if (v === null) return muted('no answer')
        return value(`${v} ms`, best.latency[i])
      },
    },
    {
      id: 'latency', section: 'speed',
      label: <>{COMPARE_LATENCY_LABEL}<InfoTooltip iconSize={11} width={200} about={COMPARE_LATENCY_LABEL} text={COMPARE_LATENCY_TITLE} /></>,
      keys: mints.map((m, i) => (allData[i]!.isOnline && m.latencyMs != null ? String(m.latencyMs) : '—')),
      cell: i => (allData[i]!.isOnline && mints[i]!.latencyMs != null ? `${mints[i]!.latencyMs} ms` : muted('—')),
    },
    ...methodRows.map((r): CompareRow => ({
      id: r.id, section: 'money', label: r.label, keys: r.keys,
      cell: i => (
        <span className="cx-lines">
          {r.cells[i]!.map((l, j) => <span key={j} className={l.muted ? 'cx-muted' : undefined}>{l.text}</span>)}
        </span>
      ),
    })),
    {
      id: 'fee', section: 'money', label: <>Input fee<InfoTooltip iconSize={11} width={200} about="Input fee" text={INPUT_FEE_TEXT} /></>,
      keys: mints.map((_, i) => { const f = feeOf(i); return f === 'pending' ? null : f ? compareFeeText(f.fee) : 'n/a' }),
      cell: i => {
        const f = feeOf(i)
        if (f === 'pending') return muted('…')
        if (!f) return muted('n/a')
        const checkedAt = f.stored ? mints[i]?.lastKeysetsCheckedAt : null
        return (
          <span className="cmp-input-fee">
            {value(compareFeeText(f.fee), best.fee[i])}
            {f.stored && <span className="cx-sub cmp-fee-lastchecked">last checked{checkedAt ? ` ${formatTimeAgo(new Date(checkedAt))}` : ''}</span>}
          </span>
        )
      },
    },
    {
      id: 'units', section: 'money', label: 'Units',
      keys: allData.map(d => d.units.join(', ') || '—'),
      cell: i => (allData[i]!.units.length > 0 ? allData[i]!.units.join(', ') : muted('—')),
    },
    {
      id: 'nut-count', section: 'features', label: COMPARE_NUT_COUNT_LABEL,
      keys: allData.map(d => String(d.trackedCount)),
      cell: i => value(`${allData[i]!.trackedCount} of ${TRACKED_NUT_KEYS.length}`, best.nuts[i]),
    },
    ...nutDiffRows,
    {
      id: 'version', section: 'operator', label: 'Software',
      keys: mints.map((m, i) => `${m.version ?? '—'}|${allData[i]!.isOutdated ? 'outdated' : ''}`),
      cell: i => (
        <span className="cx-lines">
          <code className="cx-code">{breakAfterSlash(mints[i]!.version ?? '—')}</code>
          {allData[i]!.isOutdated && <span className="cx-outdated">Outdated</span>}
        </span>
      ),
    },
    {
      id: 'contact-methods', section: 'operator', label: COMPARE_CONTACT_LABEL,
      keys: mints.map((_, i) => { const t = contactText(i); return t === 'pending' ? null : (t ?? 'n/a') }),
      cell: i => { const t = contactText(i); return t === 'pending' ? muted('…') : t === null ? muted('n/a') : t },
    },
    {
      id: 'nip87', section: 'operator', label: COMPARE_NIP87_LABEL,
      keys: mints.map(m => nip87RowText(m)),
      cell: i => nip87RowText(mints[i]!),
    },
    ...SCORE_PART_ROWS.map((r): CompareRow => ({
      id: r.id, section: 'points', label: r.label,
      keys: mints.map(m => scorePointsText(m, r.part, now)),
      cell: i => scorePointsText(mints[i]!, r.part, now),
    })),
  ]
  const shownRows = visibleCompareRows(rows, onlyDifferences)
  const rowsOf = (section: SectionId) => shownRows.filter(r => r.section === section)
  const onlyDiffStatusText = onlyDifferences
    ? (shownRows.length === 0
      ? 'Every row has the same value for these mints.'
      : `${shownRows.length} of ${rows.length} rows differ; rows with the same value are hidden.`)
    : ''

  // The slim name bar shows once the cards have scrolled away under the header (the modal itself is the scroll box).
  const cardsRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const [cardsGone, setCardsGone] = useState(false)
  const [headH, setHeadH] = useState(64)
  useLayoutEffect(() => {
    const h = headerRef.current?.offsetHeight
    if (h) setHeadH(h)
  }, [])
  useEffect(() => {
    const cards = cardsRef.current
    const root = cards?.closest<HTMLElement>('.cmp-modal') ?? null
    if (!cards || !root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(e => setCardsGone(!e[0]!.isIntersecting), { root, rootMargin: `-${headH}px 0px 0px 0px`, threshold: 0 })
    io.observe(cards)
    return () => io.disconnect()
  }, [headH])

  const loadedHistory = historyQueries.map(q => q.data).filter((d): d is HistoryResponse => d != null)
  const isLoadingHistory = historyOpened && historyQueries.some(q => q.isLoading)
  const periodDaysValue = loadedHistory[0]?.periodDays ?? null
  const minDaysAvailable = loadedHistory.length > 0 ? Math.min(...loadedHistory.map(d => d.daysOfDataAvailable)) : null
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
        row[`m${i}`] = !seg ? null : metric === 'latency' ? seg.latencyMs : metric === 'uptime' ? seg.uptimePct : seg.reliabilityScore
      })
      return row
    })
  }, [historyQueries, historyPeriod, metric])
  const chartHasEnoughData = chartData.filter(row => mints.some((_, i) => row[`m${i}`] != null)).length >= 2
  const unitOf = (v: number) => (metric === 'latency' ? `${Math.round(v)} ms` : metric === 'uptime' ? `${Math.round(v)}%` : `${Math.round(v)}`)

  const n = mints.length
  const colsStyle = { '--cx-n': n } as CSSProperties
  const renderRows = (list: CompareRow[]) => list.map(r => (
    <div key={r.id} className="cx-row" data-row={r.id}>
      <div className="cx-lbl">{r.label}</div>
      <div className="cx-cols" style={colsStyle}>
        {mints.map((mint, i) => (
          <div key={mint.url} className="cx-val" data-row={r.id}>
            <span className="sr-only">{allData[i]!.displayName}: </span>
            {r.cell(i)}
          </div>
        ))}
      </div>
    </div>
  ))

  return (
    <div className="cmp-overlay" onClick={onClose}>
      <div
        className="cmp-modal cx"
        data-mints={n}
        style={{ '--cx-head': `${headH}px` } as CSSProperties}
        onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-labelledby="cmp-modal-title" ref={dialogRef}
      >
        <div className="cmp-modal-header" ref={headerRef}>
          <div id="cmp-modal-title" className="cx-title">Compare {n} mints</div>
          <button type="button" className="cmp-modal-close" onClick={onClose} aria-label="Close"><IcClose /></button>
        </div>

        <div className="cx-body">
          <div className="cx-toolbar">
            <span className="cx-hint">{n} mints side by side</span>
            <button
              type="button"
              role="switch"
              aria-checked={onlyDifferences}
              className={`cmp-m-switch${onlyDifferences ? ' on' : ''}`}
              onClick={() => setOnlyDifferences(v => !v)}
            >
              <span className="cmp-m-switch-track" aria-hidden="true"><span className="cmp-m-switch-thumb" /></span>
              Only differences
            </button>
          </div>
          <p className="cmp-m-status cx-status" role="status" aria-live="polite">{onlyDiffStatusText}</p>

          <div className="cx-cards cx-cols" style={colsStyle} ref={cardsRef}>
            {mints.map((mint, i) => {
              const d = allData[i]!
              return (
                <div key={mint.url} className="cx-card" data-testid="cmp-card">
                  <MintFavicon url={mint.url} name={mint.name} iconUrl={mint.iconUrl} size={isMobile ? 24 : 30} radius={7} />
                  <div className="cx-name">
                    {/* The status dot right after the name (owner, 2026-11-28), held to its last word so it never wraps
                        onto a line of its own; its word is read, and shown when the mint is not online. */}
                    <span className="cx-name-text">
                      {nameHead(d.displayName)}
                      <span className="cx-name-tail">{nameTail(d.displayName)}<span className={`cx-dot cx-dot-${d.status}`} aria-hidden="true" /></span>
                    </span>
                    <span className={d.isOnline ? 'sr-only' : 'cx-status-word'}>{d.statusLabel}</span>
                    {d.isNew && <span className="cx-new">New</span>}
                  </div>
                  <code className="cx-host">{d.hostname}</code>
                  <div className="cx-score" data-row="reliability">
                    <span className="cx-score-num" style={{ color: d.isOnline ? (best.reliability[i] ? 'var(--accent)' : scoreColor(d.reliabilityScore)) : 'var(--text3)' }}>
                      {d.isOnline ? d.reliabilityScore : '—'}
                    </span>
                    <span className="cx-score-lbl">Reliability Score</span>
                    {best.reliability[i] && <BestTag />}
                  </div>
                </div>
              )
            })}
          </div>

          <div className={`cx-key cx-cols${cardsGone ? ' on' : ''}`} style={colsStyle} aria-hidden="true">
            {mints.map((mint, i) => (
              <span key={mint.url} className="cx-key-cell">
                <MintFavicon url={mint.url} name={mint.name} iconUrl={mint.iconUrl} size={18} radius={5} />
                <span className="cx-key-name">{allData[i]!.displayName}</span>
              </span>
            ))}
          </div>

          <div className="cx-sections">
            {SECTIONS.map(s => {
              const list = rowsOf(s.id)
              if (list.length === 0) return null
              return (
                <section key={s.id} className="cx-panel" aria-labelledby={`cx-h-${s.id}`}>
                  <h3 id={`cx-h-${s.id}`} className="cx-h">{s.heading}</h3>
                  {renderRows(list)}
                </section>
              )
            })}

            {rowsOf('points').length > 0 && (
              <details className="cx-panel cx-fold">
                <summary>How each score is made</summary>
                {renderRows(rowsOf('points'))}
              </details>
            )}

            <details className="cx-panel cx-fold" onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) setHistoryOpened(true) }}>
              <summary>History</summary>
              <div className="cx-hist-ctl">
                <div className="md-seg" role="group" aria-label="Metric">
                  {([['latency', 'Latency'], ['uptime', 'Uptime'], ['reliability', 'Score']] as const).map(([m, label]) => (
                    <button key={m} type="button" className={metric === m ? 'on' : ''} aria-pressed={metric === m} onClick={() => setMetric(m)}>{label}</button>
                  ))}
                </div>
                <div className="md-seg" role="group" aria-label="Period">
                  {(['24h', '7d', '30d', '90d'] as const).map(iv => (
                    <button key={iv} type="button" className={historyPeriod === iv ? 'on' : ''} aria-pressed={historyPeriod === iv} onClick={() => setHistoryPeriod(iv)}>
                      {iv.replace(/(\d+)([a-z])/, '$1 $2')}
                    </button>
                  ))}
                </div>
              </div>
              {coverageText && <p className="cx-note">{coverageText}</p>}
              {!historyOpened || isLoadingHistory ? (
                <p className="cx-note">Loading history…</p>
              ) : chartData.length === 0 ? (
                <p className="cx-note">No historical data for this period.</p>
              ) : !chartHasEnoughData ? (
                <p className="cx-note">Not enough data for this period</p>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={isMobile ? 170 : 220}>
                    <LineChart data={chartData} margin={{ top: 6, right: 12, left: 4, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label" tick={{ fontSize: 12, fill: 'var(--text3)' }} axisLine={false} tickLine={false}
                        padding={{ left: 0, right: 12 }}
                        interval={historyPeriod === '24h' ? (isMobile ? 7 : 3) : chartData.length <= 7 ? (isMobile ? 1 : 0) : Math.ceil(chartData.length / (isMobile ? 4 : 7)) - 1}
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: 'var(--text3)' }} axisLine={false} tickLine={false} width={52}
                        domain={metric === 'latency' ? [0, 'auto'] : [0, 100]}
                        tickFormatter={unitOf}
                      />
                      <Tooltip
                        contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--font-body)', fontSize: 12 }}
                        formatter={(v, name) => [typeof v === 'number' ? unitOf(v) : String(v), name]}
                      />
                      {mints.map((mint, i) => (
                        <Line key={mint.url} type="monotone" dataKey={`m${i}`} name={allData[i]!.displayName} stroke={MINT_COLORS[i]!} dot={false} strokeWidth={2} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="cx-legend">
                    {mints.map((mint, i) => (
                      <span key={mint.url} className="cx-legend-item"><span className="cx-legend-line" style={{ background: MINT_COLORS[i]! }} />{allData[i]!.displayName}</span>
                    ))}
                  </div>
                </>
              )}
              <div className="cx-row" data-row="versions">
                <div className="cx-lbl">Software versions</div>
                <div className="cx-cols" style={colsStyle}>
                  {mints.map((mint, i) => {
                    const history = versionQueries[i]?.data?.history ?? []
                    const showAll = allVersions.has(i)
                    const list = showAll ? history : history.slice(0, VERSIONS_SHOWN)
                    return (
                      <div key={mint.url} className="cx-val cx-versions">
                        <span className="sr-only">{allData[i]!.displayName}: </span>
                        {history.length === 0 ? muted(historyOpened && versionQueries[i]?.isLoading ? '…' : 'No data') : list.map((vh, j) => (
                          <span key={j} className="cmp-vh-entry">
                            <code className="cx-code">{breakAfterSlash(vh.version)}</code>
                            <span className="cx-sub">since {formatDate(vh.firstSeenAt, { local: true })}</span>
                          </span>
                        ))}
                        {history.length > VERSIONS_SHOWN && (
                          <button type="button" className="cx-more" aria-expanded={showAll}
                            onClick={() => setAllVersions(prev => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next })}>
                            {showAll ? 'Fewer versions' : 'All versions'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  )
}
