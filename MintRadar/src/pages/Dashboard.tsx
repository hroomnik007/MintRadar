import { HIDE_TEST_MINTS_TEXT, hiddenMintsText, hideOutdatedText } from '@/utils/tooltipTexts'
import { DEGRADED_AFTER_HOURS } from '@/utils/networkHealthIndex'
import { useState, useMemo, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { NostrEvent } from 'nostr-tools'
import { loadSharedPool } from '@/core/nostr/lazy'
import { useNostrDiscovery } from '@/hooks/useNostrDiscovery'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { useKnownMints, type KnownMint } from '@/hooks/useKnownMints'
import { LoadError, MINT_LIST_ERROR } from '@/components/LoadError'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { ROUTE_META_BY_PATH } from '@/utils/pageMeta'
import { useModalFocus } from '@/hooks/useModalFocus'

import type { MintStatus } from '@core/mint/api'
import { MintCard } from '@/components/mint/MintCard'
import { MintComparePicker } from '@/components/MintComparePicker'
import { useMintHoverPrefetch } from '@/hooks/useMintHoverPrefetch'
import { latencyColor, reliabilityColor, uptimeColor, displayName as mintDisplayName, groupMintsByPubkey, sameOperatorUrls, computeDuplicateMintNames, mintStatusLabel } from '@/utils/mintFormatting'
import { mintStatus } from '@/utils/mintStatus'
import { parseCompareParam, buildCompareParam, resolveComparedMints } from '@/utils/compareUrlParam'
import { listReliabilityScore, compareReliabilityThenRating } from '@/utils/reliabilitySort'
import { ratingSortKey } from '@/utils/bayesianRating'
import { isNotRecommendedMint, partitionNotRecommended } from '@/utils/notRecommended'
import { cleanMintName } from '@/utils/cleanMintName'
import { trackedCount, onlineCount as countOnline, hiddenByDefaultCount, poolForStatus } from '@/utils/mintCounts'
import { collapseOnline, showingNoteText, mobileCollapseApplies, showLessApplies, MOBILE_COLLAPSED_ONLINE, MOBILE_COLLAPSE_QUERY, MOBILE_EXPANDED_KEY, scrollPageTopAfterCollapse } from '@/utils/mobileCollapse'
import { useMediaQuery } from '@/hooks/useIsMobile'
import { TRACKED_NUT_KEYS } from '@/constants/nuts'
import { isNutOffered } from '@/utils/nutSupport'
import { hasRequiredNuts } from '@/utils/nutFilters'
import { parseMethodParam, mintMatchesMethod, methodOptions } from '@/utils/methodFilter'
import { parseSoftwareParam, buildSoftwareParam, mintMatchesSoftware, softwareGroups } from '@/utils/softwareFilter'
import { OUTDATED_PARAM, parseOutdatedParam, buildOutdatedParam, mintMatchesOutdated, hasUnknownVersion, unknownKeptNote } from '@/utils/outdatedFilter'
import { UNIT_FILTER_OPTIONS, parseUnitParam, buildUnitParam, mintMatchesUnits, countUnitHidden, unitHiddenNote, type UnitFilterValue } from '@/utils/unitFilter'
import { InfoTooltip } from '@/components/InfoTooltip'
import { probeErrorMessage, probeRateLimitMessage, isProbeErrorKind, type ProbeErrorKind } from '@/utils/probeErrorMessages'
import { classifySubmitInput, submitInputReason } from '@/utils/submitInput'
import { parseBulkInput, bulkFailureMessage, MAX_BULK_URLS } from '@/utils/bulkInput'
import './Dashboard.css'

// Historical trend charts pull in Recharts (~380 kB chunk) — lazy-load so
// that chunk only loads when a user actually opens Compare, not on every
// Dashboard visit. Matches the Stats/MintDetail lazy-loading pattern in App.tsx.
const ComparisonModal = lazy(() => import('@/components/ComparisonModal').then(m => ({ default: m.ComparisonModal })))

// ── SVG Icons ──────────────────────────────────────────────────

const IcGrid = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="2" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.1"/>
    <rect x="8.5" y="2" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.1"/>
    <rect x="2" y="8.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.1"/>
    <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.1"/>
  </svg>
)
const IcSearch = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <circle cx="5.8" cy="5.8" r="4.3" stroke="currentColor" strokeWidth="1.3"/>
    <line x1="9.2" y1="9.2" x2="12.5" y2="12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)
const IcPlus = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
    <line x1="6" y1="1.5" x2="6" y2="10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="1.5" y1="6" x2="10.5" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const IcRefresh = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M2 7a5 5 0 1 1 1.4 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <polyline points="2,4.5 2,7 4.5,7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const IcFilter = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <line x1="1.5" y1="3" x2="11.5" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <line x1="3" y1="6.5" x2="10" y2="6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <line x1="4.5" y1="10" x2="8.5" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)
const IcClose = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)
const IcList = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <line x1="5" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    <line x1="5" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    <line x1="5" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    <circle cx="2.5" cy="4" r="1" fill="currentColor"/>
    <circle cx="2.5" cy="8" r="1" fill="currentColor"/>
    <circle cx="2.5" cy="12" r="1" fill="currentColor"/>
  </svg>
)

// ── Helpers ────────────────────────────────────────────────────

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

// One clear banner for a 429 from /api/mints/discover, instead of repeating
// "Too many requests" on every row of the Bulk submit list. Uses the
// backend's Retry-After header (seconds) for an exact wait time when
// present; falls back to a generic "try again later" otherwise.
function rateLimitMessage(retryAfterHeader: string | null): string {
  const seconds = retryAfterHeader !== null ? Number(retryAfterHeader) : NaN
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 'Rate limit reached — try again later.'
  }
  const minutes = Math.ceil(seconds / 60)
  const wait = minutes <= 1 ? 'a minute' : `${minutes} minutes`
  return `Rate limit reached — try again in ${wait}.`
}

function formatTimeAgo(date: Date | null): string {
  if (!date) return '—'
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}


// `relay.nostr.band` removed 2026-09-23 — confirmed dead (WS connect timeout), same finding
// as the 2026-09-19 relay audit that already dropped it from DISCOVERY_RELAYS etc.
const NOSTR_LOOKUP_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
]
// nostr-tools gives up waiting for EOSE after 4.4 s; an EOSE that arrives sooner came from the relay.
const LOOKUP_REAL_EOSE_MS = 4000
const DEFAULT_SORT_DIRS: Record<'name' | 'latency' | 'rating' | 'reliability' | 'reviewCount', 'asc' | 'desc'> = { rating: 'desc', latency: 'asc', reliability: 'desc', name: 'asc', reviewCount: 'desc' }

// Wallet-only/auth/method NUTs are deliberately not filterable here — a mint
// never advertises the wallet-only ones, and this should stay in step with
// the same tracked list the Reliability Score/grid/adoption bars use.
const NUT_FILTER_KEYS = TRACKED_NUT_KEYS

interface FilterState {
  status: 'all' | 'online' | 'offline'
  minReliabilityScore: number
  requiredNuts: string[]
  hideTestMints: boolean
  units: UnitFilterValue[]
  /** Payment method (?method=bolt12, utils/methodFilter.ts): offered on deposit or withdrawal, any unit. null = any. */
  method: string | null
  /** Software groups (?software=nutshell,cdk,other,unknown, utils/softwareFilter.ts), OR. [] = any. */
  software: string[]
  /** Hide mints the shared version rule labels "outdated" (?outdated=hide, utils/outdatedFilter.ts). Unknown versions stay. */
  hideOutdated: boolean
}
// New default Dashboard view (2026-09-09): online-only, test mints hidden,
// sorted by Reliability Score desc. The Name-sort freeze from earlier passes is
// deliberately lifted for this — see the "Reliability Score default" note.
// hideTestMints defaults to false (2026-09-10): a fresh Dashboard SHOWS test
// mints (they still carry a "Test mint" badge). An earlier pass defaulted this
// ON — that is deliberately lifted here. ?testmints=hide is emitted only when
// the user turns the checkbox on; the default never emits a param.
const DEFAULT_FILTERS: FilterState = { status: 'online', minReliabilityScore: 0, requiredNuts: [], hideTestMints: false, units: [], method: null, software: [], hideOutdated: false }

const EMPTY_FAMILIES: ReadonlySet<string> = new Set()

function applyFilters(
  mints: KnownMint[],
  filters: FilterState,
  opts: { showDegraded?: boolean; searching?: boolean; softwareFamilies?: ReadonlySet<string> } = {},
): KnownMint[] {
  return mints.filter(mint => {
    // A name/url search reaches every mint — test mints and the online-only
    // default are both bypassed so a searched-for mint is always findable.
    if (!opts.searching) {
      if (filters.hideTestMints && isNotRecommendedMint(mint)) return false
      // "Show" (showDegraded) reveals every mint the default view hides:
      // 24h+ offline, archived and the <24h-offline ones.
      if (filters.status === 'online' && mint.online !== true && !opts.showDegraded) return false
    }
    if (filters.status === 'offline' && mint.online !== false) return false
    if (listReliabilityScore(mint) < filters.minReliabilityScore) return false
    if (!mintMatchesUnits(mint, filters.units)) return false
    if (!mintMatchesMethod(mint, filters.method)) return false
    if (!mintMatchesSoftware(mint, filters.software, opts.softwareFamilies ?? EMPTY_FAMILIES)) return false
    if (!mintMatchesOutdated(mint, filters.hideOutdated)) return false
    if (filters.requiredNuts.length > 0) {
      const nuts = mint.nutsLimits as Record<string, unknown> | null
      if (!nuts) return false
      if (!hasRequiredNuts(nuts, filters.requiredNuts)) return false
    }
    return true
  })
}

const HIDE_TEST_MINTS_TOOLTIP = HIDE_TEST_MINTS_TEXT

function countActiveFilters(f: FilterState): number {
  return [
    // 'all' widens the view (no status filter) so it isn't "active"; only an
    // explicit Offline filter counts.
    f.status === 'offline' ? 1 : 0,
    f.minReliabilityScore > 0 ? 1 : 0,
    f.requiredNuts.length > 0 ? 1 : 0,
    f.hideTestMints !== DEFAULT_FILTERS.hideTestMints ? 1 : 0,
    f.units.length > 0 ? 1 : 0,
    f.method !== null ? 1 : 0,
    f.software.length > 0 ? 1 : 0,
    f.hideOutdated ? 1 : 0,
  ].reduce((a, b) => a + b, 0)
}

// ── URL persistence (search/sort/filters) ────────────────────────
// Committed Dashboard state (not the in-progress filter-panel draft) is
// encoded into the URL query string so it survives refresh and is
// navigable via browser back/forward. Keys are omitted when at their
// default value, keeping the URL clean (e.g. "/" for the default view).

type SortByValue = 'name' | 'latency' | 'rating' | 'reliability' | 'reviewCount'
const SORT_KEYS: readonly SortByValue[] = ['name', 'latency', 'rating', 'reliability', 'reviewCount']

