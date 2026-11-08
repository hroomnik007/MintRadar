// The /api/mints/known rows: one computation per KNOWN_MINTS_CACHE_TTL shared by the website, the wallet API, the
// SPA head and the health assertions (split out of index.ts on 2026-11-08).
import { pool } from './db.js'
import { appStateTimeIso } from './appState.js'
import { getLatestVersionsMap } from './versionCatalog.js'
import type { LatestVersions } from './shared/versionRule.js'
import { splitVersionString, canonicalSoftwareName } from './shared/reliabilityScore.js'
import { pendingOf, WALLET_CHANGES_PER_MINT, type PendingSource } from './mintChanges.js'
import { computeDegraded } from './degraded.js'
import { globalMeanRating, weightedRating } from './weightedRating.js'
import { hasRecentReviewSurge } from './reviewSurge.js'
import { isArchivedMint } from './archived.js'
import { healthRecordPublishedAtIso } from './healthAssertions.js'
import { keysetsOf, changesOf, type Snapshot, type WalletExtra, type AuditDirectionsRow, latency24hOf } from './walletApi.js'
import { readStoredBreakdown } from './scoreBreakdown.js'
import { readStoredContactChecks } from './contactChecks.js'
import { createSwrCache, makeRefreshErrorLogger } from './knownMintsCache.js'
import { timedSnapshot } from './snapshotTiming.js'
import { aggregateReviews, operatorKeysOf, type ReviewAggregate } from './reviewsSync.js'
import { knownMintNameFields } from './serverConfig.js'
// ONE computation of the /api/mints/known rows, shared with the wallet API (walletApi.ts): at most one database read
// per KNOWN_MINTS_CACHE_TTL for all of them, concurrent callers join the read in flight.
// Stale-while-revalidate (knownMintsCache.ts): fresh < 60 s, served stale + one background refresh < 5 min, a 45 s timer
// and a start-up warm-up keep it from expiring under a running server.
export const knownMints = createSwrCache<Snapshot>({
  compute: timedSnapshot('known-mints', () => computeKnownMints()),
  onRefreshError: makeRefreshErrorLogger(),
})
export const invalidateKnownMints = (): void => knownMints.invalidate()

// "latest" { major, minor } of a mint's own software family from the latest-versions map (null when the
// software is not recognised or the family has no latest). Sent as `softwareLatest` on /api/mints/known.
export function latestOfFamily(version: string | null, latestVersions: LatestVersions): { major: number; minor: number } | null {
  if (!version) return null
  const family = canonicalSoftwareName(splitVersionString(version).software)
  return family ? latestVersions[family] ?? null : null
}

// The /api/mints/known rows: ONE database read (plus the cached software-version map) per refresh for every caller
// (this route, the wallet API, /api/mints/recommend); callers during a read join it. See knownMintsCache.ts.
export function loadKnownMints(): Promise<Snapshot> {
  return knownMints.get()
}

