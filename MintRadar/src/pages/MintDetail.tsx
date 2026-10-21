import { nip19 } from 'nostr-tools'
import { njumpProfileUrl, njumpEventUrl, npubFromPubkey, mintAnnounceNaddr } from '@/utils/nostrLinks'
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom'
import { Fragment, useEffect, useState, useMemo, useCallback, lazy, Suspense, type CSSProperties, type JSX, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { IcStar } from '@/components/mint/IcStar'
import { MintChangeLog } from '@/components/mint/MintChangeLog'
import { CopyTextButton } from '@/components/mint/CopyTextButton'
import { useMintProbe } from '@/hooks/useMintProbe'
import {
  reviewSurgeText, AUDIT_MINTS_TEXT, AUDIT_MELTS_TEXT, auditSuccessRateText, uptimeRowText, auditRowText, NUT_ROW_TEXT,
  versionRowText, contactRowText, scoreFormulaText, BACKUP_SUPPORTED_TEXT, NO_BACKUP_TEXT, REVIEWS_NIP87_TEXT, cashuInfoViewText,
  HTTP_ERROR_EXPLANATIONS, NON_HTTP_ERROR_EXPLANATIONS, operatorExcludedText,
  KEYSETS_HINT, newMintBadgeText, newMintCapNote, OPERATOR_REVIEW_NOTE,
  UPTIME_ROW_LABEL, AUDIT_ROW_LABEL, NUT_ROW_LABEL, VERSION_ROW_LABEL, CONTACT_ROW_LABEL,
  UPTIME_POINTS, AUDIT_POINTS, NUT_POINTS, VERSION_POINTS, CONTACT_POINTS,
  auditTooFewDetail, auditTooOldDetail, outagesCountLabel, noOutagesText, OUTAGES_WINDOW_DAYS,
} from '@/utils/tooltipTexts'
import { useKnownMints } from '@/hooks/useKnownMints'
import { LoadError, LoadingNote, MINT_LIST_ERROR, LIVE_DATA_ERROR } from '@/components/LoadError'
import { useMintReviews } from '@/hooks/useMintReviews'
import { mergeStoredAndLiveReviews, visibleReviews, withServerProfileFallback, type ServerAuthorProfile } from '@/utils/reviewUtils'
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
import { MintNetworkCard } from '@/components/MintNetworkCard'
import { networkRows } from '@/utils/networkInfo'
import { AuditCzTiles, AuditCzSwapTables, AuditStateText } from '@/components/AuditCzCards'
import { AuditDirections } from '@/components/AuditDirections'
import { supportedNutKeys } from '@/utils/nutSupport'
import { MintFeesLimits } from '@/components/mint/MintFeesLimits'
import { formatDate, formatDateTimeUtc } from '@/utils/formatDate'
import { displayName as mintDisplayName, isNewMint, firstSeenLabel, reliabilityScoreColor, reliabilityScoreInfo, formatTimeAgo, formatAuditSuccessRatio, reliabilityDonutArc, auditReliabilityColor, MIN_MEANINGFUL_REVIEWS, mintHostname, resolveMintDetailUrl, computeDuplicateMintNames } from '@/utils/mintFormatting'
import { TRACKED_NUTS } from '@/constants/nuts'
import { isTestMint } from '@/constants/testMints'
import { operatorPubkeys } from '@/utils/operatorPubkeys'
import { cleanMintNameDetailed } from '@/utils/cleanMintName'
import { formatKeysetFee, clockDriftLabel, urlIsOnion, listHasOnion, isMotdAlert } from '@/utils/mintProbeDisplay'
import { auditComponent, auditDataState, auditAgeHours, isAuditUnknown, AUDIT_MIN_SAMPLES } from '@/utils/auditScore'
import { auditFreshness, audit8333StaleLine } from '@/utils/auditFreshness'
import { IcClose } from '@/components/IcClose'
import { clickableProps } from '@/utils/clickableProps'
import { useAuditCz } from '@/hooks/useAuditCz'
import { adaptAuditCz, AUDIT_CZ_NEUTRAL_TITLE, type AuditSwapRow } from '@/utils/auditCz'
import { sortUnits } from '@/utils/sortUnits'
import {
  computeReliabilityScore as sharedComputeReliabilityScore,
  uptimeComponent, nutComponent, versionComponent, contactComponent,
  type AuditInput,
} from '@/utils/reliabilityScore'
import { classifyMintVersion, latestMapFor, type LatestVersions } from '@/utils/versionRule'
import { useNow } from '@/hooks/useNow'
import { useDocumentMeta, useNoindex, useRemoveCanonical } from '@/hooks/useDocumentMeta'
import { CLIENT_LATENCY_BUTTON_LABEL, latencyCaption } from '@/constants/probeLocation'
import { useElementHeight } from '@/hooks/useElementHeight'
import { METHODOLOGY_VERSION } from '@/utils/methodology'
import { ContactChecksLine } from '@/components/ContactChecksLine'
import { auditSourceLine, infoSourceLine, uptimeSourceLine, type SourceLine } from '@/utils/scoreSources'
import { limitedDataReasons, limitedDataText } from '@/utils/limitedData'
import { LAST_SCORE_CAPTION, KEEP_WALLET_SENTENCE, TEMPORARY_SENTENCE, contactSentence, restoreSentence, sanitizeLastError, unavailableHeadline } from '@/utils/unavailableMint'
import { healthRecordFor } from '@/utils/healthRecord'
import { AUDIT_SWAPS_WINDOW, AUDIT_WINDOW_DAYS } from '@/utils/tooltipTexts'
import { useIsMobile } from '@/hooks/useIsMobile'
import { reviewAvatarColor, avatarTextColor } from '@/utils/avatarColors'
import './MintDetail.css'

// Heavy, rarely needed parts load on demand: the Compare modal (only when opened) and the History chart (recharts, only on
// the History tab).
const ComparisonModal = lazy(() => import('@/components/ComparisonModal').then(m => ({ default: m.ComparisonModal })))
const MintDetailHistoryChart = lazy(() => import('./MintDetailHistoryChart'))
// Chart height; the Suspense placeholder uses the same value so the History tab does not jump when the chunk arrives.
const HISTORY_CHART_HEIGHT = 140
import {
  Copy, Check, Info, ShieldCheck, ShieldOff, AlertTriangle,
  Coins, Flame, SlidersHorizontal, RefreshCw, Lock, Key, Shield,
  Clock, GitBranch, Plug, Database, Award, Layers, Zap, QrCode,
  Receipt, UserCheck, EyeOff, CreditCard, Send, Code, Cloud,
  Fingerprint, Bitcoin, Star, Mail, AtSign,
  ExternalLink,
  Link2,
  ArrowUpRight,
} from 'lucide-react'

function shortNpub(npub: string): string {
  return npub.slice(0, 10) + '...' + npub.slice(-4)
}
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
function formatReviewDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/** "17 Sep 13:30" — day, short month, 24h time, in the viewer's local time zone. */
function formatOutageStart(iso: string): string {
  const d = new Date(iso)
  const date = formatDate(d, { year: false, local: true })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date} ${time}`
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.round(ms / 60000)} min`
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`
}
/** A version string with a line-break opportunity after each "/" ("Nutshell/0.20.3"); no <wbr> text is added. */
function versionWithBreaks(v: string): ReactNode {
  const parts = v.split('/')
  return parts.map((part, i) => (i === 0 ? part : <Fragment key={i}>/<wbr />{part}</Fragment>))
}
/** A five-character ★/☆ string for a rating, rounded to whole stars. */
function starString(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)))
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}
/** Page numbers to show in a pager, collapsing long runs to '…'. */
function reviewPageList(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out: (number | '…')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) out.push('…')
  for (let i = start; i <= end; i++) out.push(i)
  if (end < total - 1) out.push('…')
  out.push(total)
  return out
}

// The Audit tiles' ⓘ sits 3 px after the label (the trigger's hit-area padding is compensated by InfoTooltip.css).
const TT_GAP_LEFT = { '--tt-ml': '3px' } as CSSProperties

// ⓘ next to the "Audit stats" heading: the shared InfoTooltip with the audit explanation (or the given text). A local
// component so the identical icon can be dropped into both the desktop header and the mobile heading.
function AuditSourceInfoIcon({ text }: { text?: string }) {
  return (
    <InfoTooltip
      className="md-audit-info"
      iconSize={11}
      width={230}
      about="Audit stats"
      text={text ?? 'These stats come from audit.8333.space, an independent service that repeatedly mints and melts real ecash through this mint — how many operations it ran, how many failed, and when it last checked.'}
    />
  )
}

interface NutMethod {
  method: string
  unit: string
  min_amount?: number
  max_amount?: number
}

/** One muted sentence under the NUT compatibility grid: which NUTs nutzaps (NIP-61) rely on. No verdict. */
const NUTZAP_NUTS_NOTE = 'NUT-07, NUT-10, NUT-11 and NUT-12 are the ones nutzaps (NIP-61) rely on.'

interface NutConfig {
  disabled?: boolean
  methods?: NutMethod[]
}

interface MergedReviewCandidate {
  id: string
  pubkey: string
  rating: number | null
  comment: string
  createdAt: number
  source: 'mintradar' | 'nostr'
  profile?: { name?: string; nip05?: string; picture?: string; fromServer?: boolean }
}

const NUT_DESCRIPTIONS: Record<string, { short: string; desc: string; features: string[]; useCase: string }> = {
  'NUT-00': { short: 'Notation & crypto', desc: 'Cryptographic notation and the blind Diffie-Hellman key exchange (BDHKE) scheme underlying every Cashu operation.', features: ['Blind signatures (BDHKE)', 'Protocol notation', 'hash_to_curve mapping'], useCase: 'Defines the cryptographic foundation every other NUT builds on.' },
  'NUT-01': { short: 'Mint keys', desc: 'Retrieving public keys from the mint for each amount.', features: ['Amount-specific keypairs', 'Key retrieval API', 'Key validation'], useCase: 'Clients use mint keys to verify token signatures.' },
  'NUT-02': { short: 'Keysets & fees', desc: 'Keysets (grouped mint public keys with rotation) and the per-input fee charged when spending a proof from them.', features: ['Keyset IDs', 'Active/inactive rotation', 'Per-input fees (input_fee_ppk)'], useCase: 'Allows mints to rotate keys, support multiple currencies, and charge spending fees.' },
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
  'NUT-15': { short: 'Multi-mint MPP', desc: 'Split a single Lightning payment across multiple mints simultaneously, so wallets can pay one invoice using balances from several mints at once.', features: ['Multi-mint payments', 'Amount splitting', 'Atomic all-or-nothing'], useCase: 'Pay a large invoice by combining balances from multiple mints in one atomic payment.' },
  'NUT-16': { short: 'Animated QR', desc: 'Animated QR codes for transferring large tokens between devices.', features: ['Chunked QR frames', 'Large token transfer', 'Offline transfer'], useCase: 'Move big tokens between devices when no network is available.' },
  'NUT-17': { short: 'WebSocket', desc: 'Real-time mint updates via WebSocket subscription.', features: ['Live updates', 'Event subscription', 'Low latency'], useCase: 'Receive instant confirmation without polling.' },
  'NUT-18': { short: 'Payment req.', desc: 'Structured payment requests so wallets can pay a requested amount.', features: ['Structured requests', 'Amount + mint hints', 'Wallet interop'], useCase: 'Let a payee encode exactly what they want to be paid.' },
  'NUT-19': { short: 'Cached responses', desc: 'Mints cache successful responses for critical operations so wallets can replay after a network error.', features: ['Response caching', 'Network recovery', 'Idempotent replay'], useCase: 'Prevents loss of funds when a network interruption occurs during mint/swap/melt.' },
  'NUT-20': { short: 'Mint quote sig', desc: 'Mint signs quote requests for authenticity.', features: ['Quote signatures', 'Request authentication', 'Replay protection'], useCase: 'Prevent quote tampering between client and mint.' },
  'NUT-21': { short: 'Clear auth', desc: 'Clear-text (OAuth/OpenID) authentication for protected mint endpoints.', features: ['OAuth / OpenID', 'Access tokens', 'Protected endpoints'], useCase: 'Restrict mint access to authenticated users.' },
  'NUT-22': { short: 'Blind auth', desc: 'Blind authentication tokens for privacy-preserving mint access.', features: ['Blind auth tokens', 'Unlinkable access', 'Rate limiting'], useCase: 'Authenticate to a mint without revealing your identity.' },
  'NUT-23': { short: 'BOLT11', desc: 'BOLT11 Lightning invoices as a payment method for mint and melt.', features: ['Lightning invoices', 'Mint & melt method', 'Standard payments'], useCase: 'Fund and spend tokens via ordinary Lightning invoices.' },
  'NUT-24': { short: 'HTTP 402', desc: 'HTTP 402 Payment Required flow for paywalled resources using Cashu.', features: ['402 paywall flow', 'Machine payments', 'Resource access'], useCase: 'Pay for web resources programmatically with Cashu tokens.' },
  'NUT-25': { short: 'BOLT12', desc: 'BOLT12 offers as a payment method for mint and melt.', features: ['BOLT12 offers', 'Reusable payment codes', 'Mint & melt method'], useCase: 'Use reusable Lightning offers instead of single-use invoices.' },
  'NUT-26': { short: 'Bech32m req.', desc: 'Bech32m encoding for Cashu payment requests.', features: ['Bech32m encoding', 'Compact requests', 'Error detection'], useCase: 'Share payment requests as short, typo-resistant strings.' },
  'NUT-27': { short: 'Nostr backup', desc: 'Backing up wallet state to Nostr relays for cross-device recovery.', features: ['Nostr relay backup', 'Cross-device sync', 'Encrypted state'], useCase: 'Restore a wallet from Nostr on a new device.' },
  'NUT-28': { short: 'Pay-to-BK', desc: 'Lock tokens to a blinded public key for enhanced recipient privacy.', features: ['Blinded key lock', 'Recipient privacy', 'Selective unlock'], useCase: 'Send tokens to a recipient without exposing their public key.' },
  'NUT-29': { short: 'Batched minting', desc: 'Wallets can mint tokens for multiple quotes in a single atomic request.', features: ['Multi-quote batch', 'Atomic operation', 'Efficiency'], useCase: 'Reduces round-trips when minting from multiple paid invoices at once.' },
  'NUT-30': { short: 'Onchain', desc: 'On-chain Bitcoin as a payment method for mint and melt.', features: ['On-chain Bitcoin', 'Mint & melt method', 'Chain settlement'], useCase: 'Fund or redeem tokens directly with on-chain Bitcoin.' },
}

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
  'NUT-16': <QrCode size={13} />,
  'NUT-17': <Plug size={13} />,
  'NUT-18': <Receipt size={13} />,
  'NUT-19': <Database size={13} />,
  'NUT-20': <Award size={13} />,
  'NUT-21': <UserCheck size={13} />,
  'NUT-22': <EyeOff size={13} />,
  'NUT-23': <Zap size={13} />,
  'NUT-24': <CreditCard size={13} />,
  'NUT-25': <Send size={13} />,
  'NUT-26': <Code size={13} />,
  'NUT-27': <Cloud size={13} />,
  'NUT-28': <Fingerprint size={13} />,
  'NUT-29': <Layers size={13} />,
  'NUT-30': <Bitcoin size={13} />,
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

function ReliabilityBreakdownRow({ label, display, score, max, color, tooltip, note, detail, source }: {
  label: string
  display: string
  note?: string
  // Full-width explanation under the row (wraps; `display` is ellipsized at 170px).
  detail?: string
  // Where the number comes from: source, window, sample, time.
  source?: SourceLine
  score: number
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
          <span className="rb-row-display">{display}</span>
          <span className="rb-row-score" style={{ color }}>{score}/{max}</span>
        </div>
      </div>
      {detail && <div className="rb-row-detail">{detail}</div>}
      {source && <SourceLineView line={source} />}
      <div className="rb-row-bar">
        <div style={{ height: '100%', width: `${(score / max) * 100}%`, background: color, borderRadius: 2, transition: 'width 0.3s ease' }} />
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


function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function httpErrorTooltip(lastError: string): string | undefined {
  const m = lastError.match(/^HTTP (\d+)$/)
  if (m && m[1]) return HTTP_ERROR_EXPLANATIONS[m[1]] ?? `The mint returned HTTP ${m[1]} — an unexpected error status`
  return NON_HTTP_ERROR_EXPLANATIONS[lastError]
}

// Tooltip for the muted "Profile NIP-05 · not verified" line under Get in Touch.
const NIP05_TOOLTIP = 'Taken from the Nostr profile of the account that announced this mint. MintRadar has not checked it.'

function MintDetailContent({ url }: { url: string }) {
  const navigate = useNavigate()
  const now = useNow()
  const { data, isLoading, isError: probeError, refetch: refetchProbe } = useMintProbe(url)
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
  useDocumentMeta(
    `${metaDisplayName} - Cashu Mint Reliability Score & Uptime | MintRadar`,
    knownMint
      ? `${metaDisplayName} (${mintHostname(url)}) is ${knownMint.online ? 'online' : 'offline'} with a Reliability Score of ${knownMint.reliabilityScore ?? '—'}/100. See live uptime, latency, NUT support and reviews on MintRadar.`
      : `Live Reliability Score, uptime, latency and NUT support for the Cashu mint ${mintHostname(url)} on MintRadar.`,
    { canonicalPath: `/mint/${encodeURIComponent(url)}` },
  )

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
      return await res.json() as {
        sinceLastOutageMs: number | null
        avgRecoveryMs: number | null
        outageCount: number
        outages: Array<{ startedAt: string; durationMs: number; error: string }>
      }
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
      return res.json() as Promise<Array<{ id: string; pubkey: string; content: string; rating: number | null; createdAt: number; source: 'nostr' } & ServerAuthorProfile>>
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
  const nutCount = data?.info ? Object.keys(data.info.nuts).length : (knownMint?.nutCount ?? 0)
  const motd = data?.info?.motd
  const description = data?.info?.description
  const pubkey = data?.info?.pubkey
  const name = resolvedName ?? (knownMint ? mintHostname(url) : undefined)

  const tosUrl = data?.info?.tos_url ?? knownMint?.tosUrl ?? undefined
  const descriptionLong = data?.info?.description_long ?? knownMint?.descriptionLong ?? undefined
  const mintTime = data?.info?.time

  const email = data?.info?.contact?.find(c => c.method === 'email')?.info
  const twitter = data?.info?.contact?.find(c => c.method === 'twitter')?.info
  const nostr = data?.info?.contact?.find(c => c.method === 'nostr')?.info
  const urls = data?.info?.urls
  const hasOnionAlias = listHasOnion(urls)
  const trackedIsOnion = urlIsOnion(url)
  const showTor = trackedIsOnion || hasOnionAlias

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

  const supportedNutNumbers = new Set(
    data?.info ? Object.keys(data.info.nuts) : Object.keys(knownMint?.nutsLimits ?? {})
  )
  const supportedNuts = TRACKED_NUTS.filter(nut =>
    supportedNutNumbers.has(String(parseInt(nut.slice(4), 10)))
  )
  // NUT-13 (deterministic secrets) is wallet-side only — mints never advertise
  // it in /v1/info (confirmed against live Nutshell mints and the cashubtc/nuts
  // spec, which lists no mint implementations for NUT-13 at all). The mint-side
  // capability that actually gates seed-phrase backup/restore is NUT-09
  // (restore signatures) — check that instead.
  const supportsBackupRestore = supportedNutNumbers.has('9')
  // Display-only reading for the NUT grid, its modal and the Nutzap group: `supported: false` is not supported
  // (utils/nutSupport.ts). The score above keeps counting presence, like the backend.
  const nutsDeclared: Record<string, unknown> | null = data?.info ? (data.info.nuts as Record<string, unknown>) : (knownMint?.nutsLimits ?? null)
  const declaredNutNumbers = supportedNutKeys(nutsDeclared)
  const gridSupportedNuts = TRACKED_NUTS.filter(nut => declaredNutNumbers.has(String(parseInt(nut.slice(4), 10))))

  const reliabilityScore = knownMint?.reliabilityScore ?? computeReliabilityScore(uptimePct, supportedNuts.length, version, email, twitter, nostr, { blamed: knownMint?.auditCzBlamed ?? null, total: knownMint?.auditCzTotal ?? null, fetchedAt: knownMint?.auditCzFetchedAt ?? null }, versionLatestMap)
  const tsInfo = reliabilityScoreInfo(reliabilityScore)
  const reliabilityDonut = reliabilityDonutArc(reliabilityScore)

  // Reliability Score Breakdown modal rows — hoisted out of the modal's JSX (was a
  // nested IIFE) because the react-compiler ESLint rules disallow reading a
  // ref from inside a hand-rolled nested function during render.
  const breakdownUScore = uptimeComponent(uptimePct)
  const breakdownNScore = nutComponent(supportedNuts.length)
  const breakdownVScore = versionComponent(version, versionLatestMap)
  const breakdownContactFields = [email, twitter, nostr].filter(Boolean)
  const breakdownCScore = contactComponent(breakdownContactFields.length)
  const breakdownContactDisplay = breakdownContactFields.length === 0 ? 'None' : (email ? 'Email' : '') + (twitter ? (email ? ' + Twitter' : 'Twitter') : '') + (nostr ? ((email || twitter) ? ' + Nostr' : 'Nostr') : '')
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
  const breakdownAuditDisplay = auditState === 'scored' ? `${Math.min(auditCzBlamed ?? 0, auditCzTotal ?? 0)} / ${auditCzTotal}` : 'neutral'
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
  const czCheckedMin = czView?.checkedAt ? Math.max(0, Math.floor((now - new Date(czView.checkedAt).getTime()) / 60_000)) : null
  const czInfoText = czView
    ? cashuInfoViewText({
        fallbackFrom8333: !(has8333Audit && !auditNeedsFallback),
        checkedMinutesAgo: czCheckedMin,
        notRecent: czView.notRecent,
        failuresAttributed: czView.failuresAttributed,
      })
    : null
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
  const reliabilityBreakdownRows = [
    { label: UPTIME_ROW_LABEL, display: `${uptimePct}%`, source: uptimeSource, score: breakdownUScore, max: UPTIME_POINTS, color: uptimeColor(uptimePct), tooltip: uptimeRowText() },
    { label: AUDIT_ROW_LABEL, display: breakdownAuditDisplay, source: auditRowSource, ...(auditDetailText ? { detail: auditDetailText } : {}), score: breakdownAScore, max: AUDIT_POINTS, color: auditRowColor, tooltip: auditRowText(), ...(auditStaleNote ? { note: auditStaleNote } : {}) },
    { label: NUT_ROW_LABEL, display: `${supportedNuts.length} / ${TRACKED_NUTS.length} NUTs`, source: infoSource, score: breakdownNScore, max: NUT_POINTS, color: supportedNuts.length >= 12 ? 'var(--accent)' : supportedNuts.length >= 8 ? 'var(--amber)' : 'var(--red)', tooltip: NUT_ROW_TEXT },
    { label: VERSION_ROW_LABEL, display: version ?? 'Unknown', source: versionSource, score: breakdownVScore, max: VERSION_POINTS, color: breakdownVScore >= 12 ? 'var(--accent)' : breakdownVScore >= 6 ? 'var(--amber)' : 'var(--red)', tooltip: versionRowText() },
    { label: CONTACT_ROW_LABEL, display: breakdownContactDisplay, source: infoSource, score: breakdownCScore, max: CONTACT_POINTS, color: breakdownCScore >= 4 ? 'var(--accent)' : breakdownCScore >= 2 ? 'var(--amber)' : 'var(--red)', tooltip: contactRowText() },
  ]
  // "Limited data": the audit part is neutral, or the new-mint cap applies (the score's own constants).
  const limitedReasons = limitedDataReasons({ auditBlamed: auditCzBlamed, auditTotal: auditCzTotal, auditFetchedAt: auditCzFetchedAt, discoveredAt, now })
  const limitedDataLabel = limitedReasons.length > 0 ? (
    <InfoTooltip className="md-limited-data" width={240} text={limitedDataText(limitedReasons)}>
      <span className="md-limited-data-chip">Limited data</span>
    </InfoTooltip>
  ) : null
  // Mint that is not online: an honest block at the top of the Overview (since when, last error, what to do).
  const unavailable = !isOnline && knownMint !== null
  const unavailableInfo = unavailable ? unavailableHeadline({ since: knownMint?.offlineSince ?? knownMint?.lastOnlineAt, archived: knownMint?.archived === true, now }) : null
  const lastErrorText = sanitizeLastError(knownMint?.lastError)
  const unavailableContacts = [email && `email ${email}`, twitter && `Twitter ${twitter}`, nostr && `Nostr ${nostr}`].filter((c): c is string => !!c)
  // Signed health record: only a mint with a current event (not archived, scored, https host that may appear in an event).
  const healthRecord = knownMint && knownMint.archived !== true && typeof knownMint.reliabilityScore === 'number' ? healthRecordFor(url) : null
  const firstSeen = firstSeenLabel(discoveredAt)
  const nostrAnnouncedAt = knownMint?.nostrAnnouncedAt ?? null
  const nostrAnnounceHref = njumpEventUrl(knownMint?.nostrAnnounceId)
  const isNew = isNewMint(discoveredAt)
  const isOutdated = classifyMintVersion(version, versionLatestMap).label === 'outdated'

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
  const AUDIT_SWAP_ROWS_DEFAULT = 8
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
  const chartCoverage = chartHistoryData && chartHistoryData.daysOfDataAvailable < chartHistoryData.periodDays
    ? `Showing ${chartHistoryData.daysOfDataAvailable} of ${chartHistoryData.periodDays} days of data (history retention started recently)`
    : null

  function deltaStr(curr: number | null, prev: number | null, unit = '', insufficientHistory = false): string | null {
    if (prev === null) return (curr !== null && insufficientHistory) ? 'Not enough history yet' : null
    if (curr === null) return null
    const diff = curr - prev
    return `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}${unit} vs prev period`
  }

  // Keysets panel — same data (data.keysets from the existing probe: id/unit/
  // active), no extra fetch. Rendered on the Overview sidebar on desktop
  // (≥901px) and on the NUTs tab on mobile (<901px); the two wrappers below
  // hide the copy that doesn't belong to the current breakpoint.
  const liveKeysets = data?.keysets ?? null
  // A mint that is not online has no live keysets: show the last known ones, labelled with their check date.
  const lastKnownKeysets = unavailable && (!liveKeysets || liveKeysets.length === 0) && knownMint?.lastKeysets && knownMint.lastKeysets.length > 0 && knownMint.lastKeysetsCheckedAt
    ? knownMint.lastKeysets.map(k => ({ id: k.id, unit: k.unit, active: k.active, ...(k.inputFeePpk !== null ? { input_fee_ppk: k.inputFeePpk } : {}) }))
    : null
  // The Fees and limits group computes its examples from the same keysets (a missing fee stays unknown, not 0).
  const feeKeysets = (lastKnownKeysets ?? liveKeysets)?.map(k => ({ unit: k.unit, active: k.active, inputFeePpk: typeof k.input_fee_ppk === 'number' ? k.input_fee_ppk : null })) ?? null
  const keysetsPanel = (() => {
    const lastKnown = lastKnownKeysets
    const keysets = lastKnown ?? liveKeysets
    return (
      <div className="md-panel">
        <div className="md-panel-title">Keysets</div>
        <div className="md-panel-hint">{KEYSETS_HINT}</div>
        {lastKnown && <div className="md-panel-hint">from the last successful check on {formatDate(knownMint?.lastKeysetsCheckedAt)}</div>}
        {!keysets || keysets.length === 0 ? (
          <div style={{fontSize:13,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>Keyset data not available.</div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {keysets.map(ks => (
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
                    title="Copy full keyset ID"
                    aria-label="Copy full keyset ID"
                  >
                    {copiedContact === `keyset-${ks.id}` ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
                <span className="md-keyset-meta" style={{fontSize:11,color:'var(--text3)',fontFamily:'var(--font-mono)',textTransform:'uppercase',letterSpacing:'0.06em'}}>{ks.unit}</span>
                {typeof ks.input_fee_ppk === 'number' && (
                  <InfoTooltip text="Input fee per 1000 proofs spent from this keyset" width={200}><span className="md-keyset-meta" style={{fontSize:11,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>{formatKeysetFee(ks.input_fee_ppk)}</span></InfoTooltip>
                )}
                <span className="md-keyset-meta" style={{
                  fontSize:10,fontFamily:'var(--font-mono)',fontWeight:600,borderRadius:5,padding:'2px 7px',marginLeft:'auto',
                  color: ks.active ? 'var(--accent)' : 'var(--text3)',
                  background: ks.active ? 'var(--green-soft)' : 'var(--bg4)',
                  border: `0.5px solid ${ks.active ? 'var(--green-soft-strong)' : 'var(--border)'}`,
                }}>
                  {ks.active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
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
              <h1 className="md-name" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <span {...(resolvedNameFull ? { title: resolvedNameFull } : {})}>{displayName}</span>
                <span className={`md-status-inline ${isOnline ? '' : 'offline'}`}>
                  <span className={`status-dot ${isOnline ? '' : 'offline'}`} />
                  <span>{isOnline ? 'Online' : 'Offline'}</span>
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
              </h1>
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
                strokeDashoffset={reliabilityDonut.dashOffset}
                strokeLinecap="round"
                transform="rotate(-90 36 36)" />
            </svg>
            <span className="md-sc-reliability-num">{reliabilityScore}</span>
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

          {activeTab === 'overview' && (<>
            {unavailableInfo && (
              <div className="md-panel md-unavailable">
                <div className="md-ua-headline">{unavailableInfo.text}</div>
                {knownMint?.lastCheckedAt && (
                  <div className="md-ua-line">Last check <span title={formatDateTimeUtc(knownMint.lastCheckedAt)}>{formatTimeAgo(new Date(knownMint.lastCheckedAt), now)}</span></div>
                )}
                {lastErrorText && <div className="md-ua-line">Last error: {lastErrorText}</div>}
                <div className="md-ua-line md-ua-score">Reliability Score {reliabilityScore}. {LAST_SCORE_CAPTION}</div>
                <div className="md-ua-todo">
                  <div className="md-panel-title">What to do with tokens from an unreachable mint</div>
                  <ul className="md-ua-list">
                    <li>{KEEP_WALLET_SENTENCE}</li>
                    <li>{TEMPORARY_SENTENCE}</li>
                    <li>{restoreSentence(supportsBackupRestore)}</li>
                    <li>{contactSentence(unavailableContacts)}</li>
                  </ul>
                  <Link to="/learn/understanding-the-risks" className="md-ua-link">Read about the risks of using a mint</Link>
                </div>
              </div>
            )}
            {(motd || description || descriptionLong) && (
              <div className="md-panel">
                <div className="md-panel-title">About</div>
                {motd && isMotdAlert(motd) && (
                  <div
                    className={`md-mint-alert${motd.trim().length <= 24 ? ' md-mint-alert--inline' : ''}`}
                    role="status"
                  >
                    <AlertTriangle size={16} className="md-mint-alert-icon" />
                    <div className="md-mint-alert-body">
                      <div className="md-mint-alert-title">Operator notice</div>
                      <div className="md-mint-alert-text">{motd}</div>
                    </div>
                  </div>
                )}
                {motd && !isMotdAlert(motd) && (
                  <div className="md-motd">
                    <div className="md-motd-label">Message of the Day</div>
                    <div className="md-motd-text">{motd}</div>
                  </div>
                )}
                {description && (
                  <div className="md-info-row md-desc-row">
                    <span className="md-info-label">Description</span>
                    <span className="md-info-value">{description}</span>
                  </div>
                )}
                {descriptionLong && (
                  <div className="md-info-row md-desc-row">
                    <span className="md-info-label">Full description</span>
                    <span className="md-info-value">
                      {descriptionLong}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div className="md-panel">
              <div className="md-panel-title">Mint info</div>
            {probeLoading && (
              <div style={{fontSize:11,color:'var(--text3)',fontFamily:'var(--font-mono)',marginBottom:12}}>
                Loading live mint data (MOTD, description, contact)…
              </div>
            )}
            {probeError && data === undefined && <LoadError message={LIVE_DATA_ERROR} onRetry={() => { void refetchProbe() }} />}
            {(nut4Disabled || nut5Disabled) && (
              <div className="md-mint-alert">
                <AlertTriangle size={16} className="md-mint-alert-icon" />
                <div className="md-mint-alert-body">
                  {nut4Disabled && (
                    <>
                      <div className="md-mint-alert-title">This mint has stopped issuing new ecash</div>
                      <div className="md-mint-alert-text">
                        You can no longer deposit here, but any ecash you already hold can still
                        be melted or withdrawn. A mint turning off minting usually means the
                        operator is winding it down — if you have a balance on this mint,
                        withdraw it while you still can.
                      </div>
                    </>
                  )}
                  {nut5Disabled && (
                    <>
                      <div className="md-mint-alert-title">This mint has disabled withdrawals</div>
                      <div className="md-mint-alert-text">
                        Melting ecash back to Lightning is switched off right now. Funds already
                        held on this mint can&apos;t be moved out until the operator re-enables it —
                        avoid depositing more here in the meantime.
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="md-info-grid md-info-list">
              <div className="md-info-row">
                <span className="md-info-label">Name</span>
                <span className="md-info-value">{name ?? '—'}</span>
              </div>
              <div className="md-info-row">
                <span className="md-info-label">Version</span>
                <span className="md-info-value">{version ?? '—'}</span>
              </div>
              <div className="md-info-row">
                <span className="md-info-label">Discovered</span>
                <span className="md-info-value">NIP-87</span>
              </div>
              {mintTime && (
                <div className="md-info-row">
                  <span className="md-info-label">Server time</span>
                  <span className="md-info-value" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                    {formatTime(new Date(mintTime * 1000))}
                    {(() => { const d = clockDriftLabel(mintTime); return <span className="md-clock-drift" style={{fontSize:11,fontFamily:'var(--font-mono)',color:d.color}} title="Mint clock vs this browser">{d.label}</span> })()}
                  </span>
                </div>
              )}
              {pubkey && (
                <div className="md-info-row" style={{alignItems: 'center'}}>
                  <span className="md-info-label">Public key</span>
                  <div style={{display: 'flex', alignItems: 'center', gap: 4}}>
                    <span style={{fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font-mono)'}}>{pubkey.slice(0, 8)}…{pubkey.slice(-8)}</span>
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
                      aria-label="Copy full public key"
                    >
                      {copiedContact === 'pubkey' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              )}
              <div className="md-info-row md-hr-row">
                <span className="md-info-label">Signed health record</span>
                <span className="md-info-value md-hr-value">
                  {healthRecord ? (
                    <>
                      <CopyTextButton label="Copy naddr" what="the Nostr address (naddr) of the signed health record" value={healthRecord.naddr} />
                      <CopyTextButton label="Copy nak command" what="a nak command that fetches the signed health record" value={healthRecord.nakCommand} />
                    </>
                  ) : (
                    <span className="md-hr-none">No current record</span>
                  )}
                  <Link to="/for-wallets#signed-health-assertions" className="md-hr-link">About signed health records</Link>
                </span>
              </div>
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
            </div>
            {urls && urls.length > 1 && (
              <div className="md-info-row" style={{flexDirection:'column', alignItems:'flex-start', gap:4}}>
                <span className="md-info-label">URLs</span>
                <div style={{display:'flex', flexDirection:'column', gap:3, width:'100%'}}>
                  {urls.map((u: string) => {
                    const isActive = u === url
                    return (
                      <div key={u} style={{display:'flex', alignItems:'center', gap:6, justifyContent:'space-between'}}>
                        <span style={{
                          fontSize:12, color: isActive ? 'var(--accent)' : 'var(--text3)',
                          fontFamily:'var(--font-mono)', wordBreak:'break-all', flex:1
                        }}>
                          {isActive ? '● ' : '○ '}{u}
                        </span>
                        <button
                          onClick={() => {
                            void navigator.clipboard.writeText(u)
                            setCopiedContact(`url-${u}`)
                            setTimeout(() => setCopiedContact(null), 2000)
                          }}
                          style={{
                            background:'none', border:'none', cursor:'pointer',
                            color: copiedContact === `url-${u}` ? 'var(--accent)' : 'var(--text3)', padding:'2px 4px',
                            flexShrink:0, display:'flex',
                          }}
                          title="Copy URL"
                          aria-label="Copy URL"
                        >
                          {copiedContact === `url-${u}` ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {(() => { const rows = networkRows(knownMint); return rows ? <MintNetworkCard rows={rows} /> : null })()}

          {(email || twitter || nostr || operatorNip05 || (data?.contactChecks?.length ?? 0) > 0) && (
            <div className="md-panel">
              {(email || twitter || nostr) && (
                <>
                  <div className="md-panel-title">Get in touch</div>
                  <div className="md-contact-grid">
                    {email && (
                      <div className="md-contact-card">
                        <div className="md-contact-icon"><Mail size={14} /></div>
                        <div style={{minWidth:0}}>
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
                          aria-label="Copy"
                        >
                          {copiedContact === 'email' ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </div>
                    )}
                    {twitter && (
                      <div className="md-contact-card">
                        <div className="md-contact-icon"><AtSign size={14} /></div>
                        <div style={{minWidth:0}}>
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
                          aria-label="Copy"
                        >
                          {copiedContact === 'twitter' ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </div>
                    )}
                    {nostr && (
                      <div className="md-contact-card">
                        <div className="md-contact-icon"><Zap size={14} /></div>
                        <div style={{minWidth:0}}>
                          <div className="md-contact-type">Nostr</div>
                          <div className="md-contact-val" style={{wordBreak:'break-all'}}>
                            {njumpProfileUrl(nostr) ? (
                              <a href={njumpProfileUrl(nostr)!} target="_blank" rel="noopener noreferrer">{nostr}</a>
                            ) : nostr}
                          </div>
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
                          aria-label="Copy"
                        >
                          {copiedContact === 'nostr' ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              {operatorNip05 && (
                <div className="md-nip05-line">
                  <InfoTooltip
                    className="md-nip05-tip"
                    iconSize={13}
                    width={240}
                    openOnFocus
                    label={NIP05_TOOLTIP}
                    text={NIP05_TOOLTIP}
                  />
                  <span className="md-nip05-text">
                    Profile NIP-05 · not verified: <span className="md-nip05-val">{operatorNip05}</span>
                  </span>
                </div>
              )}
              <ContactChecksLine checks={data?.contactChecks} now={now} />
            </div>
          )}
          </>)}

          {activeTab === 'nuts' && (<>
          {knownMint && (
            <MintFeesLimits
              keysets={feeKeysets}
              keysetsPending={probeLoading && !feeKeysets}
              units={knownMint.units}
              mintMethods={knownMint.mintMethods}
              meltMethods={knownMint.meltMethods}
              disabled={{ mint: nut4Disabled, melt: nut5Disabled }}
              fetchedAt={infoFetchedAt}
              now={now}
            />
          )}

          {/* Mobile (<901px) only — on desktop the Keysets panel moves to the
              Overview sidebar next to "Units & Methods". */}
          <div className="md-keysets-at-nuts">{keysetsPanel}</div>

            <div className="md-panel">
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:11}}>
                <div className="md-panel-title" style={{marginBottom:0}}>NUT compatibility</div>
              {supportsBackupRestore ? (
                <span style={{display:'inline-flex',alignItems:'center',gap:4}}>
                  <span className="md-backup-pill" style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:10,fontFamily:'var(--font-mono)',fontWeight:600,color:'var(--accent)',background:'var(--green-soft)',border:'0.5px solid var(--green-soft-strong)',borderRadius:5,padding:'2px 7px'}}>
                    <ShieldCheck size={11} /> Backup supported
                  </span>
                  <InfoTooltip iconSize={11} width={220} about="backup support" text={BACKUP_SUPPORTED_TEXT} />
                </span>
              ) : (
                <span style={{display:'inline-flex',alignItems:'center',gap:4}}>
                  <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:10,fontFamily:'var(--font-mono)',fontWeight:600,color:'var(--text3)',background:'var(--bg3)',border:'0.5px solid var(--border)',borderRadius:5,padding:'2px 7px'}}>
                    <ShieldOff size={11} /> No backup
                  </span>
                  <InfoTooltip iconSize={11} width={220} about="backup support" text={NO_BACKUP_TEXT} />
                </span>
              )}
            </div>
            <div className="nut-summary-line">
              <strong>{gridSupportedNuts.length}</strong> of {TRACKED_NUTS.length} known NUTs supported
            </div>
            <div className="nut-grid">
              {TRACKED_NUTS.map(nut => {
                const supported = gridSupportedNuts.includes(nut)
                const meta = NUT_DESCRIPTIONS[nut]
                const nutKey = parseInt(nut.slice(4), 10).toString()
                const rawConfig = data?.info?.nuts?.[nutKey]
                const nutConfig = (rawConfig !== null && rawConfig !== undefined && typeof rawConfig === 'object') ? rawConfig as NutConfig : null
                const isDisabled = supported && nutConfig?.disabled === true
                return (
                  <div key={nut} className={`nut-card ${isDisabled ? 'nut-disabled' : supported ? 'supported' : 'unsupported'}`} {...clickableProps(() => setSelectedNut(nut))}>
                    <div className={`nut-icon ${isDisabled ? 'nut-disabled' : supported ? 'supported' : 'unsupported'}`}>
                      {NUT_ICONS[nut] ?? (isDisabled ? '!' : supported ? '●' : '○')}
                    </div>
                    <div className="nut-info">
                      <div className="nut-name">{nut}</div>
                      <div className="nut-desc">{isDisabled ? 'Disabled by operator' : meta?.short ?? ''}</div>
                    </div>
                    <span className="nut-check" style={{ color: isDisabled ? 'var(--amber)' : supported ? 'var(--accent)' : 'var(--text3)' }}>
                      {isDisabled ? '!' : supported ? '✓' : '–'}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="md-nut-nutzap-note">{NUTZAP_NUTS_NOTE}</div>
          </div>
          </>)}

          {activeTab === 'history' && (<>
            <div className="md-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div className="md-panel-title" style={{ marginBottom: 0 }}>Historical data</div>
              <div className="md-seg" role="group" aria-label="Period">
                {(['24h', '7d', '30d', '90d'] as const).map(iv => (
                  <button
                    key={iv}
                    type="button"
                    onClick={() => setChartInterval(iv)}
                    className={chartInterval === iv ? 'on' : ''}
                  >{iv}</button>
                ))}
              </div>
            </div>

            {/* Summary metric cards */}
            <div className="md-hist-summary">
              {[
                { label: 'Average latency', value: chartAvgLatency !== null ? `${chartAvgLatency} ms` : '—', delta: deltaStr(chartAvgLatency, chartPrevLatency, ' ms', chartPrevInsufficientHistory), color: 'var(--text)' },
                { label: 'Average uptime', value: chartAvgUptime !== null ? `${chartAvgUptime}%` : '—', delta: deltaStr(chartAvgUptime, chartPrevUptime, '%', chartPrevInsufficientHistory), color: 'var(--accent)' },
                { label: 'Average reliability', value: `${reliabilityScore}`, delta: null, color: tsInfo.color },
              ].map(({ label, value, delta, color }) => (
                <div key={label} className="md-hist-fig">
                  <div className="md-hist-fig-value" style={{ color }}>{value}</div>
                  <div className="md-hist-fig-label">{label}</div>
                  {delta && <div className="md-hist-fig-delta">{delta}</div>}
                </div>
              ))}
            </div>

            {/* Tab switcher */}
            <div className="md-seg md-hist-metric" role="group" aria-label="Metric">
              {([['latency', 'Latency'], ['uptime', 'Uptime'], ['reliability', 'Reliability Score']] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setChartMetric(m)}
                  className={chartMetric === m ? 'on' : ''}
                >{label}</button>
              ))}
            </div>

            {/* Line chart */}
            {histLineData.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>No historical data for this period.</p>
            ) : chartMetric === 'latency' && histLineData.filter(d => d.latency !== null).length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>No latency samples — mint was offline this period.</p>
            ) : histLineData.filter(d => d[chartMetric] !== null).length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>Not enough data for this period</p>
            ) : (
              <Suspense fallback={<div style={{ height: HISTORY_CHART_HEIGHT }} />}>
                <MintDetailHistoryChart data={histLineData} metric={chartMetric} interval={chartInterval} height={HISTORY_CHART_HEIGHT} />
              </Suspense>
            )}
            {chartCoverage && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{chartCoverage}</div>
            )}
          </div>

          <div className="md-panel">
            <div className="md-panel-title">Outages</div>
            <div className="md-hist-summary" style={{ marginBottom: 12 }}>
              {[
                { label: 'Since last outage', value: outagesData?.sinceLastOutageMs != null ? formatDuration(outagesData.sinceLastOutageMs) : '—' },
                { label: 'Time to recover', value: outagesData?.avgRecoveryMs != null ? formatDuration(outagesData.avgRecoveryMs) : '—' },
                { label: outagesCountLabel(), value: outagesData?.outageCount != null ? String(outagesData.outageCount) : '—' },
              ].map(({ label, value }) => (
                <div key={label} className="md-hist-fig">
                  <div className="md-hist-fig-value">{value}</div>
                  <div className="md-hist-fig-label">{label}</div>
                </div>
              ))}
            </div>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>Show outage details</summary>
              {outagesData?.outages && outagesData.outages.length > 0 ? (
                <table className="md-vh-table">
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Duration</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outagesData.outages.slice().reverse().map((o, i) => (
                      <tr key={i}>
                        <td className="md-vh-ver md-vh-to md-vh-wrap">{formatOutageStart(o.startedAt)}</td>
                        <td className="md-vh-ver md-vh-to md-vh-wrap">{formatDuration(o.durationMs)}</td>
                        <td className="md-vh-ver md-vh-to md-vh-wrap">{o.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text3)' }}>{noOutagesText()}</div>
              )}
            </details>
          </div>

          <div className="md-panel">
            <div className="md-panel-title">Version history</div>
            {!versionHistory || versionHistory.length === 0 ? (
              <div style={{fontSize:13,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>No version history available.</div>
            ) : (
              <table className="md-vh-table">
                <colgroup>
                  <col className="md-vh-col-date" />
                  <col className="md-vh-col-from" />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>From</th>
                    <th>To</th>
                  </tr>
                </thead>
                <tbody>
                  {versionHistory.map((vh, i) => (
                    <tr key={i}>
                      <td className="md-vh-date">{formatDate(vh.firstSeenAt)}</td>
                      <td className="md-vh-ver md-vh-from">{versionHistory[i + 1] ? versionWithBreaks(versionHistory[i + 1]!.version) : '—'}</td>
                      <td className="md-vh-ver md-vh-to">{versionWithBreaks(vh.version)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <MintChangeLog url={url} />
          </>)}

          {activeTab === 'audit' && (<>
            {auditCzLoading ? (
              <div style={{fontSize:12.5,color:'var(--text3)',fontFamily:'var(--font-mono)'}} role="status">Loading audit data…</div>
            ) : (czView !== null || has8333Audit) ? (
              <div className="md-panel md-audit-collapsible" style={{background:'var(--bg)'}}>
                {/* Desktop heading (the mobile collapse toggle below is display:none here). */}
                <div className="md-audit-header md-audit-header-main">
                  <span className="md-panel-title" style={{marginBottom:0}}>Audit stats</span>
                  <span className="md-audit-via">· via {czView ? 'cashu.info' : 'audit.8333.space'}</span>
                  <AuditSourceInfoIcon {...(czInfoText ? { text: czInfoText } : {})} />
                  {auditSwitch}
                </div>
                {/* Mobile heading (mirrors the desktop one above; the collapse
                    toggle was removed once the Audit tab lost its collapsible body). */}
                <div className="md-audit-toggle">
                  <span className="md-panel-title" style={{marginBottom:0}}>Audit stats</span>
                  <span style={{fontSize:12,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>· via {czView ? 'cashu.info' : 'audit.8333.space'}</span>
                  <AuditSourceInfoIcon {...(czInfoText ? { text: czInfoText } : {})} />
                  {auditSwitch}
                </div>

                {!czView && audit8333Stale && <p className="audit-cz-muted">{audit8333Stale}</p>}
                <p className="audit-cz-muted">{czView
                  ? `The Reliability Score uses this same cashu.info window: the last ${AUDIT_WINDOW_DAYS} days.`
                  : czData !== null
                    ? `The Reliability Score uses cashu.info's last ${AUDIT_WINDOW_DAYS} days; this view shows audit.8333.space's last ~${AUDIT_SWAPS_WINDOW} swaps.`
                    : `This view shows audit.8333.space's last ~${AUDIT_SWAPS_WINDOW} swaps; the Reliability Score does not use it.`}</p>
                {czView ? <><AuditCzTiles view={czView} /><AuditDirections detail={auditCzData?.detail} now={now} /></> : (<>
                {/* 5-second overview — always visible, never inside the mobile
                    collapse. Mints/Melts are audit.8333.space lifetime counts;
                    Recent success rate is the rolling ~100-swap window; Last
                    checked is OUR 6h cron's write time (auditSyncedAt). */}
                <div className="audit-summary-strip">
                  <div className="audit-summary-cell">
                    <div className="audit-summary-value" style={{color:'var(--accent)'}}>{stripMints === null ? '—' : stripMints.toLocaleString()}</div>
                    <div className="audit-summary-label">
                      Mints
                      <InfoTooltip iconSize={11} width={180} about="Mints" style={TT_GAP_LEFT} text={tipMints} />
                    </div>
                  </div>
                  <div className="audit-summary-cell">
                    <div className="audit-summary-value" style={{color:'var(--accent)'}}>{stripMelts === null ? '—' : stripMelts.toLocaleString()}</div>
                    <div className="audit-summary-label">
                      Melts
                      <InfoTooltip iconSize={11} width={180} about="Melts" style={TT_GAP_LEFT} text={tipMelts} />
                    </div>
                  </div>
                  <div className="audit-summary-cell">
                    <div className="audit-summary-value" style={{color: stripReliabilityColor}}>
                      {stripRecentSuccessDisplay !== '—' && (
                        <>
                          <span className="audit-summary-main">{stripRecentSuccessDisplay}</span>
                          <span className="audit-summary-dot">·</span>
                        </>
                      )}
                      <span className="audit-summary-sub">{stripRecentSuccessSub}</span>
                    </div>
                    <div className="audit-summary-label">
                      Recent success rate
                      <InfoTooltip iconSize={11} width={180} about="Recent success rate" style={TT_GAP_LEFT} text={tipSuccess} />
                    </div>
                  </div>
                  <div className="audit-summary-cell">
                    <div className="audit-summary-value" style={{fontSize:15}}>{stripAvgTimeDisplay}</div>
                    <div className="audit-summary-label">
                      Avg swap time
                      <InfoTooltip iconSize={11} width={180} about="Avg swap time" style={TT_GAP_LEFT} text={tipAvg} />
                    </div>
                  </div>
                </div>
                </>)}

                {/* Outcome bar — last ≤44 swaps, newest left (the backend
                    already orders by created_at DESC, so no client-side
                    reverse is needed). Nothing renders here until the swap
                    fetch actually resolves with data — never a fake/empty bar. */}
                {auditSwapBarItems.length > 0 && (
                  <div className="audit-swap-bar" title="Last swaps, newest first">
                    {auditSwapBarItems.map(s => (
                      <div
                        key={s.swapId}
                        className={`audit-swap-bar-mark ${s.state === 'OK' ? 'audit-swap-bar-ok' : s.neutral ? 'audit-swap-bar-neutral' : 'audit-swap-bar-fail'}`}
                        title={s.neutral === 'limits' || s.neutral === 'balance' ? AUDIT_CZ_NEUTRAL_TITLE[s.neutral] : `${s.state}${s.stage ? ` (${s.stage})` : ''}${s.createdAt ? ` · ${formatDateTimeUtc(s.createdAt)}` : ''}`}
                      />
                    ))}
                  </div>
                )}

                {czView ? (<>
                  <AuditCzSwapTables view={czView} expandedFrom={showAllCzFrom} expandedTo={showAllCzTo} onToggleFrom={() => setShowAllCzFrom(v => !v)} onToggleTo={() => setShowAllCzTo(v => !v)} />
                </>) : (<>
                {/* Recent swaps — last 8, newest first. Failed rows are muted red. */}
                {auditRecentSwapRows.length > 0 && (
                  <div className="audit-recent-swaps">
                    <div className="audit-recent-swaps-title">Recent swaps</div>
                    <div className="audit-swaps-table-wrap" tabIndex={0} role="group" aria-label="Recent swaps (scrollable)">
                      <table className="audit-swaps-table">
                        <thead>
                          <tr>
                            <th>To</th>
                            <th>Amount</th>
                            <th>Fee</th>
                            <th>Duration</th>
                            <th>State</th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditRecentSwapRows.map(s => (
                            <tr key={s.swapId} className={s.state === 'OK' ? '' : s.neutral ? 'audit-swap-row-neutral' : 'audit-swap-row-fail'} {...(s.neutral === 'limits' || s.neutral === 'balance' ? { title: AUDIT_CZ_NEUTRAL_TITLE[s.neutral] } : {})}>
                              <td>{s.counterpart ?? (s.toUrl ? mintHostname(s.toUrl) : '—')}</td>
                              <td>{s.amount !== null ? `${s.amount} sat` : '—'}</td>
                              <td>{s.fee !== null ? s.fee : '—'}</td>
                              <td>{s.timeTakenMs !== null ? `${Math.round(s.timeTakenMs)} ms` : '—'}</td>
                              {/* cz rows that are not OK: the failure text as tooltip and as visually hidden text (a title is not available on touch or to screen readers). Plain text only. */}
                              <td>
                                <AuditStateText row={s} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {auditSwaps.length > AUDIT_SWAP_ROWS_DEFAULT && (
                      <button
                        type="button"
                        className="audit-swaps-show-all-btn"
                        onClick={() => setShowAllAuditSwaps(v => !v)}
                      >
                        {showAllAuditSwaps ? 'Show fewer' : `Show all (${auditSwaps.length})`}
                      </button>
                    )}
                  </div>
                )}
                {!czView && auditSwapsLoading && auditSwaps.length === 0 && (
                  <div style={{fontSize:12.5,color:'var(--text3)',fontFamily:'var(--font-mono)',marginTop:4}}>Loading recent swaps…</div>
                )}
                {!czView && auditSwapsError && (
                  <div className="audit-swaps-error-banner" role="status">
                    Couldn't load recent swaps
                    <button type="button" className="audit-swaps-retry-btn" onClick={() => void refetchAuditSwaps()}>
                      Retry
                    </button>
                  </div>
                )}
                </>)}

                {czView ? (czView.sourceHref && (
                  <a
                    href={czView.sourceHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="audit-external-link"
                  >
                    Open on cashu.info →
                  </a>
                )) : (
                <a
                  href="https://audit.8333.space/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="audit-external-link"
                >
                  Open on audit.8333.space →
                </a>
                )}
              </div>
            ) : (
              <div className="md-panel">
                <div className="md-audit-header">
                  <span className="md-panel-title" style={{marginBottom:0}}>Audit stats</span>
                  <span className="md-audit-via">· via audit.8333.space</span>
                  <AuditSourceInfoIcon />
                </div>
                <div style={{fontSize:13,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>No audit data available for this mint.</div>
              </div>
            )}
          </>)}

          {activeTab === 'reviews' && (
            <div className="md-panel">
              <div className="reviews-header">
                <div className="md-panel-title" style={{marginBottom:0}}>Reviews</div>
                {isLoggedIn && (
                  <button className="reviews-write-btn" onClick={() => setShowReviewModal(true)}>
                    Write a review
                  </button>
                )}
              </div>
              <div className="reviews-disclaimer" style={{display:'flex',alignItems:'center',gap:5}}>
                <span>Reviews · NIP-87</span>
                <InfoTooltip
                  width={260}
                  label="About NIP-87 reviews"
                  text={REVIEWS_NIP87_TEXT}
                />
              </div>
              {operatorListedCount > 0 && <div className="reviews-disclaimer">{OPERATOR_REVIEW_NOTE}</div>}
              {reviewsLoading ? (
                <div style={{fontSize:13,color:'var(--text3)',marginTop:8}}>Loading reviews...</div>
              ) : mergedReviews.length === 0 ? (
                <div style={{fontSize:13,color:'var(--text3)',marginTop:8}}>
                  {storedReviewsFailed ? 'Reviews are not available right now.' : 'No Nostr reviews found for this mint yet.'}
                </div>
              ) : (
                <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:8}}>
                  <div className="reviews-filter-row">
                    <div
                      className="reviews-filter-group"
                      role="group"
                      aria-label="Filter reviews by rating"
                    >
                      <button
                        type="button"
                        className={`reviews-filter-chip${activeReviewFilter === 'all' ? ' active' : ''}`}
                        aria-pressed={activeReviewFilter === 'all'}
                        onClick={() => setReviewFilter('all')}
                      >All · {reviewCountBase.length}</button>
                      <button
                        type="button"
                        className={`reviews-filter-chip${activeReviewFilter === '5star' ? ' active' : ''}`}
                        aria-pressed={activeReviewFilter === '5star'}
                        onClick={() => setReviewFilter('5star')}
                      >5★ · {reviewFilterFiveStarCount}</button>
                      <button
                        type="button"
                        className={`reviews-filter-chip${activeReviewFilter === 'critical' ? ' active' : ''}`}
                        aria-pressed={activeReviewFilter === 'critical'}
                        onClick={() => setReviewFilter('critical')}
                      >Critical · {reviewFilterCriticalCount}</button>
                    </div>
                    <button
                      type="button"
                      className={`reviews-filter-chip toggle${hideAnonActive ? ' active' : ''}`}
                      aria-pressed={hideAnonActive}
                      onClick={toggleReviewHideAnon}
                    >Hide anon · {reviewFilterAnonCount}</button>
                  </div>
                  {filteredReviews.length === 0 ? (
                    <div style={{fontSize:13,color:'var(--text3)'}}>No reviews match this filter.</div>
                  ) : (
                    <>
                  {pagedReviews.map(r => {
                    const npub = nip19.npubEncode(r.pubkey)
                    const profile = r.profile
                    const displayName = profile?.name ?? shortNpub(npub)
                    const initial = (profile?.name ?? npub).slice(0, 1).toUpperCase()
                    return (
                      <div key={r.id} id={`review-${r.id}`} className={`review-card${highlightedReview === r.id ? ' review-card-hl' : ''}`}>
                        <div className="review-card-header">
                          <div className="review-avatar">
                            <div className="review-avatar-fallback" style={{ background: reviewAvatarColor(r.pubkey), color: avatarTextColor(reviewAvatarColor(r.pubkey)) }}>{initial}</div>
                            {profile?.picture?.startsWith('https://') && (
                              <img src={profile.picture} alt="" className="review-avatar-img" referrerPolicy="no-referrer" onError={e => { e.currentTarget.style.display = 'none' }} />
                            )}
                          </div>
                          <div className="review-author">
                            <span className="review-author-name">
                              <span className="review-author-name-text">
                                {displayName}
                                {profile?.name && verifiedNip05ByPubkey[r.pubkey] && (
                                  <span className="review-author-nip05">{verifiedNip05ByPubkey[r.pubkey]}</span>
                                )}
                                {profile?.fromServer && profile.nip05 && !verifiedNip05ByPubkey[r.pubkey] && (
                                  <span className="review-author-nip05-claimed">claimed NIP-05: {profile.nip05}</span>
                                )}
                              </span>
                              {operatorKeys.has(r.pubkey.toLowerCase()) && (
                                <span className="review-operator-badge">Operator</span>
                              )}
                            </span>
                            <span className="review-author-npub">{shortNpub(npub)}</span>
                          </div>
                          <div className="review-meta">
                            {r.rating !== null && (
                              <span className="review-stars">{starString(r.rating)}</span>
                            )}
                            <span className="review-date">{formatReviewDate(r.createdAt)}</span>
                            <span className="review-actions">
                              <button
                                type="button"
                                className="review-action-btn"
                                title="Copy reviewer npub"
                                aria-label="Copy reviewer npub"
                                onClick={e => {
                                  e.preventDefault()
                                  const np = npubFromPubkey(r.pubkey)
                                  if (!np) return
                                  void navigator.clipboard.writeText(np).then(() => {
                                    setCopiedReviewAction(r.id + '-npub')
                                    window.setTimeout(() => setCopiedReviewAction(null), 1500)
                                  })
                                }}
                              >{copiedReviewAction === r.id + '-npub' ? <Check size={13} /> : <Copy size={13} />}</button>
                              {njumpEventUrl(r.id) && (
                                <a
                                  href={njumpEventUrl(r.id)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="review-action-btn"
                                  title="Open this review on Nostr"
                                ><ExternalLink size={13} /></a>
                              )}
                              <button
                                type="button"
                                className="review-action-btn"
                                title="Copy link to this review"
                                aria-label="Copy link to this review"
                                onClick={e => {
                                  e.preventDefault()
                                  const permalink = `${window.location.origin}/mint/${encodeURIComponent(url)}#review-${r.id}`
                                  void navigator.clipboard.writeText(permalink).then(() => {
                                    setCopiedReviewAction(r.id + '-link')
                                    window.setTimeout(() => setCopiedReviewAction(null), 1500)
                                  })
                                }}
                              >{copiedReviewAction === r.id + '-link' ? <Check size={13} /> : <Link2 size={13} />}</button>
                            </span>
                          </div>
                        </div>
                        {r.comment && <p className="review-comment">{r.comment}</p>}
                      </div>
                    )
                  })}
                  {reviewsTotalPages > 1 && (
                    <nav className="reviews-pagination" aria-label="Reviews pages">
                      <button
                        className="reviews-page-btn"
                        disabled={reviewsPage === 1}
                        onClick={() => goToReviewsPage(reviewsPage - 1)}
                        aria-label="Previous page"
                      >‹</button>
                      {reviewPageList(reviewsPage, reviewsTotalPages).map((p, i) =>
                        p === '…'
                          ? <span key={`gap-${i}`} className="reviews-page-ellipsis">…</span>
                          : (
                            <button
                              key={p}
                              className={`reviews-page-btn${p === reviewsPage ? ' active' : ''}`}
                              aria-current={p === reviewsPage ? 'page' : undefined}
                              onClick={() => goToReviewsPage(p)}
                            >{p}</button>
                          ),
                      )}
                      <button
                        className="reviews-page-btn"
                        disabled={reviewsPage === reviewsTotalPages}
                        onClick={() => goToReviewsPage(reviewsPage + 1)}
                        aria-label="Next page"
                      >›</button>
                    </nav>
                  )}
                    </>
                  )}
                </div>
              )}
            </div>
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
                    strokeDashoffset={reliabilityDonut.dashOffset}
                    strokeLinecap="round"
                    transform="rotate(-90 36 36)" />
                </svg>
                <div className="gauge-num" style={{ color: 'var(--green-bright)', fontFamily: 'var(--font-mono-data)' }}>{reliabilityScore}</div>
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

      {showQr && (
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
              <div className="rb-hero-score" style={{color:reliabilityScoreColor(reliabilityScore)}}>{reliabilityScore}</div>
              <span className="rb-hero-badge" style={{color:tsInfo.color,background:tsInfo.bg,borderColor:tsInfo.border}}>{tsInfo.label}</span>
              {limitedDataLabel}
            </div>
            {unavailable && <div className="rb-scope-note md-ua-caption">{LAST_SCORE_CAPTION}</div>}
            {reliabilityBreakdownRows.map(row => (
              <ReliabilityBreakdownRow key={row.label} {...row} />
            ))}
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
        const supported = gridSupportedNuts.includes(selectedNut)
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
