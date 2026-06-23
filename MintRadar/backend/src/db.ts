import { Pool } from 'pg'

export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

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

    CREATE INDEX IF NOT EXISTS idx_mints_trust_score
      ON mints(last_trust_score DESC NULLS LAST);
  `)

  // Column migrations — each in its own query so a failure in one doesn't block others
  const migrations = [
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS icon_url TEXT',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS version TEXT',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS nut_count INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS tos_url TEXT',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS description_long TEXT',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS nuts_limits JSONB',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_n_mints INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_n_melts INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_n_errors INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_checked_at TIMESTAMPTZ',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS last_trust_score INTEGER',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS last_error TEXT',
    'ALTER TABLE mints ADD COLUMN IF NOT EXISTS server_location TEXT',
  ]

  for (const sql of migrations) {
    await pool.query(sql)
  }
}