export function computeKnownMints(): Promise<Snapshot> {
  return Promise.all([
    pool
    .query(`
      SELECT m.url, m.name, m.icon_url, m.version, m.nut_count,
        m.tos_url, m.description_long, m.nuts_limits,
        m.units, m.mint_methods, m.melt_methods, m.pubkey,
        m.audit_n_mints, m.audit_n_melts, m.audit_n_errors, m.audit_checked_at,
        m.audit_synced_at, m.audit_recent_total, m.audit_recent_errors, m.audit_avg_time_ms,
        m.audit_cz_total, m.audit_cz_blamed, m.audit_cz_fetched_at,
        m.discovered_at, m.nostr_announced_at, m.nostr_announce_id, m.nostr_announce_pubkey, m.nostr_announce_d, (SELECT a.value FROM app_state a WHERE a.key = 'discovery_last_success_at') AS nostr_checked_at, (SELECT s.last_created_at FROM attestation_state s WHERE s.mint_url = m.url) AS health_published_at, m.last_reliability_score, m.last_error, m.server_location, m.ip_address, m.net_asn, m.net_org, m.net_country, m.has_onion,
        m.review_count, m.review_avg_rating, m.review_operator_count, m.review_rated_count, m.review_count_7d_ago, m.review_count_7d_ago_at,
        m.contact_nostr, m.contact_checks,
        -- Only while the rollup is missing (review_rated_count IS NULL: before the first recount after a deploy or
        -- a failed one): the stored reviews, so the wallet API can count them at read time instead of showing 0.
        CASE WHEN m.review_rated_count IS NULL THEN
          (SELECT json_agg(json_build_object('pubkey', r.pubkey, 'rating', r.rating, 'comment', r.comment))
             FROM mint_reviews r WHERE r.url = m.url)
        END AS stored_reviews,
        -- The breakdown stored with the score (also in /api/mints/known since 2026-10-25, scoreBreakdown), and for the
        -- wallet API only: the start of the current offline streak (first failed probe after the last successful one)
        -- and the keysets of the latest keysets check.
        m.score_breakdown, m.keysets_checked_at,
        CASE WHEN latest.online = false THEN
          (SELECT MIN(d.checked_at) FROM mint_history d
            WHERE d.url = m.url AND d.online = false AND d.checked_at > COALESCE(m.last_online_at, '-infinity'::timestamptz))
        END AS down_since,
        (SELECT json_agg(json_build_object('id', k.keyset_id, 'unit', k.unit, 'active', k.active, 'fee', k.input_fee_ppk,
                  'expiry', to_char(k.final_expiry AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  'version', k.id_version, 'valid', k.id_valid) ORDER BY k.keyset_id)
           FROM mint_keysets k
          WHERE k.url = m.url AND m.keysets_checked_at IS NOT NULL AND k.last_seen_at >= m.keysets_checked_at - INTERVAL '10 minutes'
        ) AS keysets_json,
        -- Wallet API only: cashu.info's 7-day swaps per direction, read from the stored detail (auditCzDetail.ts); the row of the
        -- mint itself, else the one of an alias cashu.info lists for it (the mapping the detail job writes the score inputs with).
        (SELECT json_build_object('asSource', d.detail #> '{swaps7d,asSource}', 'asDest', d.detail #> '{swaps7d,asDest}', 'fetchedAt', d.fetched_at)
           FROM audit_cz_detail d
          WHERE d.url = rtrim(m.url, '/')
             OR d.url IN (SELECT a.mint_url FROM audit_cz_aliases a WHERE a.alias_url = rtrim(m.url, '/'))
          ORDER BY (d.url = rtrim(m.url, '/')) DESC, d.fetched_at DESC LIMIT 1
        ) AS audit_directions_json,
        -- Wallet API only: the newest confirmed changes of the mint (mintChanges.ts), same read as everything else.
        (SELECT json_agg(json_build_object('type', c.change_type, 'field', c.field, 'old', c.old_value, 'new', c.new_value,
                  'observed', to_char(c.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                  'first', to_char(c.first_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY c.observed_at DESC, c.id DESC)
           FROM (SELECT * FROM mint_changes WHERE url = m.url ORDER BY observed_at DESC, id DESC LIMIT ${WALLET_CHANGES_PER_MINT}) c
        ) AS changes_json,
        -- Wallet API only: the state columns pendingOf (mintChanges.ts) needs, only for a mint with something pending.
        (SELECT json_build_object('info', s.info, 'keysets', s.keysets, 'pendingKeysets', s.pending_keysets,
                  'pendingKeysetsFirstSeenAt', s.pending_keysets_first_seen_at, 'pendingInfo', s.pending_info)
           FROM mint_change_state s
          WHERE s.url = m.url AND (s.pending_keysets IS NOT NULL OR s.pending_info IS NOT NULL)
        ) AS pending_state_json,
        COUNT(h.online) AS total,
        COALESCE(SUM(CASE WHEN h.online THEN 1 ELSE 0 END), 0) AS online_count,
        h7.total_7d,
        h7.online_count_7d,
        -- Wallet API only: 30-day uptime (same rule as the 7-day one) and the latency percentiles of the successful
        -- probes of the last 24 hours (latency24h).
        h7.total_30d,
        h7.online_count_30d,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY h.latency_ms) FILTER (WHERE h.online AND h.latency_ms IS NOT NULL) AS latency_p50_24h,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY h.latency_ms) FILTER (WHERE h.online AND h.latency_ms IS NOT NULL) AS latency_p95_24h,
        COUNT(h.latency_ms) FILTER (WHERE h.online) AS latency_samples_24h,
        latest.online AS latest_online,
        latest.latency_ms AS latest_latency_ms,
        latest.checked_at AS latest_checked_at,
        m.last_online_at
      FROM mints m
      LEFT JOIN mint_history h ON h.url = m.url AND h.checked_at > NOW() - INTERVAL '24 hours'
      LEFT JOIN (
        -- One scan of the last 30 days for both windows (7d feeds uptimePct7d, 30d the wallet API's uptime30dPct).
        SELECT url,
          COUNT(*) FILTER (WHERE checked_at > NOW() - INTERVAL '7 days') AS total_7d,
          COUNT(*) FILTER (WHERE online AND checked_at > NOW() - INTERVAL '7 days') AS online_count_7d,
          COUNT(*) AS total_30d,
          COUNT(*) FILTER (WHERE online) AS online_count_30d
        FROM mint_history
        WHERE checked_at > NOW() - INTERVAL '30 days'
        GROUP BY url
      ) h7 ON h7.url = m.url
      LEFT JOIN LATERAL (
        SELECT online, latency_ms, checked_at FROM mint_history
        WHERE url = m.url ORDER BY checked_at DESC, id DESC LIMIT 1
      ) latest ON true
      GROUP BY m.url, m.name, m.icon_url, m.version, m.nut_count,
        m.tos_url, m.description_long, m.nuts_limits,
        m.units, m.mint_methods, m.melt_methods, m.pubkey,
        m.audit_n_mints, m.audit_n_melts, m.audit_n_errors, m.audit_checked_at,
        m.audit_synced_at, m.audit_recent_total, m.audit_recent_errors, m.audit_avg_time_ms,
        m.audit_cz_total, m.audit_cz_blamed, m.audit_cz_fetched_at,
        m.discovered_at, m.last_reliability_score, m.last_error, m.server_location, m.ip_address, m.net_asn, m.net_org, m.net_country, m.has_onion,
        m.review_count, m.review_avg_rating, m.review_count_7d_ago, m.review_count_7d_ago_at,
        h7.total_7d, h7.online_count_7d, h7.total_30d, h7.online_count_30d,
        latest.online, latest.latency_ms, latest.checked_at
    `),
    // The ONE "latest" per software family (versionCatalog.ts), sent with every mint so the labels and the
    // breakdown on the frontend are measured against exactly what the stored score used.
    getLatestVersionsMap(),
  ])
    .then(([result, latestVersions]) => {
      // C for the IMDB-style weighted Rating sort (see below) — computed from
      // the raw rollup columns before the row map so each mint's WR can be set
      // inline in the literal.
      const globalMean = globalMeanRating(
        result.rows.map(r => ({
          reviewCount: (r.review_count as number | null) ?? null,
          reviewAvgRating: r.review_avg_rating != null ? Number(r.review_avg_rating) : null,
        })),
      )
      const data = result.rows.map(r => {
        const total = Number(r.total)
        const onlineCount = Number(r.online_count)
        const total7d = Number(r.total_7d ?? 0)
        const onlineCount7d = Number(r.online_count_7d ?? 0)
        const latestOnline = r.latest_online as boolean | null
        const latestCheckedAt = r.latest_checked_at as string | null
        return {
          url: r.url as string,
          // Display name (cleaned; hidden-list mints show their hostname): see mintNames.ts.
          // nameFull = the full cleaned name, only when `name` was truncated/emoji-capped.
          ...knownMintNameFields(r.name as string | null, r.url as string),
          iconUrl: (r.icon_url as string | null) ?? null,
          degraded: computeDegraded(total, onlineCount, latestOnline, latestCheckedAt),
          lastOnlineAt: (r.last_online_at as Date | string | null)
            ? new Date(r.last_online_at as Date | string).toISOString()
            : null,
          archived: isArchivedMint(r.last_online_at as Date | string | null, r.latest_online as boolean | null),
          online: r.latest_online as boolean | null,
          latencyMs: r.latest_latency_ms as number | null,
          version: r.version as string | null,
          // Latest { major, minor } of THIS mint's software family (null for unknown software).
          softwareLatest: latestOfFamily(r.version as string | null, latestVersions),
          nutCount: r.nut_count as number | null,
          tosUrl: (r.tos_url as string | null) ?? null,
          descriptionLong: (r.description_long as string | null) ?? null,
          nutsLimits: (r.nuts_limits as Record<string, unknown> | null) ?? null,
          units: (r.units as string[] | null) ?? null,
          mintMethods: (r.mint_methods as Record<string, unknown>[] | null) ?? null,
          meltMethods: (r.melt_methods as Record<string, unknown>[] | null) ?? null,
          // NUT-06 mint identity pubkey — see mintPubkey.ts. Not on every
          // mint yet (populated by the probe cycle); used to suggest alias
          // hints at submit time, never to merge cards.
          pubkey: (r.pubkey as string | null) ?? null,
          auditNMints: (r.audit_n_mints as number | null) ?? null,
          auditNMelts: (r.audit_n_melts as number | null) ?? null,
          auditNErrors: (r.audit_n_errors as number | null) ?? null,
          auditCheckedAt: (r.audit_checked_at as string | null) ?? null,
          auditSyncedAt: (r.audit_synced_at as string | null) ?? null,
          auditRecentTotal: (r.audit_recent_total as number | null) ?? null,
          auditRecentErrors: (r.audit_recent_errors as number | null) ?? null,
          // cashu.info 7-day window feeding the audit part of the Reliability Score (shared/auditScore.ts):
          // swaps whose failure is attributed to the mint, all swaps, and when the stored detail was fetched.
          auditCzBlamed: (r.audit_cz_blamed as number | null) ?? null,
          auditCzTotal: (r.audit_cz_total as number | null) ?? null,
          auditCzFetchedAt: r.audit_cz_fetched_at ? new Date(r.audit_cz_fetched_at as string | Date).toISOString() : null,
          // Mean time_taken (ms) over the OK swaps in the same rolling window
          // as auditRecentTotal/Errors — see mint_audit_swaps / computeSwapStats()
          // in discovery.ts. Null when the window has no OK swap with a known time.
          auditAvgTimeMs: r.audit_avg_time_ms != null ? Number(r.audit_avg_time_ms) : null,
          discoveredAt: (r.discovered_at as string | null) ?? null,
          nostrAnnouncedAt: (r.nostr_announced_at as string | null) ?? null,
          nostrAnnounceId: (r.nostr_announce_id as string | null) ?? null,
          nostrAnnouncePubkey: (r.nostr_announce_pubkey as string | null) ?? null,
          nostrAnnounceD: (r.nostr_announce_d as string | null) ?? null,
          // Additive: time of the last discovery run in which a relay completed the kind:38172 query (app_state
          // discovery_last_success_at); null until the first such run. Same value on every row.
          nostrCheckedAt: appStateTimeIso(r.nostr_checked_at),
          // Additive (Task H1): when the signed health record (kind 30385) of this mint was last published
          // (attestation_state.last_created_at, read in this same query); null without a current record (archived, no stored
          // score, URL not allowed in an event) or while nothing was published. Website only: the wallet API does not read it.
          healthRecordPublishedAt: healthRecordPublishedAtIso(r.health_published_at, {
            url: r.url as string,
            archived: isArchivedMint(r.last_online_at as Date | string | null, r.latest_online as boolean | null),
            score: r.last_reliability_score,
          }),
          reliabilityScore: (r.last_reliability_score as number | null) ?? null,
          // Additive: the per-component points stored with reliabilityScore (mints.score_breakdown, written in the same
          // UPDATE by prober.ts), so Mint Detail's score modal shows the points the stored score used, not a live
          // recomputation. null until the first probe cycle that stored it.
          scoreBreakdown: readStoredBreakdown(r.score_breakdown),
          lastError: (r.last_error as string | null) ?? null,
          uptimePct24h: total === 0 ? null : Math.round(onlineCount / total * 100),
          // Same computation as uptimePct24h, over a 7-day window — feeds the
          // Stats "Most Reliable" panel (see docs/claude/discovery-and-relays.md), which switched to a
          // 7d default because most of the network sits at 100% on a 24h
          // window and can't be meaningfully ranked. uptimePct24h itself is
          // unchanged and still used everywhere else (mint cards, avg-uptime
          // hero tile, degraded detection).
          uptimePct7d: total7d === 0 ? null : Math.round(onlineCount7d / total7d * 100),
          serverLocation: (r.server_location as string | null) ?? null,
          ipAddress: (r.ip_address as string | null) ?? null,
          netAsn: (r.net_asn as number | null) ?? null,
          netOrg: (r.net_org as string | null) ?? null,
          netCountry: (r.net_country as string | null) ?? null,
          hasOnion: (r.has_onion as boolean | null) ?? null,
          lastCheckedAt: (r.latest_checked_at as string | null) ?? null,
          // Additive, only for a mint that is not online (Mint Detail's "unavailable" block): the start of the
          // current offline streak and the keysets of the last successful keysets check. Online mints get null/[].
          ...(r.latest_online === true
            ? { offlineSince: null, lastKeysets: [], lastKeysetsCheckedAt: null }
            : {
                offlineSince: r.down_since ? new Date(r.down_since as string | Date).toISOString() : null,
                lastKeysets: keysetsOf(r.keysets_json),
                lastKeysetsCheckedAt: r.keysets_checked_at ? new Date(r.keysets_checked_at as string | Date).toISOString() : null,
              }),
          reviewCount: (r.review_count as number | null) ?? null,
          reviewAvgRating: r.review_avg_rating != null ? Number(r.review_avg_rating) : null,
          // Additive: stored reviews written by the mint's own operator. They are NOT in
          // reviewCount / reviewAvgRating / reviewWeightedRating / reviewSurge (see reviewsSync.ts).
          operatorReviewCount: (r.review_operator_count as number | null) ?? 0,
          // Additive: how many of reviewCount carry a rating (the n behind reviewAvgRating); null until the
          // startup recount / next review sync. The frontend Rating sort uses it (src/utils/bayesianRating.ts).
          reviewRatedCount: (r.review_rated_count as number | null) ?? null,
          // Forgery-resistant sybil signal: the mint's review_count jumped
          // sharply vs. the daily rollup's ~1-week-ago snapshot. Informational
          // only — never feeds Reliability Score or reviewWeightedRating.
          reviewSurge: hasRecentReviewSurge({
            reviewCount: (r.review_count as number | null) ?? null,
            reviewCount7dAgo: (r.review_count_7d_ago as number | null) ?? null,
            reviewCount7dAgoAt: (r.review_count_7d_ago_at as string | null) ?? null,
          }),
          // IMDB-style weighted rating — used ONLY to order the Rating sort,
          // never displayed (the card badge keeps showing reviewAvgRating /
          // reviewCount). Kept out of reviewsSync's per-mint rollup because C is
          // a global mean over all mints; this endpoint already loads them all.
          reviewWeightedRating: weightedRating(
            (r.review_count as number | null) ?? null,
            r.review_avg_rating != null ? Number(r.review_avg_rating) : null,
            globalMean,
          ),
        }
      })
      // Read-time fallback for the wallet API (never part of /api/mints/known): the review aggregate of the stored
      // reviews of every mint whose review_rated_count is still NULL, by the same rule as the rollup.
      const reviewFallback = new Map<string, ReviewAggregate>()
      for (const r of result.rows as Array<{ url: string; review_rated_count: number | null; stored_reviews?: unknown; contact_nostr?: unknown; nostr_announce_pubkey?: unknown }>) {
        if (r.review_rated_count != null || !Array.isArray(r.stored_reviews) || r.stored_reviews.length === 0) continue
        reviewFallback.set(r.url, aggregateReviews(r.stored_reviews as Array<{ pubkey: string; rating: number | null; comment: string | null }>, operatorKeysOf(r)))
      }
      // Wallet API extras (probes in the last 24 h, offline-streak start, stored score breakdown, keysets), by URL.
      const walletExtra = new Map<string, WalletExtra>()
      for (const r of result.rows as Array<Record<string, unknown>>) {
        walletExtra.set(r.url as string, {
          probes24h: Number(r.total ?? 0),
          downSince: r.down_since ? new Date(r.down_since as string | Date).toISOString() : null,
          scoreBreakdown: readStoredBreakdown(r.score_breakdown),
          uptime30dPct: Number(r.total_30d ?? 0) === 0 ? null : Math.round(Number(r.online_count_30d ?? 0) / Number(r.total_30d) * 100),
          latency24h: latency24hOf(r.latency_p50_24h, r.latency_p95_24h, r.latency_samples_24h),
          keysets: keysetsOf(r.keysets_json),
          keysetsCheckedAt: r.keysets_checked_at ? new Date(r.keysets_checked_at as string | Date).toISOString() : null,
          changes: changesOf(r.changes_json),
          changesPending: pendingOf(r.pending_state_json as PendingSource | null) ?? null,
          contactChecks: readStoredContactChecks(r.contact_checks) ?? [],
          auditDirections: (r.audit_directions_json as AuditDirectionsRow | null) ?? null,
        })
      }
      const now = Date.now()
      return { data, computedAt: now, reviewFallback, walletExtra }
    })
}
