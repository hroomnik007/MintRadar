import { njumpEventUrl, mintAnnounceNaddr } from '@/utils/nostrLinks'
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom'
import { Fragment, useEffect, useState, useMemo, useCallback, lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { IcStar } from '@/components/mint/IcStar'
import { ChangeDate, PendingTag } from '@/components/mint/ChangeDate'
import { useMintChanges } from '@/hooks/useMintChanges'
import { infoDates, infoTitle, keysetDates, keysetPending } from '@/utils/changeDates'
import { useMintProbe } from '@/hooks/useMintProbe'
import {
  reviewSurgeText, AUDIT_MINTS_TEXT, AUDIT_MELTS_TEXT, auditSuccessRateText, uptimeRowText, auditRowText, NUT_ROW_TEXT,
  versionRowText, contactRowText, scoreFormulaText, cashuInfoViewText,
  HTTP_ERROR_EXPLANATIONS, NON_HTTP_ERROR_EXPLANATIONS, operatorExcludedText,
  KEYSETS_HINT, KEYSET_FEE_TEXT, newMintBadgeText, newMintCapNote,
  UPTIME_ROW_LABEL, AUDIT_ROW_LABEL, NUT_ROW_LABEL, VERSION_ROW_LABEL, CONTACT_ROW_LABEL,
  UPTIME_POINTS, AUDIT_POINTS, NUT_POINTS, VERSION_POINTS, CONTACT_POINTS,
  auditTooFewDetail, auditTooOldDetail, OUTAGES_WINDOW_DAYS,
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
import { supportedNutKeys } from '@/utils/nutSupport'
import { formatDate } from '@/utils/formatDate'
import { displayName as mintDisplayName, isNewMint, firstSeenLabel, reliabilityScoreColor, reliabilityScoreInfo, SCORE_PENDING_INFO, SCORE_PENDING_TEXT, UPTIME_PENDING_ARIA_LABEL, SCORE_PENDING_ARIA_LABEL, formatAuditSuccessRatio, reliabilityDonutArc, auditReliabilityColor, MIN_MEANINGFUL_REVIEWS, mintHostname, resolveMintDetailUrl, computeDuplicateMintNames } from '@/utils/mintFormatting'
import { TRACKED_NUTS } from '@/constants/nuts'
import { isTestMint } from '@/constants/testMints'
import { operatorPubkeys } from '@/utils/operatorPubkeys'
import { cleanMintNameDetailed } from '@/utils/cleanMintName'
import { formatKeysetFee, urlIsOnion, listHasOnion } from '@/utils/mintProbeDisplay'
import { keysetExpiry, keysetExpiryMs } from '@/utils/keysetExpiry'
import { auditComponent, auditDataState, auditAgeHours, isAuditUnknown, AUDIT_MIN_SAMPLES } from '@/utils/auditScore'
import { auditFreshness, audit8333StaleLine } from '@/utils/auditFreshness'
import { IcClose } from '@/components/IcClose'
import { useAuditCz } from '@/hooks/useAuditCz'
import { adaptAuditCz, auditCzSyncNote, type AuditSwapRow } from '@/utils/auditCz'
import { sortUnits } from '@/utils/sortUnits'
import {
  computeReliabilityScore as sharedComputeReliabilityScore,
  uptimeComponent, nutComponent, versionComponent, contactComponent,
  type AuditInput,
} from '@/utils/reliabilityScore'
import { classifyMintVersion, latestMapFor, type LatestVersions } from '@/utils/versionRule'
import { useNow } from '@/hooks/useNow'
import { mintDetailMeta } from '@/utils/pageMeta'
import { useDocumentMeta, useNoindex, useRemoveCanonical } from '@/hooks/useDocumentMeta'
import { CLIENT_LATENCY_BUTTON_LABEL, latencyCaption } from '@/constants/probeLocation'
import { useElementHeight } from '@/hooks/useElementHeight'
import { METHODOLOGY_VERSION } from '@/utils/methodology'
import { auditSuccessText, breakdownRowScore, breakdownPointsColor, contactKindsText, infoTextFor, averageReliability, latencyPercentilesText, showTorFor, type OutagesResponse } from '@/utils/mintDetailFacts'
import { auditSourceLine, infoSourceLine, uptimeSourceLine, type SourceLine } from '@/utils/scoreSources'
import { limitedDataReasons, limitedDataText } from '@/utils/limitedData'
import { LAST_SCORE_CAPTION, sanitizeLastError, unavailableHeadline } from '@/utils/unavailableMint'
import { healthRecordFor } from '@/utils/healthRecord'
import { useIsMobile } from '@/hooks/useIsMobile'
import { NutsTab } from './mintDetail/NutsTab'
import { HistoryTab } from './mintDetail/HistoryTab'
import { AuditTab, AUDIT_SWAP_ROWS_DEFAULT } from './mintDetail/AuditTab'
import { ReviewsTab } from './mintDetail/ReviewsTab'
import { OverviewTab } from './mintDetail/OverviewTab'
import { shortNpub, starString, type MergedReviewCandidate } from './mintDetail/reviewFormat'
import { NUT_DESCRIPTIONS, type NutConfig } from './mintDetail/nutCatalog'
import { reviewAvatarColor, avatarTextColor } from '@/utils/avatarColors'
import './MintDetail.css'

// Heavy, rarely needed parts load on demand: the Compare modal (only when opened). The History chart (recharts) is lazy in
// mintDetail/HistoryTab.tsx.
const ComparisonModal = lazy(() => import('@/components/ComparisonModal').then(m => ({ default: m.ComparisonModal })))
import {
  Copy, Check, Info, AlertTriangle,
  Shield,
  Clock, GitBranch, Layers, Zap, QrCode,
  Star,
  ArrowUpRight,
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
  const navigate = useNavigate()
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

  // Name rule (2026-10-05): a TRACKED mint uses the known-mint display name only (the backend cleaned it
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
  const { data: uptime24hData } = useQuery({
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


  // Avatar height tracks .md-namebox's actual rendered height (name/URL/First
  // seen/Announced-on-Nostr lines) so a 3-line mint (no Nostr announcement)
  // doesn't leave empty space below a still-4-line-tall avatar, and a 4-line
  // one doesn't overflow past a still-3-line-tall avatar. Falls back to the
  // old fixed 80/40px until the first ResizeObserver measurement lands.
  // Clamped to the same fixed column width .md-avatar-id's CSS grid reserves
  // for the avatar (--md-avatar-col) — that column is deliberately NOT sized
  // from the avatar's own rendered width, precisely so this clamp can't feed
  // back into .md-namebox's available width and self-amplify (verified this
  // was a real runaway-growth bug before the grid+clamp fix: on a 390px
  // mobile viewport, a 4-line mint with a Nostr announcement spiralled the
  // avatar past 300px, since a taller avatar narrowed namebox, which wrapped
  // more, which grew the measured height further). Keep in sync with
  // .md-avatar-id's --md-avatar-col value (112px) and its mobile override.
  //
  // Mobile's cap is 40 — i.e. unchanged from the old fixed size, growth
  // disabled entirely. Verified empirically (not a guess): even the 3-line
  // baseline's natural, unwrapped height is ~66px on a 390px phone, already
  // taller than 40, and mobile text already sits right at its own wrap
  // threshold (confirmed this wraps identically on the pre-this-feature
  // code at 375px — a pre-existing, unrelated condition). Any cap above 40
  // (tried up to 56) measurably wrapped "First seen by MintRadar <Mon YYYY>"
  // onto a second line at common widths (375–414px) that fit on one line
  // today. So there is no cap value that both (a) lets the avatar grow past
  // 40 and (b) doesn't risk new wrapping on real mobile widths — 40 is the
  // only safe choice, and it reproduces the original mobile layout exactly.
  const isMobile = useIsMobile()
  const AVATAR_COL_CAP = isMobile ? 40 : 72
  const [nameboxRef, nameboxHeight] = useElementHeight<HTMLDivElement>()
  const avatarSize = Math.min(nameboxHeight ?? (isMobile ? 40 : 72), AVATAR_COL_CAP)

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
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'nuts' | 'audit' | 'reviews'>('overview')
  const [showAllAuditSwaps, setShowAllAuditSwaps] = useState(false)
  // cashu.info view: each of the two swap tables expands on its own.
  const [showAllCzFrom, setShowAllCzFrom] = useState(false)
  const [showAllCzTo, setShowAllCzTo] = useState(false)
  // Keysets card: inactive keysets are folded by default. Keyed by mint like reviewsPageState, so switching mints folds them again without a reset effect.
  const [keysetsExpandedFor, setKeysetsExpandedFor] = useState<string | null>(null)
  // Last ≤100 audit.8333.space swaps for this mint (backend/src/discovery.ts's
  // mint_audit_swaps, served via GET /api/mints/swaps — never audit.8333.space
  // directly). Lazily fetched only once the Audit tab is actually opened, and
  // cached from then on for the rest of the session.
  const { data: auditSwapsData, isLoading: auditSwapsLoading, isError: auditSwapsError, refetch: refetchAuditSwaps } = useQuery({
    queryKey: ['mint', 'audit-swaps', url],
    queryFn: async () => {
      const res = await fetch(`/api/mints/swaps?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error('Failed to fetch audit swaps')
      return await res.json() as {
        url: string
        avgTimeMs: number | null
        swaps: Array<{
          swapId: number
          toUrl: string | null
          amount: number | null
          fee: number | null
          createdAt: string | null
          timeTakenMs: number | null
          state: string
          error: string | null
        }>
      }
    },
    enabled: activeTab === 'audit',
    staleTime: 5 * 60 * 1000,
  })
  // cashu.info data: fetched (from our own /api/mints/audit-cz, never from them) only while
  // the Audit tab is open and the known-mints list has loaded. The breakdown's Audit row does not use it.
  const { data: auditCzData, loading: auditCzLoading } = useAuditCz(url, activeTab === 'audit')
  const czData = adaptAuditCz(auditCzData, now)
  // Source chosen with the header switch (null = default: cashu.info when the 8333 data is missing/stale).
  const [auditSourcePick, setAuditSourcePick] = useState<'cz' | '8333' | null>(null)
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

  // Review deep-link (#review-<id>). This used to live further down, after
  // `filteredReviews` was computed — but that placement was after the loading
  // early-return below, so the effect was skipped on the loading render and
  // then called on every render once data arrived: a Rules-of-Hooks violation
  // (inconsistent hook count across renders of the same mount). Nothing this
  // effect (or `filteredReviews`) needs actually depends on `data`/
  // `knownMintsData` — only on already-resolved review state (`mergedReviews`,
  // `reviewFilterState`, `reviewHideAnonState`) and the route `url` — so both
  // can run unconditionally up here instead.
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
  useEffect(() => {
    const raw = window.location.hash
    const m = raw.match(/^#(overview|history|nuts|audit|reviews)$/)
    if (!m?.[1]) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab(m[1] as 'overview' | 'history' | 'nuts' | 'audit' | 'reviews')
  }, [url])

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
          <button className="md-back" aria-label="Back" onClick={() => navigate(-1)}><span className="md-back-arrow">←</span><span className="md-back-label">Back</span></button>
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
  // Header NUT count: the same tracked + declared-as-supported count as the NUTs tab and the score (the stored one until the
  // live /v1/info arrives). Object.keys(nuts).length also counted untracked NUTs and `supported: false` entries.
  const nutCount = data?.info ? supportedNuts.length : (knownMint?.nutCount ?? 0)
  // NUT-13 (deterministic secrets) is wallet-side only — mints never advertise
  // it in /v1/info (confirmed against live Nutshell mints and the cashubtc/nuts
  // spec, which lists no mint implementations for NUT-13 at all). The mint-side
  // capability that actually gates seed-phrase backup/restore is NUT-09
  // (restore signatures) — check that instead.
  const supportsBackupRestore = supportedNutNumbers.has('9')

  // The stored (server-side) score wins. Without one, the score is computed here from the 24 h uptime: until that history
  // has arrived (or when its request failed) there is no score to show, and computing it with uptime 0 showed a wrong
  // number for a moment (Task F3). Every place below shows SCORE_PENDING_* while `reliabilityScore` is null.
  const fallbackScore = () => computeReliabilityScore(uptimePct, supportedNuts.length, version, email, twitter, nostr, { blamed: knownMint?.auditCzBlamed ?? null, total: knownMint?.auditCzTotal ?? null, fetchedAt: knownMint?.auditCzFetchedAt ?? null }, versionLatestMap)
  const reliabilityScore: number | null = knownMint?.reliabilityScore ?? (uptime24hData ? fallbackScore() : null)
  const scorePending = reliabilityScore === null
  const scoreText = scorePending ? SCORE_PENDING_TEXT : String(reliabilityScore)
  // role="img" gives the placeholder's aria-label something to be announced on.
  const scoreA11y = scorePending ? { role: 'img', 'aria-label': SCORE_PENDING_ARIA_LABEL } as const : {}
  const tsInfo = reliabilityScore === null ? SCORE_PENDING_INFO : reliabilityScoreInfo(reliabilityScore)
  const reliabilityDonut = reliabilityDonutArc(reliabilityScore ?? 0)

  // Reliability Score Breakdown modal rows — hoisted out of the modal's JSX (was a
  // nested IIFE) because the react-compiler ESLint rules disallow reading a
  // ref from inside a hand-rolled nested function during render.
  const breakdownUScore = uptimeComponent(uptimePct)
  // The 24 h history is missing (not loaded yet, or its request failed) or loaded without data (uptimePct null): the Uptime row
  // shows a placeholder, never the 0 that `uptimePct` stands in for (a mint with a stored score showed a red 0% and 0/40). A
  // real 0 (uptimePct 0, a mint that was really down) is still shown as "0%".
  const uptimeRowPending = scorePending || uptime24hData === undefined || uptime24hData.uptimePct === null
  const breakdownNScore = nutComponent(supportedNuts.length)
  const breakdownVScore = versionComponent(version, versionLatestMap)
  const breakdownContactFields = [email, twitter, nostr].filter(Boolean)
  const breakdownCScore = contactComponent(breakdownContactFields.length)
  // The stored record of the shown score (/api/mints/known scoreBreakdown): its points per row win, so the rows add up to
  // the score; the live values below are display text only. null (not written yet): the live computation, as before.
  const storedBreakdown = knownMint?.reliabilityScore != null ? (knownMint.scoreBreakdown ?? null) : null
  const breakdownContactDisplay = breakdownContactFields.length === 0
    ? (storedBreakdown && storedBreakdown.contact.points > 0 ? (contactKindsText(data?.contactChecks) ?? 'Listed at last check') : 'None')
    : (email ? 'Email' : '') + (twitter ? (email ? ' + Twitter' : 'Twitter') : '') + (nostr ? ((email || twitter) ? ' + Nostr' : 'Nostr') : '')
  // Audit part of the score: cashu.info's 7-day attributed failures (mints.audit_cz_*), the same
  // functions the server scores with (shared/auditScore.ts). The audit.8333.space figures below
  // (breakdownAuditRecent*) are for the Audit tab only.
  const auditCzBlamed = knownMint?.auditCzBlamed ?? null
  const auditCzTotal = knownMint?.auditCzTotal ?? null
  const auditCzFetchedAt = knownMint?.auditCzFetchedAt ?? null
  const breakdownAScore = auditComponent(auditCzBlamed, auditCzTotal, auditCzFetchedAt, now)
  const auditState = auditDataState(auditCzBlamed, auditCzTotal, auditCzFetchedAt, now)
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
  const breakdownAuditDisplay = auditState === 'scored' ? (auditSuccessText(auditCzBlamed, auditCzTotal) ?? 'neutral') : 'neutral'
  const auditAgeDays = auditAgeH !== null && auditAgeH > 24 && (auditState === 'scored' || auditState === 'too-few') ? Math.floor(auditAgeH / 24) : null
  const auditStaleNote = auditAgeDays !== null ? `data ${auditAgeDays} ${auditAgeDays === 1 ? 'day' : 'days'} old` : undefined
  const breakdownAuditRecentTotal = knownMint?.auditRecentTotal ?? null
  const breakdownAuditRecentErrors = knownMint?.auditRecentErrors ?? null
  // Audit summary strip's "Recent success rate" cell — the audit.8333.space rolling window
  // (audit_recent_total / audit_recent_errors, up to AUDIT_SWAPS_WINDOW = 100 swaps), Audit tab
  // only: it no longer feeds the Reliability Score (that uses cashu.info, see breakdownAScore
  // above). Colour comes from auditReliabilityColor() (error-rate based:
  // <=5% green/25% amber/else red), not from the score's bands (see mintFormatting.ts).
  const recentReliabilityColor = auditReliabilityColor(breakdownAuditRecentTotal, breakdownAuditRecentErrors)
  // Breakdown row colour: same error-rate colouring over the cashu.info window, muted while neutral.
  const auditRowColor = auditReliabilityColor(auditState === 'scored' ? auditCzTotal : null, auditCzBlamed, AUDIT_MIN_SAMPLES)
  const auditSyncedAt = knownMint?.auditSyncedAt ?? null
  const auditCheckedAt = knownMint?.auditCheckedAt ?? null
  const freshness = auditFreshness(auditCheckedAt, auditSyncedAt)
  const audit8333Stale = audit8333StaleLine(auditSyncedAt, now)

  // Audit tab source: cashu.info is shown by default only when the audit.8333.space data is
  // missing or stale; with both sources present the header switch lets the visitor pick.
  const has8333Audit = knownMint !== null && knownMint.auditNMints !== null
  const auditNeedsFallback = !has8333Audit || freshness.auditorDataOld || freshness.syncStale
  const auditSource = auditSourcePick ?? (auditNeedsFallback ? 'cz' : '8333')
  const czView = czData !== null && (!has8333Audit || auditSource === 'cz') ? czData : null
  const czInfoText = czView ? cashuInfoViewText({ fallbackFrom8333: !(has8333Audit && !auditNeedsFallback) }) : null
  const czSyncNote = czView ? auditCzSyncNote(czView, now) : null
  const auditSwitch = czData !== null && has8333Audit ? (
    <div className="md-audit-seg" role="group" aria-label="Audit source">
      <button type="button" className={`md-audit-seg-btn${czView ? ' active' : ''}`} aria-pressed={czView !== null} onClick={() => setAuditSourcePick('cz')}>cashu.info</button>
      <button type="button" className={`md-audit-seg-btn${czView ? '' : ' active'}`} aria-pressed={czView === null} onClick={() => setAuditSourcePick('8333')}>8333.space</button>
    </div>
  ) : null

  // Strip values: audit.8333.space as stored, or (cz view) counted from the swaps MintRadar collected.
  const stripTotal = breakdownAuditRecentTotal
  const stripErrors = breakdownAuditRecentErrors
  // Latest successful /v1/info fetch: the latest probe while the mint is online, else the last time it was seen online.
  const infoFetchedAt = isOnline ? knownMint?.lastCheckedAt : knownMint?.lastOnlineAt
  const uptimeSource = uptimeSourceLine({ checks: uptime24hData ? headerTotalChecks : null, lastProbeAt: knownMint?.lastCheckedAt, now })
  const auditRowSource = auditSourceLine({ blamed: auditCzBlamed, total: auditCzTotal, fetchedAt: auditCzFetchedAt, now })
  const infoSource = infoSourceLine({ fetchedAt: infoFetchedAt, now })
  const versionSource = infoSourceLine({ fetchedAt: infoFetchedAt, now, comparedWithLatest: true })
  const rowUScore = breakdownRowScore(storedBreakdown, 'uptime', uptimeRowPending ? null : breakdownUScore)
  const rowAScore = breakdownRowScore(storedBreakdown, 'audit', breakdownAScore)
  const rowNScore = breakdownRowScore(storedBreakdown, 'nuts', breakdownNScore)
  const rowVScore = breakdownRowScore(storedBreakdown, 'version', breakdownVScore)
  const rowCScore = breakdownRowScore(storedBreakdown, 'contact', breakdownCScore)
  const reliabilityBreakdownRows = [
    { label: UPTIME_ROW_LABEL, display: uptimeRowPending ? SCORE_PENDING_TEXT : `${uptimePct}%`, ...(uptimeRowPending ? { displayLabel: UPTIME_PENDING_ARIA_LABEL } : {}), source: uptimeSource, score: rowUScore, max: UPTIME_POINTS, color: storedBreakdown ? breakdownPointsColor(rowUScore, UPTIME_POINTS) : uptimeRowPending ? 'var(--text3)' : uptimeColor(uptimePct), tooltip: uptimeRowText() },
    { label: AUDIT_ROW_LABEL, display: breakdownAuditDisplay, source: auditRowSource, ...(auditDetailText ? { detail: auditDetailText } : {}), score: rowAScore, max: AUDIT_POINTS, color: auditRowColor, tooltip: auditRowText(), ...(auditStaleNote ? { note: auditStaleNote } : {}) },
    { label: NUT_ROW_LABEL, display: `${supportedNuts.length} / ${TRACKED_NUTS.length} NUTs`, source: infoSource, score: rowNScore, max: NUT_POINTS, color: storedBreakdown ? breakdownPointsColor(rowNScore, NUT_POINTS) : supportedNuts.length >= 12 ? 'var(--accent)' : supportedNuts.length >= 8 ? 'var(--amber)' : 'var(--red)', tooltip: NUT_ROW_TEXT },
    { label: VERSION_ROW_LABEL, display: version ?? 'Unknown', source: versionSource, score: rowVScore, max: VERSION_POINTS, color: breakdownPointsColor(rowVScore, VERSION_POINTS), tooltip: versionRowText() },
    { label: CONTACT_ROW_LABEL, display: breakdownContactDisplay, source: infoSource, score: rowCScore, max: CONTACT_POINTS, color: breakdownPointsColor(rowCScore, CONTACT_POINTS), tooltip: contactRowText() },
  ]
  // The stored new-mint cap correction (0 or negative): one line under the rows, so they still add up to the score.
  const storedCapLine = storedBreakdown && storedBreakdown.newMintCap.points < 0
    ? <div className="rb-cap-line" data-testid="rb-cap-line">New-mint cap: {storedBreakdown.newMintCap.points} (score capped at {storedBreakdown.newMintCap.cap})</div>
    : null
  // "Limited data": the audit part is neutral, or the new-mint cap applies (the score's own constants).
  const limitedReasons = limitedDataReasons({ auditBlamed: auditCzBlamed, auditTotal: auditCzTotal, auditFetchedAt: auditCzFetchedAt, discoveredAt, now })
  const limitedDataLabel = limitedReasons.length > 0 ? (
    <InfoTooltip className="md-limited-data" width={240} text={limitedDataText(limitedReasons)}>
      <span className="md-limited-data-chip">Limited data</span>
    </InfoTooltip>
  ) : null
  // Mint that is not online: an honest block at the top of the Overview (since when, last error, what to do).
  const unavailable = !isOnline && knownMint !== null
  const isArchived = !isOnline && knownMint?.archived === true
  const unavailableInfo = unavailable ? unavailableHeadline({ since: knownMint?.offlineSince ?? knownMint?.lastOnlineAt, archived: knownMint?.archived === true, now }) : null
  const lastErrorText = sanitizeLastError(knownMint?.lastError)
  const unavailableContacts = [email && `email ${email}`, twitter && `Twitter ${twitter}`, nostr && `Nostr ${nostr}`].filter((c): c is string => !!c)
  // Signed health record: only a mint with a current event (not archived, scored, https host that may appear in an event).
  const healthRecord = knownMint && knownMint.archived !== true && typeof knownMint.reliabilityScore === 'number' ? healthRecordFor(url) : null
  const firstSeen = firstSeenLabel(discoveredAt)
  const nostrAnnouncedAt = knownMint?.nostrAnnouncedAt ?? null
  const nostrAnnounceHref = njumpEventUrl(knownMint?.nostrAnnounceId)
  const isNew = isNewMint(discoveredAt)
  // No "Outdated" pill on an archived mint (2026-10-27): the version is the last one it reported and it is no longer
  // probed, so comparing it with the current release adds nothing. The version text itself stays.
  const isOutdated = !isArchived && classifyMintVersion(version, versionLatestMap).label === 'outdated'

  // audit.8333.space lifetime counters (display-only "Audit stats" panel) — the
  // rolling-window figures that feed Reliability Score are auditRecent* / breakdownAudit* above.
  const auditNMints = knownMint?.auditNMints ?? 0
  const auditNMelts = knownMint?.auditNMelts ?? 0

  // ── Audit summary strip (top of the Audit tab) — a 5-second overview.
  // Mints / Melts are audit.8333.space lifetime counters; Recent success rate
  // is the rolling ~100-swap window (same numbers as the Recent reliability
  // card and the Reliability Score's Audit component); Last checked is OUR 6h
  // cron's write time (auditSyncedAt), NOT auditCheckedAt (that's the
  // auditor's own clock).
  //
  // The main number is framed as successes ("<successes> / <total>"), not
  // errors — every other "X/Y" ratio in the app reads higher-is-better (e.g.
  // Online Mints "55/56"), and an error count read the opposite way at a
  // glance. formatAuditSuccessRatio() does the total-minus-errors math; the
  // sub-line no longer repeats a percentage of the same fraction.
  const stripRecentSuccessDisplay = formatAuditSuccessRatio(stripTotal, stripErrors)
  const stripRecentSuccessPct = stripTotal !== null && stripTotal > 0
    ? Math.round(((stripTotal - (stripErrors ?? 0)) / stripTotal) * 100)
    : null
  const stripRecentSuccessSub = stripTotal === null
    ? 'no recent swaps'
    : isAuditUnknown(stripTotal)
      ? 'too few to score'
      : `${stripRecentSuccessPct}% ok`

  // Average duration of the successful swaps in the same rolling window
  // (backend/src/discovery.ts's computeSwapStats() → mints.audit_avg_time_ms).
  const auditAvgTimeMs = knownMint?.auditAvgTimeMs ?? null
  const stripAvgTimeDisplay = auditAvgTimeMs !== null ? `${Math.round(auditAvgTimeMs)} ms` : 'n/a'
  const stripMints = auditNMints
  const stripMelts = auditNMelts
  const stripReliabilityColor = recentReliabilityColor
  const tipMints = AUDIT_MINTS_TEXT
  const tipMelts = AUDIT_MELTS_TEXT
  const tipSuccess = auditSuccessRateText()
  const tipAvg = 'Average duration of the successful swaps in the same rolling window as Recent success rate.'

  // Last ≤100 swaps, newest first (the backend already orders by created_at
  // DESC) — the outcome bar and the "Recent swaps" table below both read from
  // this same array so they can never disagree.
  const auditSwaps: AuditSwapRow[] = auditSwapsData?.swaps ?? []
  const AUDIT_SWAP_BAR_MAX = 44
  // cashu.info view: the bar shows the stored swaps of both directions together.
  const auditSwapBarItems = (czView ? czView.swaps : auditSwaps).slice(0, AUDIT_SWAP_BAR_MAX)
  const auditRecentSwapRows = showAllAuditSwaps ? auditSwaps : auditSwaps.slice(0, AUDIT_SWAP_ROWS_DEFAULT)

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
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {shownKeysets?.map(ks => (
              <div key={ks.id} className="md-keyset-row" style={{background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0,flex:'1 1 100%'}}>
                  <span style={{fontSize:13,color:'var(--text)',fontFamily:'var(--font-mono)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{ks.id.slice(0, 8)}…{ks.id.slice(-8)}</span>
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
                </div>
                <span className="md-keyset-meta" style={{fontSize:11,color:'var(--text3)',fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'0.06em'}}>{ks.unit}</span>
                {typeof ks.input_fee_ppk === 'number' && (
                  <InfoTooltip text={KEYSET_FEE_TEXT} width={200} className="md-keyset-fee-tip"><span className="md-keyset-meta" style={{fontSize:11,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>{formatKeysetFee(ks.input_fee_ppk)}</span></InfoTooltip>
                )}
                <span className="md-keyset-meta" style={{
                  fontSize:10,fontFamily:'var(--font-mono)',fontWeight:600,borderRadius:5,padding:'2px 7px',marginLeft:'auto',
                  color: ks.active ? 'var(--accent)' : 'var(--text3)',
                  background: ks.active ? 'var(--green-soft)' : 'var(--bg4)',
                  border: `0.5px solid ${ks.active ? 'var(--green-soft-strong)' : 'var(--border)'}`,
                }}>
                  {ks.active ? 'Active' : 'Inactive'}
                </span>
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
      <div className="md-header">
        <div className="md-hdr-left">
          <button className="md-back md-back-compact" aria-label="Back" onClick={() => navigate(-1)}><span className="md-back-arrow">←</span><span className="md-back-label">Back</span></button>
          {/* Right after Back in the DOM (Tab: Back, then the star); the top-right corner is CSS: absolute against .md-header. */}
          {isLoggedIn
            ? (
              <button
                type="button"
                className={`md-watch-star md-watch-star-hero${isWatching ? ' on' : ''}`}
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
                className="md-watch-star md-watch-star-hero"
                aria-label={`Add ${displayName} to watchlist`}
                aria-pressed={false}
                title={`Add ${displayName} to watchlist`}
                onClick={() => setShowWatchLoginModal(true)}
              >
                <IcStar filled={false} />
              </button>
            )
          }
          <div className="md-avatar-id">
            <MintFavicon url={url} iconUrl={data?.info?.icon_url ?? knownMint?.iconUrl ?? null} size={avatarSize} radius={16} className="md-hdr-favicon" />
            <div className="md-namebox" ref={nameboxRef}>
              {/* The h1 holds only the name (2026-10-25): with the status and badges inside it, a screen reader
                  read the heading as "21MintOnline". The flex row and its look stay on the outer .md-name. */}
              <div className="md-name" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <h1 className="md-name-h1" {...(resolvedNameFull ? { title: resolvedNameFull } : {})}>{displayName}</h1>
                <span className={`md-status-inline ${isOnline ? '' : isArchived ? 'offline archived' : 'offline'}`}>
                  <span className={`status-dot ${isOnline ? '' : 'offline'}`} />
                  <span>{isOnline ? 'Online' : isArchived ? 'Archived' : 'Offline'}</span>
                </span>
                {isNew && (
                  <InfoTooltip text={newMintBadgeText()} width={240}><span className="md-age-badge-inline" style={{fontSize:12,fontFamily:'var(--font-mono)',fontWeight:600,color:'var(--amber)',background:'var(--amber-soft)',border:'0.5px solid var(--amber-soft-strong)',borderRadius:5,padding:'3px 9px',flexShrink:0}}>New</span></InfoTooltip>
                )}
                {isTestMint(url) && (
                  <InfoTooltip text="Not for real funds — for testing and development only">
                    <span style={{fontSize:12,fontFamily:'var(--font-mono)',fontWeight:600,color:'var(--amber)',background:'var(--amber-soft)',border:'0.5px solid var(--amber-soft-strong)',borderRadius:5,padding:'3px 9px',flexShrink:0}}>
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
                {copiedLink ? <span className="md-url-copied-label">Link copied</span> : <ArrowUpRight size={12} />}
              </button>
              {firstSeen && (
                <div className="md-first-seen" style={{fontSize:12,fontFamily:'var(--font-mono)',color:'var(--text-faint)',marginTop:4}}>{firstSeen}</div>
              )}
              <div className="md-announce-row">
              {nostrAnnouncedAt && (
                <div className="md-first-seen md-announce-label">
                  {nostrAnnounceHref ? (
                    <a href={nostrAnnounceHref} target="_blank" rel="noopener noreferrer">Announced on Nostr</a>
                  ) : 'Announced on Nostr'}
                  {' · '}
                  {new Date(nostrAnnouncedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </div>
              )}
        <div className="md-hdr-actions">
        <div className="md-hdr-center">
          {!isOnline && knownMint?.lastError && (
            <span className="md-hdr-error" style={{display:'inline-flex',alignItems:'center',gap:4}}>
              <span
                className="md-error-badge"
                style={{fontSize:11,color:'color-mix(in srgb, var(--red) 75%, var(--text))',fontFamily:'var(--font-mono)',background:'var(--red-soft)',border:'0.5px solid var(--red-soft-strong)',borderRadius:5,padding:'2px 7px',whiteSpace:'nowrap'}}
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
            <QrCode size={12} /> Mint QR
          </button>
          <a
            className="md-quick-btn"
            href={`https://wallet.cashu.me/?mint=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span aria-hidden="true">↗</span>
            <span className="md-qb-full">Open in Cashu.me</span>
            <span className="md-qb-short">Cashu.me</span>
          </a>
          </>
          )}
        </div>
        <div className="md-hdr-right">
          <button
            className="md-compare-btn"
            onClick={() => setShowComparePicker(true)}
          >
            <span aria-hidden="true">⇆</span>
            <span className="md-compare-label">Compare</span>
          </button>
        </div>
        </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="md-summary">
        <div className="md-sc">
          <div className="md-sc-icon orange"><Clock size={14} /></div>
          <div style={{flex:1}}>
            <div className="md-sc-label" style={{display:'flex',alignItems:'center',gap:4}}>
              Latency
            </div>
            <div className="md-sc-value">{latency !== null ? `${latency} ms` : '—'}</div>
            <div className="md-sc-sub">
              <span>{latencyCaption()}</span>
              <span style={{display:'inline-flex',alignItems:'center',gap:4}}>
                <button
                  onClick={() => { void testClientLatency() }}
                  disabled={testingLatency}
                  className="latency-test-btn"
                >
                  {testingLatency && <span className="latency-spinner" />}
                  {CLIENT_LATENCY_BUTTON_LABEL}
                </button>
                <InfoTooltip className="latency-client-info" iconSize={11} width={200} about="your latency from this browser" text="Your latency from this browser to the mint (client-side measurement)." />
              </span>
            </div>
            {/* Desktop strip: ends the first row (value + button) whatever the width of the value, so the label never climbs into it when the value is the short "—" of a mint without latency. */}
            <span className="md-sc-latency-break" aria-hidden="true" />
            {clientLatency !== null && (
              <div style={{fontSize:10,marginTop:4,fontFamily:'var(--font-mono)',color: typeof clientLatency === 'number' ? 'var(--text)' : 'var(--text3)'}}>
                {typeof clientLatency === 'number' ? `Your latency: ${clientLatency}ms` : clientLatency}
              </div>
            )}
          </div>
        </div>
        <div className="md-sc">
          <div className="md-sc-icon orange"><Shield size={14} /></div>
          <div style={{flex:1}}>
            <div className="md-sc-label">Uptime 24h</div>
            <div className="md-sc-value" style={{color: uptimeColor(headerUptimePct)}}>{headerUptimePct !== null ? `${headerUptimePct}%` : '—'}</div>
            <div className="md-sc-sub">{headerTotalChecks === 1 ? `${headerOnlineChecks} check` : `${headerOnlineChecks} / ${headerTotalChecks} checks`}</div>
          </div>
        </div>
        <div className="md-sc">
          <div className="md-sc-icon gray"><GitBranch size={14} /></div>
          <div style={{flex:1}}>
            <div className="md-sc-label">Version</div>
            <div className="md-sc-value sm" style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
              <span>{version ?? '—'}</span>
              {isOutdated && (
                <span className="md-outdated-pill" style={{fontSize:9,fontFamily:'var(--font-mono)',fontWeight:600,color:'color-mix(in srgb, var(--red) 75%, var(--text))',background:'var(--red-soft)',border:'0.5px solid var(--red-soft-strong)',borderRadius:4,padding:'1px 5px'}}>Outdated</span>
              )}
            </div>
            <div className="md-sc-sub">software</div>
          </div>
        </div>
        <div className="md-sc">
          <div className="md-sc-icon green"><Layers size={14} /></div>
          <div style={{flex:1}}>
            <div className="md-sc-label">NUTs</div>
            <div className="md-sc-value green">{nutCount}</div>
            <div className="md-sc-sub">supported</div>
          </div>
        </div>
        <div className="md-sc">
          <div className="md-sc-icon orange"><Star size={14} /></div>
          <div style={{flex:1}}>
            <div className="md-sc-label" style={{display:'flex',alignItems:'center',gap:4}}>
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
            {tileReviewCount === null ? (
              <div className="md-sc-value sm" style={{color:'var(--text-faint)'}} aria-label="Loading reviews">…</div>
            ) : tileReviewCount === 0 ? (
              <div className="md-sc-value sm" style={{color:'var(--text-faint)'}}>No reviews yet</div>
            ) : (
              <>
                {tileAvgRating !== null ? (
                  <div
                    className="md-sc-value"
                    style={{display:'flex',alignItems:'baseline',gap:6,opacity: tileReviewCount < MIN_MEANINGFUL_REVIEWS ? 0.6 : 1}}
                  >
                    <span style={{color:'var(--text)'}}>{tileAvgRating}</span>
                    <span className="md-sc-stars" aria-label={`${tileAvgRating} out of 5`}>{starString(tileAvgRating)}</span>
                  </div>
                ) : (
                  <div className="md-sc-value sm" style={{color:'var(--text-faint)'}}>Unrated</div>
                )}
                <div className="md-sc-sub">
                  {tileReviewCount} review{tileReviewCount !== 1 ? 's' : ''}
                  {tileReviewCount < MIN_MEANINGFUL_REVIEWS ? ' · too few to be reliable' : ''}
                </div>
              </>
            )}
          </div>
        </div>
        {/* Compact Reliability Score — mobile only (≤640px). Fills the empty cell next
            to Community rating; the full breakdown card in .md-right is hidden
            on mobile since its Uptime/NUTs/Latency rows duplicate the tiles
            above. Same target as the full card's "Details ›". */}
        <div
          className="md-sc md-sc-reliability"
          role="button"
          tabIndex={0}
          onClick={() => setShowReliabilityBreakdown(true)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowReliabilityBreakdown(true) } }}
        >
          <div className="md-sc-reliability-donut">
            <svg viewBox="0 0 72 72" aria-hidden="true">
              <circle cx="36" cy="36" r="27" fill="none" stroke="var(--bg4)" strokeWidth="8" />
              <circle cx="36" cy="36" r="27" fill="none" stroke="var(--green-bright)" strokeWidth="8"
                strokeDasharray={reliabilityDonut.dashArray}
                strokeOpacity={scorePending ? 0 : 1}
                strokeDashoffset={reliabilityDonut.dashOffset}
                strokeLinecap="round"
                transform="rotate(-90 36 36)" />
            </svg>
            <span className="md-sc-reliability-num" {...scoreA11y}>{scoreText}</span>
          </div>
          <div className="md-sc-reliability-meta">
            <div className="md-sc-label">Reliability</div>
            <span
              className="md-sc-reliability-badge"
              style={{ color: tsInfo.color, background: tsInfo.bg, border: `0.5px solid ${tsInfo.border}` }}
            >
              {tsInfo.label}
            </span>
            <span className="md-sc-reliability-link">Details ›</span>
          </div>
        </div>
      </div>

      <div className="md-tabs">
        {(['overview', 'history', 'nuts', 'audit', 'reviews'] as const).map(tab => (
          <button
            key={tab}
            className={`md-tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => {
              setActiveTab(tab)
              const newHash = `#${tab}`
              if (window.location.hash !== newHash) {
                window.history.replaceState(null, '', newHash)
              }
            }}
          >
            {{ overview: 'Overview', history: 'History', nuts: 'NUTs', audit: 'Audit', reviews: 'Reviews' }[tab]}
          </button>
        ))}
      </div>

      <div className="md-body">
        <div className="md-left">

          {activeTab === 'overview' && (
            <OverviewTab
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
              keysetsPanel={keysetsPanel}
              supportsBackupRestore={supportsBackupRestore}
              supportedNuts={supportedNuts}
              liveNuts={data?.info?.nuts}
              onSelectNut={setSelectedNut}
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
              has8333Audit={has8333Audit}
              czInfoText={czInfoText}
              czSyncNote={czSyncNote}
              auditSwitch={auditSwitch}
              audit8333Stale={audit8333Stale}
              czData={czData}
              stripMints={stripMints}
              stripMelts={stripMelts}
              stripReliabilityColor={stripReliabilityColor}
              stripRecentSuccessDisplay={stripRecentSuccessDisplay}
              stripRecentSuccessSub={stripRecentSuccessSub}
              stripAvgTimeDisplay={stripAvgTimeDisplay}
              tipMints={tipMints}
              tipMelts={tipMelts}
              tipSuccess={tipSuccess}
              tipAvg={tipAvg}
              auditSwapBarItems={auditSwapBarItems}
              auditRecentSwapRows={auditRecentSwapRows}
              auditSwaps={auditSwaps}
              showAllAuditSwaps={showAllAuditSwaps}
              setShowAllAuditSwaps={setShowAllAuditSwaps}
              showAllCzFrom={showAllCzFrom}
              showAllCzTo={showAllCzTo}
              setShowAllCzFrom={setShowAllCzFrom}
              setShowAllCzTo={setShowAllCzTo}
              auditSwapsLoading={auditSwapsLoading}
              auditSwapsError={auditSwapsError}
              refetchAuditSwaps={refetchAuditSwaps}
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
            />
          )}

        </div>

        <div className="md-right">

          <div className="md-panel md-reliability-panel">
            <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:11}}>
              <span className="md-panel-title" style={{marginBottom:0}}>Reliability Score</span>
              <Link to="/methodology" className="md-method-ver">Methodology v{METHODOLOGY_VERSION}</Link>
            </div>
            <div className="reliability-wrap">
              <div className="gauge-wrap">
                <svg viewBox="0 0 72 72">
                  <circle cx="36" cy="36" r="27" fill="none" stroke="var(--bg4)" strokeWidth="7" />
                  <circle cx="36" cy="36" r="27" fill="none" stroke="var(--green-bright)" strokeWidth="7"
                    strokeDasharray={reliabilityDonut.dashArray}
                strokeOpacity={scorePending ? 0 : 1}
                    strokeDashoffset={reliabilityDonut.dashOffset}
                    strokeLinecap="round"
                    transform="rotate(-90 36 36)" />
                </svg>
                <div className="gauge-num" style={{ color: scorePending ? 'var(--text3)' : 'var(--green-bright)', fontFamily: 'var(--font-mono-data)' }} {...scoreA11y}>{scoreText}</div>
              </div>
              <div className="reliability-badges">
                <span style={{fontSize:12,fontFamily:'var(--font-mono)',fontWeight:600,color:tsInfo.color,background:tsInfo.bg,border:`0.5px solid ${tsInfo.border}`,borderRadius:5,padding:'4px 10px',textAlign:'center'}}>{tsInfo.label}</span>
                {limitedDataLabel}
              </div>
            </div>
            <div className="rb-scope-note">Operational health, not solvency.</div>
            {unavailable && <div className="rb-scope-note md-ua-caption">{LAST_SCORE_CAPTION}</div>}
            {isNew && <div className="rb-new-note">{newMintCapNote()}</div>}
            {/* All 5 components always visible here (no "Details" click / donut
                tap needed) — the modal below (opened only from the mobile
                compact tile, where this panel is hidden) shows the same rows. */}
            <div style={{marginTop:16,width:'100%'}}>
              {reliabilityBreakdownRows.map(row => (
                <ReliabilityBreakdownRow key={row.label} {...row} />
              ))}
              {storedCapLine}
            </div>
          </div>

          {/* Units & Methods + Keysets sit side by side on desktop (≥901px,
              see .md-um-keysets-row) so both stay visible without stacking
              the sidebar too tall. Unlike the old Overview-tab-only gate,
              the sidebar itself persists across every tab (see .md-right
              above) — Keysets must too, or switching to e.g. Audit made it
              disappear entirely instead of just changing tab content. On
              mobile the Keysets copy here stays hidden and the NUTs-tab
              copy (.md-keysets-at-nuts) is shown instead. */}
          <div className="md-um-keysets-row">
            {knownMint?.units && knownMint.units.length > 0 && (
              <div className="md-panel md-um-panel md-um-panel-methods">
                <div className="md-panel-title">Units and methods</div>
                {sortUnits(knownMint.units).map(unit => {
                  const mintChips = (knownMint.mintMethods ?? []).filter(m => m.unit === unit)
                  const meltChips = (knownMint.meltMethods ?? []).filter(m => m.unit === unit)
                  // Same set of payment methods for both directions (e.g. bolt11 +
                  // bolt12 + onchain + venmo, mint AND melt) is common and, shown as
                  // two separate rows, just repeats the same chip list twice. Collapse
                  // into one "Mint & Melt" row when neither side is disabled and the
                  // method sets are identical (order-independent) — see the reported
                  // "doesn't look nice" case with several methods per direction.
                  const methodKey = (arr: { method: string }[]) => arr.map(m => m.method).slice().sort().join('|')
                  const methodsUnified = !nut4Disabled && !nut5Disabled
                    && mintChips.length > 0 && meltChips.length > 0
                    && methodKey(mintChips) === methodKey(meltChips)
                  // 2 chips per line once there's more than one method — one per
                  // line (the flex-wrap default) got very tall for a mint offering
                  // several methods per direction. A single method stays exactly
                  // as it was (no grid, no extra classes).
                  const chipsClassName = (count: number) => `method-chips${count > 1 ? ' method-chips-grid' : ''}`
                  return (
                    <div className="unit-block" key={unit}>
                      <div className="unit-header"><span className="unit-badge">{unit.toUpperCase()}</span></div>
                      <div className="method-rows">
                        {methodsUnified ? (
                          <div className="method-row">
                            <span className="method-label">Mint & Melt</span>
                            <div className={chipsClassName(mintChips.length)}>
                              {mintChips.map((m, i) => (
                                <span className="method-chip" key={i}>{m.method}</span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <>
                            {(mintChips.length > 0 || nut4Disabled) && (
                              <div className={`method-row${nut4Disabled ? ' method-row-off' : ''}`}>
                                <span className="method-label">
                                  Mint
                                  {/* Disabled is a per-direction flag, not per-chip — a
                                      separate "⚠ DISABLED" chip alongside the (also
                                      struck-through) method chips duplicated the same
                                      information and, on a narrow sidebar, wrapped onto
                                      its own line under a single chip. One badge next to
                                      the row label instead. */}
                                  {nut4Disabled && <span className="method-off-badge"><AlertTriangle size={10} /> Disabled</span>}
                                </span>
                                {mintChips.length > 0 && (
                                  <div className={chipsClassName(mintChips.length)}>
                                    {mintChips.map((m, i) => (
                                      <span className="method-chip" key={i}>{m.method}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {(meltChips.length > 0 || nut5Disabled) && (
                              <div className={`method-row${nut5Disabled ? ' method-row-off' : ''}`}>
                                <span className="method-label">
                                  Melt
                                  {nut5Disabled && <span className="method-off-badge"><AlertTriangle size={10} /> Disabled</span>}
                                </span>
                                {meltChips.length > 0 && (
                                  <div className={chipsClassName(meltChips.length)}>
                                    {meltChips.map((m, i) => (
                                      <span className="method-chip" key={i}>{m.method}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="md-keysets-at-overview md-um-panel md-um-panel-keysets">{keysetsPanel}</div>
          </div>

        </div>
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
              <button type="button" className="rv-btn-submit rv-btn-login" onClick={confirmWatchLogin}><Zap size={14} strokeWidth={2.2} aria-hidden="true" /> Login via Nostr</button>
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
              <div className="rb-hero-score" style={{color:reliabilityScore === null ? 'var(--text3)' : reliabilityScoreColor(reliabilityScore)}} {...scoreA11y}>{scoreText}</div>
              <span className="rb-hero-badge" style={{color:tsInfo.color,background:tsInfo.bg,borderColor:tsInfo.border}}>{tsInfo.label}</span>
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
                    onFocus={() => setReviewHoverRating(star)}
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
                        {(profile?.name ?? profile?.npub ?? '?').slice(0, 1).toUpperCase()}
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
                  <textarea
                    className="rv-textarea"
                    value={reviewComment}
                    onChange={e => setReviewComment(e.target.value)}
                    placeholder="What should other people know?"
                    maxLength={500}
                    rows={3}
                  />
                  <div className="rv-charcount">{reviewComment.length} / 500 characters</div>
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
        const isNutDisabled = supported && nutConfig?.disabled === true
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

              <p className="nm-desc">{meta?.desc}</p>

              {meta?.features && (
                <div className="nm-sec">
                  <div className="nm-sec-label">Features</div>
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

              <a
                className="nm-link"
                href={`https://github.com/cashubtc/nuts/blob/main/${parseInt(selectedNut.replace('NUT-', ''), 10).toString().padStart(2, '0')}.md`}
                target="_blank"
                rel="noopener noreferrer"
              >
                ↗ View NUT spec on GitHub
              </a>
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
  useRemoveCanonical()
  useNoindex()
  return (
    <div className="mint-detail">
      <div className="md-header">
        <button className="md-back" aria-label="Back" onClick={() => navigate(-1)}><span className="md-back-arrow">←</span><span className="md-back-label">Back</span></button>
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
      </div>
    </div>
  )
}

// A slug that does not decode has no mint page to point a canonical at.
function MintInvalidUrl() {
  const navigate = useNavigate()
  useRemoveCanonical()
  useNoindex()
  return (
    <div className="mint-detail">
      <div className="md-header">
        <button className="md-back" aria-label="Back" onClick={() => navigate(-1)}><span className="md-back-arrow">←</span><span className="md-back-label">Back</span></button>
      </div>
      <h1 style={{ color: 'var(--red)', padding: '24px', fontSize: '14px', fontWeight: 400 }}>Invalid mint URL.</h1>
    </div>
  )
}

export default function MintDetail() {
  const params = useParams<{ url: string }>()
  const rawUrl = params['url']
  const navigate = useNavigate()
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
          <button className="md-back" aria-label="Back" onClick={() => navigate(-1)}><span className="md-back-arrow">←</span><span className="md-back-label">Back</span></button>
        </div>
        <h1 className="sr-only">Mint details</h1>
        {knownError ? <LoadError message={MINT_LIST_ERROR} onRetry={() => void refetchKnown()} /> : <LoadingNote />}
      </div>
    )
  }

  const resolution = resolveMintDetailUrl(slug, knownMintsData)
  if (resolution.kind === 'redirect') {
    return <Navigate to={`/mint/${encodeURIComponent(resolution.url)}`} replace />
  }
  if (resolution.kind === 'not-tracked') {
    return <MintNotTracked slug={resolution.slug} suggestion={resolution.suggestion} />
  }

  return <MintDetailContent url={resolution.url} />
}
