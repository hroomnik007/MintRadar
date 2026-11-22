import { DISCOVERY_RELAYS } from '@/core/nostr/relays'
import { njumpEventUrl, mintAnnounceNaddr } from '@/utils/nostrLinks'
import { nip87AnnouncementOf } from '@/utils/nip87Announcement'
import { NIP87_ANNOUNCEMENT_LABEL, NIP87_NOT_SEEN_TEXT, nip87KeyText, nip87StoredSuffix } from '@/utils/nip87Texts'
import { useParams, useNavigate, useLocation, Navigate, Link } from 'react-router-dom'
import { Fragment, useEffect, useState, useMemo, useCallback, lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { UptimeBars } from '@/components/mint/UptimeBars'
import { uptimeDayReadouts } from '@/utils/uptimeBars'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { IcStar } from '@/components/mint/IcStar'
import { ChangeDate, PendingTag } from '@/components/mint/ChangeDate'
import { useMintChanges } from '@/hooks/useMintChanges'
import { infoDates, infoTitle, keysetDates, keysetPending } from '@/utils/changeDates'
import { useMintProbe } from '@/hooks/useMintProbe'
import {
  reviewSurgeText, uptimeRowText, uptimeRowTooltip, auditRowText, NUT_ROW_TEXT,
  versionRowText, contactRowText, scoreFormulaText,
  HTTP_ERROR_EXPLANATIONS, NON_HTTP_ERROR_EXPLANATIONS, operatorExcludedText,
  KEYSETS_HINT, KEYSET_FEE_TEXT, newMintBadgeText, newMintCapNote,
  UPTIME_ROW_LABEL, AUDIT_ROW_LABEL, NUT_ROW_LABEL, VERSION_ROW_LABEL, CONTACT_ROW_LABEL,
  UPTIME_POINTS, AUDIT_POINTS, NUT_POINTS, VERSION_POINTS, CONTACT_POINTS,
  auditTooFewDetail, auditTooOldDetail, OUTAGES_WINDOW_DAYS, TEST_MINT_TEXT, AUDIT_WINDOW_DAYS,
} from '@/utils/tooltipTexts'
import { useKnownMints } from '@/hooks/useKnownMints'
import { LoadError, LoadingNote, MINT_LIST_ERROR } from '@/components/LoadError'
import { useMintReviews } from '@/hooks/useMintReviews'
import { mergeStoredAndLiveReviews, visibleReviews, withServerProfileFallback, contactListedKeys, type ServerAuthorProfile } from '@/utils/reviewUtils'
import { useMintOperatorNip05 } from '@/hooks/useMintOperatorNip05'
import { useVerifiedNip05 } from '@/hooks/useVerifiedNip05'
import { usePendingAutoWatch } from '@/hooks/usePendingAutoWatch'
import { submitMintReview } from '@/hooks/useSubmitReview'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { removeWatchedMint } from '@/core/nostr/removeWatchedMint'
import { useAuthStore } from '@/stores/auth.store'
import { useModalFocus } from '@/hooks/useModalFocus'
import { MintComparePicker } from '@/components/MintComparePicker'
import { InfoTooltip } from '@/components/InfoTooltip'
import { supportedNutKeys, offeredNutKeys } from '@/utils/nutSupport'
import { NutDescription, NutSpecLink } from '@/components/NutSpec'
import { nutOfferBreakdown } from '@/utils/nutFilters'
import { formatDate } from '@/utils/formatDate'
import { displayName as mintDisplayName, isNewMint, firstSeenLabel, reliabilityScoreColor, reliabilityScoreInfo, SCORE_PENDING_INFO, SCORE_PENDING_TEXT, UPTIME_PENDING_ARIA_LABEL, SCORE_PENDING_ARIA_LABEL, auditReliabilityColor, MIN_MEANINGFUL_REVIEWS, mintHostname, resolveMintDetailUrl, computeDuplicateMintNames, mintStatusLabel, uptime30dColor, uptime30dShown, formatUptime30d } from '@/utils/mintFormatting'
import { mintStatus } from '@/utils/mintStatus'
import { TRACKED_NUTS } from '@/constants/nuts'
import { isTestMint } from '@/constants/testMints'
import { operatorPubkeys } from '@/utils/operatorPubkeys'
import { cleanMintNameDetailed } from '@/utils/cleanMintName'
import { formatKeysetFee, urlIsOnion, listHasOnion } from '@/utils/mintProbeDisplay'
import { keysetExpiry, keysetExpiryMs } from '@/utils/keysetExpiry'
import { auditComponent, auditDataState, auditAgeHours, AUDIT_MIN_SAMPLES } from '@/utils/auditScore'
import { auditLongOf, decidingAuditWindow } from '@/utils/auditWindows'
import { IcClose } from '@/components/IcClose'
import { useAuditCz } from '@/hooks/useAuditCz'
import { adaptAuditCz, auditCzSyncNote } from '@/utils/auditCz'
import { sortUnits } from '@/utils/sortUnits'
import { methodsCell } from '@/utils/compareMethods'
import { methodDisplayText } from '@/utils/methodFilter'
import {
  computeReliabilityScore as sharedComputeReliabilityScore,
  uptimeComponent, nutComponent, versionComponent, contactComponent,
  type AuditInput,
} from '@/utils/reliabilityScore'
import { classifyMintVersion, latestMapFor, type LatestVersions } from '@/utils/versionRule'
import { useNow } from '@/hooks/useNow'
import { mintDetailMeta, MINT_NOT_FOUND_TITLE } from '@/utils/pageMeta'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { CLIENT_LATENCY_BUTTON_LABEL, CLIENT_LATENCY_RESULT_MS, latencyCaption } from '@/constants/probeLocation'
import { METHODOLOGY_VERSION } from '@/utils/methodology'
import { auditSuccessText, uptime30dOutageNote, breakdownRowScore, breakdownPointsColor, contactKindsText, infoTextFor, averageReliability, latencyPercentilesText, showTorFor, formatDuration, uptimeTileText, type OutagesResponse } from '@/utils/mintDetailFacts'
import { readContactChecks, scoreContactKindCounts } from '@/utils/contactChecks'
import { auditSourceLine, infoSourceLine, uptimeSourceLine, type SourceLine } from '@/utils/scoreSources'
import { limitedDataReasons, limitedDataText } from '@/utils/limitedData'
import { LAST_SCORE_CAPTION, sanitizeLastError, unavailableHeadline } from '@/utils/unavailableMint'
import { healthRecordFor } from '@/utils/healthRecord'
import { useIsMobile } from '@/hooks/useIsMobile'
import { NutsTab } from './mintDetail/NutsTab'
import { HistoryTab } from './mintDetail/HistoryTab'
import { AuditTab } from './mintDetail/AuditTab'
import { ReviewsTab } from './mintDetail/ReviewsTab'
import { OverviewTab } from './mintDetail/OverviewTab'
import { shortNpub, starString, type MergedReviewCandidate } from './mintDetail/reviewFormat'
import { avatarInitial } from '@/utils/npub'
import { NUT_DESCRIPTIONS, type NutConfig } from './mintDetail/nutCatalog'
import { reviewAvatarColor, avatarTextColor } from '@/utils/avatarColors'
import './MintDetail.css'

// Heavy, rarely needed parts load on demand: the Compare modal (only when opened). The History chart (recharts) is lazy in
// mintDetail/HistoryTab.tsx.
const ComparisonModal = lazy(() => import('@/components/ComparisonModal').then(m => ({ default: m.ComparisonModal })))
import {
  Copy, Check, Info,
  Zap, QrCode,
  ArrowUpRight, User, ChevronLeft, ArrowLeftRight,
} from 'lucide-react'

// Short label for the "Signing with" row — mirrors AppShell's navbar profile
// METHOD_BADGE so the two read identically (Extension / nsec / Remote signer).
const METHOD_BADGE: Record<'nip07' | 'nsec' | 'remote-signer', string> = {
  nip07: 'Extension',
  nsec: 'nsec',
  'remote-signer': 'Remote signer',
}
// One-word gloss for each star value, shown next to the chosen rating ("5: works great").
const RATING_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'steer clear',
  2: 'rough',
  3: 'does the job',
  4: 'solid',
  5: 'works great',
}
// One row of the Reliability Score breakdown (label + info tooltip + measured
// value + score bar). Rendered both inline on the Overview sidebar panel and
// inside the "Reliability Score Breakdown" modal; each usage has its own tooltip.
// "source · window · sample · time" under a row; the time carries its absolute value in the title attribute.
function SourceLineView({ line }: { line: SourceLine }) {
  return (
    <div className="rb-row-source">
      {line.parts.join(' · ')}
      {line.time && <>{' · '}<span title={line.time.title}>{line.time.verb} {line.time.label}</span></>}
    </div>
  )
}