function parseFilterParams(params: URLSearchParams): {
  search: string
  sortBy: SortByValue
  sortDir: 'asc' | 'desc'
  filters: FilterState
  compareUrls: string[]
} {
  const sortByRaw = params.get('sort')
  const sortBy: SortByValue = (SORT_KEYS as readonly string[]).includes(sortByRaw ?? '') ? (sortByRaw as SortByValue) : 'reliability'
  const dirRaw = params.get('dir')
  const sortDir: 'asc' | 'desc' = dirRaw === 'asc' || dirRaw === 'desc' ? dirRaw : DEFAULT_SORT_DIRS[sortBy]
  const statusRaw = params.get('status')
  const status: FilterState['status'] = statusRaw === 'all' || statusRaw === 'offline' ? statusRaw : 'online'
  const reliabilityRaw = params.get('reliability')
  const reliabilityParsed = reliabilityRaw !== null ? Number(reliabilityRaw) : 0
  const minReliabilityScore = Number.isFinite(reliabilityParsed) ? Math.min(100, Math.max(0, reliabilityParsed)) : 0
  const nutsRaw = params.get('nuts')
  const requiredNuts = nutsRaw ? nutsRaw.split(',').filter(n => NUT_FILTER_KEYS.includes(n)) : []
  // Stats' NUT-coverage rows link here as ?nut=NN (zero-padded, e.g. ?nut=09).
  // Fold that single NUT into requiredNuts so the existing filter/chip/clear
  // machinery handles it. Invalid/unknown values are simply dropped — never
  // an empty grid. Once the user changes anything, buildFilterParams re-emits
  // it in the canonical ?nuts= form.
  const nutRaw = params.get('nut')
  if (nutRaw !== null) {
    const key = String(parseInt(nutRaw, 10))
    if (NUT_FILTER_KEYS.includes(key) && !requiredNuts.includes(key)) requiredNuts.push(key)
  }
  const hideTestMints = params.get('testmints') === 'hide'
  const units = parseUnitParam(params.get('unit'))
  const method = parseMethodParam(params.get('method'))
  const software = parseSoftwareParam(params.get('software'))
  const hideOutdated = parseOutdatedParam(params.get(OUTDATED_PARAM))
  const compareUrls = parseCompareParam(params.get('compare'))
  return {
    search: params.get('q') ?? '',
    sortBy,
    sortDir,
    filters: { status, minReliabilityScore, requiredNuts, hideTestMints, units, method, software, hideOutdated },
    compareUrls,
  }
}

function buildFilterParams(search: string, sortBy: SortByValue, sortDir: 'asc' | 'desc', filters: FilterState, compareUrls: string[]): URLSearchParams {
  const params = new URLSearchParams()
  if (search) params.set('q', search)
  if (sortBy !== 'reliability') params.set('sort', sortBy)
  if (sortDir !== DEFAULT_SORT_DIRS[sortBy]) params.set('dir', sortDir)
  if (filters.status !== 'online') params.set('status', filters.status)
  if (filters.minReliabilityScore > 0) params.set('reliability', String(filters.minReliabilityScore))
  if (filters.requiredNuts.length > 0) params.set('nuts', filters.requiredNuts.join(','))
  if (filters.hideTestMints) params.set('testmints', 'hide')
  const unitParam = buildUnitParam(filters.units)
  if (unitParam) params.set('unit', unitParam)
  if (filters.method) params.set('method', filters.method)
  const softwareParam = buildSoftwareParam(filters.software)
  if (softwareParam) params.set('software', softwareParam)
  const outdatedParam = buildOutdatedParam(filters.hideOutdated)
  if (outdatedParam) params.set(OUTDATED_PARAM, outdatedParam)
  if (compareUrls.length > 0) params.set('compare', buildCompareParam(compareUrls))
  return params
}

// ── Skeleton Card ─────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="sk-row">
        <div className="sk-avatar" />
        <div className="sk-lines">
          <div className="sk-line" style={{ width: '58%' }} />
          <div className="sk-line" style={{ width: '38%', marginTop: 6 }} />
        </div>
        <div className="sk-dot" />
      </div>
      <div className="sk-pills">
        <div className="sk-pill" style={{ width: 48 }} />
        <div className="sk-pill" style={{ width: 54 }} />
        <div className="sk-pill" style={{ width: 42 }} />
      </div>
      <div className="sk-bottom">
        <div className="sk-latency" />
        <div className="sk-btn" />
      </div>
    </div>
  )
}

// Muted suffix on the "Showing X of Y" line: how many mints the active Unit filter hides because
// their units are unknown / not SAT, USD or EUR. Counts only mints the other filters let through and
// that match the same text search as the grid, so it never contradicts "Showing X".
function UnitHiddenNote({ excluded, selected, search }: { excluded: KnownMint[]; selected: UnitFilterValue[]; search: string }) {
  const note = useMemo(() => {
    if (selected.length === 0) return null
    const q = search.toLowerCase()
    const pool = q
      ? excluded.filter(m => getHostname(m.url).toLowerCase().includes(q) || (m.name ?? getHostname(m.url)).toLowerCase().includes(q))
      : excluded
    return unitHiddenNote(countUnitHidden(pool, selected))
  }, [excluded, selected, search])
  return note ? <span className="grid-unit-hidden-note" data-testid="unit-hidden-note"> · {note}</span> : null
}

// Shown instead of the grid / table when the search (and filters) leave no mint (2026-10-25). Before, the page showed
// an empty grid and "Showing 0 of N" with nothing to do next.
function NoMintsMatch({
  search,
  filtersActive,
  onClearSearch,
  onResetFilters,
  onAddMint,
}: {
  search: string
  filtersActive: boolean
  onClearSearch?: (() => void) | undefined
  onResetFilters?: (() => void) | undefined
  onAddMint?: (() => void) | undefined
}) {
  const q = search.trim()
  return (
    <div className="no-mints-match" role="status" data-testid="no-mints-match">
      <p className="no-mints-match-title">
        {q ? <>No mints match <span className="no-mints-match-q">“{q}”</span></> : 'No mints match these filters'}
      </p>
      {q && filtersActive && <p className="no-mints-match-sub">Filters are on too, so some mints may be hidden by them.</p>}
      <div className="no-mints-match-actions">
        {q && onClearSearch && <button type="button" className="no-mints-match-btn" onClick={onClearSearch}>Clear search</button>}
        {filtersActive && onResetFilters && <button type="button" className="no-mints-match-btn" onClick={onResetFilters}>Reset filters</button>}
        {onAddMint && (
          <button type="button" className="no-mints-match-link" onClick={onAddMint}>Know a mint we don’t list? Add mint</button>
        )}
      </div>
    </div>
  )
}

function ShowAllButton({ total, onClick }: { total: number; onClick: () => void }) {
  return (
    <button type="button" className="show-all-mints-btn" data-testid="show-all-mints" onClick={onClick}>
      Show all {total}
    </button>
  )
}

/** End of an expanded phone list: collapses back to the first MOBILE_COLLAPSED_ONLINE online mints. */
function ShowLessButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="show-all-mints-btn" data-testid="show-less-mints" onClick={onClick}>
      Show less
    </button>
  )
}

interface EmptyStateProps {
  /** Phone default view: cap the online mints at this many (mobileCollapse.ts); null = show all. */
  collapseOnlineTo?: number | null
  onShowAll?: (() => void) | undefined
  /** Expanded phone default view only (showLessApplies); undefined on tablet/desktop and with a search/filter. */
  onShowLess?: (() => void) | undefined
  filtersActive?: boolean
  onClearSearch?: (() => void) | undefined
  onResetFilters?: (() => void) | undefined
  onAddMint?: (() => void) | undefined
}

