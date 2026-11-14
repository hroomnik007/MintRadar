import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { StoredScoreBreakdown } from '@/utils/mintDetailFacts'

export interface KnownMint {
  url: string
  // Display name from the backend (cleaned; null = show the hostname, e.g. a mint on the hidden-names list).
  name: string | null
  // Full cleaned name, only present when `name` was truncated or emoji-capped (title tooltip).
  nameFull?: string
  iconUrl: string | null
  degraded: boolean
  archived?: boolean
  lastOnlineAt?: string | null
  online: boolean | null
  latencyMs: number | null
  version: string | null
  // The ONE "latest" { major, minor } of this mint's own software family (the same value the stored Reliability
  // Score was computed against; null for unknown software). All version labels and the breakdown use it.
  softwareLatest?: { major: number; minor: number } | null
  nutCount: number | null
  tosUrl: string | null
  descriptionLong: string | null
  nutsLimits: Record<string, unknown> | null
  units?: string[] | null
  mintMethods?: { method: string; unit: string; [key: string]: unknown }[] | null
  meltMethods?: { method: string; unit: string; [key: string]: unknown }[] | null
  // NUT-06 mint identity pubkey (33-byte compressed secp256k1 hex), written
  // from the live probe (backend/src/mintPubkey.ts). Not on every mint yet.
  // Used for submit-time alias hints and the card "Same operator" badge
  // (see groupMintsByPubkey() in mintFormatting.ts) — never to merge cards.
  pubkey?: string | null
  // The audit.8333.space fields of /api/mints/known (auditNMints, auditRecentTotal, …) are still served but no longer
  // read here: the page stopped showing that service (no answer since 2026-09-27).
  // cashu.info 7-day window that feeds the audit part of the Reliability Score (backend shared/auditScore.ts):
  // swaps whose failure is attributed to this mint, all swaps, and the stored detail's fetch time (ISO).
  auditCzBlamed?: number | null
  auditCzTotal?: number | null
  auditCzFetchedAt?: string | null
  // The long audit window (methodology 8): sums of 7-day totals that do not overlap and the days they cover.
  auditCzLongBlamed?: number | null
  auditCzLongTotal?: number | null
  auditCzLongDays?: number | null
  discoveredAt?: string | null
  nostrAnnouncedAt?: string | null
  nostrAnnounceId?: string | null
  // Author pubkey + `d` tag of the same kind:38172 announcement — lets the
  // frontend build a NIP-19 naddr deep link to it (see mintAnnounceNaddr()
  // in nostrLinks.ts). Null until the discovery cron re-processes the mint's
  // still-live announcement (nostrAnnounceId alone isn't enough for naddr).
  nostrAnnouncePubkey?: string | null
  nostrAnnounceD?: string | null
  // Time of the last discovery run that reached the relays (app_state discovery_last_success_at); null until the first one.
  nostrCheckedAt?: string | null
  reliabilityScore?: number | null
  /** When the signed health record (Nostr kind 30385) of this mint was last published (attestation_state.last_created_at, ISO 8601 UTC); null without a current record or before anything was published. Website only. */
  healthRecordPublishedAt?: string | null
  /** What the stored score used at its last computation (backend scoreBreakdown.ts); null until the first probe that wrote it. */
  scoreBreakdown?: StoredScoreBreakdown | null
  lastError?: string | null
  uptimePct24h?: number | null
  /** Same computation as uptimePct24h, over a 7-day window. Feeds the Stats
   *  "Most Reliable" panel only — uptimePct24h remains the field used
   *  everywhere else (mint cards, avg-uptime hero tile, degraded detection). */
  uptimePct7d?: number | null
  /** 30-day uptime in whole percent, the figure the score's 30-day part and the recommendation gate use; null without history. */
  uptimePct30d?: number | null
  /** The same share unrounded (two decimals, rounded down): what the recommendation gate (hasSteadyUptime) compares. */
  uptimePct30dExact?: number | null
  serverLocation?: string | null
  /** Public IPv4 of the mint host, resolved by our backend. */
  ipAddress?: string | null
  /** Network card facts from our own ipinfo.io lookup: AS number, organisation, ISO country of the IP block. */
  netAsn?: number | null
  netOrg?: string | null
  netCountry?: string | null
  /** True when the mint's own /v1/info `urls` lists a .onion address; null until probed. */
  hasOnion?: boolean | null
  lastCheckedAt?: string | null
  /** Only for a mint that is not online (null/[] otherwise): start of the current offline streak, and the keysets of
   *  the last successful keysets check with its time (Mint Detail's "unavailable" block). */
  offlineSince?: string | null
  lastKeysets?: { id: string; unit: string; active: boolean; inputFeePpk: number | null; finalExpiry?: string | null }[]
  lastKeysetsCheckedAt?: string | null
  // NIP-87 review rollup, refreshed by the backend's 6h reviews sync
  // (backend/src/reviewsSync.ts). Null until that sync has run for the mint.
  reviewCount?: number | null
  reviewAvgRating?: number | null
  // Stored reviews written by the mint's own operator (a key listed in its nostr contact that also
  // authored its announcement). They are NOT in reviewCount / reviewAvgRating (backend reviewsSync.ts).
  operatorReviewCount?: number
  // Forgery-resistant sybil signal: the backend saw this mint's review_count
  // jump sharply vs. its own ~1-week-ago snapshot (backend/src/reviewSurge.ts).
  // Informational only — never affects Reliability Score or the Rating sort; the UI
  // shows a quiet ⚠ next to the Community Rating.
  reviewSurge?: boolean
  // IMDB-style weighted rating computed by the backend (backend/src/weightedRating.ts). No longer used by the
  // frontend (the Rating sort uses bayesianRating over reviewAvgRating + reviewRatedCount since 2026-10-09);
  // kept in the API. Never shown in the UI (the Community Rating badge uses reviewAvgRating/reviewCount).
  reviewWeightedRating?: number | null
  // How many of reviewCount carry a rating (the n behind reviewAvgRating); null until the backend recount.
  // Feeds the Rating sort only (src/utils/bayesianRating.ts), never displayed.
  reviewRatedCount?: number | null
}

// The server answers with Cache-Control: public, max-age=300, so a plain refetch is served from the browser's HTTP
// cache for five minutes and the "Refresh mint list" button looked dead. A refresh the user asks for sets this flag:
// the next request revalidates (If-None-Match; an unchanged list is a cheap 304) instead of reusing the cached copy.
let revalidateNext = false

/** Refetches the list for the "Refresh mint list" button, bypassing the browser's five-minute cache. */
export async function refreshKnownMints(queryClient: QueryClient): Promise<void> {
  revalidateNext = true
  try {
    await queryClient.invalidateQueries({ queryKey: KNOWN_MINTS_QUERY_KEY })
  } finally {
    revalidateNext = false
  }
}

async function fetchKnownMints(): Promise<KnownMint[]> {
  // The plain call stays exactly `fetch('/api/mints/known')`: the early preload (public/early-preload.js) must match it to be reused.
  const res = revalidateNext ? await fetch('/api/mints/known', { cache: 'no-cache' }) : await fetch('/api/mints/known')
  if (!res.ok) throw new Error('Failed to fetch known mints')
  const data = await res.json() as KnownMint[]
  return data
}

// Also read by the Stats idle warm-up (src/core/mint/prefetch.ts), which waits for this query to settle.
export const KNOWN_MINTS_QUERY_KEY = ['mints-known'] as const

export function useKnownMints() {
  return useQuery({
    queryKey: KNOWN_MINTS_QUERY_KEY,
    queryFn: fetchKnownMints,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 2,
  })
}
