import { Pool } from 'pg'

const POOL_ERROR_LOG_INTERVAL_MS = 10_000

/**
 * The pg Pool emits 'error' when an IDLE client loses its connection (Postgres restart, container recreation, network
 * drop). Without a listener Node turns that into an uncaughtException, one per idle client. pg removes the failed client
 * from the pool by itself and connects anew on the next query, so the listener only logs: ONE line (message and code,
 * anything that looks like a URL redacted, never SQL or parameters), at most one per interval, followed by one line with
 * the number of repeats it swallowed. Every long-lived pg Pool/Client needs such a listener.
 */
export function attachPoolErrorHandler(
  emitter: { on(event: 'error', listener: (err: unknown) => void): unknown },
  intervalMs: number = POOL_ERROR_LOG_INTERVAL_MS,
): void {
  let windowOpen = false
  let suppressed = 0
  emitter.on('error', (err: unknown) => {
    if (windowOpen) { suppressed++; return }
    windowOpen = true
    console.error(`[db] pool error: ${describePoolError(err)}`)
    setTimeout(() => {
      if (suppressed > 0) console.error(`[db] pool error: ${suppressed} more in the last ${Math.round(intervalMs / 1000)}s (suppressed)`)
      suppressed = 0
      windowOpen = false
    }, intervalMs).unref()
  })
}

export function describePoolError(err: unknown): string {
  const e = (err ?? {}) as { message?: unknown; code?: unknown }
  const message = typeof e.message === 'string' ? e.message : 'unknown error'
  const code = typeof e.code === 'string' ? e.code : 'none'
  const clean = message.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted-url]').replace(/\s+/g, ' ').slice(0, 200)
  return `${clean} (code ${code.slice(0, 40)})`
}

// Startup option sent with every connection of the pool. JIT is off because the planner's cost estimate for the large
// /api/mints/known query (a GROUP BY over about 40 columns) is far above jit_above_cost: compiling 123 functions took
// 3.3 to 3.9 s of a 3.9 s execution, against 0.49 s without JIT (task E2, 2026-10-22).
const JIT_OFF_OPTION = '-c jit=off'

// An explicit `options` in the pool config replaces both the `options` query parameter of the connection string and
// PGOPTIONS, so those are carried over here instead of being overwritten.
export function poolOptions(connectionString: string | undefined, pgOptions: string | undefined): string {
  let existing = pgOptions
  if (connectionString) {
    try {
      existing = new URL(connectionString).searchParams.get('options') ?? existing
    } catch { /* an unparsable string is left to pg */ }
  }
  const trimmed = existing?.trim()
  return trimmed ? `${trimmed} ${JIT_OFF_OPTION}` : JIT_OFF_OPTION
}

export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  options: poolOptions(process.env['DATABASE_URL'], process.env['PGOPTIONS']),
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})
attachPoolErrorHandler(pool)

export const AUDIT_CZ_BACKFILL_SQL = `UPDATE mints m
     SET audit_cz_total = (d.detail #>> '{swaps7d,all,total}')::integer,
         audit_cz_blamed = (d.detail #>> '{swaps7d,errorsBlamed}')::integer,
         audit_cz_fetched_at = d.fetched_at
    FROM audit_cz_detail d
   WHERE (rtrim(m.url, '/') = d.url
          OR rtrim(m.url, '/') IN (SELECT a.alias_url FROM audit_cz_aliases a WHERE a.mint_url = d.url))
     AND (d.detail #>> '{swaps7d,all,total}') ~ '^[0-9]{1,8}$'
     AND (d.detail #>> '{swaps7d,errorsBlamed}') ~ '^[0-9]{1,8}$'
     AND (m.audit_cz_total IS DISTINCT FROM (d.detail #>> '{swaps7d,all,total}')::integer
          OR m.audit_cz_blamed IS DISTINCT FROM (d.detail #>> '{swaps7d,errorsBlamed}')::integer
          OR m.audit_cz_fetched_at IS DISTINCT FROM d.fetched_at)`