function MintListView({
  mints,
  search,
  sortBy,
  sortDir,
  totalAll,
  unitExcluded = EMPTY_MINTS,
  unitSelected = EMPTY_UNITS,
  duplicateDisplayNames = EMPTY_DUPLICATE_NAMES,
  filtersActive = false,
  onClearSearch,
  onResetFilters,
  onAddMint,
  collapseOnlineTo = null,
  onShowAll,
  onShowLess,
}: {
  mints: KnownMint[]
  search: string
  sortBy: 'name' | 'latency' | 'rating' | 'reliability' | 'reviewCount'
  sortDir: 'asc' | 'desc'
  totalAll?: number
  unitExcluded?: KnownMint[]
  unitSelected?: UnitFilterValue[]
  duplicateDisplayNames?: ReadonlySet<string> | undefined
} & EmptyStateProps) {
  const navigate = useNavigate()
  const { onMintPointerEnter, onMintPointerLeave } = useMintHoverPrefetch()
  const sortedFiltered = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = mints.filter(mint => {
      if (!q) return true
      const name = (mint.name ?? getHostname(mint.url)).toLowerCase()
      return getHostname(mint.url).toLowerCase().includes(q) || name.includes(q)
    })
    // Test mints always follow every other mint, whatever the sort mode or direction.
    return partitionNotRecommended([...filtered].sort((a, b) => {
      let result: number
      if (sortBy === 'rating') {
        // Confidence-adjusted average (few reviews rank lower), NOT the displayed average —
        // see utils/bayesianRating.ts. Mints without a rated review sort last.
        result = ratingSortKey(b) - ratingSortKey(a)
      } else if (sortBy === 'latency') {
        const la = a.online === true && a.latencyMs != null ? a.latencyMs : Infinity
        const lb = b.online === true && b.latencyMs != null ? b.latencyMs : Infinity
        result = la - lb
      } else if (sortBy === 'reliability') {
        result = compareReliabilityThenRating(a, b)
      } else if (sortBy === 'reviewCount') {
        // Mints with reviewCount === 0 or null sort to the end, regardless of direction toggle.
        const ca = a.reviewCount && a.reviewCount > 0 ? a.reviewCount : -1
        const cb = b.reviewCount && b.reviewCount > 0 ? b.reviewCount : -1
        result = cb - ca
      } else {
        result = mintDisplayName(a, duplicateDisplayNames).localeCompare(mintDisplayName(b, duplicateDisplayNames))
      }
      return sortDir === DEFAULT_SORT_DIRS[sortBy] ? result : -result
    }))
  }, [mints, search, sortBy, sortDir, duplicateDisplayNames])

  if (sortedFiltered.length === 0 && (search.trim() !== '' || filtersActive)) {
    return <NoMintsMatch search={search} filtersActive={filtersActive} onClearSearch={onClearSearch} onResetFilters={onResetFilters} onAddMint={onAddMint} />
  }

  const { shown, onlineTotal, collapsed } = collapseOnline(sortedFiltered, collapseOnlineTo)

  return (
    <>
      <div className="mint-list-table-wrap">
        <table className="mint-list-table">
          <thead>
            <tr>
              <th>Mint</th>
              <th>Status</th>
              <th>Uptime 24h</th>
              <th className="col-hide-mobile">Latency</th>
              <th className="col-hide-mobile">Reliability</th>
              <th className="col-hide-mobile">NUTs</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(mint => {
              const isOnline = mint.online === true
              const isArchived = !isOnline && mint.archived === true
              // Same status rule and word as the card and the wallet API (2026-10-27): degraded reads "Degraded".
              const statusLabel = mintStatusLabel(mintStatus(mint))
              const displayName = mintDisplayName(mint, duplicateDisplayNames)
              const score = mint.reliabilityScore ?? null
              return (
                <tr key={mint.url} className="mint-list-row" onClick={e => { if (!(e.target as Element).closest('a')) navigate(`/mint/${encodeURIComponent(mint.url)}`) }} onPointerEnter={() => onMintPointerEnter(mint.url)} onPointerLeave={onMintPointerLeave}>
                  <td className="mint-list-td-name">
                    <MintFavicon url={mint.url} iconUrl={mint.iconUrl ?? null} size={24} radius={5} />
                    <div style={{ minWidth: 0 }}>
                      <div className="mint-list-name" title={displayName}><Link className="mint-list-link" to={`/mint/${encodeURIComponent(mint.url)}`}>{displayName}</Link></div>
                      {displayName !== getHostname(mint.url) && <div className="mint-list-url" title={getHostname(mint.url)}>{getHostname(mint.url)}</div>}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: 10, color: isOnline ? 'var(--accent)' : isArchived ? 'var(--text3)' : 'var(--red)' }}>
                      ●<span className="status-text-mobile-hide"> {statusLabel}</span>
                    </span>
                  </td>
                  <td style={{ color: uptimeColor(mint.uptimePct24h), fontFamily: 'var(--font-mono-data)', fontSize: 12 }}>
                    {mint.uptimePct24h != null ? `${mint.uptimePct24h}%` : '—'}
                  </td>
                  <td className="col-hide-mobile" style={{ color: latencyColor(mint.latencyMs), fontFamily: 'var(--font-mono-data)', fontSize: 12 }}>
                    {isOnline && mint.latencyMs != null ? `${mint.latencyMs}ms` : '—'}
                  </td>
                  <td className="reliability-col col-hide-mobile" style={{ color: score != null ? reliabilityColor(score) : 'var(--text3)', fontFamily: 'var(--font-mono-data)', fontSize: 12, fontWeight: 600 }}>
                    {score != null ? `${score}` : '—'}
                  </td>
                  <td className="col-hide-mobile" style={{ fontFamily: 'var(--font-mono-data)', fontSize: 12, color: 'var(--text2)' }}>
                    {mint.nutCount != null ? `${mint.nutCount}/${TRACKED_NUT_KEYS.length}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {collapsed && onShowAll && <ShowAllButton total={onlineTotal} onClick={onShowAll} />}
      {!collapsed && onShowLess && onlineTotal > MOBILE_COLLAPSED_ONLINE && <ShowLessButton onClick={onShowLess} />}
      <div className="grid-showing-note" style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', marginTop: 16, fontFamily: 'var(--font-mono)' }}>
        {showingNoteText(shown, totalAll || sortedFiltered.length, { collapsed, onlineTotal })}
        <UnitHiddenNote excluded={unitExcluded} selected={unitSelected} search={search} />
      </div>
    </>
  )
}

const EMPTY_PUBKEY_GROUPS: Map<string, string[]> = new Map()
const EMPTY_MINTS: KnownMint[] = []
const EMPTY_UNITS: UnitFilterValue[] = []
const EMPTY_DUPLICATE_NAMES: ReadonlySet<string> = new Set()

function MintGrid({
  mints,
  search,
  sortBy,
  sortDir,
  onCompare,
  totalAll,
  unitExcluded = EMPTY_MINTS,
  unitSelected = EMPTY_UNITS,
  pubkeyGroups = EMPTY_PUBKEY_GROUPS,
  duplicateDisplayNames = EMPTY_DUPLICATE_NAMES,
  filtersActive = false,
  onClearSearch,
  onResetFilters,
  onAddMint,
  collapseOnlineTo = null,
  onShowAll,
  onShowLess,
}: {
  mints: KnownMint[]
  search: string
  sortBy: 'name' | 'latency' | 'rating' | 'reliability' | 'reviewCount'
  sortDir: 'asc' | 'desc'
  onCompare?: (url: string) => void
  totalAll?: number
  unitExcluded?: KnownMint[]
  unitSelected?: UnitFilterValue[]
  pubkeyGroups?: Map<string, string[]>
  duplicateDisplayNames?: ReadonlySet<string> | undefined
} & EmptyStateProps) {
  const sortedFiltered = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = mints.filter(mint => {
      if (!q) return true
      const name = (mint.name ?? getHostname(mint.url)).toLowerCase()
      return getHostname(mint.url).toLowerCase().includes(q) || name.includes(q)
    })

    // Test mints always follow every other mint, whatever the sort mode or direction.
    return partitionNotRecommended([...filtered].sort((a, b) => {
      let result: number
      if (sortBy === 'rating') {
        // Confidence-adjusted average (few reviews rank lower), NOT the displayed average —
        // see utils/bayesianRating.ts. Mints without a rated review sort last.
        result = ratingSortKey(b) - ratingSortKey(a)
      } else if (sortBy === 'latency') {
        const la = a.online === true && a.latencyMs != null ? a.latencyMs : Infinity
        const lb = b.online === true && b.latencyMs != null ? b.latencyMs : Infinity
        result = la - lb
      } else if (sortBy === 'reliability') {
        result = compareReliabilityThenRating(a, b)
      } else if (sortBy === 'reviewCount') {
        // Mints with reviewCount === 0 or null sort to the end, regardless of direction toggle.
        const ca = a.reviewCount && a.reviewCount > 0 ? a.reviewCount : -1
        const cb = b.reviewCount && b.reviewCount > 0 ? b.reviewCount : -1
        result = cb - ca
      } else {
        result = mintDisplayName(a, duplicateDisplayNames).localeCompare(mintDisplayName(b, duplicateDisplayNames))
      }
      return sortDir === DEFAULT_SORT_DIRS[sortBy] ? result : -result
    }))
  }, [mints, search, sortBy, sortDir, duplicateDisplayNames])

  if (sortedFiltered.length === 0 && (search.trim() !== '' || filtersActive)) {
    return <NoMintsMatch search={search} filtersActive={filtersActive} onClearSearch={onClearSearch} onResetFilters={onResetFilters} onAddMint={onAddMint} />
  }

  const { shown, onlineTotal, collapsed } = collapseOnline(sortedFiltered, collapseOnlineTo)

  return (
    <>
      <div className="mint-grid">
        {shown.map(mint => (
          <MintCard
            key={mint.url}
            mint={mint}
            {...(onCompare ? { onCompare } : {})}
            sameOperatorUrls={sameOperatorUrls(mint, pubkeyGroups)}
            duplicateDisplayNames={duplicateDisplayNames}
          />
        ))}
      </div>
      {collapsed && onShowAll && <ShowAllButton total={onlineTotal} onClick={onShowAll} />}
      {!collapsed && onShowLess && onlineTotal > MOBILE_COLLAPSED_ONLINE && <ShowLessButton onClick={onShowLess} />}
      <div className="grid-showing-note" style={{fontSize:13,color:'var(--text3)',textAlign:'center',marginTop:16,fontFamily:'var(--font-mono)'}}>
        {showingNoteText(shown, totalAll || sortedFiltered.length, { collapsed, onlineTotal })}
        <UnitHiddenNote excluded={unitExcluded} selected={unitSelected} search={search} />
      </div>
    </>
  )
}

// ── Dashboard ──────────────────────────────────────────────────

export default function Dashboard() {
  // Search/sort/filters are persisted in the URL query string (not plain
  // useState) so they survive a refresh and are navigable via browser
  // back/forward — see parseFilterParams/buildFilterParams above.
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { search, sortBy, sortDir, filters: activeFilters, compareUrls } = useMemo(
    () => parseFilterParams(searchParams),
    [searchParams]
  )

  function commitFilters(
    next: { search?: string; sortBy?: SortByValue; sortDir?: 'asc' | 'desc'; filters?: FilterState; compareUrls?: string[] },
    opts?: { replace?: boolean }
  ) {
    const merged = {
      search: next.search ?? search,
      sortBy: next.sortBy ?? sortBy,
      sortDir: next.sortDir ?? sortDir,
      filters: next.filters ?? activeFilters,
      compareUrls: next.compareUrls ?? compareUrls,
    }
    setSearchParams(buildFilterParams(merged.search, merged.sortBy, merged.sortDir, merged.filters, merged.compareUrls), opts)
  }

  const [viewMode, setViewMode] = useState<'cards' | 'list'>(() => {
    const saved = localStorage.getItem('mintRadar_viewMode')
    return saved === 'list' ? 'list' : 'cards'
  })

  // Filter panel draft state — only committed to the URL (activeFilters) via
  // "Apply filter". Re-synced from activeFilters whenever the panel opens
  // (see the "Filters" button below) so it can't go stale after a
  // browser back/forward navigation changed activeFilters while closed.
  const [showFilters, setShowFilters] = useState(false)
  const [pendingFilters, setPendingFilters] = useState<FilterState>(DEFAULT_FILTERS)

  // Comparison state — the confirmed selection (compareUrls) is persisted in
  // the URL via commitFilters/buildFilterParams so a Compare result can be
  // shared by link; compareBaseUrl/showComparePicker are transient
  // in-progress picker UI state only, not persisted.
  const [compareBaseUrl, setCompareBaseUrl] = useState<string | null>(null)
  const [showComparePicker, setShowComparePicker] = useState(false)

  function openComparePicker(url: string) {
    setCompareBaseUrl(url)
    setShowComparePicker(true)
  }

  // Uses the functional setSearchParams form (patches whatever `compare` is
  // present in the URL *at call time*) rather than commitFilters' full
  // rebuild — this is also called from the mintradar:escape effect below,
  // whose handler closure can otherwise go stale relative to other filter
  // state (search/sort/etc.) between effect re-subscriptions.
  const closeComparisonModal = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('compare')
      return next
    }, { replace: true })
  }, [setSearchParams])

  const [, setTick] = useState(0)
  const [showDegraded, setShowDegraded] = useState(false)
  const [showSubmit, setShowSubmit] = useState(false)
  const dialogRef = useModalFocus('.submit-modal-input') // the Single field first (was autoFocus, which made the input the recorded "trigger")
  const submitBtnRef = useRef<HTMLButtonElement>(null)
  const [submitTab, setSubmitTab] = useState<'single' | 'bulk'>('single')
  const [submitInput, setSubmitInput] = useState('')
  const [submitState, setSubmitState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [submitMsg, setSubmitMsg] = useState('')
  // Populated when a newly-submitted URL shares a mint pubkey with an
  // already-tracked mint (backend/src/mintPubkey.ts). Informational only —
  // both URLs stay tracked as separate rows, nothing is merged.
  const [submitAliasOf, setSubmitAliasOf] = useState<{ url: string; name: string | null }[]>([])
  // Persistent post-submit banner — survives the submit modal closing.
  // `watchUrls` are the newly-added URL(s) the banner waits to see appear in
  // /api/mints/known before auto-dismissing (single-submit only; a bulk
  // banner with nothing newly added has no URL to watch for and stays until
  // manually dismissed). `attempts` bounds the re-invalidate retries below —
  // never an unbounded/unthrottled poll.
  const [queuedBanner, setQueuedBanner] = useState<{
    id: number
    message: string
    tone: 'success' | 'info' | 'error'
    watchUrls: string[]
    attempts: number
  } | null>(null)
  // Probe/lookup results are keyed by the input they were produced for —
  // 'loading' and 'idle' are derived below instead of set synchronously in effects.
  const [probe, setProbe] = useState<{ url: string; state: 'success' | 'error'; result: { name: string | null; version: string | null; nutCount: number; latencyMs: number | null } | null; errorKind?: ProbeErrorKind; rateLimitMsg?: string }>({ url: '', state: 'error', result: null })
  // The outcome of one Nostr key lookup, keyed by the input it was run for (derived 'loading' while none matches).
  const [nostrLookup, setNostrLookup] = useState<{ input: string; outcome: 'found' | 'empty' | 'unreachable' | 'nonhttps'; url: string }>({ input: '', outcome: 'empty', url: '' })
  // The reason line follows the input only after a short pause, so the live region does not announce every keystroke.
  const [settledInput, setSettledInput] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const submitTrimmed = submitInput.trim()
  const inputClass = useMemo(() => classifySubmitInput(submitInput), [submitInput])
  const lookupPubkey = inputClass.kind === 'npub' ? inputClass.pubkey : null
  const lookupResult = lookupPubkey !== null && nostrLookup.input === submitTrimmed ? nostrLookup : null
  const lookupLoading = lookupPubkey !== null && lookupResult === null
  // The one URL the Single tab previews and submits: a typed https URL, or the mint a key's announcement points to.
  const submitUrl = inputClass.kind === 'url' ? inputClass.url : lookupResult?.outcome === 'found' ? lookupResult.url : ''
  const probeState: 'idle' | 'loading' | 'success' | 'error' =
    submitUrl === '' ? 'idle'
    : probe.url === submitUrl ? probe.state
    : 'loading'
  const probeResult = probe.url === submitUrl && probeState === 'success' ? probe.result : null
  const submitReason = settledInput === submitInput ? submitInputReason(inputClass) : null
  // An empty field shows no reason line (the description and the helper above already say it); the Submit button then
  // points assistive technology at those two instead of at the empty status region.
  const submitEmpty = inputClass.kind === 'empty'
  const submitDisabled = probeState !== 'success' || submitState === 'loading'

  // Bulk submit state
  const [bulkInput, setBulkInput] = useState('')
  const [bulkProgress, setBulkProgress] = useState<Array<{ url: string; status: 'pending' | 'probing' | 'added' | 'duplicate' | 'failed'; error?: string; aliasOf?: { url: string; name: string | null }[] }>>([])
  const [bulkRunning, setBulkRunning] = useState(false)
  // The live summary follows the textarea only after a short pause (it sits in a live region).
  const [bulkSettled, setBulkSettled] = useState('')
  // One message for a whole submission that failed as a whole (timeout, network, bad answer) — never per-row guesses.
  const [bulkError, setBulkError] = useState<string | null>(null)
  // Lines of the submission that were not sent (invalid or duplicate), for the results note.
  const [bulkSkipped, setBulkSkipped] = useState(0)
  const [bulkDone, setBulkDone] = useState(false)
  // Set only on a 429 from /api/mints/discover — a single banner shown above
  // the row list instead of repeating "Too many requests" on every row (see
  // handleBulkSubmit below).
  const [bulkRateLimitMsg, setBulkRateLimitMsg] = useState<string | null>(null)
  const bulkParsed = useMemo(() => parseBulkInput(bulkSettled), [bulkSettled])
  useEffect(() => {
    const timer = setTimeout(() => setBulkSettled(bulkInput), 400)
    return () => clearTimeout(timer)
  }, [bulkInput])

  const queryClient = useQueryClient()
  // Client-side NIP-87 discovery POSTs newly-announced mint URLs to
  // /api/mints/discover, where the backend validates + probes them before they
  // enter the `mints` table. We deliberately do NOT merge raw, unvalidated Nostr
  // announcements into the grid or the counts — the single source of truth for
  // "how many mints we track" is /api/mints/known, which is exactly what
  // /api/stats counts too (both are an unfiltered `SELECT ... FROM mints`).
  useNostrDiscovery()
  const { data: knownMintsData, isLoading: knownLoading, isError: knownIsError, refetch: refetchKnown } = useKnownMints()
  // Only when there is nothing to show: a failed background refresh keeps the data already loaded.
  const knownError = knownIsError && knownMintsData === undefined

  // Grouped once over every known mint (not just the currently filtered/shown
  // set) so a "Same operator" badge still reflects the full network, not just
  // whichever mints happen to be visible after the active filters.
  const pubkeyGroups = useMemo(() => groupMintsByPubkey(knownMintsData ?? []), [knownMintsData])

  // Same reasoning as pubkeyGroups above — computed over the full known-mints
  // list so displayName()'s parent-domain suffix guard only fires for a real
  // sibling-name collision (e.g. two "aleafnd.org" mints), not for a mint
  // whose own name merely happens to be a domain suffix of its own hostname
  // with no actual collision (e.g. name="cashu.chat").
  const duplicateDisplayNames = useMemo(() => computeDuplicateMintNames(knownMintsData ?? []), [knownMintsData])

  // The full set of mints we track — every row of the mints table, archived
  // included: same number as "All Known", Stats "Mints Tracked" and
  // /api/stats `totalMints` (see utils/mintCounts.ts).
  const trackedMints = useMemo(() => knownMintsData ?? [], [knownMintsData])
  const knownTotal = trackedCount(trackedMints)

  // An explicit "Offline" or "All" status must surface degraded (offline 24h+) and
  // archived mints even when the default hidden-mints toggle is off — otherwise
  // Offline would AND against the hidden set and return nothing, and All would
  // not mean all.
  const allMints = useMemo(
    () => poolForStatus(trackedMints, activeFilters.status, showDegraded) as KnownMint[],
    [trackedMints, activeFilters.status, showDegraded],
  )
  const hiddenCount = hiddenByDefaultCount(trackedMints, activeFilters.status)

  // Software groups come from ALL tracked mints (not the status pool), so an option does not appear or vanish when Status changes.
  const softwareChoices = useMemo(() => softwareGroups(trackedMints, pendingFilters.software), [trackedMints, pendingFilters.software])
  const softwareFamilies = useMemo(() => softwareGroups(trackedMints).families, [trackedMints])

  const filteredMints = useMemo(() => {
    return applyFilters(allMints, activeFilters, {
      showDegraded,
      searching: search.trim().length > 0,
      softwareFamilies,
    })
  }, [allMints, activeFilters, showDegraded, search, softwareFamilies])
  // Mints that pass every filter except Unit (only needed for the footer note while a unit is selected).
  const unitExcluded = useMemo(() => {
    if (activeFilters.units.length === 0) return EMPTY_MINTS
    const rest = applyFilters(allMints, { ...activeFilters, units: [] }, { showDegraded, searching: search.trim().length > 0, softwareFamilies })
    return rest.filter(m => !mintMatchesUnits(m, activeFilters.units))
  }, [allMints, activeFilters, showDegraded, search, softwareFamilies])
  const activeFilterCount = countActiveFilters(activeFilters)
  // Method filter options: what the tracked mints offer right now (a switched-off NUT-04/05 side does not count), plus the selected one.
  const methodChoices = useMemo(() => methodOptions(allMints, pendingFilters.method), [allMints, pendingFilters.method])
  // Phone default view: first MOBILE_COLLAPSED_ONLINE online mints + "Show all N" (mobileCollapse.ts).
  const isPhone = useMediaQuery(MOBILE_COLLAPSE_QUERY)
  const [mobileExpanded, setMobileExpanded] = useState(() => {
    try { return sessionStorage.getItem(MOBILE_EXPANDED_KEY) === '1' } catch { return false }
  })
  const collapseOnlineTo = mobileCollapseApplies({ isPhone, expanded: mobileExpanded, search, activeFilterCount, status: activeFilters.status }) ? MOBILE_COLLAPSED_ONLINE : null
  function showAllMints(): void {
    setMobileExpanded(true)
    try { sessionStorage.setItem(MOBILE_EXPANDED_KEY, '1') } catch { /* private mode: expanded for this view only */ }
  }
  const showLess = showLessApplies({ isPhone, expanded: mobileExpanded, search, activeFilterCount, status: activeFilters.status })
  // "Show less" sits at the end of a long list; after the collapse the page is much shorter and the visitor would
  // land near the footer, so the effect below goes back to the very top of the page and focuses the Dashboard heading
  // (scrollPageTopAfterCollapse in mobileCollapse.ts).
  const collapseScrollPending = useRef(false)
  function showFewerMints(): void {
    try { sessionStorage.removeItem(MOBILE_EXPANDED_KEY) } catch { /* private mode: nothing stored */ }
    collapseScrollPending.current = true
    setMobileExpanded(false)
  }
  useEffect(() => {
    if (!collapseScrollPending.current || collapseOnlineTo === null) return
    collapseScrollPending.current = false
    scrollPageTopAfterCollapse(window, headingRef.current)
  }, [collapseOnlineTo])
  function openSubmit(): void {
    setShowSubmit(true); setSubmitTab('single'); setSubmitState('idle'); setSubmitInput(''); setProbe({ url: '', state: 'error', result: null }); setNostrLookup({ input: '', outcome: 'empty', url: '' }); setBulkInput(''); setBulkSettled(''); setBulkError(null); setBulkSkipped(0); setBulkProgress([]); setBulkRunning(false); setBulkDone(false); setBulkRateLimitMsg(null)
  }
  // "Add a mint" from a page that is not the Dashboard (the bad-naddr page, MintNaddr.tsx) arrives with
  // state { openAddMint: true }: open the modal once and drop the state so Back / a refresh does not reopen it.
  const location = useLocation()
  const openAddMintRequested = (location.state as { openAddMint?: boolean } | null)?.openAddMint === true
  // Opened during render (React's "adjust state on a prop change" pattern), keyed by the history entry so it runs once;
  // the effect only rewrites the history entry.
  const [handledAddMintKey, setHandledAddMintKey] = useState<string | null>(null)
  if (openAddMintRequested && handledAddMintKey !== location.key) {
    setHandledAddMintKey(location.key)
    openSubmit()
  }
  useEffect(() => {
    if (!openAddMintRequested) return
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
  }, [openAddMintRequested, navigate, location.pathname, location.search])
  function clearSearch(): void {
    commitFilters({ search: '' }, { replace: true })
    searchInputRef.current?.focus({ preventScroll: true })
  }
  function resetFilters(): void {
    setPendingFilters(DEFAULT_FILTERS)
    commitFilters({ filters: DEFAULT_FILTERS })
  }

  // Live count for the filter panel's "Show N of M" button: the same pure
  // applyFilters/pool chain as filteredMints above, but over the *draft*
  // (pendingFilters). Only computed while the panel is open.
  // draftUnknownKept: of those mints, how many have a version the rule cannot compare (the "Hide outdated software"
  // note, shown only while that checkbox is on).
  const { draftCount, draftUnknownKept } = useMemo(() => {
    if (!showFilters) return { draftCount: 0, draftUnknownKept: 0 }
    const pool = poolForStatus(trackedMints, pendingFilters.status, showDegraded) as KnownMint[]
    const shown = applyFilters(pool, pendingFilters, { showDegraded, searching: search.trim().length > 0, softwareFamilies })
    return { draftCount: shown.length, draftUnknownKept: pendingFilters.hideOutdated ? shown.filter(hasUnknownVersion).length : 0 }
  }, [showFilters, trackedMints, pendingFilters, showDegraded, search, softwareFamilies])

  const onlineCount = countOnline(trackedMints)

  // Resolved against the full known-mints set (not the filtered/degraded-hidden
  // allMints) so a shared compare link still works for an offline/degraded
  // mint that's simply hidden from the grid right now. An untracked/invalid
  // URL in the ?compare= param is silently skipped, never crashes the modal.
  const comparedMints = useMemo(
    () => resolveComparedMints(compareUrls, knownMintsData ?? []),
    [knownMintsData, compareUrls]
  )

  const lastCheckTime = useMemo(() => {
    if (!knownMintsData) return null
    let latest: Date | null = null
    for (const mint of knownMintsData) {
      if (mint.lastCheckedAt) {
        const t = new Date(mint.lastCheckedAt)
        if (!latest || t > latest) latest = t
      }
    }
    return latest
  }, [knownMintsData])

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!showSubmit) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSubmit(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showSubmit])

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).type === 'mintradar:escape') {
        setShowFilters(false)
        setShowComparePicker(false)
        closeComparisonModal()
        setShowSubmit(false)
      }
    }
    window.addEventListener('mintradar:escape', handler)
    return () => window.removeEventListener('mintradar:escape', handler)
  }, [closeComparisonModal])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '/') return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
      e.preventDefault()
      searchInputRef.current?.focus()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (submitState !== 'success') return
    const timer = setTimeout(() => setShowSubmit(false), 3000)
    return () => clearTimeout(timer)
  }, [submitState])

  // Derived, not set-in-effect: true once every watched URL from the last
  // submit is visible in /api/mints/known, so the banner (rendered below via
  // `visibleQueuedBanner`) disappears on its own without an effect calling
  // setState synchronously off current render state.
  const queuedBannerResolved = queuedBanner !== null && queuedBanner.watchUrls.length > 0 &&
    queuedBanner.watchUrls.every(u => (knownMintsData ?? []).some(m => m.url === u))
  const visibleQueuedBanner = queuedBanner && !queuedBannerResolved ? queuedBanner : null

  // While unresolved, re-invalidates the query at the backend's own
  // known-mints cache cadence (60s, KNOWN_MINTS_CACHE_TTL) instead of adding
  // a separate polling interval — bounded to 3 attempts (3 min) so a mint
  // that never becomes visible doesn't retry forever.
  useEffect(() => {
    if (!queuedBanner || queuedBanner.watchUrls.length === 0) return
    if (queuedBannerResolved) return
    if (queuedBanner.attempts >= 3) return
    const t = setTimeout(() => {
      setQueuedBanner(b => b ? { ...b, attempts: b.attempts + 1 } : b)
      void queryClient.invalidateQueries({ queryKey: ['mints-known'] })
    }, 60_000)
    return () => clearTimeout(t)
  }, [queuedBanner, queuedBannerResolved, queryClient])

  function handleViewMode(mode: 'cards' | 'list') {
    setViewMode(mode)
    localStorage.setItem('mintRadar_viewMode', mode)
  }

  // Where the sort segment scrolls inside itself (≤370px, see Dashboard.css) keep the active option in view.
  const sortSegmentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const seg = sortSegmentRef.current
    const active = seg?.querySelector<HTMLElement>('.sort-btn.active')
    if (!seg || !active || seg.scrollWidth <= seg.clientWidth) return
    const a = active.getBoundingClientRect()
    const b = seg.getBoundingClientRect()
    seg.scrollLeft += a.left - b.left - (b.width - a.width) / 2
  }, [sortBy])

  function handleSortClick(s: typeof sortBy) {
    if (s === sortBy) {
      commitFilters({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      commitFilters({ sortBy: s, sortDir: DEFAULT_SORT_DIRS[s] })
    }
  }

  // Single <-> Bulk: focus follows the tab to its field, deliberately (the first mount is handled by useModalFocus).
  const prevSubmitTab = useRef(submitTab)
  const tabKeyNav = useRef(false) // arrow/Home/End on the tabs keeps focus on the tab (roving tabindex)
  useEffect(() => {
    if (prevSubmitTab.current === submitTab) return
    prevSubmitTab.current = submitTab
    if (tabKeyNav.current) { tabKeyNav.current = false; return }
    if (!showSubmit) return
    document.querySelector<HTMLElement>(submitTab === 'bulk' ? '.submit-modal .bulk-textarea' : '.submit-modal .submit-modal-input')?.focus({ preventScroll: true })
  }, [submitTab, showSubmit])

  // useModalFocus hands focus back to whatever had it when the dialog opened. Browsers that do not focus a
  // button on click (Safari) leave nothing recorded, so fall back to the Submit button that opened the modal.
  const submitWasOpen = useRef(false)
  useEffect(() => {
    if (showSubmit) { submitWasOpen.current = true; return }
    if (!submitWasOpen.current) return
    submitWasOpen.current = false
    if (!document.activeElement || document.activeElement === document.body) submitBtnRef.current?.focus({ preventScroll: true })
  }, [showSubmit])

  function handleSubmitTabKey(e: React.KeyboardEvent) {
    const order: Array<'single' | 'bulk'> = ['single', 'bulk']
    const i = order.indexOf(submitTab)
    let next: 'single' | 'bulk' | null = null
    if (e.key === 'ArrowRight') next = order[(i + 1) % 2] ?? null
    else if (e.key === 'ArrowLeft') next = order[(i + 1) % 2] ?? null
    else if (e.key === 'Home') next = 'single'
    else if (e.key === 'End') next = 'bulk'
    if (next === null) return
    e.preventDefault()
    if (next !== submitTab) { tabKeyNav.current = true; setSubmitTab(next) }
    document.getElementById(`submit-tab-${next}`)?.focus({ preventScroll: true })
  }

  function handleSubmitInputChange(value: string) {
    setSubmitInput(value)
    // A new value invalidates the previous attempt's error (a submit in flight keeps its 'loading').
    if (submitState === 'error') setSubmitState('idle')
  }

  useEffect(() => {
    const timer = setTimeout(() => setSettledInput(submitInput), 400)
    return () => clearTimeout(timer)
  }, [submitInput])

  // Nostr key lookup — only a valid npub gets here (classifySubmitInput); hex, nsec, nprofile, junk, http and
  // malformed values never reach a relay. Same relays, filter, 600 ms debounce and 8 s limit as before. Every lookup
  // belongs to the input it was started for: the cleanup (input changed, modal closed) marks it stale, closes its
  // subscriptions, and a stale result never touches state.
  // The relays are queried one subscription each (the same as one subscribeMany over all of them) so that a relay
  // that really answered can be told apart from one that never did: nostr-tools declares EOSE on its own after
  // ~4.4 s of silence, which is not an answer.
  useEffect(() => {
    if (!showSubmit || lookupPubkey === null) return
    const input = submitTrimmed
    const pubkey = lookupPubkey
    let stale = false
    let done = false
    let answered = 0
    let pending = NOSTR_LOOKUP_RELAYS.length
    let hardTimeout: ReturnType<typeof setTimeout> | undefined
    const events: NostrEvent[] = []
    const subs: { close: (reason?: string) => void }[] = []
    const settle = () => {
      if (stale || done) return
      done = true
      clearTimeout(hardTimeout)
      subs.forEach(sub => sub.close('lookup done'))
      // The authors filter is only a request: ignore anything a relay returns that is not this key's announcement.
      // The newest announcement wins (equal created_at: the first one received), whatever order or relay it came from;
      // one stamped more than 10 minutes ahead of this clock is ignored. An older announcement is never a fallback.
      const horizon = Math.floor(Date.now() / 1000) + 600
      let newest: NostrEvent | undefined
      for (const e of events) {
        if (e.kind !== 38172 || e.pubkey !== pubkey || e.created_at > horizon) continue
        if (!newest || e.created_at > newest.created_at) newest = e
      }
      if (!newest && answered === 0) { setNostrLookup({ input, outcome: 'unreachable', url: '' }); return }
      const announced = newest?.tags.find(t => t[0] === 'u' && t[1])?.[1]
      if (!announced) { setNostrLookup({ input, outcome: 'empty', url: '' }); return }
      const c = classifySubmitInput(announced)
      setNostrLookup(c.kind === 'url' ? { input, outcome: 'found', url: c.url } : { input, outcome: 'nonhttps', url: '' })
    }
    const timer = setTimeout(() => {
      hardTimeout = setTimeout(settle, 8000)
      // The relay pool (nostr-tools) loads on first use, not with the home page (src/core/nostr/lazy.ts). The 8 s
      // deadline already runs, so a slow or failed load ends as "unreachable" like silent relays do.
      void loadSharedPool().then(sharedPool => {
        if (stale) return
        // Measured from the subscribe, so the module download does not count against a relay's answer time.
        const startedAt = Date.now()
        for (const relay of NOSTR_LOOKUP_RELAYS) {
          let relayDone = false
          const relayFinished = (answeredByRelay: boolean) => {
            if (relayDone) return
            relayDone = true
            if (answeredByRelay) answered++
            pending--
            if (pending === 0) settle()
          }
          const sub = sharedPool.subscribeMany([relay], { kinds: [38172], authors: [pubkey], limit: 5 }, {
            onevent: e => { events.push(e) },
            // Faster than the library's own EOSE timeout = the relay really answered. A relay that failed or closed
            // also reports EOSE, synchronously before its onclose: the microtask lets onclose (a failure) win.
            oneose: () => { queueMicrotask(() => { relayFinished(Date.now() - startedAt < LOOKUP_REAL_EOSE_MS); sub.close('lookup done') }) },
            onclose: () => relayFinished(false),
          })
          subs.push(sub)
        }
      }, () => {})
    }, 600)
    return () => { stale = true; clearTimeout(timer); clearTimeout(hardTimeout); subs.forEach(sub => sub.close('stale')) }
  }, [submitTrimmed, lookupPubkey, showSubmit])

  useEffect(() => {
    if (!showSubmit) return
    if (submitUrl === '') return
    // Same rule as the lookup: the preview belongs to the URL it was probed for; a stale answer is dropped
    // (and the request aborted when the URL changes or the modal closes).
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/mint/probe?url=${encodeURIComponent(submitUrl)}`, { signal: ctrl.signal })
        .then(res => {
          if (res.status === 429) {
            // Our own limit on unknown-URL probes (not the mint host's) — keep the input, no auto-retry.
            if (!ctrl.signal.aborted) setProbe({ url: submitUrl, state: 'error', result: null, rateLimitMsg: probeRateLimitMessage(res.headers.get('Retry-After')) })
            return null
          }
          if (!res.ok) throw new Error()
          return res.json() as Promise<MintStatus>
        })
        .then(data => {
          if (data === null || ctrl.signal.aborted) return
          if (data.online && data.info) {
            const nuts = data.info.nuts as Record<string, unknown>
            setProbe({
              url: submitUrl,
              state: 'success',
              result: {
                // Cleaned like every displayed mint name (cleanMintName.ts); '' = nothing displayable -> "Unknown mint".
                name: cleanMintName(data.info.name, '') || null,
                version: data.info.version ?? null,
                // The tracked NUTs the mint offers (declared, not switched off), like the Mint detail header (not every key of `nuts`).
                nutCount: TRACKED_NUT_KEYS.filter(key => isNutOffered(nuts[key])).length,
                latencyMs: data.latencyMs,
              },
            })
          } else {
            setProbe({ url: submitUrl, state: 'error', result: null, ...(isProbeErrorKind(data.errorKind) ? { errorKind: data.errorKind } : {}) })
          }
        })
        .catch(() => {
          if (ctrl.signal.aborted) return
          setProbe({ url: submitUrl, state: 'error', result: null })
        })
    }, 600)
    return () => { ctrl.abort(); clearTimeout(timer) }
  }, [submitUrl, showSubmit])

  function handleSubmitMint() {
    // aria-disabled keeps the button clickable, so the guard lives here.
    if (submitDisabled) return
    setSubmitState('loading')
    setSubmitAliasOf([])
    fetch('/api/mint/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: submitUrl }),
    })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }: {
        ok: boolean
        data: {
          success?: boolean
          isNew?: boolean
          error?: string
          errorKind?: string
          name?: string | null
          aliasOf?: { url: string; name: string | null }[]
        }
      }) => {
        if (!ok) {
          setSubmitState('error')
          setSubmitMsg(probeErrorMessage(data.errorKind) ?? data.error ?? 'Submission failed')
        } else {
          setSubmitState('success')
          setSubmitMsg(
            data.isNew === false
              ? 'Already tracked — this mint is already known to MintRadar.'
              : 'Added. It will show up in the list shortly.'
          )
          setSubmitAliasOf(data.aliasOf ?? [])
          void queryClient.invalidateQueries({ queryKey: ['mints-known'] })
          // Already-tracked URLs keep the modal message only — no persistent
          // banner (nothing new for the dashboard to wait on).
          if (data.isNew !== false) {
            setQueuedBanner({
              id: Date.now(),
              message: 'Added. It will show up in the list shortly.',
              tone: 'success',
              watchUrls: [submitUrl],
              attempts: 0,
            })
          }
        }
      })
      .catch(() => {
        setSubmitState('error')
        setSubmitMsg('Network error. Please try again.')
      })
  }

  async function handleBulkSubmit() {
    // Parsed from the live text, not the debounced copy: what is sent is exactly what the textarea holds now.
    const parsed = parseBulkInput(bulkInput)
    const urls = parsed.valid
    if (urls.length === 0 || urls.length > MAX_BULK_URLS) return
    setBulkProgress(urls.map(url => ({ url, status: 'probing' as const })))
    setBulkRunning(true)
    setBulkDone(false)
    setBulkRateLimitMsg(null)
    setBulkError(null)
    setBulkSkipped(parsed.invalid.length + parsed.duplicates.length)

    // Back to the form with the text intact and one message for the whole submission.
    const failAsWhole = (message: string) => {
      setBulkProgress([])
      setBulkRunning(false)
      setBulkDone(false)
      setBulkError(message)
      void queryClient.invalidateQueries({ queryKey: ['mints-known'] })
    }
    const SLOW = 'The server took too long to answer. Some mints may have been added, refresh the list to check.'

    let res: Response
    try {
      // `source: 'bulk'` — an explicit user action, drawing from its own rate-limit budget separate from the
      // background NIP-87 discovery scan (see useNostrDiscovery.ts / DISCOVER_BULK_RATE_LIMIT_MAX).
      res = await fetch('/api/mints/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, source: 'bulk' }),
      })
    } catch {
      failAsWhole(SLOW)
      return
    }
    if (res.status === 429) {
      // Nothing in this batch was processed — rows go back to "pending" and one message explains why.
      setBulkRateLimitMsg(rateLimitMessage(res.headers.get('Retry-After')))
      setBulkProgress(prev => prev.map(p => ({ ...p, status: 'pending' as const })))
      setBulkRunning(false)
      setBulkDone(true)
      return
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) { failAsWhole(SLOW); return }
    let data: {
      error?: string
      results?: Array<{ url: string; success: boolean; isNew: boolean; error?: string; errorKind?: string; aliasOf?: { url: string; name: string | null }[] }>
    }
    try {
      data = await res.json() as typeof data
    } catch {
      failAsWhole(SLOW)
      return
    }
    if (!res.ok || !Array.isArray(data.results)) { failAsWhole(data.error ?? 'Submission failed. Try again.'); return }
    const results = data.results
    // Rows map to the sent lines by index, so they are only trusted when the counts agree.
    if (results.length !== urls.length) {
      failAsWhole('The server returned an unexpected answer. Some mints may have been added, refresh the list to check.')
      return
    }
    const progress = results.map((r, k) => {
      const url = urls[k] ?? r.url
      if (!r.success) return { url, status: 'failed' as const, error: bulkFailureMessage(r.errorKind, r.error) }
      return { url, status: r.isNew ? 'added' as const : 'duplicate' as const, aliasOf: r.aliasOf ?? [] }
    })
    setBulkProgress(progress)
    setBulkRunning(false)
    setBulkDone(true)
    void queryClient.invalidateQueries({ queryKey: ['mints-known'] })

    const added = progress.filter(p => p.status === 'added')
    const tracked = progress.filter(p => p.status === 'duplicate').length
    const failed = progress.filter(p => p.status === 'failed').length
    // One banner summarizing the whole batch, not one per URL.
    setQueuedBanner({
      id: Date.now(),
      message: `${added.length} added, ${tracked} already tracked, ${failed} failed`,
      tone: failed === 0 ? 'success' : added.length + tracked === 0 ? 'error' : 'info',
      watchUrls: added.map(p => p.url),
      attempts: 0,
    })
  }

  const bulkAdded = bulkProgress.filter(p => p.status === 'added').length
  const bulkDuplicate = bulkProgress.filter(p => p.status === 'duplicate').length
  const bulkFailed = bulkProgress.filter(p => p.status === 'failed').length
  const bulkTone: 'success' | 'warning' | 'error' = bulkFailed === 0 ? 'success' : bulkAdded + bulkDuplicate === 0 ? 'error' : 'warning'
  const knownUrlSet = useMemo(() => new Set((knownMintsData ?? []).map(m => m.url)), [knownMintsData])
  const bulkValidCount = bulkParsed.valid.length
  const bulkAlreadyTracked = knownMintsData ? bulkParsed.valid.filter(u => knownUrlSet.has(u)).length : null
  const bulkOverBy = bulkValidCount - MAX_BULK_URLS
  const bulkDisabled = bulkValidCount === 0 || bulkOverBy > 0
  // Same notion of "empty" as the live summary (the debounced copy): no reason line then, the description says it.
  const bulkEmpty = bulkSettled.trim() === ''
  const bulkReason =
    bulkOverBy > 0 ? `Up to ${MAX_BULK_URLS} mints per submission. Remove ${bulkOverBy} ${bulkOverBy === 1 ? 'line' : 'lines'}.`
    : bulkValidCount === 0 ? (bulkSettled.trim() === '' ? 'Paste at least one https:// mint URL.' : 'No valid https:// mint URLs yet.')
    : null

  useDocumentMeta(ROUTE_META_BY_PATH['/'].title, ROUTE_META_BY_PATH['/'].description)

  return (
    <div className="dashboard">
      <h1 ref={headingRef} tabIndex={-1} className="sr-only" data-testid="dashboard-heading">MintRadar — Cashu Mints Reliability Score & Uptime Monitor</h1>

      <div className="dash-intro">
        <div className="dash-actions" role="group" aria-label="Get started">
          <button type="button" className="dash-action" onClick={() => navigate('/tools#pick')}>
            Find a mint
          </button>
          <button type="button" className="dash-action" onClick={() => navigate('/tools#token')}>
            Inspect a token
          </button>
        </div>
        <p className="grid-score-explainer">
          We score how it runs. They score how it went. You pick.
        </p>
      </div>

      {!search && !knownError && (
        <div className="dash-status">
          <div className="dash-status-btn">
            <span className="dash-status-live" aria-hidden="true" />
            <span className="dash-status-item"><b>{knownLoading ? '—' : onlineCount}</b> online mints</span>
            <span className="dash-status-sep" aria-hidden="true" />
            <span className="dash-status-item"><b>{knownLoading ? '—' : knownTotal}</b> tracked mints</span>
            <span className="dash-status-item dash-status-end">last checked {formatTimeAgo(lastCheckTime)}</span>
          </div>
        </div>
      )}

      {visibleQueuedBanner && (
        <div className={`queued-banner queued-banner-${visibleQueuedBanner.tone}`} role="status">
          <span>{visibleQueuedBanner.message}</span>
          <button
            type="button"
            className="queued-banner-dismiss"
            aria-label="Dismiss"
            onClick={() => setQueuedBanner(null)}
          >
            ×
          </button>
        </div>
      )}

      <div className="dashboard-controls">
        {/* Wrapper is `display: contents` on desktop (transparent to the flex
            row) and a real flex row on mobile, where the Filters button sits
            beside the search input instead of wrapping to its own line. */}
        <div className="controls-search-line">
          <div className="search-wrap">
            <span className="search-icon"><IcSearch /></span>
            <input
              ref={searchInputRef}
              className="search-input"
              type="text"
              placeholder="Search mints"
              value={search}
              onChange={e => commitFilters({ search: e.target.value }, { replace: true })}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              data-search-input
            />
            {!searchFocused && search === '' && (
              <span className="search-shortcut">/</span>
            )}
          </div>
          <button
            type="button"
            className={`filter-btn${showFilters ? ' active' : ''}`}
            onClick={() => { if (!showFilters) setPendingFilters(activeFilters); setShowFilters(v => !v) }}
          >
            <IcFilter />
            Filters
            {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
          </button>
        </div>
        <div className="sort-segment" ref={sortSegmentRef}>
          {(['reviewCount', 'rating', 'latency', 'name', 'reliability'] as const).map(s => (
            <button
              key={s}
              type="button"
              className={`sort-btn${sortBy === s ? ' active' : ''}`}
              onClick={() => handleSortClick(s)}
            >
              {s === 'reliability' || s === 'reviewCount' ? (
                // Two labels, one shown at a time by CSS (display: none), so the accessible name is always the visible
                // text. The short one fits all five chips on one row at 320–389px (see .sort-lbl-short in Dashboard.css).
                <>
                  <span className="sort-lbl-full">{s === 'reliability' ? 'Reliability Score' : 'Most reviewed'}</span>
                  <span className="sort-lbl-short">{s === 'reliability' ? 'Reliability' : 'Reviews'}</span>
                </>
              ) : s.charAt(0).toUpperCase() + s.slice(1)}
              {sortBy === s && <span className="sort-arrow" style={{marginLeft: 3, fontSize: 10, opacity: 0.7}}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
            </button>
          ))}
        </div>
        <div className="view-toggle">
          <button type="button" className={`view-toggle-btn${viewMode === 'cards' ? ' active' : ''}`} onClick={() => handleViewMode('cards')} title="Card view" aria-label="Card view" aria-pressed={viewMode === 'cards'}>
            <IcGrid />
          </button>
          <button type="button" className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => handleViewMode('list')} title="List view" aria-label="List view" aria-pressed={viewMode === 'list'}>
            <IcList />
          </button>
        </div>
        <button
          type="button"
          className="refresh-btn"
          title="Refresh mint list"
          aria-label="Refresh mint list"
          onClick={() => {
            // Refresh only (2026-10-25): it used to also reset the search, sort and filters, which threw away a
            // filtered view just to get fresh numbers. Resetting lives in the Filters panel ("Reset") and in the
            // no-results state ("Clear search" / "Reset filters").
            void queryClient.invalidateQueries({ queryKey: ['mints-known'] })
          }}
        >
          <IcRefresh />
        </button>
        <button type="button" className="submit-btn" ref={submitBtnRef} onClick={openSubmit}>
          <IcPlus /> Add mint
        </button>
      </div>

      {showFilters && (
        <div className="filter-panel">
          {/* Active filter tags */}
          {activeFilterCount > 0 && (
            <div className="filter-active-tags">
              {activeFilters.status === 'offline' && (
                <span className="filter-tag">
                  Offline
                  <button type="button" onClick={() => { const f = { ...activeFilters, status: 'online' as const }; commitFilters({ filters: f }); setPendingFilters(f) }}><IcClose /></button>
                </span>
              )}
              {activeFilters.hideTestMints && (
                <span className="filter-tag">
                  <InfoTooltip text={HIDE_TEST_MINTS_TOOLTIP} width={240}>Test mints hidden</InfoTooltip>
                  <button type="button" onClick={() => { const f = { ...activeFilters, hideTestMints: false }; commitFilters({ filters: f }); setPendingFilters(f) }}><IcClose /></button>
                </span>
              )}
              {activeFilters.minReliabilityScore > 0 && (
                <span className="filter-tag">
                  Reliability ≥ {activeFilters.minReliabilityScore}
                  <button type="button" onClick={() => { const f = { ...activeFilters, minReliabilityScore: 0 }; commitFilters({ filters: f }); setPendingFilters(f) }}><IcClose /></button>
                </span>
              )}
              {activeFilters.units.length > 0 && (
                <span className="filter-tag">
                  Unit: {activeFilters.units.map(u => u.toUpperCase()).join(', ')}
                  <button type="button" aria-label="Clear unit filter" onClick={() => { const f = { ...activeFilters, units: [] }; commitFilters({ filters: f }); setPendingFilters(f) }}><IcClose /></button>
                </span>
              )}
              {activeFilters.method !== null && (
                <span className="filter-tag">
                  Method: {activeFilters.method}
                  <button type="button" aria-label="Clear method filter" onClick={() => { const f = { ...activeFilters, method: null }; commitFilters({ filters: f }); setPendingFilters(f) }}><IcClose /></button>
                </span>
              )}
              {activeFilters.software.length > 0 && (
                <span className="filter-tag">
                  Software: {activeFilters.software.map(k => softwareChoices.options.find(o => o.key === k)?.name ?? k).join(', ')}
                  <button type="button" aria-label="Clear software filter" onClick={() => { const f = { ...activeFilters, software: [] }; commitFilters({ filters: f }); setPendingFilters(f) }}><IcClose /></button>
                </span>
              )}
              {activeFilters.hideOutdated && (
                <span className="filter-tag">
                  Outdated software hidden
                  <button type="button" aria-label="Clear outdated software filter" onClick={() => { const f = { ...activeFilters, hideOutdated: false }; commitFilters({ filters: f }); setPendingFilters(f) }}><IcClose /></button>
                </span>
              )}
              {activeFilters.requiredNuts.map(nut => (
                <span key={nut} className="filter-tag">
                  NUT-{nut.padStart(2, '0')}
                  <button type="button" onClick={() => { const f = { ...activeFilters, requiredNuts: activeFilters.requiredNuts.filter(n => n !== nut) }; commitFilters({ filters: f }); setPendingFilters(f) }}><IcClose /></button>
                </span>
              ))}
            </div>
          )}

          {/* Two rows on desktop, one column on phones (F2): .filter-main = the four segmented groups (Status, Unit,
              Method, Software), .filter-footer = Reliability, Hide test mints, Reset, Show N of M. The DOM order is
              the phone order. See .filter-bar in Dashboard.css. */}
          <div className="filter-bar">
            <div className="filter-main">
            <div className="filter-field">
              <span className="filter-field-label" id="filter-status-label">Status</span>
              <div className="filter-seg" role="radiogroup" aria-labelledby="filter-status-label">
                {(['all', 'online', 'offline'] as const).map(s => (
                  <label key={s} className={`filter-seg-opt${pendingFilters.status === s ? ' active' : ''}`}>
                    <input type="radio" name="filter-status" checked={pendingFilters.status === s} onChange={() => setPendingFilters(p => ({ ...p, status: s }))} />
                    <span>{s === 'all' ? 'All' : s === 'online' ? 'Online' : 'Offline'}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="filter-field">
              <span className="filter-field-label" id="filter-unit-label">Unit</span>
              <div className="filter-seg" role="group" aria-labelledby="filter-unit-label">
                {UNIT_FILTER_OPTIONS.map(u => {
                  const on = pendingFilters.units.includes(u)
                  return (
                    <button
                      key={u}
                      type="button"
                      className={`filter-seg-opt filter-unit-chip${on ? ' active' : ''}`}
                      aria-pressed={on}
                      data-unit={u}
                      onClick={() => setPendingFilters(p => ({ ...p, units: UNIT_FILTER_OPTIONS.filter(x => x === u ? !on : p.units.includes(x)) }))}
                    >
                      {u.toUpperCase()}
                    </button>
                  )
                })}
              </div>
            </div>

            {methodChoices.length > 0 && (
              <div className="filter-field">
                <span className="filter-field-label" id="filter-method-label">Method</span>
                <div className="filter-seg" role="group" aria-labelledby="filter-method-label">
                  {methodChoices.map(m => {
                    const on = pendingFilters.method === m
                    return (
                      <button
                        key={m}
                        type="button"
                        className={`filter-seg-opt filter-method-chip${on ? ' active' : ''}`}
                        aria-pressed={on}
                        data-method={m}
                        onClick={() => setPendingFilters(p => ({ ...p, method: on ? null : m }))}
                      >
                        {m}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {softwareChoices.options.length > 0 && (
              <div className="filter-field filter-software">
                <span className="filter-field-label" id="filter-software-label">Software</span>
                <div className="filter-seg" role="group" aria-labelledby="filter-software-label">
                  {softwareChoices.options.map(o => {
                    const on = pendingFilters.software.includes(o.key)
                    return (
                      <button
                        key={o.key}
                        type="button"
                        className={`filter-seg-opt filter-software-chip${on ? ' active' : ''}`}
                        aria-pressed={on}
                        data-software={o.key}
                        onClick={() => setPendingFilters(p => ({ ...p, software: softwareChoices.options.map(x => x.key).filter(k => k === o.key ? !on : p.software.includes(k)) }))}
                      >
                        {o.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            </div>

            <div className="filter-footer">
              {/* "Hide outdated software" comes right after Software in the DOM (and on phones): the first control of row 2,
                  so row 1 keeps the four segmented groups. */}
              <div className="filter-outdated">
                <label className="filter-outdated-check">
                  <input
                    type="checkbox"
                    checked={pendingFilters.hideOutdated}
                    onChange={e => setPendingFilters(p => ({ ...p, hideOutdated: e.target.checked }))}
                  />
                  Hide outdated software
                </label>
                <InfoTooltip text={hideOutdatedText()} width={260} about="Hide outdated software" />
                {pendingFilters.hideOutdated && (
                  <span className="filter-hint" data-testid="filter-outdated-kept" aria-live="polite">{unknownKeptNote(draftUnknownKept)}</span>
                )}
              </div>
              <div className="filter-rel">
                <span className="filter-group-label">Reliability ≥ <strong>{pendingFilters.minReliabilityScore}</strong></span>
                <input
                  type="range" min={0} max={100} step={5}
                  value={pendingFilters.minReliabilityScore}
                  onChange={e => setPendingFilters(p => ({ ...p, minReliabilityScore: parseInt(e.target.value) }))}
                  className="filter-slider"
                  aria-label="Minimum Reliability Score"
                />
              </div>
              <label className="filter-check">
                <input
                  type="checkbox"
                  checked={pendingFilters.hideTestMints}
                  onChange={e => setPendingFilters(p => ({ ...p, hideTestMints: e.target.checked }))}
                />
                Hide test mints
              </label>
              <div className="filter-actions-row">
                <button type="button" className="filter-reset-btn" onClick={resetFilters}>Reset</button>
                <button
                  type="button"
                  className="filter-apply-btn"
                  aria-label={`Show ${draftCount} of ${knownTotal} mints`}
                  onClick={() => { commitFilters({ filters: pendingFilters }); setShowFilters(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                >
                  Show {draftCount} of {knownTotal}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!showFilters && activeFilters.requiredNuts.length > 0 && (
        <div className="active-nut-chips">
          {activeFilters.requiredNuts.map(nut => (
            <span key={nut} className="filter-tag">
              NUT-{nut.padStart(2, '0')}
              <button
                type="button"
                aria-label={`Clear NUT-${nut.padStart(2, '0')} filter`}
                onClick={() => {
                  const f = { ...activeFilters, requiredNuts: activeFilters.requiredNuts.filter(n => n !== nut) }
                  commitFilters({ filters: f })
                  setPendingFilters(f)
                }}
              >
                <IcClose />
              </button>
            </span>
          ))}
        </div>
      )}

      {knownError ? (
        <LoadError message={MINT_LIST_ERROR} onRetry={() => void refetchKnown()} />
      ) : knownLoading ? (
        <div className="mint-grid">
          {Array.from({ length: 9 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <>
          {viewMode === 'list' ? (
            <MintListView
              mints={filteredMints}
              collapseOnlineTo={collapseOnlineTo}
              onShowAll={showAllMints}
              onShowLess={showLess ? showFewerMints : undefined}
              filtersActive={activeFilterCount > 0}
              onClearSearch={clearSearch}
              onResetFilters={resetFilters}
              onAddMint={openSubmit}
              search={search}
              sortBy={sortBy}
              sortDir={sortDir}
              totalAll={knownTotal}
              unitExcluded={unitExcluded}
              unitSelected={activeFilters.units}
              duplicateDisplayNames={duplicateDisplayNames}
            />
          ) : (
            <MintGrid
              mints={filteredMints}
              collapseOnlineTo={collapseOnlineTo}
              onShowAll={showAllMints}
              onShowLess={showLess ? showFewerMints : undefined}
              filtersActive={activeFilterCount > 0}
              onClearSearch={clearSearch}
              onResetFilters={resetFilters}
              onAddMint={openSubmit}
              search={search}
              sortBy={sortBy}
              sortDir={sortDir}
              onCompare={openComparePicker}
              totalAll={knownTotal}
              unitExcluded={unitExcluded}
              unitSelected={activeFilters.units}
              pubkeyGroups={pubkeyGroups}
              duplicateDisplayNames={duplicateDisplayNames}
            />
          )}
          {hiddenCount > 0 && (
            <button
              type="button"
              className="degraded-note"
              onClick={() => setShowDegraded(v => !v)}
              aria-expanded={showDegraded}
            >
              {!showDegraded && <>{hiddenMintsText(hiddenCount, DEGRADED_AFTER_HOURS)}{' '}</>}
              <span className="degraded-note-action">{showDegraded ? 'Hide' : 'Show'}</span>
            </button>
          )}
        </>
      )}

      {/* Compare picker */}
      {showComparePicker && compareBaseUrl && (() => {
        const baseMint = allMints.find(m => m.url === compareBaseUrl)
        const candidates = allMints.filter(m => m.url !== compareBaseUrl && m.online === true)
        return (
          <MintComparePicker
            candidates={candidates}
            baseLabel={baseMint ? mintDisplayName(baseMint, duplicateDisplayNames) : compareBaseUrl}
            duplicateDisplayNames={duplicateDisplayNames}
            onClose={() => setShowComparePicker(false)}
            onConfirm={urls => {
              commitFilters({ compareUrls: [compareBaseUrl, ...urls] })
              setShowComparePicker(false)
            }}
          />
        )
      })()}

      {/* Comparison modal — driven by ?compare= in the URL so a result can be shared via link */}
      {comparedMints.length >= 2 && (
        <Suspense fallback={null}>
          <ComparisonModal mints={comparedMints} onClose={closeComparisonModal} />
        </Suspense>
      )}

      {showSubmit && (
        <div className="submit-modal-overlay" onClick={() => setShowSubmit(false)}>
          <div className="submit-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="submit-modal-title" ref={dialogRef}>
            <button type="button" className="submit-modal-close" onClick={() => setShowSubmit(false)} aria-label="Close"><IcClose /></button>
            <div className="submit-modal-title" id="submit-modal-title">Add a mint</div>
            <div className="submit-tabs" role="tablist" aria-label="Submit mode" onKeyDown={handleSubmitTabKey}>
              <button type="button" role="tab" id="submit-tab-single" aria-selected={submitTab === 'single'} aria-controls="submit-panel-single" tabIndex={submitTab === 'single' ? 0 : -1} className={`submit-tab-btn${submitTab === 'single' ? ' active' : ''}`} onClick={() => setSubmitTab('single')}>Single</button>
              <button type="button" role="tab" id="submit-tab-bulk" aria-selected={submitTab === 'bulk'} aria-controls="submit-panel-bulk" tabIndex={submitTab === 'bulk' ? 0 : -1} className={`submit-tab-btn${submitTab === 'bulk' ? ' active' : ''}`} onClick={() => setSubmitTab('bulk')}>Bulk</button>
            </div>

            {submitTab === 'single' && (
              <div role="tabpanel" id="submit-panel-single" aria-labelledby="submit-tab-single">
                <div className="submit-modal-desc" id="submit-desc">
                  Paste a mint URL. We check it before adding. Only public mints are accepted. First checks run within 5 minutes.
                </div>
                {/* Mirrors SUBMIT_RATE_LIMIT_MAX (20 per hour per IP) in backend/src/index.ts — manually synced like the Bulk limits below. */}
                {submitState !== 'success' && (
                  <>
                    <label htmlFor="submit-input" className="sr-only">Mint URL or npub</label>
                    <input
                      id="submit-input"
                      className="submit-modal-input"
                      type="text"
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="mint.example.com"
                      value={submitInput}
                      onChange={e => handleSubmitInputChange(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !submitDisabled) handleSubmitMint() }}
                      aria-describedby="submit-helper submit-status"
                    />
                    <div className="submit-input-hint" id="submit-helper">https:// is added if missing · 20 per hour.</div>
                    {/* One status region for everything the field produces: the reason for an unusable value, the key
                        lookup and the mint preview. */}
                    <div id="submit-status" className="submit-status-reserve" role="status" aria-live="polite">
                      {submitReason !== null && !submitEmpty && <div className={`submit-reason${inputClass.kind === 'nsec' ? ' warn' : ''}`}>{submitReason}</div>}
                      {lookupLoading && <div className="submit-probe-loading">Looking up mint on Nostr…</div>}
                      {lookupResult?.outcome === 'empty' && <div className="submit-probe-error">No mint announcement found for this key on the relays we checked.</div>}
                      {lookupResult?.outcome === 'unreachable' && <div className="submit-probe-error">Couldn't reach the Nostr relays. Try again.</div>}
                      {lookupResult?.outcome === 'nonhttps' && <div className="submit-probe-error">The announcement points to a non-https address, which can't be listed.</div>}
                      {lookupResult?.outcome === 'found' && (
                        <div className="submit-found">
                          <span>Announced mint:</span>
                          <span className="submit-found-url" title={lookupResult.url}>{lookupResult.url}</span>
                        </div>
                      )}
                      {probeState === 'loading' && <div className="submit-probe-loading">Checking mint…</div>}
                      {probeState === 'success' && probeResult !== null && (
                        <div className="submit-probe-preview">
                          <div className="submit-probe-name">{probeResult.name ?? 'Unknown mint'}</div>
                          <div className="submit-probe-meta">
                            <span>v{probeResult.version ?? '?'}</span>
                            <span>·</span>
                            <span>{probeResult.nutCount} NUTs</span>
                            {probeResult.latencyMs !== null && (<><span>·</span><span style={{ color: latencyColor(probeResult.latencyMs) }}>{probeResult.latencyMs} ms</span></>)}
                          </div>
                        </div>
                      )}
                      {probeState === 'error' && <div className="submit-probe-error">{(probe.url === submitUrl ? (probe.rateLimitMsg ?? probeErrorMessage(probe.errorKind)) : null) ?? 'Mint unreachable or invalid'}</div>}
                    </div>
                    {submitState === 'error' && <div className="submit-result error" role="alert">{submitMsg}</div>}
                    <div className="submit-modal-actions">
                      <button className="submit-cancel-btn" onClick={() => setShowSubmit(false)}>Cancel</button>
                      <button className="submit-ok-btn" onClick={handleSubmitMint} aria-disabled={submitDisabled} aria-describedby={submitEmpty ? 'submit-desc submit-helper' : 'submit-status'}>
                        {submitState === 'loading' ? 'Adding…' : 'Add mint'}
                      </button>
                    </div>
                  </>
                )}
                {submitState === 'success' && (
                  <>
                    <div className="submit-result success" role="status">{submitMsg}</div>
                    {submitAliasOf.length > 0 && (
                      <div className="submit-alias-hint">
                        Same mint pubkey as:{' '}
                        {submitAliasOf.map((a, i) => (
                          <span key={a.url}>
                            {i > 0 && ', '}
                            <Link to={`/mint/${encodeURIComponent(a.url)}`} onClick={() => setShowSubmit(false)}>
                              {a.name ?? getHostname(a.url)}
                            </Link>
                          </span>
                        ))}
                        . Not merged — tracked as its own URL.
                      </div>
                    )}
                    <div className="submit-modal-actions">
                      {/* The Submit button is gone: focus goes to Close, the next sensible stop after the result. */}
                      <button className="submit-ok-btn" autoFocus onClick={() => setShowSubmit(false)}>Close</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {submitTab === 'bulk' && (
              <div role="tabpanel" id="submit-panel-bulk" aria-labelledby="submit-tab-bulk">
                <div className="submit-modal-desc" id="bulk-desc">
                  Paste one mint URL per line.
                </div>
                {/* Static limits note — mirrors the backend's MAX_DISCOVER_BATCH
                    (100) and DISCOVER_BULK_RATE_LIMIT_MAX (10) constants in
                    backend/src/index.ts (no shared workspace between the two
                    packages, so this is a manually-synced number like
                    testMints.ts/auditScore.ts — update both if either changes). */}
                <div className="submit-input-hint" id="bulk-limits">https:// is added if missing · up to 100 mints · 10 per hour.</div>
                {!bulkRunning && !bulkDone && (
                  <>
                    <label htmlFor="bulk-input" className="sr-only">Mint URLs, one per line</label>
                    <textarea
                      id="bulk-input"
                      className="bulk-textarea"
                      placeholder={'mint1.example.com\nmint2.example.com'}
                      value={bulkInput}
                      onChange={e => setBulkInput(e.target.value)}
                      rows={6}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoComplete="off"
                      aria-describedby="bulk-limits bulk-status"
                    />
                    {/* Live summary, refreshed 400 ms after typing stops. */}
                    <div id="bulk-status" className="submit-status-reserve" role="status" aria-live="polite">
                      {bulkSettled.trim() !== '' && (
                        <div className="bulk-summary">
                          {bulkValidCount} valid
                          {bulkParsed.invalid.length > 0 && ` · ${bulkParsed.invalid.length} invalid`}
                          {bulkParsed.duplicates.length > 0 && ` · ${bulkParsed.duplicates.length} ${bulkParsed.duplicates.length === 1 ? 'duplicate' : 'duplicates'}`}
                          {bulkAlreadyTracked !== null && bulkAlreadyTracked > 0 && ` · ${bulkAlreadyTracked} already tracked`}
                        </div>
                      )}
                      {(bulkParsed.invalid.length > 0 || bulkParsed.duplicates.length > 0) && (
                        <ul className="bulk-issues">
                          {bulkParsed.invalid.slice(0, 5).map(i => (
                            <li key={`i${i.line}`}>Line {i.line}: {i.reason}{i.text !== null && <> <span className="bulk-issue-text">{i.text}</span></>}</li>
                          ))}
                          {bulkParsed.invalid.length > 5 && <li>+{bulkParsed.invalid.length - 5} more invalid</li>}
                          {bulkParsed.duplicates.slice(0, 5).map(d => (
                            <li key={`d${d.line}`}>Line {d.line}: duplicate of line {d.of}, sent once.</li>
                          ))}
                          {bulkParsed.duplicates.length > 5 && <li>+{bulkParsed.duplicates.length - 5} more duplicates</li>}
                        </ul>
                      )}
                      {bulkReason !== null && !bulkEmpty && <div className={`submit-reason${bulkOverBy > 0 ? ' warn' : ''}`}>{bulkReason}</div>}
                    </div>
                    {bulkError && <div className="submit-result error" role="alert">{bulkError}</div>}
                    <div className="submit-modal-actions">
                      <button className="submit-cancel-btn" onClick={() => setShowSubmit(false)}>Cancel</button>
                      <button
                        className="submit-ok-btn"
                        onClick={() => { if (!bulkDisabled) void handleBulkSubmit() }}
                        aria-disabled={bulkDisabled}
                        aria-describedby={bulkEmpty ? 'bulk-desc bulk-limits' : 'bulk-status'}
                      >{bulkValidCount === 0 ? 'Add mints' : `Add ${bulkValidCount} ${bulkValidCount === 1 ? 'mint' : 'mints'}`}</button>
                    </div>
                  </>
                )}
                {/* One banner for a 429 instead of repeating "Too many requests"
                    on every row below — the rows themselves fall back to
                    "pending" (see handleBulkSubmit), since nothing in the
                    batch was actually processed. */}
                {bulkRateLimitMsg && (
                  <div className="submit-result error" role="alert">{bulkRateLimitMsg}</div>
                )}
                {(bulkRunning || bulkProgress.length > 0) && (
                  <div className="bulk-progress">
                    {bulkProgress.map((p, i) => (
                      <div key={i} className={`bulk-row status-${p.status}${(p.status === 'added' && (p.aliasOf?.length ?? 0) > 0) || p.status === 'failed' ? ' bulk-row-alias' : ''}`}>
                        <span className="bulk-url" title={p.url}>{p.url}</span>
                        <span className="bulk-status">
                          {p.status === 'pending' && '…'}
                          {p.status === 'probing' && '⟳ probing'}
                          {p.status === 'added' && '✓ Added'}
                          {p.status === 'duplicate' && '• Already tracked'}
                          {p.status === 'failed' && '✗ Failed'}
                        </span>
                        {p.status === 'failed' && <span className="bulk-row-subtitle bulk-row-fail">{p.error ?? 'Error'}</span>}
                        {p.status === 'added' && (p.aliasOf?.length ?? 0) > 0 && (
                          <span className="bulk-row-subtitle">
                            Same pubkey as {p.aliasOf!.map(a => a.name ?? getHostname(a.url)).join(', ')} — not merged
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {bulkDone && (
                  <div style={{ marginTop: 10 }}>
                    {!bulkRateLimitMsg && (
                      <div className={`submit-result ${bulkTone}`} role="status">
                        {bulkAdded} added, {bulkDuplicate} already tracked, {bulkFailed} failed
                      </div>
                    )}
                    {!bulkRateLimitMsg && bulkSkipped > 0 && (
                      <div className="submit-reason">{bulkSkipped} {bulkSkipped === 1 ? 'line was' : 'lines were'} not sent (invalid or duplicate).</div>
                    )}
                    <div className="submit-modal-actions">
                      {/* After the results appear, focus moves to Close: the form (and the Submit button) is gone and Close is the one action left. */}
                      <button className="submit-ok-btn" autoFocus onClick={() => setShowSubmit(false)}>Close</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
