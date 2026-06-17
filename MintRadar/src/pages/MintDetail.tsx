import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MintFavicon } from '@/components/mint/MintFavicon'
import {
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts'
import { useMintProbe } from '@/hooks/useMintProbe'
import { useMintHistory } from '@/hooks/useMintHistory'
import { useKnownMints } from '@/hooks/useKnownMints'
import { useMintReviews } from '@/hooks/useMintReviews'
import { submitMintReview } from '@/hooks/useSubmitReview'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { useAuthStore } from '@/stores/auth.store'
import { ComparisonModal } from '@/components/ComparisonModal'
import './MintDetail.css'
import {
  Copy, Check, Info, ShieldCheck, ShieldOff, ChevronDown, ChevronUp,
  Coins, Flame, SlidersHorizontal, RefreshCw, Lock, Key, Shield,
  Clock, GitBranch, Plug, Database, Award, Layers, Zap,
} from 'lucide-react'

interface NutMethod {
  method: string
  unit: string
  min_amount?: number
  max_amount?: number
}

interface NutConfig {
  disabled?: boolean
  methods?: NutMethod[]
}

const NUT_DESCRIPTIONS: Record<string, { short: string; desc: string; features: string[]; useCase: string }> = {
  'NUT-00': { short: 'Token format', desc: 'Basic Cashu token format and encoding specification.', features: ['Base64url encoding', 'Token versioning', 'Multi-mint tokens'], useCase: 'Foundation for all Cashu token operations.' },
  'NUT-01': { short: 'Mint keys', desc: 'Retrieving public keys from the mint for each amount.', features: ['Amount-specific keypairs', 'Key retrieval API', 'Key validation'], useCase: 'Clients use mint keys to verify token signatures.' },
  'NUT-02': { short: 'Keysets', desc: 'Multiple keysets support for key rotation and currencies.', features: ['Keyset IDs', 'Multiple currencies', 'Key rotation'], useCase: 'Allows mints to rotate keys and support multiple currencies.' },
  'NUT-03': { short: 'Swap', desc: 'Swapping proofs for new ones of equal value.', features: ['Proof exchange', 'Change splitting', 'Privacy improvement'], useCase: 'Core operation for splitting and combining tokens.' },
  'NUT-04': { short: 'Mint tokens', desc: 'Minting new Cashu tokens against a Lightning invoice.', features: ['Lightning invoice creation', 'Token issuance', 'Amount verification'], useCase: 'Entry point for getting Cashu tokens from Lightning.' },
  'NUT-05': { short: 'Melt tokens', desc: 'Melting Cashu tokens to pay a Lightning invoice.', features: ['Invoice payment', 'Fee estimation', 'Change return'], useCase: 'Exit point for spending Cashu tokens via Lightning.' },
  'NUT-06': { short: 'Mint info', desc: 'Retrieving mint metadata, capabilities and contact info.', features: ['Version info', 'Supported NUTs', 'Contact details', 'MOTD'], useCase: 'Clients discover mint capabilities before interacting.' },
  'NUT-07': { short: 'Token state', desc: 'Checking whether a proof has been spent or is still valid.', features: ['Spent proof detection', 'Pending state', 'Batch checking'], useCase: 'Verify token validity without redeeming it.' },
  'NUT-08': { short: 'Overpay melt', desc: 'Overpaying melt fees and receiving change back.', features: ['Fee overpayment', 'Change tokens', 'Fee estimation'], useCase: 'Handle variable Lightning routing fees gracefully.' },
  'NUT-09': { short: 'Restore', desc: 'Restoring blinded signatures from mint backup data.', features: ['Signature restoration', 'Backup validation', 'Deterministic secrets'], useCase: 'Recover tokens from backup without double-spend risk.' },
  'NUT-10': { short: 'Spending cond.', desc: 'Spending conditions that must be met to use a proof.', features: ['Conditional spending', 'Script conditions', 'Extensible'], useCase: 'Base for advanced features like P2PK and HTLCs.' },
  'NUT-11': { short: 'Pay-to-PK', desc: 'Lock tokens to a specific public key for secure transfers.', features: ['Public key locking', 'Signature verification', 'Selective unlock'], useCase: 'Send tokens that only a specific recipient can spend.' },
  'NUT-12': { short: 'DLEQ proofs', desc: 'Discrete Log Equality proofs for verifiable blind signatures.', features: ['Cryptographic proofs', 'Signature verification', 'Privacy preserving'], useCase: 'Clients verify mint honesty without revealing token data.' },
  'NUT-14': { short: 'HTLCs', desc: 'Hash Time Locked Contracts for atomic swaps.', features: ['Hash preimage', 'Timelock expiry', 'Atomic swaps'], useCase: 'Enable trustless cross-mint or cross-chain swaps.' },
  'NUT-15': { short: 'Multipart melt', desc: 'Split a melt payment across multiple Lightning invoices.', features: ['Multi-invoice payment', 'Amount splitting', 'Partial melt'], useCase: 'Pay invoices larger than a single proof allows.' },
  'NUT-17': { short: 'WebSocket', desc: 'Real-time mint updates via WebSocket subscription.', features: ['Live updates', 'Event subscription', 'Low latency'], useCase: 'Receive instant confirmation without polling.' },
  'NUT-19': { short: 'Cached responses', desc: 'Mints cache successful responses for critical operations so wallets can replay after a network error.', features: ['Response caching', 'Network recovery', 'Idempotent replay'], useCase: 'Prevents loss of funds when a network interruption occurs during mint/swap/melt.' },
  'NUT-20': { short: 'Mint quote sig', desc: 'Mint signs quote requests for authenticity.', features: ['Quote signatures', 'Request authentication', 'Replay protection'], useCase: 'Prevent quote tampering between client and mint.' },
  'NUT-29': { short: 'Batched minting', desc: 'Wallets can mint tokens for multiple quotes in a single atomic request.', features: ['Multi-quote batch', 'Atomic operation', 'Efficiency'], useCase: 'Reduces round-trips when minting from multiple paid invoices at once.' },
}

const ALL_NUTS = [
  'NUT-04', 'NUT-05', 'NUT-07', 'NUT-08', 'NUT-09', 'NUT-10', 'NUT-11',
  'NUT-12', 'NUT-14', 'NUT-15', 'NUT-17', 'NUT-19', 'NUT-20', 'NUT-29',
]

const NUT_ICONS: Record<string, JSX.Element> = {
  'NUT-04': <Coins size={13} />,
  'NUT-05': <Flame size={13} />,
  'NUT-07': <Info size={13} />,
  'NUT-08': <SlidersHorizontal size={13} />,
  'NUT-09': <RefreshCw size={13} />,
  'NUT-10': <Lock size={13} />,
  'NUT-11': <Key size={13} />,
  'NUT-12': <Shield size={13} />,
  'NUT-14': <Clock size={13} />,
  'NUT-15': <GitBranch size={13} />,
  'NUT-17': <Plug size={13} />,
  'NUT-19': <Database size={13} />,
  'NUT-20': <Award size={13} />,
  'NUT-29': <Layers size={13} />,
}

function uptimeColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'var(--text3)'
  if (pct >= 80) return '#4ade80'
  if (pct >= 50) return '#ffa500'
  return '#ff4d4d'
}

function trustScoreColor(score: number): string {
  if (score >= 75) return '#4ade80'
  if (score >= 50) return '#ffa500'
  return '#ff4d4d'
}

function trustScoreInfo(score: number): { label: string; color: string; bg: string; border: string } {
  if (score >= 70) return { label: 'High Trust', color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.25)' }
  if (score >= 40) return { label: 'Moderate Trust', color: '#ffa500', bg: 'rgba(255,165,0,0.1)', border: 'rgba(255,165,0,0.25)' }
  return { label: 'Low Trust', color: '#ff4d4d', bg: 'rgba(255,77,77,0.1)', border: 'rgba(255,77,77,0.25)' }
}

