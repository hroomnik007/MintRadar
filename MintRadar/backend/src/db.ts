import { Pool } from 'pg'

export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

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

    
  await pool.query(`
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

// 30-day retention: a subscription not touched (created/updated) in 30 days
// is dropped. Returns the deleted row count for cron logging.
export async function pruneOldNotificationSubscriptions(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM notification_subscriptions WHERE updated_at < now() - interval '30 days'`
  )
  return result.rowCount ?? 0
}