function ReliabilityBreakdownRow({ label, display, displayLabel, score, max, color, tooltip, note, detail, source }: {
  label: string
  display: string
  // aria-label of a placeholder display ("—"), so it is announced as "not available yet".
  displayLabel?: string
  note?: string
  // Full-width explanation under the row (wraps; `display` is ellipsized at 170px).
  detail?: string
  // Where the number comes from: source, window, sample, time.
  source?: SourceLine
  // null = not known yet: shown as "—/max" with an empty bar.
  score: number | null
  max: number
  color: string
  tooltip: string
}) {
  return (
    <div className="rb-row">
      <div className="rb-row-top">
        <span className="rb-row-label">
          {label}
          <InfoTooltip iconSize={11} width={220} about={label} text={tooltip} />
        </span>
        <div className="rb-row-right">
          {note && <InfoTooltip text={tooltip} width={220}><span className="rb-row-note">{note}</span></InfoTooltip>}
          <span className="rb-row-display" {...(displayLabel ? { role: 'img', 'aria-label': displayLabel } : {})}>{display}</span>
          <span className="rb-row-score" style={{ color }}>{score ?? SCORE_PENDING_TEXT}/{max}</span>
        </div>
      </div>
      {detail && <div className="rb-row-detail">{detail}</div>}
      {source && <SourceLineView line={source} />}
      <div className="rb-row-bar">
        <div style={{ height: '100%', width: `${((score ?? 0) / max) * 100}%`, background: color, borderRadius: 2, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  )
}

/** A payment method as a reader says it, in the Units and methods table (2026-11-19 mockup alignment): bolt11 is a
 *  Lightning invoice, so "Lightning"; bolt12 keeps its name; "On-chain". Other methods as the mint names them. */
function methodPlainText(method: string): string {
  if (method === 'bolt11') return 'Lightning'
  if (method === 'bolt12') return 'Lightning (BOLT12)'
  return methodDisplayText(method)
}

const MINT_TABS = ['overview', 'history', 'nuts', 'audit', 'reviews'] as const
type MintTab = typeof MINT_TABS[number]
const MINT_TAB_LABELS: Record<MintTab, string> = { overview: 'Overview', history: 'History', nuts: 'NUTs', audit: 'Audit', reviews: 'Reviews' }

function uptimeColor(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'var(--text3)'
  if (pct >= 80) return 'var(--accent)'
  if (pct >= 50) return 'var(--amber)'
  return 'var(--red)'
}


function contactCountOf(email?: string, twitter?: string, nostr?: string): number {
  return [email, twitter, nostr].filter(Boolean).length
}

// Thin adapter over the shared computation so the call sites can keep passing the
// three contact fields they already have. Only ever used as a fallback — the
// server-side score in KnownMint.reliabilityScore wins whenever it exists.
function computeReliabilityScore(
  uptimePct: number,
  nutCount: number,
  versionStr: string | null | undefined,
  email?: string,
  twitter?: string,
  nostr?: string,
  audit?: AuditInput,
  latestVersions?: LatestVersions,
): number {
  return sharedComputeReliabilityScore(
    uptimePct,
    nutCount,
    versionStr ?? null,
    contactCountOf(email, twitter, nostr),
    audit ?? { blamed: null, total: null, fetchedAt: null },
    latestVersions,
  )
}

// Must match backend/src/index.ts's NOSTR_REVIEWS_CACHE_TTL — that endpoint's
// cache is only as fresh as this value lets the frontend re-ask for it, so a
// staleTime longer than the backend TTL silently defeats a backend-side
// shortening (this happened once already: backend TTL was cut from 10min to
// 2min while this stayed at 10min, so nothing changed for users). No shared
// workspace between the two packages (same caveat as NOSTR_REVIEWS_RELAYS in
// docs/claude/reviews-and-nostr.md's "Reviews Feature" section) — keep both in sync by hand.
const NOSTR_REVIEWS_STALE_TIME_MS = 2 * 60 * 1000 // 2 minutes


function httpErrorTooltip(lastError: string): string | undefined {
  const m = lastError.match(/^HTTP (\d+)$/)
  if (m && m[1]) return HTTP_ERROR_EXPLANATIONS[m[1]] ?? `The mint returned HTTP ${m[1]} — an unexpected error status`
  return NON_HTTP_ERROR_EXPLANATIONS[lastError]
}


function MintDetailContent({ url }: { url: string }) {
  const now = useNow()
  const { data, isLoading, isError: probeError, refetch: refetchProbe } = useMintProbe(url)
  // Confirmed changes, values seen once and keyset seen dates: dates next to the keysets, fees and mint info (no panel of their own).
  const { data: mintChanges } = useMintChanges(url)
  const { data: knownMintsData } = useKnownMints()
  const knownMint = knownMintsData?.find(m => m.url === url) ?? null
  const operatorNip05 = useMintOperatorNip05(knownMint?.nostrAnnouncePubkey ?? null)

  // Computed over the full known-mints list — see Dashboard.tsx's own
  // duplicateDisplayNames for the rationale.
  const duplicateDisplayNames = useMemo(() => computeDuplicateMintNames(knownMintsData ?? []), [knownMintsData])

  // Name rule: a TRACKED mint uses the known-mint display name only (the backend cleaned it
  // and applied the hidden-names list; null means "show the hostname"), so the live probe's raw name can
  // never override it. An untracked mint (live probe only) uses the live name cleaned here with the same
  // function the backend uses (cleanMintName.ts).
  const liveName = data?.info?.name ? cleanMintNameDetailed(data.info.name, '') : null
  const resolvedName = knownMint ? (knownMint.name ?? null) : ((liveName?.name ?? '') || null)
  const resolvedNameFull = knownMint ? (knownMint.nameFull ?? null) : (liveName?.full ?? null)
  const metaDisplayName = mintDisplayName({ name: resolvedName, url }, duplicateDisplayNames)
  const meta = mintDetailMeta(metaDisplayName, mintHostname(url), knownMint)
  useDocumentMeta(meta.title, meta.description, { canonicalPath: `/mint/${encodeURIComponent(url)}` })

  const [chartInterval, setChartInterval] = useState<'24h' | '7d' | '30d' | '90d'>('7d')
  const [chartMetric, setChartMetric] = useState<'latency' | 'uptime' | 'reliability'>('latency')
  const { data: chartHistoryData } = useQuery({
    queryKey: ['mint', 'chart-history', url, chartInterval],
    queryFn: async () => {
      const res = await fetch(`/api/mints/history?url=${encodeURIComponent(url)}&period=${chartInterval}`)
      if (!res.ok) throw new Error('Failed to fetch chart history')
      return res.json() as Promise<{
        period: string
        segments: Array<{ bucket: string; online: boolean; latencyMs: number | null; total: number; onlineCount: number; uptimePct: number | null; reliabilityScore: number | null }>
        uptimePct: number | null
        avgLatencyMs: number | null
        p50LatencyMs?: number | null
        p95LatencyMs?: number | null
        prevUptimePct: number | null
        prevAvgLatencyMs: number | null
        earliestCheckedAt: string | null
        daysOfDataAvailable: number
        periodDays: number
        prevPeriodInsufficientHistory: boolean
      }>
    },
    staleTime: 5 * 60 * 1000,
  })
  // Dedicated 24h query for the header — shares TanStack cache with historyData when historyPeriod='24h'
  const { data: uptime24hData, isError: uptime24hError } = useQuery({
    queryKey: ['mint', 'history-api', url, '24h'],
    queryFn: async () => {
      const res = await fetch(`/api/mints/history?url=${encodeURIComponent(url)}&period=24h`)
      if (!res.ok) throw new Error('Failed to fetch history')
      return res.json() as Promise<{
        period: string
        segments: Array<{ bucket: string; online: boolean; latencyMs: number | null; total: number; onlineCount: number; uptimePct: number | null; reliabilityScore: number | null }>
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

  const { data: outagesData } = useQuery({
    queryKey: ['mint', 'outages', url],
    queryFn: async () => {
      const res = await fetch(`/api/mints/outages?url=${encodeURIComponent(url)}&days=${OUTAGES_WINDOW_DAYS}`)
      if (!res.ok) throw new Error('Failed to fetch outages')
      return await res.json() as OutagesResponse
    },
    staleTime: 5 * 60 * 1000,
  })

  const watchlistMints = useWatchlistStore(state => state.mints)
  const addMint = useWatchlistStore(state => state.addMint)
  const loadFromDb = useWatchlistStore(state => state.loadFromDb)
  const profile = useAuthStore(state => state.profile)
  const authMethod = useAuthStore(state => state.method)
  const isLoggedIn = profile !== null

  // "+ Watch" while logged out opens a modal instead of a silent no-op/redirect.
  // The pending "auto-add after login" intent lives in usePendingAutoWatch, which
  // pins it to this mint URL + time so a route-param change, an unmount, or a
  // much-later unrelated login can't make it add the wrong mint (2026-09-07 audit, L7).
  const [showWatchLoginModal, setShowWatchLoginModal] = useState(false)
  const autoWatch = useCallback((u: string) => {
    if (!useWatchlistStore.getState().mints.includes(u)) void addMint(u)
  }, [addMint])
  const { arm: armAutoWatch, disarm: disarmAutoWatch } = usePendingAutoWatch(url, isLoggedIn, autoWatch)
  const closeWatchLoginModal = useCallback(() => {
    setShowWatchLoginModal(false)
    disarmAutoWatch() // (c) explicit Cancel / Escape / overlay / × — the user backed out.
  }, [setShowWatchLoginModal, disarmAutoWatch])
  const confirmWatchLogin = useCallback(() => {
    armAutoWatch()
    setShowWatchLoginModal(false)
    window.dispatchEvent(new CustomEvent('mintradar:open-login'))
  }, [armAutoWatch])
  useEffect(() => {
    if (!showWatchLoginModal) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeWatchLoginModal() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [showWatchLoginModal, closeWatchLoginModal])

  // A failed request must end in the error state, never in a cached []: an empty list
  // would read as "0 reviews" for the staleTime while the card shows the DB count.
  const { data: nostrReviewsData, isError: storedReviewsFailed } = useQuery({
    queryKey: ['mint', 'nostr-reviews', url],
    queryFn: async () => {
      const res = await fetch(`/api/mints/nostr-reviews?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error('Failed to fetch stored reviews')
      return res.json() as Promise<Array<{ id: string; pubkey: string; content: string; rating: number | null; createdAt: number; source: 'nostr'; listedAsContact?: boolean } & ServerAuthorProfile>>
    },
    staleTime: NOSTR_REVIEWS_STALE_TIME_MS,
    retry: false,
  })
  // Pubkeys from the DB-backed secondary source, so useMintReviews' kind:0
  // profile lookup also covers reviewers who only show up via that path
  // (nostrOnly below) — otherwise they'd only ever get the generic anon
  // avatar even when their Nostr profile is perfectly current.
  const nostrReviewsPubkeys = useMemo(
    () => [...new Set((nostrReviewsData ?? []).map(r => r.pubkey))],
    [nostrReviewsData],
  )
  // Authors whose key the mint itself lists as a nostr contact and whose review is NOT excluded as an operator review
  // (the server decides from the stored contacts, also for an offline mint). Only a neutral label in the list: it never
  // changes a count, an average or a filter.
  const contactListed = useMemo(() => contactListedKeys(nostrReviewsData), [nostrReviewsData])
  const { reviews, loading: reviewsLoading, profiles: nostrProfiles } = useMintReviews(url, nostrReviewsPubkeys)
  // Shared shape for mergeStoredAndLiveReviews' two input arrays — `source` has
  // to be the same literal-union type on both sides, not narrowed to a single
  // literal on each ('nostr' / 'mintradar'), or TS unifies the generic to
  // whichever array is inferred first and rejects the other as incompatible.
  // The card shows mints.review_count: one stored review per pubkey. This list
  // is that same set. A live event may replace a stored one when it is newer,
  // and the signed-in user's own just-published review is added so they see it
  // before the next sync. Other live-only events are not added — counting them
  // made this page say 5 while the card said 4.
  const mergedReviews = useMemo(() => {
    const stored: MergedReviewCandidate[] = (nostrReviewsData ?? []).map(r => {
      const profileForReview = nostrProfiles[r.pubkey]
      return {
        id: r.id,
        pubkey: r.pubkey,
        rating: r.rating,
        comment: r.content,
        createdAt: r.createdAt,
        source: 'nostr',
        ...(profileForReview ? { profile: profileForReview } : {}),
      }
    })
    const live: MergedReviewCandidate[] = reviews.map(r => ({ ...r, source: 'mintradar' }))
    // Server-side profile names are only a fallback for reviewers the browser found no name for. They are applied
    // after the merge so a live (newer) review of the same author gets them too.
    const serverProfiles = new Map<string, ServerAuthorProfile>(
      (nostrReviewsData ?? []).map((r): [string, ServerAuthorProfile] => [r.pubkey, r]),
    )
    return withServerProfileFallback(visibleReviews(mergeStoredAndLiveReviews(stored, live, profile?.pubkey ?? null)), serverProfiles)
  }, [reviews, nostrReviewsData, nostrProfiles, profile?.pubkey])
  const [selectedNut, setSelectedNut] = useState<string | null>(null)
  const [copiedContact, setCopiedContact] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedReviewAction, setCopiedReviewAction] = useState<string | null>(null)
  const [highlightedReview, setHighlightedReview] = useState<string | null>(null)


  // The header icon is a fixed 64px (48px on phones) since the 2026-11-19 redesign; it was sized from the name block.
  const isMobile = useIsMobile()

  const [showQr, setShowQr] = useState(false)
  const [showReliabilityBreakdown, setShowReliabilityBreakdown] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [reviewsPageState, setReviewsPageState] = useState<{ key: string; page: number }>({ key: '', page: 1 })
  const [reviewFilterState, setReviewFilterState] = useState<{ key: string; type: 'all' | '5star' | 'critical' }>({ key: '', type: 'all' })
  const [reviewHideAnonState, setReviewHideAnonState] = useState<{ key: string; on: boolean }>({ key: '', on: false })
  // 0 = phase 1 (rating not chosen yet); 1-5 = phase 2 (form revealed).
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewHoverRating, setReviewHoverRating] = useState(0)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewSuccess, setReviewSuccess] = useState(false)
  const [clientLatency, setClientLatency] = useState<number | string | null>(null)
  const [testingLatency, setTestingLatency] = useState(false)
  // The result goes back to "Show my latency" after 5 minutes (it is a one-off reading). A new measurement first clears the
  // result, so its own result starts a fresh timer; the cleanup also clears it on unmount.
  useEffect(() => {
    if (clientLatency === null) return
    const t = setTimeout(() => setClientLatency(null), CLIENT_LATENCY_RESULT_MS)
    return () => clearTimeout(t)
  }, [clientLatency])
  const [activeTab, setActiveTab] = useState<MintTab>('overview')
  const selectTab = (tab: MintTab) => {
    setActiveTab(tab)
    const newHash = `#${tab}`
    if (window.location.hash !== newHash) window.history.replaceState(null, '', newHash)
  }
  // cashu.info view: each of the two swap tables expands on its own.
  // Keysets card: inactive keysets are folded by default. Keyed by mint like reviewsPageState, so switching mints folds them again without a reset effect.
  const [keysetsExpandedFor, setKeysetsExpandedFor] = useState<string | null>(null)
  // cashu.info data: fetched (from our own /api/mints/audit-cz, never from them) only while
  // the Audit tab is open and the known-mints list has loaded. The breakdown's Audit row does not use it.
  const { data: auditCzData, loading: auditCzLoading } = useAuditCz(url, activeTab === 'audit')
  const czData = adaptAuditCz(auditCzData, now)
  const [showComparePicker, setShowComparePicker] = useState(false)
  const [compareSelectedUrls, setCompareSelectedUrls] = useState<Set<string>>(new Set())
  const [showComparisonModal, setShowComparisonModal] = useState(false)
  const dialogRef = useModalFocus()

  async function testClientLatency() {
    // `url` is the /mint/:url route param (decodeURIComponent'd) — not
    // guaranteed to be a real mint. Validate before firing a request straight
    // from the visitor's browser, the same way core/mint/api.ts validates a
    // probe URL (https:// scheme + length cap). (2026-09-07 audit, L6.)
    if (!url.startsWith('https://') || url.length > 500) {
      setClientLatency('Invalid mint URL')
      return
    }
    setTestingLatency(true)
    setClientLatency(null)
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 5000)
    const t0 = performance.now()
    try {
      const res = await fetch(url.replace(/\/$/, '') + '/v1/info', { cache: 'no-store', credentials: 'omit', signal: ctrl.signal })
      clearTimeout(timeout)
      if (res.ok) {
        setClientLatency(Math.round(performance.now() - t0))
      } else {
        setClientLatency(`Unreachable (HTTP ${res.status})`)
      }
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

  // Single close path (overlay / × / Cancel / Escape / post-success) — resets
  // every field so the modal always reopens in phase 1. Same pattern as
  // AppShell's closeLoginModal; deliberately NOT an effect.
  const closeReviewModal = useCallback(() => {
    setShowReviewModal(false)
    setReviewRating(0)
    setReviewHoverRating(0)
    setReviewComment('')
    setReviewError(null)
    setReviewSuccess(false)
  }, [])

  // Dismissing (overlay / × / Cancel / Escape) with a comment already typed asks first, so a stray click
  // outside the dialog cannot throw a written review away. Success and sign-out still close directly.
  const requestCloseReviewModal = useCallback(() => {
    if (reviewComment.trim() !== '' && !reviewSuccess && !window.confirm('Discard your review?')) return
    closeReviewModal()
  }, [reviewComment, reviewSuccess, closeReviewModal])

  useEffect(() => {
    if (!showReviewModal) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') requestCloseReviewModal() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [showReviewModal, requestCloseReviewModal])

  useEffect(() => {
    if (!showQr) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowQr(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [showQr])

  useEffect(() => {
    if (!showReliabilityBreakdown) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowReliabilityBreakdown(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [showReliabilityBreakdown])

  useEffect(() => {
    if (!showComparePicker) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowComparePicker(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [showComparePicker])

  // Review deep-link (#review-<id>). Must stay ABOVE the loading early-return below (Rules of Hooks: a hook after it
  // runs on some renders only). It needs only resolved review state and the route `url`, not `data`/`knownMintsData`.
  const activeReviewFilter = reviewFilterState.key === url ? reviewFilterState.type : 'all'
  const hideAnonActive = reviewHideAnonState.key === url && reviewHideAnonState.on
  let filteredReviews = mergedReviews
  if (activeReviewFilter === '5star') filteredReviews = filteredReviews.filter(r => r.rating === 5)
  else if (activeReviewFilter === 'critical') filteredReviews = filteredReviews.filter(r => r.rating !== null && r.rating <= 2)
  if (hideAnonActive) filteredReviews = filteredReviews.filter(r => !!r.profile?.name)
  const REVIEWS_PER_PAGE = 5
  // Reviews with neither rating nor text collapse into one line above the list.
  // k counts them inside the currently filtered set (so it follows Hide anon;
  // the 5★/Critical chips never match them, so k is 0 there and no line shows).
  // The chip counts are untouched — they still include these reviews.
  const listReviews = filteredReviews

  useEffect(() => {
    const raw = window.location.hash
    const m = raw.match(/^#review-([0-9a-f]{64})$/i)
    if (!m?.[1]) return
    const id = m[1].toLowerCase()
    // This is a one-time reaction to the browser's location hash at mount/hash-change
    // (an external system), not state derived from props/other state — the documented
    // exemption for this rule — but the linter's static check only recognizes that
    // pattern inside an event-listener callback, which a plain hash read on mount has
    // no natural one for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab('reviews')
    setReviewFilterState({ key: url, type: 'all' })
    setReviewHideAnonState({ key: url, on: false })
    const idx = filteredReviews.findIndex(r => r.id.toLowerCase() === id)
    if (idx >= 0) {
      setReviewsPageState({ key: url, page: Math.floor(idx / REVIEWS_PER_PAGE) + 1 })
    }
    setHighlightedReview(id)
    const t = window.setTimeout(() => {
      document.getElementById(`review-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 250)
    const t2 = window.setTimeout(() => setHighlightedReview(null), 2800)
    return () => { window.clearTimeout(t); window.clearTimeout(t2) }
  }, [url, filteredReviews])

  // Numbered pagination for the Reviews tab, applied to the filtered list. Page is
  // keyed by mint URL so it resets to 1 when navigating to a different mint (no
  // reset effect needed); changing a filter above also resets it to 1.
  const reviewsTotalPages = Math.max(1, Math.ceil(listReviews.length / REVIEWS_PER_PAGE))
  const reviewsPage = Math.min(
    reviewsPageState.key === url ? reviewsPageState.page : 1,
    reviewsTotalPages,
  )
  const pagedReviews = listReviews.slice((reviewsPage - 1) * REVIEWS_PER_PAGE, reviewsPage * REVIEWS_PER_PAGE)
  // Only the page actually on screen gets its NIP-05 claim verified — see
  // useVerifiedNip05.ts for why this bounds external requests without needing
  // a separate cap. Computed up here (not lower with the rest of the pagination
  // derived state) because it calls a hook, and this component has an early
  // loading-state return further down — hooks can't follow that conditionally.
  const verifiedNip05ByPubkey = useVerifiedNip05(
    useMemo(() => pagedReviews.map(r => ({ pubkey: r.pubkey, nip05: r.profile?.nip05 })), [pagedReviews])
  )

  // Plain-tab deep link (#audit | #history | #nuts | #reviews | #overview) on
  // load. Distinct from #review-<id> above — that pattern is "review-"
  // (singular + id), this one is "reviews" (plural, no id), so the two never
  // collide and #review-<id> already wins for opening the Reviews tab.
  // Unrecognized/missing hash falls through to the default 'overview' tab.
  // Also follows a hash-only change on the same mint page: an in-app link (router location hash) and a typed or
  // pasted URL that only changes the fragment (hashchange). Tabs themselves use replaceState, which fires neither.
  const { hash: locationHash } = useLocation()
  useEffect(() => {
    const apply = () => {
      const m = window.location.hash.match(/^#(overview|history|nuts|audit|reviews)$/)
      if (!m?.[1]) return
      setActiveTab(m[1] as 'overview' | 'history' | 'nuts' | 'audit' | 'reviews')
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [url, locationHash])

  // The slot grid only changes when the current hour/day bucket does, so key the memo on the bucket, not on every 30 s
  // useNow tick: a new data array on each tick made the chart re-run its line animation.
  const slotBucketMs = chartInterval === '24h' ? 3_600_000 : 86_400_000
  const currentBucketMs = Math.floor(now / slotBucketMs) * slotBucketMs
  const histLineData = useMemo(() => {
    const segs = chartHistoryData?.segments ?? []
    const nutCount = knownMint?.nutCount ?? 0
    const versionStr = knownMint?.version ?? data?.info?.version ?? null
    const auditInput: AuditInput = {
      blamed: knownMint?.auditCzBlamed ?? null,
      total: knownMint?.auditCzTotal ?? null,
      fetchedAt: knownMint?.auditCzFetchedAt ?? null,
      long: auditLongOf(knownMint),
    }
    const emailVal = data?.info?.contact?.find((c: { method: string }) => c.method === 'email')?.info
    const twitterVal = data?.info?.contact?.find((c: { method: string }) => c.method === 'twitter')?.info
    const nostrVal = data?.info?.contact?.find((c: { method: string }) => c.method === 'nostr')?.info
    function bucketLabel(bucket: string): string {
      const d = new Date(bucket)
      if (chartInterval === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      return formatDate(d, { year: false, local: true })
    }
    function makePoint(seg: typeof segs[0] | null, label: string) {
      if (!seg) return { label, latency: null as number | null, uptime: null as number | null, reliability: null as number | null }
      const reliabilityVal = seg.reliabilityScore !== null && seg.reliabilityScore !== undefined
        ? seg.reliabilityScore
        : seg.uptimePct !== null
          ? computeReliabilityScore(seg.uptimePct, nutCount, versionStr, emailVal, twitterVal, nostrVal, auditInput, latestMapFor(versionStr, knownMint?.softwareLatest))
          : null
      return { label, latency: seg.latencyMs, uptime: seg.uptimePct, reliability: reliabilityVal }
    }
    // For empty data or 90d (weekly buckets), use segments as-is
    if (segs.length === 0 || chartInterval === '90d') {
      return segs.map(seg => makePoint(seg, bucketLabel(seg.bucket)))
    }
    // Generate full expected time slots so sparse data maps to correct X positions
    const isHourly = chartInterval === '24h'
    const slotCount = chartInterval === '24h' ? 24 : chartInterval === '7d' ? 7 : 30
    const bucketMs = isHourly ? 3_600_000 : 86_400_000
    const keyLen = isHourly ? 13 : 10
    const segMap = new Map(segs.map(s => [s.bucket.slice(0, keyLen), s]))
    return Array.from({ length: slotCount }, (_, i) => {
      const slotMs = currentBucketMs - (slotCount - 1 - i) * bucketMs
      const iso = new Date(slotMs).toISOString()
      return makePoint(segMap.get(iso.slice(0, keyLen)) ?? null, bucketLabel(iso))
    })
  }, [chartHistoryData?.segments, chartInterval, knownMint, data?.info?.version, data?.info?.contact, currentBucketMs])

  // Render as soon as EITHER source is ready: the cached mints-known list
  // (near-instant — already fetched by Dashboard in the common flow) or the
  // live probe. Previously this blocked on the live probe alone, so an
  // offline/unresponsive mint showed nothing but the Back button for as
  // long as the probe took to time out (up to ~10-20s+). Header/stat
  // tiles/Overview now render from `knownMint` immediately; fields that
  // only the live probe has (MOTD, description, pubkey, contact, alt URLs)
  // appear once `data` resolves, with `probeLoading` available to show a
  // loading state for just those pieces.
  if (knownMintsData === undefined && data === undefined) {
    return (
      <div className="mint-detail">
        <div className="md-header">
          <Link className="md-back" to="/"><ChevronLeft size={16} aria-hidden="true" /><span className="md-back-label">All mints</span></Link>
        </div>
      </div>
    )
  }

  const probeLoading = (isLoading || data === undefined) && !probeError

  const displayName = metaDisplayName
  const isOnline = data?.online ?? knownMint?.online ?? false
  const latency = knownMint?.latencyMs ?? null
  const version = data?.info?.version ?? knownMint?.version ?? undefined
  // The one "latest" of this mint's software family, as the API sent it with the stored score (versionRule.ts).
  const versionLatestMap = latestMapFor(knownMint?.version, knownMint?.softwareLatest)
  // Live MOTD / description, else the last confirmed values of a known mint (probe `lastInfo`) with a muted "last seen".
  const infoText = infoTextFor(data?.info, data?.lastInfo)
  const motd = infoText.motd
  const description = infoText.description
  const infoLastSeenAt = infoText.lastSeenAt
  const pubkey = data?.info?.pubkey ?? knownMint?.pubkey ?? undefined
  const name = resolvedName ?? (knownMint ? mintHostname(url) : undefined)

  const tosUrl = data?.info?.tos_url ?? knownMint?.tosUrl ?? undefined
  const descriptionLong = data?.info?.description_long ?? knownMint?.descriptionLong ?? undefined
  const mintTime = data?.info?.time

  // Live contacts from the probe; fall back to last published contacts when the mint is offline.
  const liveContact = data?.info?.contact
  const lastContacts = data?.lastContacts as { method: string; info: string }[] | undefined
  const lastContactsAt = data?.lastContactsAt as string | null | undefined
  const contactSource = liveContact ?? lastContacts
  const email = contactSource?.find(c => c.method === 'email')?.info
  const twitter = contactSource?.find(c => c.method === 'twitter')?.info
  const nostr = contactSource?.find(c => c.method === 'nostr')?.info
  // The listed contacts the score counts (methodology 9: recognised format only; see scoreContactKindCounts). Only the
  // fallback score and the breakdown row's live text use these; the stored score and breakdown win.
  const liveChecks = readContactChecks(data?.contactChecks)
  const scoreEmail = email && scoreContactKindCounts('email', liveChecks) ? email : undefined
  const scoreTwitter = twitter && scoreContactKindCounts('twitter', liveChecks) ? twitter : undefined
  const scoreNostr = nostr && scoreContactKindCounts('nostr', liveChecks) ? nostr : undefined
  const contactsAreLastSeen = !liveContact && !!lastContacts?.length
  const urls = data?.info?.urls
  const hasOnionAlias = listHasOnion(urls)
  const trackedIsOnion = urlIsOnion(url)
  const showTor = showTorFor(trackedIsOnion, hasOnionAlias, knownMint?.hasOnion)

  const uptimePct = uptime24hData?.uptimePct ?? 0

  // Header "Uptime 24H" — always sourced from server API (same 24h window as Mint History panel)
  const headerUptimePct = uptime24hData?.uptimePct ?? null
  const headerOnlineChecks = (uptime24hData?.segments ?? []).reduce((s, r) => s + r.onlineCount, 0)
  const headerTotalChecks = (uptime24hData?.segments ?? []).reduce((s, r) => s + r.total, 0)
  const uptimeTile = uptimeTileText({
    state: uptime24hData !== undefined ? 'ready' : uptime24hError ? 'error' : 'pending',
    pct: headerUptimePct,
    onlineChecks: headerOnlineChecks,
    totalChecks: headerTotalChecks,
    listPct: knownMint?.uptimePct24h,
  })

  // NUT-04 (minting) and NUT-05 (melting) disabled detection
  const nut4Disabled = (() => {
    const raw = data?.info?.nuts?.['4'] ?? knownMint?.nutsLimits?.['4']
    return raw !== null && raw !== undefined && typeof raw === 'object' && (raw as NutConfig).disabled === true
  })()
  const nut5Disabled = (() => {
    const raw = data?.info?.nuts?.['5'] ?? knownMint?.nutsLimits?.['5']
    return raw !== null && raw !== undefined && typeof raw === 'object' && (raw as NutConfig).disabled === true
  })()

  const discoveredAt = knownMint?.discoveredAt ?? null

  const isWatching = watchlistMints.includes(url)
  const toggleWatch = () => { void (isWatching ? removeWatchedMint(url, displayName) : addMint(url)) }

  // The declared-as-supported NUT numbers (utils/nutSupport.ts: null, absent and `supported: false` are not support) — the
  // rule the backend scores with since methodology 4, so the fallback score below, the NUT row and the grid agree with it.
  const nutsDeclared: Record<string, unknown> | null = data?.info ? (data.info.nuts as Record<string, unknown>) : (knownMint?.nutsLimits ?? null)
  const supportedNutNumbers = supportedNutKeys(nutsDeclared)
  const supportedNuts = TRACKED_NUTS.filter(nut =>
    supportedNutNumbers.has(String(parseInt(nut.slice(4), 10)))
  )
  // Switched off: a declared NUT-04/05 with `disabled: true` is shown as disabled, not supported, and since
  // methodology 5 it does not count for the score either: the fallback score, the NUT row and the header use offeredNuts.
  const offeredNutNumbers = offeredNutKeys(nutsDeclared)
  const offeredNuts = supportedNuts.filter(nut => offeredNutNumbers.has(String(parseInt(nut.slice(4), 10))))
  const disabledNuts = supportedNuts.filter(nut => !offeredNuts.includes(nut))
  // Header NUT count: the same tracked + offered count as the NUTs tab (the stored one until the live /v1/info arrives;
  // since methodology 5 the stored count already leaves the switched-off ones out). Object.keys(nuts).length also
  // counted untracked NUTs and `supported: false` entries.
  const nutCount = data?.info ? offeredNuts.length : (knownMint?.nutCount ?? 0)
  // Adding a mint that does not issue or does not pay out ecash right now to a wallet is a dead end, like an archived one.
  const walletActionsOff = nut4Disabled || nut5Disabled
  // NUT-13 (deterministic secrets) is wallet-side only — mints never advertise
  // it in /v1/info (confirmed against live Nutshell mints and the cashubtc/nuts
  // spec, which lists no mint implementations for NUT-13 at all). The mint-side
  // capability that actually gates seed-phrase backup/restore is NUT-09
  // (restore signatures) — check that instead.
  const supportsBackupRestore = supportedNutNumbers.has('9')

  // The stored (server-side) score wins. Without one, the score is computed here from the 24 h uptime: until that history
  // has arrived (or when its request failed) there is no score to show, and computing it with uptime 0 showed a wrong
  // number for a moment (Task F3). Every place below shows SCORE_PENDING_* while `reliabilityScore` is null.
  const fallbackScore = () => computeReliabilityScore(uptimePct, offeredNuts.length, version, scoreEmail, scoreTwitter, scoreNostr, { blamed: knownMint?.auditCzBlamed ?? null, total: knownMint?.auditCzTotal ?? null, fetchedAt: knownMint?.auditCzFetchedAt ?? null, long: auditLongOf(knownMint) }, versionLatestMap)
  const reliabilityScore: number | null = knownMint?.reliabilityScore ?? (uptime24hData ? fallbackScore() : null)
  const scorePending = reliabilityScore === null
  const scoreText = scorePending ? SCORE_PENDING_TEXT : String(reliabilityScore)
  // role="img" gives the placeholder's aria-label something to be announced on.
  const scoreA11y = scorePending ? { role: 'img', 'aria-label': SCORE_PENDING_ARIA_LABEL } as const : {}
  const tsInfo = reliabilityScore === null ? SCORE_PENDING_INFO : reliabilityScoreInfo(reliabilityScore)

  // Reliability Score Breakdown modal rows — hoisted out of the modal's JSX (was a
  // nested IIFE) because the react-compiler ESLint rules disallow reading a
  // ref from inside a hand-rolled nested function during render.
  const breakdownUScore = uptimeComponent(uptimePct)
  // The 24 h history is missing (not loaded yet, or its request failed) or loaded without data (uptimePct null): the Uptime row
  // shows a placeholder, never the 0 that `uptimePct` stands in for (a mint with a stored score showed a red 0% and 0/40). A
  // real 0 (uptimePct 0, a mint that was really down) is still shown as "0%".
  const uptimeRowPending = scorePending || uptime24hData === undefined || uptime24hData.uptimePct === null
  const breakdownNScore = nutComponent(offeredNuts.length)
  const breakdownVScore = versionComponent(version, versionLatestMap)
  const breakdownContactFields = [scoreEmail, scoreTwitter, scoreNostr].filter(Boolean)
  const breakdownCScore = contactComponent(breakdownContactFields.length)
  // The stored record of the shown score (/api/mints/known scoreBreakdown): its points per row win, so the rows add up to
  // the score; the live values below are display text only. null (not written yet): the live computation, as before.
  const storedBreakdown = knownMint?.reliabilityScore != null ? (knownMint.scoreBreakdown ?? null) : null
  const breakdownContactDisplay = breakdownContactFields.length === 0
    ? (storedBreakdown && storedBreakdown.contact.points > 0 ? (contactKindsText(data?.contactChecks) ?? 'Listed at last check') : 'None')
    : (scoreEmail ? 'Email' : '') + (scoreTwitter ? (scoreEmail ? ' + Twitter' : 'Twitter') : '') + (scoreNostr ? ((scoreEmail || scoreTwitter) ? ' + Nostr' : 'Nostr') : '')
  // Audit part of the score: cashu.info's 7-day attributed failures (mints.audit_cz_*), the same
  // functions the server scores with (shared/auditScore.ts).
  const auditCzBlamed = knownMint?.auditCzBlamed ?? null
  const auditCzTotal = knownMint?.auditCzTotal ?? null
  const auditCzFetchedAt = knownMint?.auditCzFetchedAt ?? null
  const auditLong = auditLongOf(knownMint)
  const breakdownAScore = auditComponent(auditCzBlamed, auditCzTotal, auditCzFetchedAt, now, auditLong)
  const auditState = auditDataState(auditCzBlamed, auditCzTotal, auditCzFetchedAt, now, auditLong)
  // The window the part takes its points from (the worse one); its numbers are the ones the row shows.
  const auditWindow = decidingAuditWindow(auditCzBlamed, auditCzTotal, auditLong)
  const auditAgeH = auditAgeHours(auditCzFetchedAt, now)
  // A scored row has no line under it; only the neutral states explain themselves.
  const auditDetailText = auditState === 'scored'
    ? undefined
    : auditState === 'too-few'
      ? auditTooFewDetail()
      : auditState === 'too-old'
        ? auditTooOldDetail()
        : 'No cashu.info audit data: neutral'
  // Swaps without an attributed failure / all swaps, the same figure as Compare's "No mint fault (7d)" row (it used to show the
  // attributed failures, "0 / 13", next to 25/25, which read as 0 successes).
  const breakdownAuditDisplay = auditState === 'scored' && auditWindow
    ? `${auditSuccessText(auditWindow.blamed, auditWindow.total) ?? 'neutral'}${auditWindow.days > AUDIT_WINDOW_DAYS ? ` · ${auditWindow.days}d` : ''}`
    : 'neutral'
  const auditAgeDays = auditAgeH !== null && auditAgeH > 24 && (auditState === 'scored' || auditState === 'too-few') ? Math.floor(auditAgeH / 24) : null
  const auditStaleNote = auditAgeDays !== null ? `data ${auditAgeDays} ${auditAgeDays === 1 ? 'day' : 'days'} old` : undefined
  // Breakdown row colour: same error-rate colouring over the cashu.info window, muted while neutral.
  const auditRowColor = auditReliabilityColor(auditState === 'scored' && auditWindow ? auditWindow.total : null, auditWindow?.blamed ?? null, AUDIT_MIN_SAMPLES)
  // Audit tab: the cashu.info view (the audit source of the score); null while the mint has no stored detail.
  const czView = czData
  const czSyncNote = czView ? auditCzSyncNote(czView, now) : null

  // Latest successful /v1/info fetch: the latest probe while the mint is online, else the last time it was seen online.
  const infoFetchedAt = isOnline ? knownMint?.lastCheckedAt : knownMint?.lastOnlineAt
  const uptimeSource = uptimeSourceLine({ checks: uptime24hData ? headerTotalChecks : null, lastProbeAt: knownMint?.lastCheckedAt, now })
  const auditRowSource = auditSourceLine({ blamed: auditCzBlamed, total: auditCzTotal, fetchedAt: auditCzFetchedAt, now, long: auditLong })
  const infoSource = infoSourceLine({ fetchedAt: infoFetchedAt, now })
  const versionSource = infoSourceLine({ fetchedAt: infoFetchedAt, now, comparedWithLatest: true })
  const rowUScore = breakdownRowScore(storedBreakdown, 'uptime', uptimeRowPending ? null : breakdownUScore)
  const rowAScore = breakdownRowScore(storedBreakdown, 'audit', breakdownAScore)
  const rowNScore = breakdownRowScore(storedBreakdown, 'nuts', breakdownNScore)
  const rowVScore = breakdownRowScore(storedBreakdown, 'version', breakdownVScore)
  const rowCScore = breakdownRowScore(storedBreakdown, 'contact', breakdownCScore)
  // Methodology 7: the stored record carries the four uptime parts and the 30-day figures they used. The row then
  // names both windows, and its ⓘ lists each part with the figure it used and its points (they add up to the row's
  // points). Without the stored parts the ⓘ is the general explanation. No line under the row besides the source.
  const storedUptimeInputs = storedBreakdown?.uptimeParts ? storedBreakdown.uptimeInputs : undefined
  const uptimeRowDisplay = storedUptimeInputs ? `${uptimePct}% · 30d ${storedUptimeInputs.uptime30dPct}%` : `${uptimePct}%`
  const uptimeTooltip = uptimeRowTooltip(storedBreakdown, formatDuration) ?? uptimeRowText()
  // U1: the unrounded 30-day share cut down to one decimal (never a rounded-up 100 % with yellow days).
  const uptime30dShownValue = uptime30dShown(knownMint?.uptimePct30dExact, knownMint?.uptimePct30d)
  const reliabilityBreakdownRows = [
    { label: UPTIME_ROW_LABEL, display: uptimeRowPending ? SCORE_PENDING_TEXT : uptimeRowDisplay, ...(uptimeRowPending ? { displayLabel: UPTIME_PENDING_ARIA_LABEL } : {}), source: uptimeSource, score: rowUScore, max: UPTIME_POINTS, color: storedBreakdown ? breakdownPointsColor(rowUScore, UPTIME_POINTS) : uptimeRowPending ? 'var(--text3)' : uptimeColor(uptimePct), tooltip: uptimeTooltip },
    { label: AUDIT_ROW_LABEL, display: breakdownAuditDisplay, source: auditRowSource, ...(auditDetailText ? { detail: auditDetailText } : {}), score: rowAScore, max: AUDIT_POINTS, color: auditRowColor, tooltip: auditRowText(), ...(auditStaleNote ? { note: auditStaleNote } : {}) },
    { label: NUT_ROW_LABEL, display: `${offeredNuts.length} / ${TRACKED_NUTS.length} NUTs${disabledNuts.length > 0 ? ` · ${disabledNuts.length} disabled` : ''}`, source: infoSource, score: rowNScore, max: NUT_POINTS, color: storedBreakdown ? breakdownPointsColor(rowNScore, NUT_POINTS) : offeredNuts.length >= 12 ? 'var(--accent)' : offeredNuts.length >= 8 ? 'var(--amber)' : 'var(--red)', tooltip: NUT_ROW_TEXT },
    { label: VERSION_ROW_LABEL, display: version ?? 'Unknown', source: versionSource, score: rowVScore, max: VERSION_POINTS, color: breakdownPointsColor(rowVScore, VERSION_POINTS), tooltip: versionRowText() },
    { label: CONTACT_ROW_LABEL, display: breakdownContactDisplay, source: infoSource, score: rowCScore, max: CONTACT_POINTS, color: breakdownPointsColor(rowCScore, CONTACT_POINTS), tooltip: contactRowText() },
  ]
  // The stored new-mint cap correction (0 or negative): one line under the rows, so they still add up to the score.
  const storedCapLine = storedBreakdown && storedBreakdown.newMintCap.points < 0
    ? <div className="rb-cap-line" data-testid="rb-cap-line">New-mint cap: {storedBreakdown.newMintCap.points} (score capped at {storedBreakdown.newMintCap.cap})</div>
    : null
  // "Limited data": the audit part is neutral, or the new-mint cap applies (the score's own constants).
  const limitedReasons = limitedDataReasons({ auditBlamed: auditCzBlamed, auditTotal: auditCzTotal, auditFetchedAt: auditCzFetchedAt, auditLong, discoveredAt, now })
  const limitedDataLabel = limitedReasons.length > 0 ? (
    <InfoTooltip className="md-limited-data" width={240} text={limitedDataText(limitedReasons)}>
      <span className="md-limited-data-chip">Limited data</span>
    </InfoTooltip>
  ) : null
  // Mint that is not online: an honest block at the top of the Overview (since when, last error, what to do).
  const unavailable = !isOnline && knownMint !== null
  const isArchived = !isOnline && knownMint?.archived === true
  // A mint that is not online keeps its last score, but in grey: a green "High Reliability" next to "Offline" read as a
  // current verdict (2026-11-15 audit). The text stays; the breakdown says it is the last measured score.
  const badgeInfo = unavailable && !scorePending ? { ...tsInfo, color: 'var(--text3)', bg: 'var(--bg3)', border: 'var(--border)' } : tsInfo
  // Said to screen readers too (no title attribute: tooltipPatterns.test.ts allows none for explanations).
  const badgeLastNote = unavailable && !scorePending ? <span className="sr-only"> (last measured score)</span> : null
  const scoreTone = (c: string) => (unavailable ? 'var(--text3)' : c)
  // Status word: the shared rule of the wallet API `status` (utils/mintStatus.ts), so a mint the API calls
  // `degraded` reads "Degraded" here as on its card (lnpay was degraded in the API but "Offline" here). The one
  // input that can differ from the API is `online`: a live probe from this page is newer than the snapshot, and when
  // it succeeds the mint is Online even if the snapshot still says degraded.
  const status = mintStatus({ online: isOnline, degraded: !isOnline && knownMint?.degraded === true, archived: isArchived })
  const statusLabel = mintStatusLabel(status)
  const unavailableInfo = unavailable ? unavailableHeadline({ since: knownMint?.offlineSince ?? knownMint?.lastOnlineAt, archived: knownMint?.archived === true, now }) : null
  const lastErrorText = sanitizeLastError(knownMint?.lastError)
  const unavailableContacts = [email && `email ${email}`, twitter && `Twitter ${twitter}`, nostr && `Nostr ${nostr}`].filter((c): c is string => !!c)
  // Signed health record: only a mint with a current event (not archived, scored, https host that may appear in an event).
  const healthRecord = knownMint && knownMint.archived !== true && typeof knownMint.reliabilityScore === 'number' ? healthRecordFor(url) : null
  const firstSeen = firstSeenLabel(discoveredAt)
  // NIP-87 announcement line (header): only the stored discovery data, nothing is fetched here.
  const nip87 = knownMint ? nip87AnnouncementOf({ announcedAt: knownMint.nostrAnnouncedAt, announceD: knownMint.nostrAnnounceD, infoPubkey: knownMint.pubkey, checkedAt: knownMint.nostrCheckedAt }) : null
  const nip87Key = nip87 ? nip87KeyText(nip87) : null
  // With relay hints (the discovery relays MintRadar found it on), the author and the NIP-87 kind, so njump can find it.
  const nostrAnnounceHref = njumpEventUrl(knownMint?.nostrAnnounceId, { relays: DISCOVERY_RELAYS, author: knownMint?.nostrAnnouncePubkey, kind: 38172 })
  // Shown as a row of the Overview tab's "Mint info" panel (it was a line of the header until 2026-11-13: protocol detail
  // above the fold of every mint page, and a link told apart from its sentence by colour alone).
  const nip87Line = nip87 ? (
    <span className="md-info-nip87" data-testid="md-nip87">
      {nip87.announcement === 'seen' ? (<>
        {nostrAnnounceHref ? (
          <a href={nostrAnnounceHref} target="_blank" rel="noopener noreferrer">{NIP87_ANNOUNCEMENT_LABEL}</a>
        ) : NIP87_ANNOUNCEMENT_LABEL}
        {nip87StoredSuffix(nip87.eventCreatedAt)}
      </>) : NIP87_NOT_SEEN_TEXT}
      {nip87Key && <span className="md-announce-key" data-testid="md-nip87-key">{nip87Key}</span>}
    </span>
  ) : null
  const isNew = isNewMint(discoveredAt)
  // No "Outdated" pill on an archived mint: the version is the last one it reported and it is no longer
  // probed, so comparing it with the current release adds nothing. The version text itself stays.
  const isOutdated = !isArchived && classifyMintVersion(version, versionLatestMap).label === 'outdated'

  // The mint's operator keys: a nostr contact it lists that ALSO authored its NIP-87 announcement
  // (both must agree, decision 2026-10-05). Their reviews stay in the list, labelled "Operator",
  // but are not counted in the tile. Without the live probe's contact list (still loading, or the
  // mint is offline) or the known-mints row (the announcement author) the operator set cannot be
  // worked out here, so the tile then keeps the backend rollup, which applies the same rule.
  // (Plain computation, not a hook: this runs after the component's early return. At most 10 decodes.)
  const operatorKeys = operatorPubkeys({ contact: data?.info?.contact ?? null, announcePubkey: knownMint?.nostrAnnouncePubkey ?? null })
  const operatorKeysKnown = data?.info !== undefined && knownMint !== null
  const countedReviews = mergedReviews.filter(r => !operatorKeys.has(r.pubkey.toLowerCase()))
  const operatorListedCount = mergedReviews.length - countedReviews.length

  // Average rating is computed only over events that actually carry a numeric
  // rating — rating-less endorsement events are counted in the review total but
  // never contribute to (or dilute) the star average.
  const ratedReviews = countedReviews.filter(r => r.rating !== null)
  const avgRating = ratedReviews.length > 0
    ? Math.round(ratedReviews.reduce((s, r) => s + (r.rating as number), 0) / ratedReviews.length * 10) / 10
    : null

  // Same number as the mint card (mints.review_count, one per pubkey, operator excluded). Until
  // the stored list has loaded, show that rollup directly. After it has, the list is the stored
  // set, so its length (minus the operator's) is the card's number — plus one only when the
  // viewer just published a review the sync has not stored yet.
  const storedReviewsReady = nostrReviewsData !== undefined
  const tileFromRollup = !storedReviewsReady || !operatorKeysKnown
  const tileReviewCount = tileFromRollup
    ? (knownMint?.reviewCount ?? (storedReviewsReady ? countedReviews.length : null))
    : countedReviews.length
  const tileAvgRating = tileFromRollup ? (knownMint?.reviewAvgRating ?? (storedReviewsReady ? avgRating : null)) : avgRating
  const tileOperatorExcluded = tileFromRollup ? (knownMint?.operatorReviewCount ?? 0) : operatorListedCount
  const operatorExcludedNote = operatorExcludedText(tileOperatorExcluded)

  // Reviews-tab filter chips. "all" / "5star" / "critical" are mutually exclusive
  // (one active at a time); "hideAnon" is an independent toggle combined on top of
  // whichever exclusive filter is active. Both are keyed by mint URL, same pattern
  // as reviewsPageState, so switching mints resets them without a reset effect.
  // (activeReviewFilter/hideAnonActive/filteredReviews are computed earlier in
  // this component now — see the review deep-link effect above.)
  // The All/5★/Critical chip counts must match what "Hide anon" actually leaves in
  // the list below — when it's on, count from the anon-filtered set, not the full
  // mergedReviews, or the chip numbers would disagree with what the user sees.
  const reviewCountBase = hideAnonActive ? mergedReviews.filter(r => !!r.profile?.name) : mergedReviews
  const reviewFilterFiveStarCount = reviewCountBase.filter(r => r.rating === 5).length
  // Critical excludes rating === null explicitly — a rating-less endorsement event
  // is not a bad review, and JS's `null <= 2` (coerces null to 0) would otherwise
  // wrongly include it here.
  const reviewFilterCriticalCount = reviewCountBase.filter(r => r.rating !== null && r.rating <= 2).length
  const reviewFilterAnonCount = mergedReviews.filter(r => !r.profile?.name).length
  const setReviewFilter = (type: 'all' | '5star' | 'critical') => {
    setReviewFilterState({ key: url, type })
    setReviewsPageState({ key: url, page: 1 })
  }
  const toggleReviewHideAnon = () => {
    setReviewHideAnonState({ key: url, on: !hideAnonActive })
    setReviewsPageState({ key: url, page: 1 })
  }

  const goToReviewsPage = (p: number) => setReviewsPageState({ key: url, page: Math.max(1, Math.min(p, reviewsTotalPages)) })

  const chartAvgLatency = chartHistoryData?.avgLatencyMs ?? null
  const chartPrevLatency = chartHistoryData?.prevAvgLatencyMs ?? null
  const chartAvgUptime = chartHistoryData?.uptimePct ?? null
  const chartPrevUptime = chartHistoryData?.prevUptimePct ?? null
  const chartPrevInsufficientHistory = chartHistoryData?.prevPeriodInsufficientHistory ?? false
  // Mean of the period's non-null segment scores (never the current score); "—" when the period has none.
  const chartAvgReliability = averageReliability(chartHistoryData?.segments)
  const chartLatencyPercentiles = latencyPercentilesText(chartHistoryData?.p50LatencyMs, chartHistoryData?.p95LatencyMs, chartInterval)
  const chartCoverage = chartHistoryData && chartHistoryData.daysOfDataAvailable < chartHistoryData.periodDays
    ? `Showing ${chartHistoryData.daysOfDataAvailable} of ${chartHistoryData.periodDays} days of data (history retention started recently)`
    : null

  // Change dates of the mint info values (utils/changeDates.ts): pubkey "since" only when a change is recorded, MOTD "last
  // changed", name / description only in the title.
  const pubkeyDates = infoDates('pubkey', mintChanges, now)
  const motdDates = infoDates('motd', mintChanges, now)
  const nameTitle = infoTitle(infoDates('name', mintChanges, now))
  const descriptionTitle = infoTitle(infoDates('description', mintChanges, now))
  const nameDates = nameTitle ? { title: nameTitle } : null
  const descriptionDates = descriptionTitle ? { title: descriptionTitle } : null
  const motdDatesLine = (motdDates.changed || motdDates.pending) ? (
    <div className="md-info-dates md-motd-dates" data-testid="motd-dates">
      {motdDates.changed && <ChangeDate prefix="last changed" mark={motdDates.changed} testId="motd-changed" />}
      {motdDates.pending && <PendingTag mark={motdDates.pending} />}
    </div>
  ) : null

  // Keysets panel — same data (data.keysets from the existing probe: id/unit/
  // active), no extra fetch. Rendered on the Overview sidebar on desktop
  // (≥901px) and on the NUTs tab on mobile (<901px); the two wrappers below
  // hide the copy that doesn't belong to the current breakpoint.
  const liveKeysets = data?.keysets ?? null
  // A mint that is not online has no live keysets: show the last known ones, labelled with their check date.
  const lastKnownKeysets = unavailable && (!liveKeysets || liveKeysets.length === 0) && knownMint?.lastKeysets && knownMint.lastKeysets.length > 0 && knownMint.lastKeysetsCheckedAt
    ? knownMint.lastKeysets.map(k => {
        const expiryMs = keysetExpiryMs(k.finalExpiry)
        return { id: k.id, unit: k.unit, active: k.active, ...(k.inputFeePpk !== null ? { input_fee_ppk: k.inputFeePpk } : {}), ...(expiryMs !== null ? { final_expiry: expiryMs / 1000 } : {}) }
      })
    : null
  // The Fees and limits group computes its examples from the same keysets (a missing fee stays unknown, not 0).
  const feeKeysets = (lastKnownKeysets ?? liveKeysets)?.map(k => ({ unit: k.unit, active: k.active, inputFeePpk: typeof k.input_fee_ppk === 'number' ? k.input_fee_ppk : null })) ?? null
  const keysetsPanel = (() => {
    const lastKnown = lastKnownKeysets
    const rawKeysets = lastKnown ?? liveKeysets
    // Active keysets first, inactive below; the order inside each group is the mint's own (display only, the data is untouched).
    const keysets = rawKeysets ? [...rawKeysets.filter(k => k.active), ...rawKeysets.filter(k => !k.active)] : rawKeysets
    // Only the active keysets show by default. A mint with no active keyset or with a single keyset shows everything and has no button.
    const activeCount = keysets ? keysets.filter(k => k.active).length : 0
    const hiddenCount = keysets && keysets.length > 1 && activeCount > 0 ? keysets.length - activeCount : 0
    const keysetsExpanded = keysetsExpandedFor === url
    const shownKeysets = keysets && hiddenCount > 0 && !keysetsExpanded ? keysets.slice(0, activeCount) : keysets
    return (
      <div className="md-panel">
        <div className="md-panel-title">Keysets</div>
        <div className="md-panel-hint">{KEYSETS_HINT}</div>
        {lastKnown && <div className="md-panel-hint">from the last successful check on {formatDate(knownMint?.lastKeysetsCheckedAt)}</div>}
        {!keysets || keysets.length === 0 ? (
          <div style={{fontSize:13,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>Keyset data not available.</div>
        ) : (
          <div className="md-keyset-list">
            {shownKeysets?.map(ks => (
              <div key={ks.id} className="md-keyset-row">
                <div className="md-keyset-idline">
                  <span className="md-keyset-id">{ks.id.slice(0, 8)}…{ks.id.slice(-8)}</span>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(ks.id)
                      setCopiedContact(`keyset-${ks.id}`)
                      setTimeout(() => setCopiedContact(null), 2000)
                    }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: copiedContact === `keyset-${ks.id}` ? 'var(--accent)' : 'var(--text3)',
                      padding: '2px 4px', display: 'flex', flexShrink: 0,
                    }}
                    className="md-copy-icon"
                    title="Copy full keyset ID"
                    aria-label="Copy full keyset ID"
                  >
                    {copiedContact === `keyset-${ks.id}` ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  {/* On the id line, outlined (2026-11-19 mockup alignment). */}
                  <span className={`md-keyset-meta md-keyset-state${ks.active ? ' is-active' : ''}`}>{ks.active ? 'Active' : 'Inactive'}</span>
                </div>
                <span className="md-keyset-meta md-keyset-unit">{ks.unit}</span>
                {typeof ks.input_fee_ppk === 'number' && (
                  <InfoTooltip text={KEYSET_FEE_TEXT} width={200} className="md-keyset-fee-tip"><span className="md-keyset-meta">{formatKeysetFee(ks.input_fee_ppk)}</span></InfoTooltip>
                )}
                {(() => {
                  const d = keysetDates(ks.id, ks.active, mintChanges, now)
                  const p = keysetPending(ks.id, mintChanges, now)
                  // Only when the mint states a final expiry; highlighted under 30 days or once past.
                  const x = keysetExpiry(ks.final_expiry, now)
                  if (!d && !p && !x) return null
                  return (
                    <div className="md-keyset-dates" data-testid="keyset-dates">
                      {d && <span className="md-chg-date" title={d.title}>{d.text}</span>}
                      {x && <span className={`md-chg-date md-keyset-expiry${x.soon ? ' md-keyset-expiry--soon' : ''}`} data-testid="keyset-expiry" title={x.title}>{x.text}</span>}
                      {p && <PendingTag mark={p} />}
                    </div>
                  )
                })()}
              </div>
            ))}
            {hiddenCount > 0 && (
              <button type="button" className="md-keysets-toggle" aria-expanded={keysetsExpanded} onClick={() => setKeysetsExpandedFor(keysetsExpanded ? null : url)}>
                {keysetsExpanded ? 'Show fewer' : `Show ${hiddenCount} inactive ${hiddenCount === 1 ? 'keyset' : 'keysets'}`}
              </button>
            )}
          </div>
        )}
      </div>
    )
  })()

  return (
    <div className="mint-detail">
      {/* Header, 2026-11-19 redesign (phase 4): icon | name, state and the watch star right after them (owner, 2026-11-18),
          the shareable URL and "first seen" under it | the actions on the right (under the name on phones). */}
      <div className="md-header md-dh">
        {/* "All mints" to the list (mockup alignment 2026-11-19; it was "← Back" through the browser history). */}
        <Link className="md-back md-back-compact" to="/"><ChevronLeft size={16} aria-hidden="true" /><span className="md-back-label">All mints</span></Link>
        <div className="md-dh-main">
          <MintFavicon url={url} iconUrl={data?.info?.icon_url ?? knownMint?.iconUrl ?? null} size={isMobile ? 48 : 64} radius={isMobile ? 12 : 14} className="md-hdr-favicon" />
          <div className="md-namebox">
            <div className="md-name md-dh-title">
              <h1 className="md-name-h1" {...(resolvedNameFull ? { title: resolvedNameFull } : {})}>{displayName}</h1>
              <span className={`md-status-inline ${status === 'online' ? '' : status === 'archived' ? 'offline archived' : status === 'degraded' ? 'offline degraded' : 'offline'}`} data-status={status}>
                <span className={`status-dot ${isOnline ? '' : 'offline'}`} />
                <span>{statusLabel}</span>
              </span>
              {isLoggedIn
                ? (
                  <button
                    type="button"
                    className={`md-watch-star md-dh-star${isWatching ? ' on' : ''}`}
                    aria-label={isWatching ? `Remove ${displayName} from watchlist` : `Add ${displayName} to watchlist`}
                    aria-pressed={isWatching}
                    title={isWatching ? `Remove ${displayName} from watchlist` : `Add ${displayName} to watchlist`}
                    onClick={toggleWatch}
                  >
                    <IcStar filled={isWatching} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="md-watch-star md-dh-star"
                    aria-label={`Add ${displayName} to watchlist`}
                    aria-pressed={false}
                    title={`Add ${displayName} to watchlist`}
                    onClick={() => setShowWatchLoginModal(true)}
                  >
                    <IcStar filled={false} />
                  </button>
                )
              }
              {isNew && (
                <InfoTooltip text={newMintBadgeText()} width={240}><span className="md-age-badge-inline md-dh-badge">New</span></InfoTooltip>
              )}
              {isTestMint(url) && (
                <InfoTooltip text={TEST_MINT_TEXT}>
                  <span className="md-dh-badge">
                    Test mint
                  </span>
                </InfoTooltip>
              )}
            </div>
            <button
              type="button"
              className={`md-url md-url-copy ${copiedLink ? 'copied' : ''}`}
              onClick={() => {
                const naddr = mintAnnounceNaddr(knownMint?.nostrAnnouncePubkey, knownMint?.nostrAnnounceD)
                const shareLink = naddr
                  ? `${window.location.origin}/mint/nostr/${naddr}`
                  : window.location.href
                void navigator.clipboard.writeText(shareLink)
                setCopiedLink(true)
                setTimeout(() => setCopiedLink(false), 2000)
              }}
            >
              <span>
                {showTor && (
                  <span className="md-url-tor" title={trackedIsOnion ? 'Tor hidden service — reachable only over the Tor network' : 'Mint also advertises a .onion URL'}>Tor</span>
                )}
                {(() => {
                  // The scheme is hidden on phones (CSS) so a typical URL fits one line; it stays in the DOM.
                  const m = /^(https?:\/\/)(.*)$/.exec(url)
                  const rest = m ? m[2]! : url
                  return (
                    <>
                      {m && <span className="md-url-scheme">{m[1]}</span>}
                      {rest.split(/(?<=\/)/).map((part, i) => <Fragment key={i}>{part}<wbr /></Fragment>)}
                    </>
                  )
                })()}
              </span>
              {copiedLink ? <span className="md-url-copied-label">Link copied</span> : <Copy size={14} aria-label="Copy link" />}
            </button>
            {firstSeen && (
              <div className="md-first-seen">{firstSeen}</div>
            )}
          </div>
          <div className="md-hdr-actions">
            <div className="md-hdr-center">
              {!isOnline && knownMint?.lastError && (
                <span className="md-hdr-error" style={{display:'inline-flex',alignItems:'center',gap:4}}>
                  <span
                    className="md-error-badge"
                    style={{fontSize:12,color:'color-mix(in srgb, var(--red) 75%, var(--text))',fontFamily:'var(--font-mono)',background:'var(--red-soft)',border:'0.5px solid var(--red-soft-strong)',borderRadius:5,padding:'2px 7px',whiteSpace:'nowrap'}}
                  >
                    {knownMint.lastError}
                  </span>
                  {httpErrorTooltip(knownMint.lastError) ? (
                    <InfoTooltip iconSize={11} width={200} about={knownMint.lastError} text={httpErrorTooltip(knownMint.lastError) ?? ''} />
                  ) : (
                    // No explanation for this error: the icon stays (as before) but is not a control that opens nothing.
                    <Info size={11} color="#6b7280" style={{cursor:'help'}} aria-hidden="true" />
                  )}
                </span>
              )}
              {/* Not for an archived mint: it is no longer probed and was offline for a long time, so adding it to a wallet is
                  a dead end. "Open in Cashu.me" went first (2026-10-25); Mint QR (its dialog is "Add … to wallet") followed
                  (2026-10-27). The URL itself stays in the header. */}
              {!isArchived && (
              <>
              <button className="md-quick-btn" onClick={() => setShowQr(true)}>
                <QrCode size={16} aria-hidden="true" /> Mint QR
              </button>
              {/* Nor for a mint that switched minting or melting off (NUT-04/05 `disabled: true`): Cashu.me
                  only; Mint QR stays for it (the URL is still a fact). */}
              {!walletActionsOff && (
              <a
                className="md-quick-btn"
                href={`https://wallet.cashu.me/?mint=${encodeURIComponent(url)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ArrowUpRight size={16} aria-hidden="true" />
                <span className="md-qb-full">Open in Cashu.me</span>
                <span className="md-qb-short">Cashu.me</span>
              </a>
              )}
              </>
              )}
            </div>
            <div className="md-hdr-right">
              <button
                className="md-compare-btn"
                onClick={() => setShowComparePicker(true)}
              >
                <ArrowLeftRight size={16} aria-hidden="true" />
                <span className="md-compare-label">Compare</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Five figures, 2026-11-19 redesign (phase 4): the score first at every width (the phone donut tile is gone);
          Software joins the version and the NUT count. Phones: the score spans the first row, then 2 x 2. */}
      <div className="md-summary md-strip">
        <div className="md-sc md-sc-score" data-testid="md-summary-score">
          <div className="md-sc-value md-strip-readout" style={{color: scorePending ? 'var(--text-faint)' : scoreTone(badgeInfo.color)}} {...scoreA11y}>{scoreText}</div>
          <div className="md-sc-label">Reliability Score</div>
          <div className="md-sc-sub">
            {/* The same sentence while the score is pending ("Pending. …", one line like "High. …"), so the tile keeps its
                height when it arrives. */}
            {/* The band word alone ("High", owner 2026-11-19): "Reliability Score" is the label right above it, and the
                sentence fits one line, so the strip is lower. */}
            <span>{`${scorePending ? 'Pending' : tsInfo.label.replace(/ Reliability$/, '')}. Operational health, not solvency.`}{badgeLastNote}</span>
            <button type="button" className="md-strip-link md-sc-score-link" onClick={() => setShowReliabilityBreakdown(true)}>How it is made</button>
          </div>
        </div>
        <div className="md-sc md-sc-latency">
          <div className="md-sc-value">{latency !== null ? <>{latency}<span className="md-strip-unit"> ms</span></> : '—'}</div>
          <div className="md-sc-label">Latency</div>
          <div className="md-sc-sub">
            <span>{latencyCaption()}</span>
            <button
              type="button"
              onClick={() => { void testClientLatency() }}
              disabled={testingLatency}
              className="latency-test-btn"
            >
              {testingLatency && <span className="latency-spinner" />}
              {/* The result replaces the label in the same button (same spot, same height, the strip does not grow);
                  a click measures again. */}
              {clientLatency === null ? CLIENT_LATENCY_BUTTON_LABEL
                : typeof clientLatency === 'number' ? `Your latency: ${clientLatency} ms`
                : clientLatency.startsWith('Unreachable') ? <>Unreachable<span className="sr-only">{clientLatency.slice('Unreachable'.length)}</span></>
                : clientLatency}
            </button>
          </div>
        </div>
        <div className="md-sc md-sc-uptime">
          <div className="md-sc-value" style={{color: uptimeColor(uptimeTile.pct)}}>{uptimeTile.value}</div>
          <div className="md-sc-label">Uptime 24h</div>
          <div className="md-sc-sub" data-testid="md-uptime-24h-checks">{uptimeTile.sub}</div>
        </div>
        <div className="md-sc md-sc-rating">
          {tileReviewCount === null ? (
            <div className="md-sc-value sm" style={{color:'var(--text-faint)'}} aria-label="Loading reviews">…</div>
          ) : tileReviewCount === 0 ? (
            <div className="md-sc-value sm" style={{color:'var(--text-faint)'}}>No reviews yet</div>
          ) : tileAvgRating !== null ? (
            <div className="md-sc-value" style={{opacity: tileReviewCount < MIN_MEANINGFUL_REVIEWS ? 0.6 : 1}}>
              <span className="md-sc-rating-num">{tileAvgRating}</span>{' '}
              <span className="md-sc-stars" aria-label={`${tileAvgRating} out of 5`}>{starString(tileAvgRating)}</span>
            </div>
          ) : (
            <div className="md-sc-value sm" style={{color:'var(--text-faint)'}}>Unrated</div>
          )}
          <div className="md-sc-label md-strip-label-row">
            Community rating
            {knownMint?.reviewSurge && (
              <InfoTooltip
                className="review-surge-flag"
                tone="warn"
                width={210}
                iconSize={11}
                label="Recent review surge"
                text={reviewSurgeText()}
              />
            )}
            {tileOperatorExcluded > 0 && (
              <InfoTooltip
                className="operator-excluded-info"
                width={220}
                iconSize={11}
                label="Operator reviews not counted"
                text={operatorExcludedNote}
              />
            )}
          </div>
          {tileReviewCount !== null && tileReviewCount > 0 && (
            <div className="md-sc-sub">
              {tileReviewCount} review{tileReviewCount !== 1 ? 's' : ''}
              {tileReviewCount < MIN_MEANINGFUL_REVIEWS ? ', too few to be reliable' : ''}
            </div>
          )}
        </div>
        <div className="md-sc md-sc-software">
          <div className="md-sc-value"><span className="md-sc-nut-count">{nutCount}</span><span className="md-strip-unit"> NUTs</span></div>
          <div className="md-sc-label">Software</div>
          <div className="md-sc-sub">
            <span className="md-strip-code">{version ?? 'Version unknown'}</span>
            {isOutdated && <span className="md-outdated-pill">Outdated</span>}
            {disabledNuts.length > 0 && <span className="md-sc-nut-disabled">{disabledNuts.length} disabled</span>}
          </div>
        </div>
      </div>

      {/* The 30 daily bars, wide (2026-11-19 redesign, phase 4): the same data as the mint cards (/api/mints/known
          uptimeDaily30). The 30-day figure that sat in the Uptime tile is the sentence beside the heading. */}
      {knownMint?.uptimeDaily30 && (
        <section className="md-trace" aria-labelledby="md-trace-h">
          <div className="md-trace-head">
            <h2 id="md-trace-h" className="md-trace-title">Last 30 days</h2>
            {uptime30dShownValue != null && (
              <span className="md-trace-note" data-testid="md-uptime-30d">
                <span style={{ color: uptime30dColor(uptime30dShownValue) }}>{formatUptime30d(uptime30dShownValue)}%</span> uptime
                {uptime30dOutageNote(uptime30dShownValue, outagesData?.outageCount) && (
                  <span className="md-uptime-30d-note">{uptime30dOutageNote(uptime30dShownValue, outagesData?.outageCount).replace(/^ · /, ', ')}</span>
                )}
              </span>
            )}
          </div>
          <UptimeBars days={knownMint.uptimeDaily30} variant="wide" readouts={uptimeDayReadouts(knownMint.uptimeDaily30, outagesData?.outages, now)} />
          <div className="uptime-scale" aria-hidden="true">
            <span>{new Date(now - 29 * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
            <span>Today</span>
          </div>
        </section>
      )}

      {/* Tabs (WAI-ARIA tabs pattern): one tab stop, Left/Right/Home/End move and activate, the panel is labelled by its tab. */}
      <div className="md-tabs" role="tablist" aria-label="Mint details">
        {MINT_TABS.map((tab, i) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`md-tab-${tab}`}
            aria-selected={activeTab === tab}
            aria-controls="md-tabpanel"
            tabIndex={activeTab === tab ? 0 : -1}
            className={`md-tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => selectTab(tab)}
            onKeyDown={e => {
              const to = e.key === 'ArrowRight' ? (i + 1) % MINT_TABS.length
                : e.key === 'ArrowLeft' ? (i - 1 + MINT_TABS.length) % MINT_TABS.length
                : e.key === 'Home' ? 0
                : e.key === 'End' ? MINT_TABS.length - 1
                : -1
              if (to < 0) return
              e.preventDefault()
              selectTab(MINT_TABS[to]!)
              document.getElementById(`md-tab-${MINT_TABS[to]!}`)?.focus()
            }}
          >
            {MINT_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className={`md-body md-body-${activeTab}`}>
        <div className="md-left" role="tabpanel" id="md-tabpanel" aria-labelledby={`md-tab-${activeTab}`}>

          {activeTab === 'overview' && (
            <OverviewTab
              headingName={displayName}
              url={url}
              now={now}
              knownMint={knownMint}
              data={data}
              probeLoading={probeLoading}
              probeError={probeError}
              refetchProbe={refetchProbe}
              unavailableInfo={unavailableInfo}
              lastErrorText={lastErrorText}
              scoreText={scoreText}
              supportsBackupRestore={supportsBackupRestore}
              unavailableContacts={unavailableContacts}
              motd={motd}
              description={description}
              descriptionLong={descriptionLong}
              infoLastSeenAt={infoLastSeenAt}
              motdDatesLine={motdDatesLine}
              descriptionDates={descriptionDates}
              nameDates={nameDates}
              nip87Line={nip87Line}
              pubkeyDates={pubkeyDates}
              nut4Disabled={nut4Disabled}
              nut5Disabled={nut5Disabled}
              name={name}
              version={version}
              mintTime={mintTime}
              pubkey={pubkey}
              healthRecord={healthRecord}
              tosUrl={tosUrl}
              urls={urls}
              email={email}
              twitter={twitter}
              nostr={nostr}
              operatorNip05={operatorNip05}
              contactsAreLastSeen={contactsAreLastSeen}
              lastContactsAt={lastContactsAt}
              contactSource={contactSource}
              copiedContact={copiedContact}
              setCopiedContact={setCopiedContact}
            />
          )}

          {activeTab === 'nuts' && (
            <NutsTab
              feesLimits={knownMint ? {
                keysets: feeKeysets,
                keysetsPending: probeLoading && !feeKeysets,
                units: knownMint.units,
                mintMethods: knownMint.mintMethods,
                meltMethods: knownMint.meltMethods,
                disabled: { mint: nut4Disabled, melt: nut5Disabled },
                fetchedAt: infoFetchedAt,
                now,
                changes: mintChanges,
              } : null}
              supportsBackupRestore={supportsBackupRestore}
              supportedNuts={offeredNuts}
              disabledNuts={disabledNuts}
              onSelectNut={setSelectedNut}
              infoFetchedAt={infoFetchedAt}
              now={now}
            />
          )}

          {activeTab === 'history' && (
            <HistoryTab
              chartInterval={chartInterval}
              onChartInterval={setChartInterval}
              chartMetric={chartMetric}
              onChartMetric={setChartMetric}
              chartAvgLatency={chartAvgLatency}
              chartPrevLatency={chartPrevLatency}
              chartAvgUptime={chartAvgUptime}
              chartPrevUptime={chartPrevUptime}
              chartPrevInsufficientHistory={chartPrevInsufficientHistory}
              chartAvgReliability={chartAvgReliability}
              chartLatencyPercentiles={chartLatencyPercentiles}
              chartCoverage={chartCoverage}
              histLineData={histLineData}
              outagesData={outagesData}
              lastErrorText={lastErrorText}
              versionHistory={versionHistory}
            />
          )}

          {activeTab === 'audit' && (
            <AuditTab
              auditCzLoading={auditCzLoading}
              czView={czView}
              czSyncNote={czSyncNote}
              now={now}
            />
          )}

          {activeTab === 'reviews' && (
            <ReviewsTab
              url={url}
              isLoggedIn={isLoggedIn}
              setShowReviewModal={setShowReviewModal}
              operatorListedCount={operatorListedCount}
              reviewsLoading={reviewsLoading}
              mergedReviews={mergedReviews}
              storedReviewsFailed={storedReviewsFailed}
              activeReviewFilter={activeReviewFilter}
              setReviewFilter={setReviewFilter}
              reviewCountBase={reviewCountBase}
              reviewFilterFiveStarCount={reviewFilterFiveStarCount}
              reviewFilterCriticalCount={reviewFilterCriticalCount}
              hideAnonActive={hideAnonActive}
              toggleReviewHideAnon={toggleReviewHideAnon}
              reviewFilterAnonCount={reviewFilterAnonCount}
              filteredReviews={filteredReviews}
              pagedReviews={pagedReviews}
              highlightedReview={highlightedReview}
              verifiedNip05ByPubkey={verifiedNip05ByPubkey}
              operatorKeys={operatorKeys}
              contactListed={contactListed}
              copiedReviewAction={copiedReviewAction}
              setCopiedReviewAction={setCopiedReviewAction}
              reviewsPage={reviewsPage}
              reviewsTotalPages={reviewsTotalPages}
              goToReviewsPage={goToReviewsPage}
              summary={{
                avg: tileAvgRating,
                count: tileReviewCount,
                rated: ratedReviews.length,
                perStar: [5, 4, 3, 2, 1].map(s => ratedReviews.filter(r => Math.round(r.rating as number) === s).length) as [number, number, number, number, number],
              }}
            />
          )}

        </div>

        {/* The side column is on Overview only since the 2026-11-19 redesign (phase 4b): the other tabs get the full width
            for charts and tables. Keysets are here at every width (the NUTs tab's phone copy is gone). */}
        {activeTab === 'overview' && (
        <div className="md-right">

          {/* "How the 92 is made" (phase 4b): the score is in the strip, so no gauge here; the five parts, each with its source. */}
          <section className="md-panel md-reliability-panel" aria-labelledby="md-rb-title">
            <div className="md-panel-h">
              <div>
                <h2 id="md-rb-title" className="md-panel-title">{scorePending ? 'How the score is made' : `How the ${scoreText} is made`}</h2>
                <p className="md-panel-sub">Methodology version {METHODOLOGY_VERSION}</p>
              </div>
              <Link to="/methodology" className="md-method-ver">Methodology</Link>
            </div>
            {limitedDataLabel && <div className="md-rb-limited">{limitedDataLabel}</div>}
            {unavailable && <div className="rb-scope-note md-ua-caption">{LAST_SCORE_CAPTION}</div>}
            {isNew && <div className="rb-new-note">{newMintCapNote()}</div>}
            <div className="md-rb-rows">
              {reliabilityBreakdownRows.map(row => (
                <ReliabilityBreakdownRow key={row.label} {...row} />
              ))}
              {storedCapLine}
            </div>
          </section>

          {knownMint?.units && knownMint.units.length > 0 && (
            <section className="md-panel md-um-panel md-um-panel-methods" aria-labelledby="md-um-title">
              <h2 id="md-um-title" className="md-panel-title">Units and methods</h2>
              {/* One row per unit: what you can deposit with (NUT-04) and withdraw with (NUT-05), as the mint declares it. */}
              <table className="md-methods-table">
                <thead>
                  <tr><th scope="col">Unit</th><th scope="col">Mint (deposit)</th><th scope="col">Melt (withdraw)</th></tr>
                </thead>
                <tbody>
                  {sortUnits(knownMint.units).map(unit => {
                    const cell = (list: typeof knownMint.mintMethods, off: boolean) => {
                      const c = methodsCell((list ?? []).filter(m => m.unit === unit), off)
                      return c.state === 'list'
                        ? <span className="md-methods-list">{c.text.split(', ').map(methodPlainText).join(', ')}</span>
                        : <span className={`md-methods-${c.state}`}>{c.text}</span>
                    }
                    return (
                      <tr key={unit}>
                        <th scope="row"><span className="unit-badge">{unit.toUpperCase()}</span></th>
                        <td>{cell(knownMint.mintMethods, nut4Disabled)}</td>
                        <td>{cell(knownMint.meltMethods, nut5Disabled)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="md-panel-hint">Limits and fees are on the <button type="button" className="md-strip-link" onClick={() => selectTab('nuts')}>NUTs tab</button>.</p>
            </section>
          )}

          <div className="md-keysets-at-overview md-um-panel md-um-panel-keysets">{keysetsPanel}</div>
        </div>
        )}
      </div>

      {showQr && !isArchived && (
        <div className="qr-modal-overlay" onClick={() => setShowQr(false)}>
          <div className="qr-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="qr-modal-title" ref={dialogRef}>
            <div className="qr-modal-header">
              <MintFavicon url={url} iconUrl={data?.info?.icon_url ?? null} size={38} radius={9} />
              <div className="qr-modal-heading">
                <div id="qr-modal-title" className="qr-modal-title">Add {displayName} to wallet</div>
                <div className="qr-modal-sub">Scan with any Cashu wallet app</div>
              </div>
              <button type="button" className="qr-modal-close" onClick={() => setShowQr(false)} aria-label="Close"><IcClose /></button>
            </div>
            <div className="qr-modal-code">
              <div className="qr-modal-code-frame">
                <QRCodeSVG
                  value={url}
                  size={184}
                  level="L"
                  marginSize={1}
                  bgColor="#ffffff"
                  fgColor="#000000"
                  role="img"
                  aria-label="QR Code"
                  style={{display:'block',width:184,height:184}}
                />
              </div>
            </div>
            <div className="qr-modal-url-row">
              <input
                className="qr-modal-url"
                readOnly
                aria-label="Mint URL"
                value={url}
              />
              <button
                type="button"
                className="qr-modal-copy"
                onClick={() => { void navigator.clipboard.writeText(url); setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000) }}
              >
                {copiedUrl ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showWatchLoginModal && (
        <div className="rv-modal-overlay" onClick={closeWatchLoginModal}>
          <div className="rv-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Watch this mint" ref={dialogRef}>
            <div className="rv-modal-head">
              <div className="rv-modal-heading">
                <div className="rv-modal-title">Watch this mint</div>
                <div className="rv-modal-sub">
                  Log in with Nostr to add it to your watchlist. Your list syncs over Nostr. You can then turn on an optional Nostr DM for this mint when it goes offline or comes back online.
                </div>
              </div>
              <button type="button" className="rv-modal-close" onClick={closeWatchLoginModal} aria-label="Close"><IcClose /></button>
            </div>
            <div className="rv-actions">
              <button type="button" className="rv-btn-cancel" onClick={closeWatchLoginModal}>Cancel</button>
              <button type="button" className="rv-btn-submit rv-btn-login" onClick={confirmWatchLogin}><Zap size={14} strokeWidth={2.2} aria-hidden="true" /> Log in with Nostr</button>
            </div>
          </div>
        </div>
      )}

      {showReliabilityBreakdown && (
        <div className="rb-overlay" onClick={() => setShowReliabilityBreakdown(false)}>
          <div className="rb-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="reliability-breakdown-title" ref={dialogRef}>
            <div className="rb-head">
              <div id="reliability-breakdown-title" className="rb-title">Reliability Score Breakdown</div>
              <Link to="/methodology" className="md-method-ver rb-method-ver">Methodology v{METHODOLOGY_VERSION}</Link>
              <button type="button" className="rb-close" onClick={() => setShowReliabilityBreakdown(false)} aria-label="Close"><IcClose /></button>
            </div>
            <div className="rb-hero">
              <div className="rb-hero-score" style={{color:reliabilityScore === null ? 'var(--text3)' : scoreTone(reliabilityScoreColor(reliabilityScore))}} {...scoreA11y}>{scoreText}</div>
              <span className="rb-hero-badge" data-testid="rb-hero-badge" style={{color:badgeInfo.color,background:badgeInfo.bg,borderColor:badgeInfo.border}}>{tsInfo.label}{badgeLastNote}</span>
              {limitedDataLabel}
            </div>
            {unavailable && <div className="rb-scope-note md-ua-caption">{LAST_SCORE_CAPTION}</div>}
            {reliabilityBreakdownRows.map(row => (
              <ReliabilityBreakdownRow key={row.label} {...row} />
            ))}
            {storedCapLine}
            <div className="rb-formula">
              {scoreFormulaText()}
              {' '}<Link to="/methodology" className="rb-method-link">How the score is computed</Link>
            </div>
          </div>
        </div>
      )}

      {showReviewModal && (
        <div className="rv-modal-overlay" onClick={requestCloseReviewModal}>
          <div className="rv-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Write a review" ref={dialogRef}>
            <div className="rv-modal-head">
              <div className="rv-modal-heading">
                <div className="rv-modal-title">Write a review for {displayName}</div>
                <div className="rv-modal-sub">Share your experience with this mint.</div>
              </div>
              <button className="rv-modal-close" onClick={requestCloseReviewModal} aria-label="Close"><IcClose /></button>
            </div>

            {/* Phase 1 + 2 share the star row. Hover/focus previews up to the
                pointer; once a star is clicked the form below unfolds. */}
            <div className="rv-rate">
              <div className="rv-stars" onMouseLeave={() => setReviewHoverRating(0)}>
                {[1, 2, 3, 4, 5].map(star => (
                  <button
                    key={star}
                    type="button"
                    className="rv-star"
                    data-filled={star <= (reviewHoverRating || reviewRating)}
                    aria-label={`${star} star${star > 1 ? 's' : ''}${RATING_LABELS[star as 1 | 2 | 3 | 4 | 5] ? ` — ${RATING_LABELS[star as 1 | 2 | 3 | 4 | 5]}` : ''}`}
                    aria-pressed={reviewRating === star}
                    onMouseEnter={() => setReviewHoverRating(star)}
                    // Keyboard focus previews like hover; the focus the dialog moves here on open does not
                    // (it lit stars the user had not chosen). :focus-visible tells the two apart.
                    onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setReviewHoverRating(star) }}
                    onBlur={() => setReviewHoverRating(0)}
                    onClick={() => setReviewRating(star)}
                  >
                    ★
                  </button>
                ))}
              </div>
              <span className="rv-rate-label" data-chosen={reviewRating > 0}>
                {reviewRating > 0
                  ? `${reviewRating}: ${RATING_LABELS[reviewRating as 1 | 2 | 3 | 4 | 5]}`
                  : 'Choose a rating'}
              </span>
            </div>

            {reviewRating > 0 && (
              <div className="rv-phase2">
                <div className="rv-signer">
                  {profile?.picture?.startsWith('https://')
                    ? <img src={profile.picture} alt="" className="rv-signer-avatar" onError={e => { e.currentTarget.style.display = 'none' }} />
                    : <div className="rv-signer-avatar rv-signer-avatar-fallback" style={{ background: reviewAvatarColor(profile?.pubkey ?? '0'), color: avatarTextColor(reviewAvatarColor(profile?.pubkey ?? '0')) }}>
                        {avatarInitial(profile?.name) ?? <User size={15} strokeWidth={2.4} aria-hidden="true" />}
                      </div>}
                  <div className="rv-signer-text">
                    <span className="rv-signer-label">Signing with</span>
                    <span className="rv-signer-id">
                      <span className="rv-signer-name">{profile?.name ?? (profile ? shortNpub(profile.npub) : 'Nostr account')}</span>
                    </span>
                  </div>
                  {authMethod !== null && <span className="rv-signer-badge">{METHOD_BADGE[authMethod]}</span>}
                </div>

                <div className="rv-field">
                  <label className="rv-field-label" htmlFor="rv-comment">Your review (optional)</label>
                  <textarea
                    id="rv-comment"
                    aria-describedby="rv-charcount"
                    className="rv-textarea"
                    value={reviewComment}
                    onChange={e => setReviewComment(e.target.value)}
                    placeholder="What should other people know?"
                    maxLength={500}
                    rows={3}
                  />
                  <div className="rv-charcount" id="rv-charcount">{reviewComment.length} / 500 characters</div>
                </div>

                {reviewError !== null && <div className="rv-msg rv-msg-error">{reviewError}</div>}
                {reviewSuccess && <div className="rv-msg rv-msg-success">✓ Review published!</div>}

                <div className="rv-actions">
                  <button type="button" className="rv-btn-cancel" onClick={requestCloseReviewModal}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rv-btn-submit"
                    disabled={reviewSubmitting}
                    onClick={() => {
                      void (async () => {
                        setReviewSubmitting(true)
                        setReviewError(null)
                        try {
                          await submitMintReview(url, reviewRating, reviewComment)
                          setReviewSuccess(true)
                          setTimeout(() => { closeReviewModal() }, 1500)
                        } catch (err) {
                          setReviewError(err instanceof Error ? err.message : 'Failed to publish review')
                        } finally {
                          setReviewSubmitting(false)
                        }
                      })()
                    }}
                  >
                    {reviewSubmitting ? 'Publishing...' : 'Sign and publish'}
                  </button>
                </div>
                <p className="rv-permanence-note">Published permanently to public Nostr relays.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedNut && (() => {
        const meta = NUT_DESCRIPTIONS[selectedNut]
        const supported = supportedNuts.includes(selectedNut)
        const nutKey = parseInt(selectedNut.slice(4), 10).toString()
        const rawNutConfig = data?.info?.nuts?.[nutKey] ?? knownMint?.nutsLimits?.[nutKey]
        const nutConfig = (rawNutConfig !== null && typeof rawNutConfig === 'object') ? rawNutConfig as NutConfig : null
        const isNutDisabled = disabledNuts.includes(selectedNut)
        // How many online mints offer this NUT: the same client list and the same rule as the Stats NUT coverage modal.
        const offerCounts = knownMintsData ? nutOfferBreakdown(knownMintsData, nutKey) : null
        // Not supported: say which of the two plain facts it is (absent vs. listed with `supported: false`); unknown while no data.
        const declaredEntry = nutsDeclared?.[nutKey]
        const stateFact = supported || isNutDisabled || nutsDeclared == null ? null
          : declaredEntry != null ? 'Listed, marked unsupported by this mint' : 'Not listed by this mint'
        return (
          <div className="nm-overlay" onClick={() => setSelectedNut(null)}>
            <div
              className="nm"
              onClick={e => e.stopPropagation()}
              role="dialog" aria-modal="true" aria-labelledby="nut-modal-title" ref={dialogRef}
            >
              <div className="nm-head">
                <div className="nm-heading">
                  <div id="nut-modal-title" className="nm-title">{meta?.short ?? selectedNut}</div>
                  <div className="nm-code">{selectedNut}</div>
                </div>
                <span className={`nm-status ${isNutDisabled ? 'disabled' : supported ? 'ok' : 'off'}`}>
                  {isNutDisabled ? '⊘ Disabled by operator' : supported ? '✓ Supported' : '– Not supported'}
                </span>
                <button type="button" className="rv-modal-close" onClick={() => setSelectedNut(null)} aria-label="Close"><IcClose /></button>
              </div>

              <NutDescription nut={selectedNut} />
              {stateFact && <p className="nm-text nm-fact">{stateFact}</p>}
              {offerCounts && offerCounts.online > 0 && (
                <p className="nm-text nm-fact">Offered by {offerCounts.offering.length} of {offerCounts.online} online mint{offerCounts.online !== 1 ? 's' : ''}.</p>
              )}

              {meta?.features && (
                <div className="nm-sec">
                  <div className="nm-sec-label">What this NUT covers</div>
                  <div className="nm-chips">
                    {meta.features.map(f => <span key={f} className="nm-chip">{f}</span>)}
                  </div>
                </div>
              )}

              {meta?.useCase && (
                <div className="nm-sec">
                  <div className="nm-sec-label">Use case</div>
                  <p className="nm-text">{meta.useCase}</p>
                </div>
              )}

              {nutConfig?.methods && nutConfig.methods.length > 0 && (
                <div className="nm-sec">
                  <div className="nm-sec-label">Limits</div>
                  {nutConfig.methods.map((m, i) => (
                    <div key={i} className="nm-limit">
                      <span className="nm-limit-method">{m.method} / {m.unit}</span>
                      <span className="nm-limit-range">
                        {m.min_amount == null && m.max_amount == null ? 'No limits specified' : (<>
                          {m.min_amount != null ? m.min_amount.toLocaleString() : '—'}
                          {' – '}
                          {m.max_amount != null ? m.max_amount.toLocaleString() : '—'}
                        </>)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <NutSpecLink nut={selectedNut} />
            </div>
          </div>
        )
      })()}

      {showComparePicker && (() => {
        const baseMint = knownMintsData?.find(m => m.url === url)
        const candidates = (knownMintsData ?? []).filter(m => m.url !== url && m.online === true)
        return (
          <MintComparePicker
            candidates={candidates}
            baseLabel={baseMint ? mintDisplayName(baseMint, duplicateDisplayNames) : displayName}
            duplicateDisplayNames={duplicateDisplayNames}
            onClose={() => setShowComparePicker(false)}
            onConfirm={urls => {
              setCompareSelectedUrls(new Set(urls))
              setShowComparePicker(false)
              setShowComparisonModal(true)
            }}
          />
        )
      })()}

      {showComparisonModal && (() => {
        const comparedMints = [
          ...(knownMintsData?.filter(m => m.url === url) ?? []),
          ...(knownMintsData?.filter(m => compareSelectedUrls.has(m.url)) ?? []),
        ]
        return comparedMints.length >= 2
          ? <Suspense fallback={null}><ComparisonModal mints={comparedMints} onClose={() => setShowComparisonModal(false)} /></Suspense>
          : null
      })()}
    </div>
  )
}

function safeDecode(raw: string): string | null {
  try { return decodeURIComponent(raw) } catch { return null }
}

function MintNotTracked({ slug, suggestion }: { slug: string; suggestion: string | null }) {
  const navigate = useNavigate()
  // Own title (it kept the previous page's title), no canonical link, noindex: the same tags as the 404 page.
  useDocumentMeta(MINT_NOT_FOUND_TITLE, undefined, { noindex: true, notFound: true })
  return (
    <div className="mint-detail">
      {/* Only Back: no card around it (an empty bordered box read as a header that failed to load). */}
      <div className="md-header md-header-bare">
        <Link className="md-back" to="/"><ChevronLeft size={16} aria-hidden="true" /><span className="md-back-label">All mints</span></Link>
      </div>
      <div className="md-not-tracked">
        <h1 className="md-not-tracked-title">Not a tracked mint</h1>
        <p className="md-not-tracked-body">
          MintRadar isn’t tracking <code>{slug}</code>. It may not be a Cashu mint, or it hasn’t been submitted yet.
        </p>
        {suggestion && (
          <p className="md-not-tracked-suggest">
            Did you mean{' '}
            <button
              type="button"
              className="md-not-tracked-link"
              onClick={() => navigate(`/mint/${encodeURIComponent(suggestion)}`, { replace: true })}
            >
              {mintHostname(suggestion)}
            </button>
            ?
          </p>
        )}
        <p className="md-not-tracked-suggest">
          <button type="button" className="md-not-tracked-link" onClick={() => navigate('/')}>Browse tracked mints →</button>
        </p>
        <p className="md-not-tracked-suggest">
          {/* Opens the Dashboard's "Add a mint" dialog (location state openAddMint); nothing is submitted from here. */}
          Know this mint?{' '}
          <button type="button" className="md-not-tracked-link" data-testid="not-tracked-add" onClick={() => navigate('/', { state: { openAddMint: true } })}>Add a mint</button>
        </p>
      </div>
    </div>
  )
}

// A slug that does not decode has no mint page to point a canonical at.
function MintInvalidUrl() {
  // Own title (it kept the previous page's title), no canonical link, noindex: the same tags as the 404 page.
  useDocumentMeta(MINT_NOT_FOUND_TITLE, undefined, { noindex: true, notFound: true })
  return (
    <div className="mint-detail">
      <div className="md-header md-header-bare">
        <Link className="md-back" to="/"><ChevronLeft size={16} aria-hidden="true" /><span className="md-back-label">All mints</span></Link>
      </div>
      <h1 style={{ color: 'var(--red)', padding: '24px', fontSize: '14px', fontWeight: 400 }}>Invalid mint URL.</h1>
    </div>
  )
}

export default function MintDetail() {
  const params = useParams<{ url: string }>()
  const rawUrl = params['url']
  const { hash } = useLocation()
  const { data: knownMintsData, isError: knownError, refetch: refetchKnown } = useKnownMints()

  const slug = rawUrl === undefined ? null : safeDecode(rawUrl)

  if (slug === null) return <MintInvalidUrl />

  // Need the tracked list before we can canonicalise a bare-host slug and decide
  // between "redirect to the real mint" and "not tracked".
  // A failed list is an error state with a retry, never "Not a tracked mint" (the list is simply missing).
  if (knownMintsData === undefined) {
    return (
      <div className="mint-detail mint-detail-pending">
        <div className="md-header">
          <Link className="md-back" to="/"><ChevronLeft size={16} aria-hidden="true" /><span className="md-back-label">All mints</span></Link>
        </div>
        <h1 className="sr-only">Mint details</h1>
        {knownError ? <LoadError message={MINT_LIST_ERROR} onRetry={() => void refetchKnown()} /> : <LoadingNote />}
      </div>
    )
  }

  const resolution = resolveMintDetailUrl(slug, knownMintsData)
  if (resolution.kind === 'redirect') {
    // The hash goes along (#audit, #history, #review-<id>…), so a short link can open a tab.
    return <Navigate to={{ pathname: `/mint/${encodeURIComponent(resolution.url)}`, hash }} replace />
  }
  if (resolution.kind === 'not-tracked') {
    return <MintNotTracked slug={resolution.slug} suggestion={resolution.suggestion} />
  }

  return <MintDetailContent url={resolution.url} />
}