function mintAgeBadge(discoveredAt: string | null | undefined): { label: string; color: string; bg: string; border: string } | null {
  if (!discoveredAt) return null
  const months = (Date.now() - new Date(discoveredAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  if (months < 1) return { label: 'Fresh', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.25)' }
  if (months < 6) return { label: 'Established', color: '#4ade80', bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.25)' }
  if (months < 12) return { label: 'Veteran', color: '#ffa500', bg: 'rgba(255,165,0,0.1)', border: 'rgba(255,165,0,0.25)' }
  return { label: 'OG', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' }
}

function parseMinorVer(v: string | null | undefined): number {
  if (!v) return 0
  const m = v.match(/\d+\.(\d+)/)
  return m ? parseInt(m[1] ?? '0', 10) : 0
}

const NUTSHELL_VERSIONS: [number, number][] = [
  [0, 21], [0, 20], [0, 19], [0, 18], [0, 17], [0, 16], [0, 15],
]

function versionFreshnessScore(versionStr: string | null | undefined): number {
  if (!versionStr) return 0
  const match = versionStr.match(/(\d+)\.(\d+)/)
  if (!match || match[1] === undefined || match[2] === undefined) return 3
  const major = parseInt(match[1], 10)
  const minor = parseInt(match[2], 10)
  const idx = NUTSHELL_VERSIONS.findIndex(([mj, mn]) => major > mj || (major === mj && minor >= mn))
  if (idx === -1) return 0
  return Math.max(0, 10 - idx * 2)
}

function contactInfoScore(email?: string, twitter?: string, nostr?: string, website?: string): number {
  const count = [email, twitter, nostr, website].filter(Boolean).length
  return Math.round((count / 4) * 5)
}

function auditReliabilityScore(nMints: number | null, nMelts: number | null, nErrors: number | null): number {
  if (nMints === null) return 2.5
  const total = nMints + (nMelts ?? 0) + (nErrors ?? 0)
  if (total === 0) return 5
  const errorRate = (nErrors ?? 0) / total
  if (errorRate === 0) return 5
  if (errorRate < 0.01) return 4
  if (errorRate < 0.05) return 3
  if (errorRate < 0.15) return 2
  return 1
}

function computeTrustScore(
  uptimePct: number,
  nutCount: number,
  versionStr: string | null | undefined,
  email?: string,
  twitter?: string,
  nostr?: string,
  website?: string,
  auditNMints?: number | null,
  auditNMelts?: number | null,
  auditNErrors?: number | null,
): number {
  const uptimeScore = Math.round(uptimePct * 0.45)
  const nutScore = Math.round(Math.min(nutCount / ALL_NUTS.length, 1) * 30)
  const verScore = Math.round(versionFreshnessScore(versionStr) / 10 * 15)
  const cScore = contactInfoScore(email, twitter, nostr, website)
  const aScore = auditReliabilityScore(auditNMints ?? null, auditNMelts ?? null, auditNErrors ?? null)
  return Math.round(Math.min(100, uptimeScore + nutScore + verScore + cScore + aScore))
}

const WARNING_KEYWORDS = ['rug', 'shutdown', 'warning', 'beware', 'risk', 'danger', 'caution', 'maintenance']
function isWarningMotd(text: string): boolean {
  const lower = text.toLowerCase()
  return WARNING_KEYWORDS.some(kw => lower.includes(kw))
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function MintDetailContent({ url }: { url: string }) {
  const navigate = useNavigate()
  const { data, isLoading } = useMintProbe(url)
  useMintHistory(url)
  const { data: knownMintsData } = useKnownMints()
  const knownMint = knownMintsData?.find(m => m.url === url) ?? null
  const [historyPeriod, setHistoryPeriod] = useState<'24h' | '7d' | '30d'>('24h')
  const [chartInterval, setChartInterval] = useState<'24h' | '7d' | '30d' | '90d'>('7d')
  const [chartMetric, setChartMetric] = useState<'latency' | 'uptime' | 'trust'>('latency')
  const { data: historyData } = useQuery({
    queryKey: ['mint', 'history-api', url, historyPeriod],
    queryFn: async () => {
      const res = await fetch(`/api/mints/history?url=${encodeURIComponent(url)}&period=${historyPeriod}`)
      if (!res.ok) throw new Error('Failed to fetch history')
      return res.json() as Promise<{
        period: string
        segments: Array<{ bucket: string; online: boolean; latencyMs: number | null; total: number; onlineCount: number; uptimePct: number | null }>
        uptimePct: number | null
        avgLatencyMs: number | null
        prevUptimePct: number | null
        prevAvgLatencyMs: number | null
        history: Array<{ online: boolean; latencyMs: number | null; checkedAt: string }>
      }>
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })
  const { data: chartHistoryData } = useQuery({
    queryKey: ['mint', 'chart-history', url, chartInterval],
    queryFn: async () => {
      const res = await fetch(`/api/mints/history?url=${encodeURIComponent(url)}&period=${chartInterval}`)
      if (!res.ok) throw new Error('Failed to fetch chart history')
      return res.json() as Promise<{
        period: string
        segments: Array<{ bucket: string; online: boolean; latencyMs: number | null; total: number; onlineCount: number; uptimePct: number | null }>
        uptimePct: number | null
        avgLatencyMs: number | null
        prevUptimePct: number | null
        prevAvgLatencyMs: number | null
      }>
    },
    staleTime: 5 * 60 * 1000,
  })
  // Dedicated 24h query for the header — shares TanStack cache with historyData when historyPeriod='24h'
  const { data: uptime24hData } = useQuery({
    queryKey: ['mint', 'history-api', url, '24h'],
    queryFn: async () => {
      const res = await fetch(`/api/mints/history?url=${encodeURIComponent(url)}&period=24h`)
      if (!res.ok) throw new Error('Failed to fetch history')
      return res.json() as Promise<{
        period: string
        segments: Array<{ bucket: string; online: boolean; latencyMs: number | null; total: number; onlineCount: number; uptimePct: number | null }>
        uptimePct: number | null
        avgLatencyMs: number | null
        prevUptimePct: number | null
        prevAvgLatencyMs: number | null
        history: Array<{ online: boolean; latencyMs: number | null; checkedAt: string }>
      }>
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })
  const { data: versionHistoryData } = useQuery({
    queryKey: ['mint', 'version-history', url],
    queryFn: async () => {
      const res = await fetch(`/api/mints/version-history?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error('Failed to fetch version history')
      return await res.json() as { history: Array<{ version: string; firstSeenAt: string }>; latestGlobalVersion: string | null }
    },
    staleTime: 10 * 60 * 1000,
  })
  const versionHistory = versionHistoryData?.history
  const latestGlobalVersion = versionHistoryData?.latestGlobalVersion ?? null
  const watchlistMints = useWatchlistStore(state => state.mints)
  const addMint = useWatchlistStore(state => state.addMint)
  const removeMint = useWatchlistStore(state => state.removeMint)
  const loadFromDb = useWatchlistStore(state => state.loadFromDb)
  const profile = useAuthStore(state => state.profile)
  const isLoggedIn = profile !== null
  const { reviews, loading: reviewsLoading } = useMintReviews(url)
  const { data: nostrReviewsData } = useQuery({
    queryKey: ['mint', 'nostr-reviews', url],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/mints/nostr-reviews?url=${encodeURIComponent(url)}`)
        if (!res.ok) return []
        return res.json() as Promise<Array<{ id: string; pubkey: string; content: string; rating: number; createdAt: number; source: 'nostr' }>>
      } catch {
        return []
      }
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
  const mergedReviews = useMemo(() => {
    const mintradarIds = new Set(reviews.map(r => r.id))
    const nostrOnly = (nostrReviewsData ?? []).filter(r => !mintradarIds.has(r.id))
    const all: Array<{ id: string; pubkey: string; rating: number; comment: string; createdAt: number; source: 'mintradar' | 'nostr' }> = [
      ...reviews.map(r => ({ ...r, source: 'mintradar' as const })),
      ...nostrOnly.map(r => ({ id: r.id, pubkey: r.pubkey, rating: r.rating, comment: r.content, createdAt: r.createdAt, source: 'nostr' as const })),
    ]
    return all.sort((a, b) => b.createdAt - a.createdAt)
  }, [reviews, nostrReviewsData])
  const [selectedNut, setSelectedNut] = useState<string | null>(null)
  const [copiedContact, setCopiedContact] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [showTrustBreakdown, setShowTrustBreakdown] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewSuccess, setReviewSuccess] = useState(false)
  const [auditTooltip, setAuditTooltip] = useState<'mints' | 'melts' | 'errors' | null>(null)
  const [breakdownTooltip, setBreakdownTooltip] = useState<string | null>(null)
  const [clientLatency, setClientLatency] = useState<number | string | null>(null)
  const [testingLatency, setTestingLatency] = useState(false)
  const [latencyBtnTooltip, setLatencyBtnTooltip] = useState(false)
  const [segmentTooltip, setSegmentTooltip] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'nuts' | 'audit' | 'reviews'>('overview')
  const [auditExpanded, setAuditExpanded] = useState(false)
  const [showComparePicker, setShowComparePicker] = useState(false)
  const [comparePickerSelected, setComparePickerSelected] = useState<Set<string>>(new Set())
  const [showComparisonModal, setShowComparisonModal] = useState(false)
  const [comparePickerSearch, setComparePickerSearch] = useState('')

  async function testClientLatency() {
    setTestingLatency(true)
    setClientLatency(null)
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 5000)
    const t0 = performance.now()
    try {
      await fetch(url.replace(/\/$/, '') + '/v1/info', { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
      clearTimeout(timeout)
      setClientLatency(Math.round(performance.now() - t0))
    } catch {
      clearTimeout(timeout)
      setClientLatency('Unreachable from your location')
    } finally {
      setTestingLatency(false)
    }
  }

  useEffect(() => { void loadFromDb() }, [loadFromDb])

  useEffect(() => {
    if (!selectedNut) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedNut(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedNut])

  useEffect(() => {
    if (!showReviewModal) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowReviewModal(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [showReviewModal])

  useEffect(() => {
    if (!showTrustBreakdown) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowTrustBreakdown(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [showTrustBreakdown])

  const histLineData = useMemo(() => {
    const segs = chartHistoryData?.segments ?? []
    const nutCount = knownMint?.nutCount ?? 0
    const versionStr = knownMint?.version ?? data?.info?.version ?? null
    const auditNMints = knownMint?.auditNMints ?? null
    const auditNMelts = knownMint?.auditNMelts ?? null
    const auditNErrors = knownMint?.auditNErrors ?? null
    const emailVal = data?.info?.contact?.find((c: { method: string }) => c.method === 'email')?.info
    const twitterVal = data?.info?.contact?.find((c: { method: string }) => c.method === 'twitter')?.info
    const nostrVal = data?.info?.contact?.find((c: { method: string }) => c.method === 'nostr')?.info
    const websiteVal = data?.info?.contact?.find((c: { method: string }) => c.method === 'website')?.info
    function bucketLabel(bucket: string): string {
      const d = new Date(bucket)
      if (chartInterval === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
    function makePoint(seg: typeof segs[0] | null, label: string) {
      if (!seg) return { label, latency: null as number | null, uptime: null as number | null, trust: null as number | null }
      const trustVal = seg.uptimePct !== null
        ? computeTrustScore(seg.uptimePct, nutCount, versionStr, emailVal, twitterVal, nostrVal, websiteVal, auditNMints, auditNMelts, auditNErrors)
        : null
      return { label, latency: seg.latencyMs, uptime: seg.uptimePct, trust: trustVal }
    }
    // For empty data or 90d (weekly buckets), use segments as-is
    if (segs.length === 0 || chartInterval === '90d') {
      return segs.map(seg => makePoint(seg, bucketLabel(seg.bucket)))
    }
    // Generate full expected time slots so sparse data maps to correct X positions
    const isHourly = chartInterval === '24h'
    const slotCount = chartInterval === '24h' ? 24 : chartInterval === '7d' ? 7 : 30
    const bucketMs = isHourly ? 3_600_000 : 86_400_000
    const currentBucketMs = Math.floor(Date.now() / bucketMs) * bucketMs
    const keyLen = isHourly ? 13 : 10
    const segMap = new Map(segs.map(s => [s.bucket.slice(0, keyLen), s]))
    return Array.from({ length: slotCount }, (_, i) => {
      const slotMs = currentBucketMs - (slotCount - 1 - i) * bucketMs
      const iso = new Date(slotMs).toISOString()
      return makePoint(segMap.get(iso.slice(0, keyLen)) ?? null, bucketLabel(iso))
    })
  }, [chartHistoryData?.segments, chartInterval, knownMint, data?.info?.version, data?.info?.contact])

  if (isLoading || data === undefined) {
    return (
      <div className="mint-detail">
        <div className="md-header">
          <button className="md-back" onClick={() => navigate(-1)}>← Back</button>
        </div>
      </div>
    )
  }

  const hostname = (() => { try { return new URL(url).hostname } catch { return url } })()
  const displayName = data.info?.name ?? hostname
  const isOnline = data.online
  const latency = knownMint?.latencyMs ?? null
  const version = data.info?.version
  const nutCount = data.info !== null ? Object.keys(data.info.nuts).length : 0
  const motd = data.info?.motd
  const description = data.info?.description
  const pubkey = data.info?.pubkey
  const name = data.info?.name

  const tosUrl = data.info?.tos_url
  const descriptionLong = data.info?.description_long
  const mintTime = data.info?.time

  const email = data.info?.contact?.find(c => c.method === 'email')?.info
  const twitter = data.info?.contact?.find(c => c.method === 'twitter')?.info
  const nostr = data.info?.contact?.find(c => c.method === 'nostr')?.info
  const website = data.info?.contact?.find(c => c.method === 'website')?.info
  const urls = data.info?.urls

  const uptimePct = uptime24hData?.uptimePct ?? 0

  // Header "Uptime 24H" — always sourced from server API (same 24h window as Mint History panel)
  const headerUptimePct = uptime24hData?.uptimePct ?? null
  const headerOnlineChecks = (uptime24hData?.segments ?? []).reduce((s, r) => s + r.onlineCount, 0)
  const headerTotalChecks = (uptime24hData?.segments ?? []).reduce((s, r) => s + r.total, 0)

  // NUT-04 (minting) and NUT-05 (melting) disabled detection
  const nut4Disabled = (() => {
    const raw = data.info?.nuts?.['4'] ?? knownMint?.nutsLimits?.['4']
    return raw !== null && raw !== undefined && typeof raw === 'object' && (raw as NutConfig).disabled === true
  })()
  const nut5Disabled = (() => {
    const raw = data.info?.nuts?.['5'] ?? knownMint?.nutsLimits?.['5']
    return raw !== null && raw !== undefined && typeof raw === 'object' && (raw as NutConfig).disabled === true
  })()

  const segments = historyData?.segments ?? []
  const apiUptimePct = historyData?.uptimePct ?? null
  const apiAvgLatency = historyData?.avgLatencyMs ?? null
  const prevUptimePct = historyData?.prevUptimePct ?? null
  const uptimeTrend = (apiUptimePct !== null && prevUptimePct !== null)
    ? apiUptimePct - prevUptimePct
    : null
  const displayUptimePct = apiUptimePct ?? uptimePct

  const discoveredAt = knownMint?.discoveredAt ?? null
  const isLessThan7dOld = discoveredAt != null
    ? (Date.now() - new Date(discoveredAt).getTime()) < 7 * 24 * 3600 * 1000
    : false
  const isLessThan30dOld = discoveredAt != null
    ? (Date.now() - new Date(discoveredAt).getTime()) < 30 * 24 * 3600 * 1000
    : false

  const isWatching = watchlistMints.includes(url)
  const toggleWatch = () => { void (isWatching ? removeMint(url) : addMint(url)) }

  const supportedNutNumbers = new Set(data.info !== null ? Object.keys(data.info.nuts) : [])
  const supportedNuts = ALL_NUTS.filter(nut =>
    supportedNutNumbers.has(String(parseInt(nut.slice(4), 10)))
  )
  const supportsNut13 = supportedNutNumbers.has('13')

  const trustScore = knownMint?.trustScore ?? computeTrustScore(uptimePct, supportedNuts.length, version, email, twitter, nostr, website, knownMint?.auditNMints ?? null, knownMint?.auditNMelts ?? null, knownMint?.auditNErrors ?? null)
  const tsInfo = trustScoreInfo(trustScore)
  const ageBadge = mintAgeBadge(discoveredAt)
  const isOutdated = version !== null && latestGlobalVersion !== null
    && (parseMinorVer(latestGlobalVersion) - parseMinorVer(version)) > 2

  const avgRating = reviews.length > 0
    ? Math.round(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length * 10) / 10
    : null

  const chartAvgLatency = chartHistoryData?.avgLatencyMs ?? null
  const chartPrevLatency = chartHistoryData?.prevAvgLatencyMs ?? null
  const chartAvgUptime = chartHistoryData?.uptimePct ?? null
  const chartPrevUptime = chartHistoryData?.prevUptimePct ?? null

  function deltaStr(curr: number | null, prev: number | null, unit = ''): string | null {
    if (curr === null || prev === null) return null
    const diff = curr - prev
    return `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}${unit} vs prev period`
  }

  return (
    <div className="mint-detail">
      <div className="md-header">
        <button className="md-back" onClick={() => navigate(-1)}>← Back</button>
        <MintFavicon url={url} iconUrl={data?.info?.icon_url ?? null} size={32} />
        <div className="md-namebox">
          <div className="md-name" style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
            <span>{displayName}</span>
            {ageBadge && (
              <span style={{fontSize:10,fontFamily:'var(--font-mono)',fontWeight:600,color:ageBadge.color,background:ageBadge.bg,border:`0.5px solid ${ageBadge.border}`,borderRadius:4,padding:'1px 6px',flexShrink:0}}>{ageBadge.label}</span>
            )}
          </div>
          <div className="md-url">{url}</div>
        </div>
        <div className={`md-online-badge ${isOnline ? '' : 'offline'}`}>
          <div className={`status-dot ${isOnline ? '' : 'offline'}`} />
          {isOnline ? 'Online' : 'Offline'}
        </div>
        {!isOnline && knownMint?.lastError && (
          <span style={{fontSize:11,color:'#ff4d4d',fontFamily:'var(--font-mono)',background:'rgba(255,77,77,0.08)',border:'0.5px solid rgba(255,77,77,0.25)',borderRadius:5,padding:'2px 7px',whiteSpace:'nowrap'}}>
            {knownMint.lastError}
          </span>
        )}
        {isLoggedIn
          ? (
            <button className={`md-watch-btn ${isWatching ? 'watching' : ''}`} onClick={toggleWatch}>
              {isWatching ? '✓ Watching' : '+ Add to Watchlist'}
            </button>
          ) : (
            <button
              className="md-watch-btn"
              style={{ color: 'var(--text3)', cursor: 'default' }}
              onClick={e => e.preventDefault()}
              title="Login with Nostr to add to watchlist"
            >
              + Add to Watchlist
            </button>
          )
        }
        <button
          className="md-compare-btn"
          onClick={() => { setShowComparePicker(true); setComparePickerSelected(new Set()); setComparePickerSearch('') }}
        >
          ⇆ Compare
        </button>
      </div>

      <div className="md-summary">
        <div className="md-sc">
          <div className="md-sc-label" style={{display:'flex',alignItems:'center',gap:4}}>
            Latency
            <span title="Measured from our server in Frankfurt, DE. Click 'Test' for your local latency." style={{cursor:'help',color:'var(--text3)',fontSize:9}}>ⓘ</span>
          </div>
          <div className="md-sc-value">{latency !== null ? `${latency} ms` : '—'}</div>
          <div className="md-sc-sub" style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
            <span>server · Frankfurt</span>
            <span
              style={{position:'relative',display:'inline-flex'}}
              onMouseEnter={() => setLatencyBtnTooltip(true)}
              onMouseLeave={() => setLatencyBtnTooltip(false)}
            >
              {latencyBtnTooltip && (
                <div className="audit-tooltip" style={{width:200}}>
                  Your latency from this browser to the mint (client-side measurement).
                </div>
              )}
              <button
                onClick={() => { void testClientLatency() }}
                disabled={testingLatency}
                className="latency-test-btn"
                style={{background:'transparent',border:'0.5px solid #17E87F',borderRadius:6,color:'#17E87F',fontSize:12,padding:'4px 10px',cursor:testingLatency?'wait':'pointer',fontFamily:'var(--font-mono)',display:'inline-flex',alignItems:'center',gap:6}}
              >
                {testingLatency && <span className="latency-spinner" />}
                Show my latency
              </button>
            </span>
          </div>
          {clientLatency !== null && (
            <div style={{fontSize:10,marginTop:4,fontFamily:'var(--font-mono)',color: typeof clientLatency === 'number' ? 'var(--text)' : 'var(--text3)'}}>
              {typeof clientLatency === 'number' ? `Your latency: ${clientLatency}ms` : clientLatency}
            </div>
          )}
        </div>
        <div className={`md-sc ${headerUptimePct === 100 ? 'uptime' : ''}`}>
          <div className="md-sc-label">Uptime 24h</div>
          <div className="md-sc-value" style={{color: uptimeColor(headerUptimePct)}}>{headerUptimePct !== null ? `${headerUptimePct}%` : '—'}</div>
          <div className="md-sc-sub">{headerTotalChecks === 1 ? `${headerOnlineChecks} check` : `${headerOnlineChecks} / ${headerTotalChecks} checks`}</div>
        </div>
        <div className="md-sc">
          <div className="md-sc-label">Version</div>
          <div className="md-sc-value sm" style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
            <span>{version ?? '—'}</span>
            {isOutdated && (
              <span style={{fontSize:9,fontFamily:'var(--font-mono)',fontWeight:600,color:'#ff4d4d',background:'rgba(255,77,77,0.1)',border:'0.5px solid rgba(255,77,77,0.3)',borderRadius:4,padding:'1px 5px'}}>Outdated</span>
            )}
          </div>
          <div className="md-sc-sub">software</div>
        </div>
        <div className="md-sc">
          <div className="md-sc-label">NUTs</div>
          <div className="md-sc-value">{nutCount}</div>
          <div className="md-sc-sub">supported</div>
        </div>
      </div>

      <div className="md-tabs">
        {(['overview', 'history', 'nuts', 'audit', 'reviews'] as const).map(tab => (
          <button
            key={tab}
            className={`md-tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {{ overview: 'Overview', history: 'History', nuts: 'NUTs', audit: 'Audit', reviews: 'Reviews' }[tab]}
          </button>
        ))}
      </div>

      <div className="md-body">
        <div className="md-left">

          {activeTab === 'overview' && (<>
            <div className="md-panel">
              <div className="md-panel-title">Mint info</div>
            {(nut4Disabled || nut5Disabled) && (
              <div style={{background:'rgba(255,165,0,0.08)',border:'0.5px solid rgba(255,165,0,0.3)',borderRadius:8,padding:'9px 12px',marginBottom:12,display:'flex',alignItems:'flex-start',gap:8}}>
                <span style={{color:'#ffa500',fontSize:14,flexShrink:0,lineHeight:1.3}}>⚠</span>
                <div style={{fontSize:12,color:'#ffa500',fontFamily:'var(--font-mono)',lineHeight:1.6}}>
                  {nut4Disabled && <div>Minting is currently disabled by this mint operator</div>}
                  {nut5Disabled && <div>Melting is currently disabled by this mint operator</div>}
                </div>
              </div>
            )}
            {motd && (
              <div className={`md-motd${isWarningMotd(motd) ? ' warning' : ''}`}>
                <div className="md-motd-label">Message of the Day</div>
                <div className="md-motd-text">{motd}</div>
              </div>
            )}
            <div className="md-info-row">
              <span className="md-info-label" style={{ fontWeight: 600 }}>Name</span>
              <span className="md-info-value green">{name ?? '—'}</span>
            </div>
            {description && (
              <div className="md-info-row">
                <span className="md-info-label">Description</span>
                <span className="md-info-value" style={{ color: 'var(--text2)' }}>{description}</span>
              </div>
            )}
            {descriptionLong && (
              <div className="md-info-row" style={{flexDirection:'column', alignItems:'flex-start', gap:4}}>
                <span className="md-info-label">Full description</span>
                <span style={{fontSize:11, color:'var(--text2)', lineHeight:1.5, fontFamily:'var(--font-mono)'}}>
                  {descriptionLong}
                </span>
              </div>
            )}
            <div className="md-info-row">
              <span className="md-info-label">Version</span>
              <span className="md-info-value">{version ?? '—'}</span>
            </div>
            {pubkey && (
              <div className="md-info-row" style={{alignItems: 'center'}}>
                <span className="md-info-label">Public key</span>
                <div style={{display: 'flex', alignItems: 'center', gap: 4}}>
                  <span style={{fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap'}}>{pubkey.slice(0, 16)}…</span>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(pubkey)
                      setCopiedContact('pubkey')
                      setTimeout(() => setCopiedContact(null), 2000)
                    }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: copiedContact === 'pubkey' ? 'var(--accent)' : 'var(--text3)',
                      padding: '2px 4px', flexShrink: 0, display: 'flex',
                    }}
                    title="Copy full public key"
                  >
                    {copiedContact === 'pubkey' ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            )}
            <div className="md-info-row">
              <span className="md-info-label">Discovered</span>
              <span className="md-info-value">NIP-87</span>
            </div>
            {mintTime && (
              <div className="md-info-row">
                <span className="md-info-label">Server time</span>
                <span className="md-info-value">{formatTime(new Date(mintTime * 1000))}</span>
              </div>
            )}
            {tosUrl && (tosUrl.startsWith('https://') || tosUrl.startsWith('http://')) && (
              <div className="md-info-row">
                <span className="md-info-label">Terms of Service</span>
                <a
                  href={tosUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="md-info-value"
                  style={{color:'var(--accent)', textDecoration:'none'}}
                  onClick={e => e.stopPropagation()}
                >
                  View ToS ↗
                </a>
              </div>
            )}
            {urls && urls.length > 1 && (
              <div className="md-info-row" style={{flexDirection:'column', alignItems:'flex-start', gap:4}}>
                <span className="md-info-label">URLs</span>
                <div style={{display:'flex', flexDirection:'column', gap:3, width:'100%'}}>
                  {urls.map((u: string) => {
                    const isActive = u === url
                    return (
                      <div key={u} style={{display:'flex', alignItems:'center', gap:6, justifyContent:'space-between'}}>
                        <span style={{
                          fontSize:10, color: isActive ? 'var(--accent)' : 'var(--text3)',
                          fontFamily:'var(--font-mono)', wordBreak:'break-all', flex:1
                        }}>
                          {isActive ? '● ' : '○ '}{u}
                        </span>
                        <button
                          onClick={() => {
                            void navigator.clipboard.writeText(u)
                            setCopiedUrl(true)
                            setTimeout(() => setCopiedUrl(false), 2000)
                          }}
                          style={{
                            background:'none', border:'none', cursor:'pointer',
                            color:'var(--text3)', padding:'2px 4px',
                            flexShrink:0, display:'flex',
                          }}
                          title="Copy URL"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {(email || twitter || nostr) && (
            <div className="md-panel">
              <div className="md-panel-title">Get in Touch</div>
              <div className="md-contact-grid">
                {email && (
                  <div className="md-contact-card">
                    <div>
                      <div className="md-contact-type">Email</div>
                      <div className="md-contact-val">{email}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void navigator.clipboard.writeText(email)
                        setCopiedContact('email')
                        setTimeout(() => setCopiedContact(null), 2000)
                      }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: copiedContact === 'email' ? 'var(--accent)' : 'var(--text3)',
                        padding: '2px 4px', marginLeft: 'auto',
                        flexShrink: 0, display: 'flex',
                      }}
                      title="Copy"
                    >
                      {copiedContact === 'email' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                )}
                {twitter && (
                  <div className="md-contact-card">
                    <div>
                      <div className="md-contact-type">Twitter</div>
                      <div className="md-contact-val">{twitter}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void navigator.clipboard.writeText(twitter)
                        setCopiedContact('twitter')
                        setTimeout(() => setCopiedContact(null), 2000)
                      }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: copiedContact === 'twitter' ? 'var(--accent)' : 'var(--text3)',
                        padding: '2px 4px', marginLeft: 'auto',
                        flexShrink: 0, display: 'flex',
                      }}
                      title="Copy"
                    >
                      {copiedContact === 'twitter' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                )}
                {nostr && (
                  <div className="md-contact-card">
                    <div>
                      <div className="md-contact-type">Nostr</div>
                      <div className="md-contact-val">{nostr.slice(0, 16)}…</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void navigator.clipboard.writeText(nostr)
                        setCopiedContact('nostr')
                        setTimeout(() => setCopiedContact(null), 2000)
                      }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: copiedContact === 'nostr' ? 'var(--accent)' : 'var(--text3)',
                        padding: '2px 4px', marginLeft: 'auto',
                        flexShrink: 0, display: 'flex',
                      }}
                      title="Copy"
                    >
                      {copiedContact === 'nostr' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          </>)}

          {activeTab === 'nuts' && (<>
            <div className="md-panel">
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:11}}>
                <div className="md-panel-title" style={{marginBottom:0}}>NUT Compatibility</div>
              {supportsNut13 ? (
                <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:10,fontFamily:'var(--font-mono)',fontWeight:600,color:'#4ade80',background:'rgba(74,222,128,0.1)',border:'0.5px solid rgba(74,222,128,0.3)',borderRadius:5,padding:'2px 7px'}}>
                  <ShieldCheck size={11} /> Backup supported
                </span>
              ) : (
                <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:10,fontFamily:'var(--font-mono)',fontWeight:600,color:'var(--text3)',background:'var(--bg3)',border:'0.5px solid var(--border)',borderRadius:5,padding:'2px 7px'}}>
                  <ShieldOff size={11} /> No backup
                </span>
              )}
            </div>
            <div className="nut-grid">
              {ALL_NUTS.map(nut => {
                const supported = supportedNuts.includes(nut)
                const meta = NUT_DESCRIPTIONS[nut]
                const nutKey = parseInt(nut.slice(4), 10).toString()
                const rawConfig = data.info?.nuts?.[nutKey]
                const nutConfig = (rawConfig !== null && rawConfig !== undefined && typeof rawConfig === 'object') ? rawConfig as NutConfig : null
                const isDisabled = supported && nutConfig?.disabled === true
                return (
                  <div key={nut} className={`nut-card ${isDisabled ? 'nut-disabled' : supported ? 'supported' : 'unsupported'}`} onClick={() => setSelectedNut(nut)}>
                    <div className={`nut-icon ${isDisabled ? 'nut-disabled' : supported ? 'supported' : 'unsupported'}`}>
                      {NUT_ICONS[nut] ?? (isDisabled ? '!' : supported ? '●' : '○')}
                    </div>
                    <div className="nut-info">
                      <div className="nut-name">{nut}</div>
                      <div className="nut-desc">{isDisabled ? 'Disabled by operator' : meta?.short ?? ''}</div>
                    </div>
                    <span className="nut-check" style={{ color: isDisabled ? '#ffa500' : supported ? 'var(--accent)' : 'var(--text3)' }}>
                      {isDisabled ? '!' : supported ? '✓' : '–'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {(() => {
            const nut4 = (data.info?.nuts?.['4'] ?? knownMint?.nutsLimits?.['4']) as NutConfig | null | undefined
            const nut5 = (data.info?.nuts?.['5'] ?? knownMint?.nutsLimits?.['5']) as NutConfig | null | undefined
            const hasAnyLimits =
              nut4?.methods?.some(m => m.min_amount != null || m.max_amount != null) ||
              nut5?.methods?.some(m => m.min_amount != null || m.max_amount != null)
            const renderLimits = (cfg: NutConfig | null | undefined) => {
              if (!cfg?.methods?.length) return <span style={{fontSize:11,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>—</span>
              return cfg.methods.map((m, i) => (
                <span key={i} style={{fontSize:11,color:'var(--text)',fontFamily:'var(--font-mono)'}}>
                  {m.min_amount != null ? m.min_amount.toLocaleString() : '—'}
                  {' – '}
                  {m.max_amount != null ? m.max_amount.toLocaleString() : '—'} sat
                  {cfg.methods && i < cfg.methods.length - 1 ? ', ' : ''}
                </span>
              ))
            }
            return (
              <div className="md-panel">
                <div className="md-panel-title">NUT Limits</div>
                {!hasAnyLimits ? (
                  <div style={{fontSize:11,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>Limits not specified by this mint.</div>
                ) : (
                  <div style={{display:'flex',flexDirection:'column',gap:0}}>
                    <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'0 12px',marginBottom:4}}>
                      <span style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'0.08em'}}>NUT</span>
                      <span style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'0.08em'}}>Min – Max</span>
                    </div>
                    {[{ key: 'NUT-04 (Minting)', cfg: nut4 }, { key: 'NUT-05 (Melting)', cfg: nut5 }].map(({ key, cfg }) => (
                      <div key={key} style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'0 12px',padding:'5px 0',borderBottom:'0.5px solid var(--border)',alignItems:'center'}}>
                        <span style={{fontSize:11,fontWeight:600,color:'var(--text2)',fontFamily:'var(--font-mono)',whiteSpace:'nowrap'}}>{key}</span>
                        <div>{renderLimits(cfg)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
          </>)}

          {activeTab === 'history' && (<>
            <div className="md-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div className="md-panel-title" style={{ marginBottom: 0 }}>Historical data</div>
              <div style={{ display: 'flex', background: 'var(--bg3)', borderRadius: 6, padding: 2, gap: 1 }}>
                {(['24h', '7d', '30d', '90d'] as const).map(iv => (
                  <button
                    key={iv}
                    onClick={() => setChartInterval(iv)}
                    style={{
                      background: chartInterval === iv ? 'var(--accent)' : 'transparent',
                      color: chartInterval === iv ? 'var(--bg)' : 'var(--text2)',
                      border: 'none', borderRadius: 4, padding: '2px 8px',
                      fontSize: 10, fontFamily: 'var(--font-mono)',
                      cursor: 'pointer', fontWeight: chartInterval === iv ? 700 : 400,
                    }}
                  >{iv}</button>
                ))}
              </div>
            </div>

            {/* Summary metric cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
              {[
                { label: 'Avg Latency', value: chartAvgLatency !== null ? `${chartAvgLatency}ms` : '—', delta: deltaStr(chartAvgLatency, chartPrevLatency, 'ms'), color: 'var(--text)' },
                { label: 'Avg Uptime', value: chartAvgUptime !== null ? `${chartAvgUptime}%` : '—', delta: deltaStr(chartAvgUptime, chartPrevUptime, '%'), color: '#4ade80' },
                { label: 'Avg Trust', value: `${trustScore}%`, delta: null, color: tsInfo.color },
              ].map(({ label, value, delta, color }) => (
                <div key={label} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, fontFamily: 'var(--font-mono)' }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{value}</div>
                  {delta && <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>{delta}</div>}
                </div>
              ))}
            </div>

            {/* Tab switcher */}
            <div style={{ display: 'flex', gap: 2, marginBottom: 10, background: 'var(--bg3)', borderRadius: 6, padding: 2, width: 'fit-content' }}>
              {([['latency', 'Latency'], ['uptime', 'Uptime'], ['trust', 'Trust Score']] as const).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setChartMetric(m)}
                  style={{
                    background: chartMetric === m ? 'var(--bg2)' : 'transparent',
                    border: chartMetric === m ? '1px solid var(--border2)' : '1px solid transparent',
                    borderRadius: 5, padding: '3px 10px',
                    fontSize: 10.5, fontFamily: 'var(--font-mono)',
                    color: chartMetric === m ? 'var(--text)' : 'var(--text3)',
                    cursor: 'pointer',
                  }}
                >{label}</button>
              ))}
            </div>

            {/* Line chart */}
            {histLineData.length > 0 ? (
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={histLineData} margin={{ top: 4, right: 4, left: 10, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9, fill: 'var(--text3)' }}
                    axisLine={false} tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'var(--text3)' }}
                    axisLine={false} tickLine={false}
                    width={60}
                    domain={chartMetric === 'latency'
                    ? [(min: number) => Math.round(min * 0.95), (max: number) => Math.round(max * 1.05)]
                    : [0, 100]}
                    tickFormatter={(v: number) => chartMetric === 'latency' ? `${v}ms` : `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                    formatter={(value) => [chartMetric === 'latency' ? `${String(value)}ms` : `${String(value)}%`, chartMetric === 'latency' ? 'Latency' : chartMetric === 'uptime' ? 'Uptime' : 'Trust Score']}
                  />
                  <Line
                    type="monotone"
                    dataKey={chartMetric}
                    stroke={chartMetric === 'latency' ? '#B4B2A9' : chartMetric === 'uptime' ? '#4ade80' : '#ffa500'}
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0 }}>Žiadne historické dáta pre toto obdobie.</p>
            )}
          </div>

          <div className="md-panel">
            <div className="md-panel-title">Version history</div>
            {!versionHistory || versionHistory.length === 0 ? (
              <div style={{fontSize:12,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>No version history available.</div>
            ) : (
              <>
                <div style={{display:'grid',gridTemplateColumns:'auto 1fr 1fr',gap:'0 12px',marginBottom:4}}>
                  <span style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'0.08em'}}>Date</span>
                  <span style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'0.08em'}}>From</span>
                  <span style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'0.08em'}}>To</span>
                </div>
                {versionHistory.map((vh, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '0 12px',
                    padding: '4px 0',
                    borderBottom: i < versionHistory.length - 1 ? '0.5px solid var(--border)' : 'none',
                    alignItems: 'center',
                  }}>
                    <span style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--font-mono)',whiteSpace:'nowrap'}}>
                      {new Date(vh.firstSeenAt).toLocaleDateString()}
                    </span>
                    <span style={{fontSize:11,color:'var(--text2)',fontFamily:'var(--font-mono)'}}>
                      {versionHistory[i + 1]?.version ?? '—'}
                    </span>
                    <span style={{fontSize:11,color:'var(--text)',fontFamily:'var(--font-mono)',fontWeight:500}}>
                      {vh.version}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
          </>)}

          {activeTab === 'audit' && (
            knownMint !== null && knownMint.auditNMints !== null ? (
              <div className="md-panel md-audit-collapsible" style={{background:'var(--bg)'}}>
                <button
                  className="md-audit-toggle"
                  onClick={() => setAuditExpanded(v => !v)}
                  aria-expanded={auditExpanded}
                >
                  <div style={{display:'flex',alignItems:'baseline',gap:6}}>
                    <span className="md-panel-title" style={{marginBottom:0}}>Audit stats</span>
                    <span style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>· via audit.8333.space</span>
                  </div>
                  <span className="md-audit-chevron">
                    {auditExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>
                <div className={`md-audit-content${auditExpanded ? ' expanded' : ''}`}>
                <div className="audit-stats-grid">
                  <div className="audit-stat-card">
                    <div className="audit-stat-value" style={{color:'#4ade80'}}>{(knownMint.auditNMints ?? 0).toLocaleString()}</div>
                    <div className="audit-stat-label">
                      Mint ops
                      <span style={{position:'relative',display:'inline-flex',marginLeft:3}}
                        onMouseEnter={() => setAuditTooltip('mints')}
                        onMouseLeave={() => setAuditTooltip(null)}
                        onClick={() => setAuditTooltip(auditTooltip === 'mints' ? null : 'mints')}
                      >
                        <Info size={11} color="#6b7280" style={{cursor:'help'}} />
                        {auditTooltip === 'mints' && (
                          <div className="audit-tooltip" style={{left:'50%',transform:'translateX(-50%)'}}>
                            Number of successful ecash minting operations. The auditor actively creates ecash tokens to verify the mint works correctly.
                          </div>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="audit-stat-card">
                    <div className="audit-stat-value" style={{color:'#4ade80'}}>{(knownMint.auditNMelts ?? 0).toLocaleString()}</div>
                    <div className="audit-stat-label">
                      Melt ops
                      <span style={{position:'relative',display:'inline-flex',marginLeft:3}}
                        onMouseEnter={() => setAuditTooltip('melts')}
                        onMouseLeave={() => setAuditTooltip(null)}
                        onClick={() => setAuditTooltip(auditTooltip === 'melts' ? null : 'melts')}
                      >
                        <Info size={11} color="#6b7280" style={{cursor:'help'}} />
                        {auditTooltip === 'melts' && (
                          <div className="audit-tooltip" style={{left:'50%',transform:'translateX(-50%)'}}>
                            Number of successful ecash melting operations. The auditor redeems ecash back to Lightning to verify withdrawals work.
                          </div>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="audit-stat-card">
                    <div className="audit-stat-value" style={{color: (knownMint.auditNErrors ?? 0) > 0 ? '#ff4d4d' : '#4ade80'}}>{(knownMint.auditNErrors ?? 0).toLocaleString()}</div>
                    <div className="audit-stat-label">
                      Errors
                      <span style={{position:'relative',display:'inline-flex',marginLeft:3}}
                        onMouseEnter={() => setAuditTooltip('errors')}
                        onMouseLeave={() => setAuditTooltip(null)}
                        onClick={() => setAuditTooltip(auditTooltip === 'errors' ? null : 'errors')}
                      >
                        <Info size={11} color="#6b7280" style={{cursor:'help'}} />
                        {auditTooltip === 'errors' && (
                          <div className="audit-tooltip" style={{left:'50%',transform:'translateX(-50%)'}}>
                            Number of failed mint or melt operations detected by the auditor. Higher error count indicates reliability issues.
                          </div>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
                {knownMint.auditCheckedAt ? (
                  <div style={{fontSize:9,color:'var(--text3)',marginTop:10,fontFamily:'var(--font-mono)'}}>
                    Last checked {new Date(knownMint.auditCheckedAt).toLocaleDateString()}
                  </div>
                ) : null}
                </div>
              </div>
            ) : (
              <div className="md-panel">
                <div className="md-panel-title">Audit stats</div>
                <div style={{fontSize:12,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>No audit data available for this mint.</div>
              </div>
            )
          )}

          {activeTab === 'reviews' && (
            <div className="md-panel">
              <div className="md-panel-title">Reviews</div>
              <div className="reviews-header">
                <div>
                  {avgRating !== null ? (
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <span className="reviews-avg">{avgRating}</span>
                      <span className="reviews-stars">
                        {'★'.repeat(Math.round(avgRating))}{'☆'.repeat(5-Math.round(avgRating))}
                      </span>
                    </div>
                  ) : (
                    <span style={{fontSize:12,color:'var(--text3)'}}>No reviews yet</span>
                  )}
                  {reviews.length > 0 && (
                    <span className="reviews-count">{reviews.length} review{reviews.length !== 1 ? 's' : ''} · via NIP-87</span>
                  )}
                </div>
                {isLoggedIn && (
                  <button className="reviews-write-btn" onClick={() => setShowReviewModal(true)}>
                    Write review
                  </button>
                )}
              </div>
              {reviewsLoading ? (
                <div style={{fontSize:11,color:'var(--text3)',marginTop:8}}>Loading reviews...</div>
              ) : mergedReviews.length > 0 ? (
                <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:8}}>
                  {mergedReviews.slice(0,5).map(r => (
                    <div key={r.id} style={{background:'var(--bg3)',border:'0.5px solid var(--border)',borderRadius:8,padding:'8px 10px'}}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                        <span style={{color:'var(--yellow)',fontSize:12}}>{'★'.repeat(r.rating)}{'☆'.repeat(5-r.rating)}</span>
                        <div style={{display:'flex',alignItems:'center',gap:5}}>
                          {r.source === 'nostr' ? (
                            <span style={{display:'inline-flex',alignItems:'center',gap:2,fontSize:9,fontFamily:'var(--font-mono)',fontWeight:600,color:'#8b5cf6',background:'rgba(139,92,246,0.1)',border:'0.5px solid rgba(139,92,246,0.3)',borderRadius:4,padding:'1px 5px'}}>
                              <Zap size={8} />Nostr
                            </span>
                          ) : (
                            <span style={{fontSize:9,fontFamily:'var(--font-mono)',fontWeight:600,color:'#17E87F',background:'rgba(23,232,127,0.1)',border:'0.5px solid rgba(23,232,127,0.3)',borderRadius:4,padding:'1px 5px'}}>
                              MintRadar
                            </span>
                          )}
                          <span style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>
                            {r.pubkey.slice(0,8)}…
                          </span>
                        </div>
                      </div>
                      {r.comment && <p style={{fontSize:11,color:'var(--text2)',lineHeight:1.5,margin:0}}>{r.comment}</p>}
                    </div>
                  ))}
                  {mergedReviews.length > 5 && (
                    <div style={{fontSize:11,color:'var(--text3)',textAlign:'center'}}>{mergedReviews.length - 5} more reviews</div>
                  )}
                </div>
              ) : (
                <div style={{fontSize:11,color:'var(--text3)',marginTop:8}}>
                  {isLoggedIn ? 'No reviews yet. Be the first to write one!' : 'No reviews yet. Login with Nostr to write one.'}
                </div>
              )}
            </div>
          )}

        </div>

        <div className="md-right">

          {(() => {
            const knownMintLoading = knownMintsData === undefined
            const tabs: Array<{ id: '24h' | '7d' | '30d'; label: string; disabled: boolean }> = [
              { id: '24h', label: '24h', disabled: false },
              { id: '7d',  label: '7d',  disabled: knownMintLoading || isLessThan7dOld },
              { id: '30d', label: '30d', disabled: knownMintLoading || isLessThan30dOld },
            ]

            function segColor(pct: number | null): string {
              if (pct === null) return '#374151'
              if (pct === 100) return '#4ade80'
              if (pct >= 50)   return '#fb923c'
              return '#f87171'
            }

            function latencyBadgeColor(ms: number | null): string {
              if (ms === null) return 'var(--text3)'
              if (ms < 300) return '#4ade80'
              if (ms < 800) return '#fb923c'
              return '#f87171'
            }

            function formatBucket(bucket: string): string {
              const d = new Date(bucket)
              if (historyPeriod === '24h') {
                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
              }
              return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
            }

            const startLabel = (() => {
              if (historyPeriod === '24h') return '24h ago'
              if (historyPeriod === '7d') return '7d ago'
              if (knownMintLoading) return '…'
              if (discoveredAt) {
                const d = new Date(discoveredAt)
                return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
              }
              return '30d ago'
            })()

            // Fill full expected time range so missing buckets appear as gray bars
            const barBucketMs = historyPeriod === '24h' ? 3_600_000 : 86_400_000
            const barSlotCount = historyPeriod === '24h' ? 24 : historyPeriod === '7d' ? 7 : 30
            const barCurrentBucketMs = Math.floor(Date.now() / barBucketMs) * barBucketMs
            const barKeyLen = historyPeriod === '24h' ? 13 : 10
            const barSegMap = new Map(segments.map(s => [s.bucket.slice(0, barKeyLen), s]))
            const displaySegments = (historyData !== undefined && segments.length > 0)
              ? Array.from({ length: barSlotCount }, (_, i) => {
                  const slotMs = barCurrentBucketMs - (barSlotCount - 1 - i) * barBucketMs
                  const iso = new Date(slotMs).toISOString()
                  return barSegMap.get(iso.slice(0, barKeyLen)) ?? {
                    bucket: iso, online: false, latencyMs: null, total: 0, onlineCount: 0, uptimePct: null,
                  }
                })
              : segments

            return (
              <div className="md-panel">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <div className="md-panel-title" style={{marginBottom:0}}>Mint History</div>
                  <div style={{display:'flex',background:'var(--bg3)',borderRadius:6,padding:2,gap:1}}>
                    {tabs.map(tab => (
                      <button
                        key={tab.id}
                        disabled={tab.disabled}
                        onClick={() => { if (!tab.disabled) setHistoryPeriod(tab.id) }}
                        style={{
                          background: historyPeriod === tab.id ? 'var(--accent)' : 'transparent',
                          color: historyPeriod === tab.id ? 'var(--bg)' : tab.disabled ? 'var(--text3)' : 'var(--text2)',
                          border: 'none',
                          borderRadius: 4,
                          padding: '2px 8px',
                          fontSize: 10,
                          fontFamily: 'var(--font-mono)',
                          cursor: tab.disabled ? 'not-allowed' : 'pointer',
                          opacity: tab.disabled ? 0.4 : 1,
                          transition: 'all 150ms ease',
                          fontWeight: historyPeriod === tab.id ? 700 : 400,
                        }}
                      >{tab.label}</button>
                    ))}
                  </div>
                </div>

                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:20,fontWeight:600,color: displayUptimePct !== null ? segColor(displayUptimePct) : 'var(--text3)',fontFamily:'var(--font-mono)',letterSpacing:'-0.03em',lineHeight:1}}>
                      {displayUptimePct !== null ? `${displayUptimePct}%` : '—'}
                    </span>
                    {uptimeTrend !== null && (
                      <span style={{fontSize:10,color: uptimeTrend >= 0 ? '#4ade80' : '#f87171',fontFamily:'var(--font-mono)'}}>
                        {uptimeTrend >= 0 ? `↑+${uptimeTrend}%` : `↓${uptimeTrend}%`}
                      </span>
                    )}
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>Avg. latency</span>
                    <span style={{
                      fontSize:10,fontFamily:'var(--font-mono)',
                      color: 'var(--text)',
                      background: apiAvgLatency !== null ? `${latencyBadgeColor(apiAvgLatency)}18` : 'var(--bg3)',
                      border: `0.5px solid ${apiAvgLatency !== null ? latencyBadgeColor(apiAvgLatency) : 'var(--border)'}40`,
                      borderRadius:4,padding:'1px 6px',
                    }}>
                      {apiAvgLatency !== null ? `${apiAvgLatency}ms` : '—'}
                    </span>
                  </div>
                </div>

                <div style={{position:'relative',paddingBottom:6}}>
                  <div style={{display:'flex',gap:2}}>
                    {displaySegments.map((seg, i) => (
                      <div
                        key={i}
                        style={{flex:1,height:20,background:segColor(seg.uptimePct),borderRadius:2,cursor:'default'}}
                        onMouseEnter={() => setSegmentTooltip(i)}
                        onMouseLeave={() => setSegmentTooltip(null)}
                      />
                    ))}
                    {displaySegments.length === 0 && (
                      <div style={{flex:1,height:20,background:'var(--bg3)',borderRadius:2,display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <span style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>No data available for this period</span>
                      </div>
                    )}
                    {segmentTooltip !== null && displaySegments[segmentTooltip] !== undefined && (() => {
                      const seg = displaySegments[segmentTooltip]!
                      const leftPct = Math.min(Math.max((segmentTooltip + 0.5) / displaySegments.length * 100, 10), 90)
                      return (
                        <div style={{position:'absolute',bottom:'calc(100% + 6px)',left:`${leftPct}%`,transform:'translateX(-50%)',background:'var(--bg2)',border:'0.5px solid var(--border2)',borderRadius:6,padding:'4px 8px',fontSize:10,whiteSpace:'nowrap',fontFamily:'var(--font-mono)',zIndex:10,pointerEvents:'none'}}>
                          <div style={{color:'var(--text2)'}}>{formatBucket(seg.bucket)}</div>
                          <div style={{color:segColor(seg.uptimePct)}}>
                            {seg.uptimePct !== null ? `${seg.uptimePct}% uptime` : 'No data'}
                          </div>
                          {seg.latencyMs !== null && (
                            <div style={{color:'var(--text3)'}}>{seg.latencyMs}ms latency</div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontSize:9,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>
                    <span>{startLabel}</span>
                    <span>Now</span>
                  </div>
                  <div style={{display:'flex',gap:10,marginTop:6,flexWrap:'wrap'}}>
                    {([{color:'#4ade80',label:'100%'},{color:'#fb923c',label:'50–99%'},{color:'#f87171',label:'<50%'}] as const).map(({color,label}) => (
                      <div key={label} style={{display:'flex',alignItems:'center',gap:3}}>
                        <div style={{width:8,height:8,background:color,borderRadius:1}}/>
                        <span style={{fontSize:9,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })()}

          <div className="md-panel">
            <div className="md-panel-title">Trust Score</div>
            <div className="trust-wrap" style={{cursor:'pointer'}} onClick={() => setShowTrustBreakdown(true)} title="Click for breakdown">
              <div className="gauge-wrap">
                <svg viewBox="0 0 72 72">
                  <circle cx="36" cy="36" r="27" fill="none" stroke="var(--bg3)" strokeWidth="7" />
                  <circle cx="36" cy="36" r="27" fill="none" stroke={trustScoreColor(trustScore)} strokeWidth="7"
                    strokeDasharray={`${(trustScore * 1.696).toFixed(1)} 169.6`}
                    strokeDashoffset="42.4"
                    strokeLinecap="round"
                    transform="rotate(-90 36 36)" />
                </svg>
                <div className="gauge-num" style={{ color: trustScoreColor(trustScore) }}>{trustScore}%</div>
              </div>
              <span style={{fontSize:9,fontFamily:'var(--font-mono)',fontWeight:600,color:tsInfo.color,background:tsInfo.bg,border:`0.5px solid ${tsInfo.border}`,borderRadius:4,padding:'1px 6px',textAlign:'center'}}>{tsInfo.label}</span>
              <div className="trust-info">
                <div className="trust-row">
                  <span className="trust-label">Uptime</span>
                  <span className="trust-value" style={{ color: uptimeColor(uptimePct) }}>{uptimePct}%</span>
                </div>
                <div className="trust-row">
                  <span className="trust-label">NUTs</span>
                  <span className="trust-value">{supportedNuts.length}/{ALL_NUTS.length}</span>
                </div>
                <div className="trust-row">
                  <span className="trust-label">Version</span>
                  <span className="trust-value" style={{ fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{version ?? '—'}</span>
                </div>
                <div className="trust-row">
                  <span className="trust-label">Audit</span>
                  <span className="trust-value">
                    {knownMint?.auditNMints !== null && knownMint?.auditNMints !== undefined
                      ? `${auditReliabilityScore(knownMint.auditNMints, knownMint.auditNMelts ?? null, knownMint.auditNErrors ?? null)}/5`
                      : '—'}
                  </span>
                </div>
              </div>
              <div style={{fontSize:9,color:'var(--text3)',textAlign:'center'}}>tap for details</div>
            </div>
          </div>

          <div className="md-panel">
            <div className="md-panel-title">Add to Wallet</div>
            <p style={{fontSize:12, color:'var(--text3)', marginBottom:12, lineHeight:1.5}}>
              Copy the mint URL to add it to your Cashu wallet app.
            </p>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(url)
                setCopiedUrl(true)
                setTimeout(() => setCopiedUrl(false), 2000)
              }}
              style={{
                width: '100%', background: copiedUrl ? '#0d2018' : 'var(--accent)',
                color: copiedUrl ? 'var(--accent)' : 'var(--bg)',
                border: copiedUrl ? '0.5px solid #1a3a28' : 'none',
                borderRadius: 8, padding: '10px 16px',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'var(--font-body)', marginBottom: 8,
                transition: 'all 150ms ease',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {copiedUrl ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy Mint URL</>}
            </button>
            <a
              href={`https://wallet.cashu.me/?mint=${encodeURIComponent(url)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                width: '100%', background: 'var(--bg3)',
                color: 'var(--text2)',
                border: '0.5px solid var(--border)',
                borderRadius: 8, padding: '9px 16px',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'var(--font-body)', marginBottom: 8,
                textDecoration: 'none', boxSizing: 'border-box',
                transition: 'border-color 150ms ease',
              }}
            >
              ↗ Open in Cashu.me
            </a>
            <button
              onClick={() => setShowQr(!showQr)}
              style={{
                background: 'none', border: 'none', padding: '4px 0',
                cursor: 'pointer', color: 'var(--text3)', fontSize: 12,
                textDecoration: 'underline', fontFamily: 'var(--font-body)',
                display: 'block', width: '100%', textAlign: 'center',
              }}
            >
              {showQr ? 'Hide QR Code' : 'Show QR Code'}
            </button>
            {showQr && (
              <div style={{marginTop: 12, display: 'flex', justifyContent: 'center'}}>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}&bgcolor=111318&color=4ade80&qzone=2`}
                  alt="QR Code"
                  style={{borderRadius: 8, width: 160, height: 160}}
                />
              </div>
            )}
          </div>

        </div>
      </div>

      {showTrustBreakdown && (
        <div style={{position:'fixed',inset:0,zIndex:100,background:'rgba(0,0,0,0.7)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}
          onClick={() => setShowTrustBreakdown(false)}>
          <div style={{background:'var(--bg2)',border:'0.5px solid var(--border2)',borderRadius:14,padding:'24px',maxWidth:380,width:'100%'}}
            onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:600,color:'var(--text)'}}>Trust Score Breakdown</div>
              <button onClick={() => setShowTrustBreakdown(false)} style={{background:'none',border:'none',color:'var(--text3)',fontSize:18,cursor:'pointer'}}>×</button>
            </div>
            <div style={{textAlign:'center',marginBottom:20}}>
              <div style={{fontSize:48,fontWeight:700,color:trustScoreColor(trustScore),lineHeight:1}}>{trustScore}%</div>
              <div style={{marginTop:8,display:'flex',justifyContent:'center'}}>
                <span style={{fontSize:11,fontFamily:'var(--font-mono)',fontWeight:600,color:tsInfo.color,background:tsInfo.bg,border:`0.5px solid ${tsInfo.border}`,borderRadius:5,padding:'2px 8px'}}>{tsInfo.label}</span>
              </div>
            </div>
            {(() => {
              const uScore = Math.round(uptimePct * 0.45)
              const nScore = Math.round(Math.min(supportedNuts.length / ALL_NUTS.length, 1) * 30)
              const vScore = Math.round(versionFreshnessScore(version) / 10 * 15)
              const contactFields = [email, twitter, nostr, website].filter(Boolean)
              const cScore = Math.round((contactFields.length / 4) * 5)
              const contactDisplay = contactFields.length === 0 ? 'None' : (email ? 'Email' : '') + (twitter ? (email ? ' + Twitter' : 'Twitter') : '') + (nostr ? ((email || twitter) ? ' + Nostr' : 'Nostr') : '') + (website ? ((email || twitter || nostr) ? ' + Web' : 'Web') : '')
              const auditNMints = knownMint?.auditNMints ?? null
              const auditNMelts = knownMint?.auditNMelts ?? null
              const auditNErrors = knownMint?.auditNErrors ?? null
              const aScore = auditReliabilityScore(auditNMints, auditNMelts, auditNErrors)
              const auditTotal = (auditNMints ?? 0) + (auditNMelts ?? 0) + (auditNErrors ?? 0)
              const auditDisplay = auditNMints === null ? '—' : auditTotal === 0 ? '0%' : `${((auditNErrors ?? 0) / auditTotal * 100).toFixed(1)}% err`
              const rows = [
                { label: 'Uptime (45%)', display: `${uptimePct}%`, score: uScore, max: 45, color: uptimeColor(uptimePct), tooltip: 'Percentage of successful checks over the last 24h. 100% uptime = full points.' },
                { label: 'NUT Support (30%)', display: `${supportedNuts.length} / ${ALL_NUTS.length} NUTs`, score: nScore, max: 30, color: supportedNuts.length >= 12 ? '#4ade80' : supportedNuts.length >= 8 ? '#ffa500' : '#ff4d4d', tooltip: 'Number of NUT specifications (cashu protocol features) this mint supports out of all tracked NUTs.' },
                { label: 'Version (15%)', display: version ?? 'Unknown', score: vScore, max: 15, color: vScore >= 12 ? '#4ade80' : vScore >= 6 ? '#ffa500' : '#ff4d4d', tooltip: "How recent the mint's software version is compared to the latest known Nutshell releases. Newer = higher score." },
                { label: 'Contact (5%)', display: contactDisplay, score: cScore, max: 5, color: cScore >= 4 ? '#4ade80' : cScore >= 2 ? '#ffa500' : '#ff4d4d', tooltip: 'Number of contact methods provided (email, Twitter, Nostr, website). More contact options = higher score.' },
                { label: 'Audit reliability (5%)', display: auditDisplay, score: aScore, max: 5, color: aScore >= 4 ? '#4ade80' : aScore >= 3 ? '#ffa500' : '#ff4d4d', tooltip: 'Based on error rate from audit.8333.space — the percentage of failed mint/melt operations out of all tested operations. Lower error rate = higher score.' },
              ]
              return rows.map(row => (
                <div key={row.label} style={{marginBottom:14}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                    <span style={{fontSize:12,color:'var(--text2)',display:'flex',alignItems:'center',gap:4}}>
                      {row.label}
                      <span style={{position:'relative',display:'inline-flex'}}
                        onMouseEnter={() => setBreakdownTooltip(row.label)}
                        onMouseLeave={() => setBreakdownTooltip(null)}
                        onClick={e => { e.stopPropagation(); setBreakdownTooltip(breakdownTooltip === row.label ? null : row.label) }}
                      >
                        <Info size={11} color="#6b7280" style={{flexShrink:0,cursor:'help'}} />
                        {breakdownTooltip === row.label && (
                          <div className="audit-tooltip" style={{width:220,left:'50%',transform:'translateX(-50%)'}}>{row.tooltip}</div>
                        )}
                      </span>
                    </span>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:11,color:'var(--text3)',fontFamily:'var(--font-mono)',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{row.display}</span>
                      <span style={{fontSize:13,fontWeight:600,color:row.color}}>{row.score}/{row.max}</span>
                    </div>
                  </div>
                  <div style={{height:4,background:'var(--bg3)',borderRadius:2,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${(row.score/row.max)*100}%`,background:row.color,borderRadius:2,transition:'width 0.3s ease'}}/>
                  </div>
                </div>
              ))
            })()}
            <div style={{borderTop:'0.5px solid var(--border)',paddingTop:12,marginTop:4,fontSize:10,color:'var(--text3)',lineHeight:1.6}}>
              Score = Uptime×45% + NUT support×30% + Version×15% + Contact×5% + Audit×5%
            </div>
          </div>
        </div>
      )}

      {showReviewModal && (
        <div style={{position:'fixed',inset:0,zIndex:100,background:'rgba(0,0,0,0.7)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}
          onClick={() => setShowReviewModal(false)}>
          <div style={{background:'var(--bg2)',border:'0.5px solid var(--border2)',borderRadius:14,padding:'24px',maxWidth:400,width:'100%'}}
            onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:600,color:'var(--text)'}}>Write a review</div>
              <button onClick={() => setShowReviewModal(false)} style={{background:'none',border:'none',color:'var(--text3)',fontSize:18,cursor:'pointer'}}>×</button>
            </div>

            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}}>Rating</div>
              <div style={{display:'flex',gap:6}}>
                {[1,2,3,4,5].map(star => (
                  <button key={star} onClick={() => setReviewRating(star)}
                    style={{background:'none',border:'none',cursor:'pointer',fontSize:24,color: star <= reviewRating ? 'var(--yellow)' : 'var(--border2)',padding:'0 2px'}}>
                    ★
                  </button>
                ))}
              </div>
            </div>

            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}}>Comment (optional)</div>
              <textarea
                value={reviewComment}
                onChange={e => setReviewComment(e.target.value)}
                placeholder="Share your experience with this mint..."
                maxLength={500}
                rows={3}
                style={{width:'100%',background:'var(--bg3)',border:'0.5px solid var(--border)',borderRadius:8,padding:'8px 12px',color:'var(--text)',fontSize:12,outline:'none',fontFamily:'var(--font-body)',resize:'vertical',boxSizing:'border-box'}}
              />
              <div style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--font-mono)',textAlign:'right',marginTop:4}}>
                {reviewComment.length} / 500 characters
              </div>
            </div>

            {reviewError !== null && <div style={{fontSize:11,color:'var(--red)',marginBottom:10}}>{reviewError}</div>}
            {reviewSuccess && <div style={{fontSize:11,color:'var(--accent)',marginBottom:10}}>✓ Review published!</div>}

            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={() => setShowReviewModal(false)}
                style={{background:'transparent',border:'0.5px solid var(--border)',borderRadius:8,padding:'8px 16px',color:'var(--text3)',fontSize:13,cursor:'pointer',fontFamily:'var(--font-body)'}}>
                Cancel
              </button>
              <button
                disabled={reviewSubmitting}
                onClick={() => {
                  void (async () => {
                    setReviewSubmitting(true)
                    setReviewError(null)
                    try {
                      await submitMintReview(url, reviewRating, reviewComment)
                      setReviewSuccess(true)
                      setTimeout(() => { setShowReviewModal(false); setReviewSuccess(false); setReviewComment(''); setReviewRating(5) }, 1500)
                    } catch (err) {
                      setReviewError(err instanceof Error ? err.message : 'Failed to publish review')
                    } finally {
                      setReviewSubmitting(false)
                    }
                  })()
                }}
                style={{background:'var(--accent)',color:'var(--bg)',border:'none',borderRadius:8,padding:'8px 18px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'var(--font-body)',opacity:reviewSubmitting ? 0.6 : 1}}>
                {reviewSubmitting ? 'Publishing...' : 'Publish review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedNut && (() => {
        const meta = NUT_DESCRIPTIONS[selectedNut]
        const supported = supportedNuts.includes(selectedNut)
        const nutKey = parseInt(selectedNut.slice(4), 10).toString()
        const rawNutConfig = data.info?.nuts?.[nutKey] ?? knownMint?.nutsLimits?.[nutKey]
        const nutConfig = (rawNutConfig !== null && typeof rawNutConfig === 'object') ? rawNutConfig as NutConfig : null
        const isNutDisabled = supported && nutConfig?.disabled === true
        return (
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 100,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '20px',
            }}
            onClick={() => setSelectedNut(null)}
          >
            <div
              style={{
                background: 'var(--bg2)', border: '0.5px solid var(--border2)',
                borderRadius: 14, padding: '24px', maxWidth: 420, width: '100%',
                boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 16}}>
                <div>
                  <div style={{fontSize: 18, fontWeight: 600, color: supported ? 'var(--accent)' : 'var(--text2)'}}>
                    {meta?.short ?? selectedNut}
                  </div>
                  <div style={{fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginTop: 2}}>
                    {selectedNut}
                  </div>
                </div>
                <div style={{display:'flex', alignItems:'center', gap: 8}}>
                  <span style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 6,
                    background: isNutDisabled ? 'rgba(255,165,0,0.1)' : supported ? '#0d2018' : 'var(--bg3)',
                    color: isNutDisabled ? '#ffa500' : supported ? 'var(--accent)' : 'var(--text3)',
                    border: `0.5px solid ${isNutDisabled ? 'rgba(255,165,0,0.3)' : supported ? '#1a3a28' : 'var(--border)'}`,
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {isNutDisabled ? '⊘ Disabled by operator' : supported ? '✓ Supported' : '– Not supported'}
                  </span>
                  <button
                    onClick={() => setSelectedNut(null)}
                    style={{background:'none', border:'none', color:'var(--text3)', fontSize:18, cursor:'pointer', lineHeight:1}}
                  >×</button>
                </div>
              </div>

              <p style={{fontSize: 13, color: 'var(--text2)', marginBottom: 14, lineHeight: 1.6}}>
                {meta?.desc}
              </p>

              {meta?.features && (
                <div style={{marginBottom: 14}}>
                  <div style={{fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8}}>Features</div>
                  <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                    {meta.features.map(f => (
                      <span key={f} style={{
                        fontSize: 11, padding: '3px 9px', borderRadius: 6,
                        background: 'var(--bg3)', border: '0.5px solid var(--border)',
                        color: 'var(--text2)',
                      }}>
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {meta?.useCase && (
                <div style={{
                  borderTop: '0.5px solid var(--border)', paddingTop: 12, marginTop: 4,
                }}>
                  <div style={{fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6}}>Use case</div>
                  <p style={{fontSize: 12, color: 'var(--text3)', lineHeight: 1.5}}>{meta.useCase}</p>
                </div>
              )}

              {nutConfig?.methods && nutConfig.methods.length > 0 && (
                <div style={{borderTop: '0.5px solid var(--border)', paddingTop: 12, marginTop: 4}}>
                  <div style={{fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8}}>Limits</div>
                  {nutConfig.methods.map((m, i) => (
                    <div key={i} style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5}}>
                      <span style={{fontSize:11, color:'var(--text2)', fontFamily:'var(--font-mono)'}}>
                        {m.method} / {m.unit}
                      </span>
                      <span style={{fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)'}}>
                        {m.min_amount != null ? m.min_amount.toLocaleString() : '—'}
                        {' – '}
                        {m.max_amount != null ? m.max_amount.toLocaleString() : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <a
                href={`https://github.com/cashubtc/nuts/blob/main/${parseInt(selectedNut.replace('NUT-', ''), 10).toString().padStart(2, '0')}.md`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  marginTop: 16, fontSize: 11, color: 'var(--accent)',
                  textDecoration: 'none',
                }}
              >
                ↗ View NUT spec on GitHub
              </a>
            </div>
          </div>
        )
      })()}

      {showComparePicker && (() => {
        const q = comparePickerSearch.toLowerCase()
        const otherMints = (knownMintsData ?? []).filter(m =>
          m.url !== url &&
          (q === '' || (m.name ?? m.url).toLowerCase().includes(q) || m.url.toLowerCase().includes(q))
        )
        const comparedMints = [
          ...(knownMintsData?.filter(m => m.url === url) ?? []),
          ...(knownMintsData?.filter(m => comparePickerSelected.has(m.url)) ?? []),
        ]
        return (
          <div className="cmp-overlay" onClick={() => setShowComparePicker(false)}>
            <div className="md-picker-modal" onClick={e => e.stopPropagation()}>
              <div className="md-picker-header">
                <div style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>Compare with...</div>
                <button onClick={() => setShowComparePicker(false)} style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',fontSize:18}}>×</button>
              </div>
              <div style={{padding:'8px 16px 0'}}>
                <div style={{fontSize:11,color:'var(--text3)',marginBottom:8}}>
                  Select 1–3 mints to compare with <strong style={{color:'var(--text)'}}>{knownMintsData?.find(m => m.url === url)?.name ?? url}</strong>
                </div>
                <input
                  className="md-picker-search"
                  type="text"
                  placeholder="Search mints..."
                  value={comparePickerSearch}
                  onChange={e => setComparePickerSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="md-picker-list">
                {otherMints.slice(0, 50).map(m => {
                  const isChecked = comparePickerSelected.has(m.url)
                  const disabled = !isChecked && comparePickerSelected.size >= 3
                  return (
                    <div
                      key={m.url}
                      className={`md-picker-item${isChecked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}
                      onClick={() => {
                        if (disabled) return
                        setComparePickerSelected(prev => {
                          const next = new Set(prev)
                          if (next.has(m.url)) next.delete(m.url); else next.add(m.url)
                          return next
                        })
                      }}
                    >
                      <div className={`card-checkbox${isChecked ? ' checked' : ''}`} style={{width:14,height:14,borderRadius:3,flexShrink:0}}>
                        {isChecked && <span style={{fontSize:10,lineHeight:1}}>✓</span>}
                      </div>
                      <span style={{width:7,height:7,borderRadius:'50%',background:m.online===true?'var(--accent)':'#ff4d4d',display:'inline-block',flexShrink:0}} />
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.name ?? new URL(m.url).hostname}</div>
                        <div style={{fontSize:10,color:'var(--text3)',fontFamily:'var(--font-mono)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{new URL(m.url).hostname}</div>
                      </div>
                    </div>
                  )
                })}
                {otherMints.length === 0 && (
                  <div style={{padding:'16px',fontSize:12,color:'var(--text3)',textAlign:'center'}}>No mints found</div>
                )}
              </div>
              <div className="md-picker-footer">
                <span style={{fontSize:11,color:'var(--text3)'}}>{comparePickerSelected.size} / 3 selected</span>
                <button
                  className="md-picker-confirm"
                  disabled={comparePickerSelected.size === 0}
                  onClick={() => { setShowComparePicker(false); setShowComparisonModal(true) }}
                >
                  Compare ({comparedMints.length})
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {showComparisonModal && (() => {
        const comparedMints = [
          ...(knownMintsData?.filter(m => m.url === url) ?? []),
          ...(knownMintsData?.filter(m => comparePickerSelected.has(m.url)) ?? []),
        ]
        return comparedMints.length >= 2
          ? <ComparisonModal mints={comparedMints} onClose={() => setShowComparisonModal(false)} />
          : null
      })()}
    </div>
  )
}

export default function MintDetail() {
  const params = useParams<{ url: string }>()
  const rawUrl = params['url']
  const navigate = useNavigate()

  if (rawUrl === undefined) {
    return (
      <div className="mint-detail">
        <div className="md-header">
          <button className="md-back" onClick={() => navigate(-1)}>← Back</button>
        </div>
        <p style={{ color: 'var(--red)', padding: '24px', fontSize: '14px' }}>Invalid mint URL.</p>
      </div>
    )
  }

  return <MintDetailContent url={decodeURIComponent(rawUrl)} />
}