export async function initDb(): Promise<void> {
  // Core tables — single batch (ordered by dependency)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mints (
      url TEXT PRIMARY KEY,
      name TEXT,
      discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_known BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS mint_history (
      id BIGSERIAL PRIMARY KEY,
      url TEXT NOT NULL REFERENCES mints(url) ON DELETE CASCADE,
      online BOOLEAN NOT NULL,
      latency_ms INTEGER,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_mint_history_url_checked
      ON mint_history(url, checked_at DESC);

    CREATE TABLE IF NOT EXISTS mint_version_history (
      id BIGSERIAL PRIMARY KEY,
      url TEXT NOT NULL REFERENCES mints(url) ON DELETE CASCADE,
      version TEXT NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_mint_version_history_url_version
      ON mint_version_history(url, version);

    CREATE INDEX IF NOT EXISTS idx_mint_version_history_url_date
      ON mint_version_history(url, first_seen_at DESC);

    CREATE TABLE IF NOT EXISTS software_versions (
      software TEXT PRIMARY KEY,
      latest_version TEXT,
      fetched_at TIMESTAMPTZ,
      source_url TEXT
    );

    CREATE TABLE IF NOT EXISTS notification_subscriptions (
      pubkey TEXT NOT NULL,
      mint_url TEXT NOT NULL REFERENCES mints(url) ON DELETE CASCADE,
      notify_on_down BOOLEAN NOT NULL DEFAULT true,
      notify_on_up BOOLEAN NOT NULL DEFAULT true,
      notify_on_mint_melt_issues BOOLEAN NOT NULL DEFAULT false,
      notify_on_version_outdated BOOLEAN NOT NULL DEFAULT false,
      notify_on_nut_loss BOOLEAN NOT NULL DEFAULT false,
      relays TEXT[] NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (pubkey, mint_url)
    );

    CREATE INDEX IF NOT EXISTS idx_notification_subs_updated_at
      ON notification_subscriptions(updated_at);

    -- Existing databases: CREATE TABLE IF NOT EXISTS does not add the new flag columns.
    ALTER TABLE notification_subscriptions ADD COLUMN IF NOT EXISTS notify_on_mint_melt_issues BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE notification_subscriptions ADD COLUMN IF NOT EXISTS notify_on_version_outdated BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE notification_subscriptions ADD COLUMN IF NOT EXISTS notify_on_nut_loss BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS mint_reviews (
      url TEXT NOT NULL REFERENCES mints(url) ON DELETE CASCADE,
      pubkey TEXT NOT NULL,
      event_id TEXT NOT NULL,
      rating INTEGER,
      comment TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      PRIMARY KEY (url, pubkey)
    );

    CREATE INDEX IF NOT EXISTS idx_mint_reviews_url_created
      ON mint_reviews(url, created_at DESC);

    -- Per-relay progress of the hourly reviews sync (reviewsSync.ts). Unix seconds.
    -- last_ok_started_at = when the last run that finished cleanly on that relay STARTED
    -- (the next incremental query asks for events since that minus a safety overlap);
    -- last_full_at = start of the last clean run that had no "since" (the daily full sweep).
    CREATE TABLE IF NOT EXISTS reviews_sync_relay_state (
      relay TEXT PRIMARY KEY,
      last_ok_started_at BIGINT NOT NULL,
      last_full_at BIGINT
    );

    -- Per-relay delivery counters of the same sync (reviewsRelayStats.ts): counts only, no ids/keys/text/URLs.
    -- Additive. last_ok_started_at may be NULL = the relay has a counters row but never finished a clean run
    -- (loadRelayState ignores such rows). counters_since = when this relay's counters started.
    ALTER TABLE reviews_sync_relay_state ALTER COLUMN last_ok_started_at DROP NOT NULL;
    ALTER TABLE reviews_sync_relay_state ADD COLUMN IF NOT EXISTS runs INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE reviews_sync_relay_state ADD COLUMN IF NOT EXISTS ok_runs INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE reviews_sync_relay_state ADD COLUMN IF NOT EXISTS failed_runs INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE reviews_sync_relay_state ADD COLUMN IF NOT EXISTS skipped_runs INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE reviews_sync_relay_state ADD COLUMN IF NOT EXISTS events_delivered BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE reviews_sync_relay_state ADD COLUMN IF NOT EXISTS events_exclusive BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE reviews_sync_relay_state ADD COLUMN IF NOT EXISTS events_new BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE reviews_sync_relay_state ADD COLUMN IF NOT EXISTS total_ms BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE reviews_sync_relay_state ADD COLUMN IF NOT EXISTS last_run_exclusive INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE reviews_sync_relay_state ADD COLUMN IF NOT EXISTS counters_since TIMESTAMPTZ NOT NULL DEFAULT now();

    -- Public profile (kind:0) of review authors and mint contact/announcement keys, fetched by the
    -- hourly reviews sync from the profile indexer relays (profilesSync.ts). Only name, display_name
    -- and nip05 are stored (cleaned text, unverified). found = false: asked, nobody had it (asked
    -- again after 24 h). Unix seconds.
    CREATE TABLE IF NOT EXISTS nostr_profiles (
      pubkey TEXT PRIMARY KEY,
      name TEXT,
      display_name TEXT,
      nip05 TEXT,
      event_created_at BIGINT,
      fetched_at BIGINT NOT NULL,
      found BOOLEAN NOT NULL
    );

    -- Per-swap rows for the audit.8333.space rolling window (see discovery.ts's
    -- fetchRecentSwaps/persistMintAuditSwaps). Fully replaced (DELETE + INSERT,
    -- same atomic-per-mint-replace pattern as mint_reviews) every 6h discovery
    -- cycle, so this table only ever holds each mint's current ~100-swap window,
    -- not history across cycles. swap_id is audit.8333.space's own per-swap id.
    CREATE TABLE IF NOT EXISTS mint_audit_swaps (
      url TEXT NOT NULL REFERENCES mints(url) ON DELETE CASCADE,
      swap_id BIGINT NOT NULL,
      to_url TEXT,
      amount INTEGER,
      fee INTEGER,
      created_at TIMESTAMPTZ,
      time_taken_ms DOUBLE PRECISION,
      state TEXT NOT NULL,
      error TEXT,
      PRIMARY KEY (url, swap_id)
    );

    CREATE INDEX IF NOT EXISTS idx_mint_audit_swaps_url_created
      ON mint_audit_swaps(url, created_at DESC);

    -- cashu.info, formerly audit.cashu.cz (second, public audit source; see auditCz.ts). Display-only:
    -- never read by scoring code. No FK to mints — keyed by their normalised URL,
    -- matched to our mints at read time (url or alias).
    CREATE TABLE IF NOT EXISTS audit_cz_mints (
      url TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      uptime24h DOUBLE PRECISION,
      uptime7d DOUBLE PRECISION,
      uptime30d DOUBLE PRECISION,
      attributed_failures INTEGER,
      minted INTEGER,
      melted INTEGER,
      last_check TIMESTAMPTZ,
      page TEXT,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL DEFAULT 'audit.cashu.cz'
    );
    ALTER TABLE audit_cz_mints ADD COLUMN IF NOT EXISTS minted INTEGER;
    ALTER TABLE audit_cz_mints ADD COLUMN IF NOT EXISTS melted INTEGER;

    CREATE TABLE IF NOT EXISTS audit_cz_aliases (
      alias_url TEXT PRIMARY KEY,
      mint_url TEXT NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_audit_cz_aliases_mint ON audit_cz_aliases(mint_url);

    CREATE TABLE IF NOT EXISTS audit_cz_swaps (
      id TEXT PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL,
      stage TEXT,
      error TEXT,
      amount DOUBLE PRECISION,
      fee DOUBLE PRECISION,
      duration_ms DOUBLE PRECISION,
      from_url TEXT,
      to_url TEXT,
      from_name TEXT,
      to_name TEXT,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL DEFAULT 'audit.cashu.cz'
    );

    CREATE INDEX IF NOT EXISTS idx_audit_cz_swaps_from ON audit_cz_swaps(from_url, at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_cz_swaps_to ON audit_cz_swaps(to_url, at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_cz_swaps_at ON audit_cz_swaps(at DESC);

    -- Validated subset of the per-mint detail (auditCzDetail.ts), filled by the 30-minute cron.
    -- Keyed like audit_cz_mints. Never holds an IP address, the onion address, score or reviews.
    CREATE TABLE IF NOT EXISTS audit_cz_detail (
      url TEXT PRIMARY KEY,
      detail JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  // Column migrations — each in its own query so a failure in one doesn't block others
  const migrations = [
    // Small key/value store for one-time application state (first user: 'known_mints_seeded', see
    // cron.ts seedKnownMints). Additive and idempotent.
    `CREATE TABLE IF NOT EXISTS app_state (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    // Reliability Score rename (was "Trust Score") — atomic, metadata-only column
    // and index renames, guarded so they're a no-op once already applied (fresh
    // installs never have the old names, so these guards also make the migration
    // safe to run against a brand-new database).
    `DO $$
     BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mints' AND column_name = 'last_trust_score')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mints' AND column_name = 'last_reliability_score') THEN
         ALTER TABLE mints RENAME COLUMN last_trust_score TO last_reliability_score;
       END IF;
     END $$`,
    `DO $$
     BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mints' AND column_name = 'trust_score_7d_ago')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mints' AND column_name = 'reliability_score_7d_ago') THEN
         ALTER TABLE mints RENAME COLUMN trust_score_7d_ago TO reliability_score_7d_ago;
       END IF;
     END $$`,
    `DO $$
     BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mints' AND column_name = 'trust_score_30d_ago')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mints' AND column_name = 'reliability_score_30d_ago') THEN
         ALTER TABLE mints RENAME COLUMN trust_score_30d_ago TO reliability_score_30d_ago;
       END IF;
     END $$`,
    `DO $$
     BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mints' AND column_name = 'trust_movers_checked_at')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mints' AND column_name = 'reliability_movers_checked_at') THEN
         ALTER TABLE mints RENAME COLUMN trust_movers_checked_at TO reliability_movers_checked_at;
       END IF;
     END $$`,
    `DO $$
     BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mint_history' AND column_name = 'trust_score')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mint_history' AND column_name = 'reliability_score') THEN
         ALTER TABLE mint_history RENAME COLUMN trust_score TO reliability_score;
       END IF;
     END $$`,
    `DO $$
     BEGIN
       IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_mints_trust_score')
          AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_mints_reliability_score') THEN
         ALTER INDEX idx_mints_trust_score RENAME TO idx_mints_reliability_score;
       END IF;
     END $$`,
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS icon_url TEXT',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS version TEXT',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS nut_count INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS tos_url TEXT',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS description_long TEXT',
    // Column of the removed text-based notice detector; it only ever held derived data.
    'ALTER TABLE mints DROP COLUMN IF EXISTS demo_notice',
    // The mint's own NUT-06 contact entries with method "nostr" (raw strings, capped), rewritten on
    // every successful probe. Only used to work out which review authors are the mint's operator
    // (shared/operatorPubkeys.ts); never displayed or returned by any endpoint.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS contact_nostr JSONB',
    // How many stored reviews (same counting rule as review_count) were written by the operator and
    // therefore are NOT in review_count / review_avg_rating. Set together with them (reviewsSync.ts).
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS review_operator_count INTEGER',
    // How many of the counted reviews (review_count) carry a rating: the n behind review_avg_rating. Only the
    // frontend Rating sort reads it (confidence-adjusted average). Set with the other aggregates (reviewsSync.ts);
    // NULL until the startup recount / next review sync has run for the mint.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS review_rated_count INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS nuts_limits JSONB',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_n_mints INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_n_melts INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_n_errors INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_checked_at TIMESTAMPTZ',
    // audit_checked_at mirrors audit.8333.space's own `updated_at`; audit_synced_at
    // is when OUR 6h discovery cron last wrote these columns, so the Mint Detail
    // "Last checked X ago" strip can be truthful about our refresh cadence.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_synced_at TIMESTAMPTZ',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_id INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_recent_total INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_recent_errors INTEGER',
    // Mean time_taken (ms) across the OK swaps in the same rolling window as
    // audit_recent_total/errors — see mint_audit_swaps + computeSwapStats() in
    // discovery.ts. Null when the window has zero OK swaps with a known time.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_avg_time_ms DOUBLE PRECISION',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS last_reliability_score INTEGER',
    'CREATE INDEX IF NOT EXISTS idx_mints_reliability_score ON mints(last_reliability_score DESC NULLS LAST)',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS last_error TEXT',
    // Recurring-revalidation markers (prober.ts revalidateMints()): `invalid_since`
    // is set the first time a mint is found REACHABLE-but-not-a-Cashu-mint (a URL
    // repointed via DNS/redirect after it first passed the submit/discovery gate)
    // and cleared whenever it validates again; a mint whose `invalid_since` is
    // older than REVALIDATION_REAP_DAYS is deleted so the 5-min probe stops
    // hammering an attacker-chosen host forever. `revalidated_at` is the last time
    // the daily strong (/v1/info + /v1/keys) check ran for this mint.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS invalid_since TIMESTAMPTZ',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS revalidated_at TIMESTAMPTZ',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS server_location TEXT',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS ip_address TEXT',
    // Network card facts from our own ipinfo.io lookup (same request as server_location) and /v1/info `urls`.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS net_asn INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS net_org TEXT',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS net_country TEXT',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS has_onion BOOLEAN',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS units JSONB',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS mint_methods JSONB',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS melt_methods JSONB',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS last_online_at TIMESTAMPTZ',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS contact_count INTEGER',
    'ALTER TABLE mint_history ADD COLUMN IF NOT EXISTS reliability_score INTEGER',
    // Reliability Score Movers rollup — mints.last_reliability_score already holds the "latest"
    // snapshot (written by every probe); these two hold the point-in-time score
    // 7d / 30d ago, refreshed by refreshReliabilityMoversRollup() on the probe cron so
    // GET /api/stats/reliability-movers is a plain read of `mints` instead of two
    // DISTINCT ON passes over all of mint_history. Same pattern as review_count.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS reliability_score_7d_ago INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS reliability_score_30d_ago INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS reliability_movers_checked_at TIMESTAMPTZ',
    // Partial index covering the `reliability_score IS NOT NULL` filter that the rollup's
    // per-mint "score at-or-before cutoff" lookups use — without it those lookups
    // fall back to scanning idx_mint_history_url_checked + heap-fetching every row.
    `CREATE INDEX IF NOT EXISTS idx_mint_history_score_checked
       ON mint_history(url, checked_at DESC) WHERE reliability_score IS NOT NULL`,
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS review_count INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS review_avg_rating REAL',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS reviews_checked_at TIMESTAMPTZ',
    // Rolling ~1-week-ago review_count snapshot — feeds the "recent review surge"
    // sybil flag (reviewSurge.ts / reviewSurgeRollup.ts). Advanced once a day.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS review_count_7d_ago INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS review_count_7d_ago_at TIMESTAMPTZ',
    // Unused since 2026-09-27. A drop-floor wrote these while still deleting
    // mint_reviews rows a thin cycle didn't see, which confirmed the loss.
    // Sync now upserts and never shrinks the stored set, so nothing reads them.
    // Left in place; do not drop the columns just to tidy this.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS review_count_pending_low INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS review_count_pending_low_streak INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE notification_subscriptions ADD COLUMN IF NOT EXISTS last_notified_down_at TIMESTAMPTZ',
    'ALTER TABLE notification_subscriptions ADD COLUMN IF NOT EXISTS last_notified_up_at TIMESTAMPTZ',
    // "More alerts" claim slots (nostrService.ts notifyAlert): the time of the subscriber's last claim
    // (NULL = never notified). Never reset by a cleared condition any more; the cooldown and the re-arm
    // (alert_rearmed_*_at, below) decide when the next DM may go out.
    'ALTER TABLE notification_subscriptions ADD COLUMN IF NOT EXISTS last_notified_mint_melt_at TIMESTAMPTZ',
    'ALTER TABLE notification_subscriptions ADD COLUMN IF NOT EXISTS last_notified_version_outdated_at TIMESTAMPTZ',
    'ALTER TABLE notification_subscriptions ADD COLUMN IF NOT EXISTS last_notified_nut_loss_at TIMESTAMPTZ',
    // Hysteresis of the "More alerts" (notificationLimits.ts CLEAR_PROBES_TO_REARM): consecutive probes on
    // which the condition was clear (reset to 0 while it is active) and the moment the streak last reached
    // the threshold. A subscriber is claimable again only when its last claim is older than this moment.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS alert_clear_streak_mint_melt INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS alert_clear_streak_version_outdated INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS alert_clear_streak_nut_loss INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS alert_rearmed_mint_melt_at TIMESTAMPTZ',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS alert_rearmed_version_outdated_at TIMESTAMPTZ',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS alert_rearmed_nut_loss_at TIMESTAMPTZ',
    // Per-subscriber daily cap on notification DMs (dmQuota.ts): one row per pubkey, window = 24 h from the
    // first DM, count capped at cap+1 (bounded), summary_sent = the one "paused alerts" DM of the window.
    `CREATE TABLE IF NOT EXISTS notification_dm_quota (
       pubkey TEXT PRIMARY KEY,
       window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
       dm_count INTEGER NOT NULL DEFAULT 0,
       summary_sent BOOLEAN NOT NULL DEFAULT false
     )`,
    'CREATE INDEX IF NOT EXISTS idx_notification_dm_quota_window ON notification_dm_quota(window_start)',
    // Version freshness grace period (see versionCatalog.ts's effectiveLatestVersions()):
    // released_at is GitHub's own published_at for latest_version, so grace periods are
    // measured from the real upstream release date, not from whenever our daily cron
    // happened to notice it. previous_version is the latest_version this row held right
    // before the current one — the rung a mint compares against while still in grace.
    'ALTER TABLE software_versions ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ',
    'ALTER TABLE software_versions ADD COLUMN IF NOT EXISTS previous_version TEXT',
    // Mint identity pubkey (NUT-06 `/v1/info.pubkey`, a 33-byte compressed secp256k1
    // hex string) — lets submit/discover suggest "this looks like an alias of an
    // already-tracked mint" without ever merging rows. See mintPubkey.ts. URL stays
    // the only identity for history/watchlist/reviews/notifications.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS pubkey TEXT',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS nostr_announced_at TIMESTAMPTZ',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS nostr_announce_id TEXT',
    // Author pubkey + `d` tag identifier of the mint's own kind:38172 NIP-87
    // announcement event — needed (together with the kind) to build a NIP-19
    // `naddr` deep link to that event. nostr_announce_id alone (the event id)
    // isn't enough for an addressable-event coordinate. Null until the next
    // 6h discovery cycle re-processes a still-live announcement.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS nostr_announce_pubkey TEXT',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS nostr_announce_d TEXT',
    `CREATE INDEX IF NOT EXISTS idx_mints_pubkey ON mints (pubkey) WHERE pubkey IS NOT NULL`,
    // Defense-in-depth for the rating range bug in reviews.ts/reviewUtils.ts's
    // content-fallback "[X/5]" parser (fixed alongside this constraint) — an
    // out-of-range parsed rating should never reach the DB, but this guarantees
    // it even if a future code path forgets the clamp. Verified 0 existing rows
    // violate this before adding it (checked live prod DB, 2026-09-19). Postgres
    // has no `ADD CONSTRAINT IF NOT EXISTS`, so this is wrapped in a DO block
    // that checks pg_constraint first — the migrations array runs on every boot.
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'mint_reviews_rating_range'
       ) THEN
         ALTER TABLE mint_reviews ADD CONSTRAINT mint_reviews_rating_range
           CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
       END IF;
     END $$`,
    // The audit source moved audit.cashu.cz -> cashu.info: rewrite stored page URLs that still
    // carry the old host (id re-validated). Idempotent — matches nothing once rewritten.
    `UPDATE audit_cz_mints
       SET page = 'https://cashu.info/mint/' || substring(page from '^https://audit\\.cashu\\.cz/mint/([A-Za-z0-9]{8,64})/?$')
     WHERE page ~ '^https://audit\\.cashu\\.cz/mint/[A-Za-z0-9]{8,64}/?$'`,
    // Audit part of the Reliability Score reads these three columns (shared/auditScore.ts), filled by
    // the cashu.info detail cron (auditCzDetail.ts): swaps7d.all.total, swaps7d.errorsBlamed and the
    // detail's fetched_at, on the tracked mint the url/alias mapping resolves. The audit_recent_*
    // columns stay (audit.8333.space data: Audit tab, /api).
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_cz_total INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_cz_blamed INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_cz_fetched_at TIMESTAMPTZ',
    // Backfill from the stored detail rows so scores don't drop to neutral between a deploy and the
    // next detail cron run. Idempotent (a second run matches nothing); a mint with no detail row stays NULL.
    AUDIT_CZ_BACKFILL_SQL,
    // What the (dormant until a key is configured) Nostr health-assertion publisher last published per mint
    // (healthPublisher.ts): the state behind the 6 h / rank delta / 24 h rules, so a restart never republishes
    // everything. Additive and idempotent; stays empty while the feature is off.
    `CREATE TABLE IF NOT EXISTS attestation_state (
       mint_url TEXT PRIMARY KEY,
       last_event_id TEXT,
       last_created_at BIGINT,
       last_rank INTEGER,
       last_status TEXT,
       last_methodology INTEGER
     )`,
    // Keysets of every mint (keysetsSync.ts, hourly): data collection only, nothing here feeds the Reliability Score.
    // ON DELETE CASCADE removes a mint's rows together with the mint (every prune path deletes from mints).
    // id_valid: NULL = could not be checked (legacy id, or the keys were not obtained in the same check).
    `CREATE TABLE IF NOT EXISTS mint_keysets (
       url TEXT NOT NULL REFERENCES mints(url) ON DELETE CASCADE,
       keyset_id TEXT NOT NULL,
       unit TEXT NOT NULL,
       active BOOLEAN NOT NULL,
       input_fee_ppk INTEGER,
       final_expiry TIMESTAMPTZ,
       id_version TEXT NOT NULL,
       id_valid BOOLEAN,
       first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (url, keyset_id)
     )`,
    'CREATE INDEX IF NOT EXISTS idx_mint_keysets_url ON mint_keysets(url)',
    // Nullable, no default: a metadata-only change, no table rewrite.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS keysets_checked_at TIMESTAMPTZ',
    // The per-component points behind last_reliability_score, written in the same UPDATE (scoreBreakdown.ts); NULL until
    // the next probe cycle after the deploy. Nullable, no default: a metadata-only change, no table rewrite.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS score_breakdown JSONB',
    // Confirmed changes in a mint's public data (mintChanges.ts): a difference becomes a row only after two consecutive
    // successful observations. Facts with a source and a time; nothing here feeds the Reliability Score. Values are
    // sanitised text (no URLs, no contact values). ON DELETE CASCADE removes the rows together with the mint.
    `CREATE TABLE IF NOT EXISTS mint_changes (
       id BIGSERIAL PRIMARY KEY,
       url TEXT NOT NULL REFERENCES mints(url) ON DELETE CASCADE,
       change_type TEXT NOT NULL,
       field TEXT NOT NULL,
       old_value TEXT,
       new_value TEXT,
       observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       source TEXT NOT NULL CHECK (source IN ('info', 'keysets'))
     )`,
    'CREATE INDEX IF NOT EXISTS idx_mint_changes_url_observed ON mint_changes(url, observed_at DESC)',
    // The last CONFIRMED normalised values per mint (the baseline the next observation is compared with) and the time
    // the mint was first observed. NULL info/keysets = never observed: the first observation is a baseline, no change.
    `CREATE TABLE IF NOT EXISTS mint_change_state (
       url TEXT PRIMARY KEY REFERENCES mints(url) ON DELETE CASCADE,
       info JSONB,
       keysets JSONB,
       tracking_since TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    // Version of the rule the stored `info.nuts` baseline was built with (NUTS_RULES_VERSION in mintChanges.ts; 0 = built before
    // supported:false meant "not supported"). An older stamp makes the next observation replace the baseline silently, no change row.
    'ALTER TABLE mint_change_state ADD COLUMN IF NOT EXISTS nuts_rules INTEGER NOT NULL DEFAULT 0',
    // Facts about the mint's contact entries (contactChecks.ts): [{ kind, formatValid, domainResolves, checkedAt }] per entry,
    // never a contact value or a domain. NULL until the first check after the deploy. Nullable, no default: metadata only.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS contact_checks JSONB',
    // Last published NUT-06 contact entries (method + info only, max 10, sanitized). Overwritten on every successful probe.
    // Cleared when the mint removes them, or after 90 days without a successful probe. Shown on Mint Detail when the mint is offline.
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS last_contacts JSONB',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS last_contacts_at TIMESTAMPTZ',
    // Newest mint_changes.id a subscriber was told about (public key / input fee DMs): the dedupe claim, one DM per change row.
    'ALTER TABLE notification_subscriptions ADD COLUMN IF NOT EXISTS last_notified_change_id BIGINT',
  ]

  for (const sql of migrations) {
    await pool.query(sql)
  }

  // Seed software_versions so scoring works identically right after deploy, even
  // before fetchLatestUpstreamVersions' daily cron job has run for the first time.
  // Initial values only (major.minor is what the version rule uses; the exact patch doesn't
  // matter). ON CONFLICT DO NOTHING makes this a no-op after the first run, once the cron job
  // owns the row and replaces them with the real latest GitHub release.
  await pool.query(`
    INSERT INTO software_versions (software, latest_version, fetched_at, source_url)
    VALUES
      ('nutshell', '0.20.3', NOW(), NULL),
      ('cdk', '0.17.5', NOW(), NULL)
    ON CONFLICT (software) DO NOTHING
  `)
}

/** Rows of mint_changes older than this are deleted by the daily maintenance job. */
export const MINT_CHANGES_RETENTION_DAYS = 365

export async function pruneOldMintChanges(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM mint_changes WHERE observed_at < NOW() - INTERVAL '${MINT_CHANGES_RETENTION_DAYS} days'`
  )
  return result.rowCount ?? 0
}

// 30-day retention: a subscription not touched (created/updated) in 30 days
// is dropped. Returns the deleted row count for cron logging.
export async function pruneOldNotificationSubscriptions(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM notification_subscriptions WHERE updated_at < now() - interval '30 days'`
  )
  // Cap windows last 24 h; a row older than two days carries no information any more.
  await pool.query(`DELETE FROM notification_dm_quota WHERE window_start < now() - interval '2 days'`)
  return result.rowCount ?? 0
}
