import { describe, it, expect, vi, beforeEach } from 'vitest'

// initDb() adds the Reliability Score's audit inputs (mints.audit_cz_*) and backfills them from the stored
// audit_cz_detail rows, so scores do not dip to neutral between a deploy and the next detail cron run.
// pg is mocked here (the SQL itself was also run twice against a real PostgreSQL 17, see the commit notes).

const { queries } = vi.hoisted(() => ({ queries: [] as string[] }))
vi.mock('pg', () => ({
  Pool: class { on = () => this; query = async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 0 } } },
}))

import { initDb, AUDIT_CZ_BACKFILL_SQL } from '../db.js'

beforeEach(() => { queries.length = 0 })

describe('initDb — audit_cz score inputs', () => {
  it('adds the three columns additively (IF NOT EXISTS)', async () => {
    await initDb()
    for (const col of ['audit_cz_total INTEGER', 'audit_cz_blamed INTEGER', 'audit_cz_fetched_at TIMESTAMPTZ']) {
      expect(queries).toContain(`ALTER TABLE mints ADD COLUMN IF NOT EXISTS ${col}`)
    }
  })

  it('runs the backfill after the columns exist, in the startup migration', async () => {
    await initDb()
    const lastAlter = queries.lastIndexOf('ALTER TABLE mints ADD COLUMN IF NOT EXISTS audit_cz_fetched_at TIMESTAMPTZ')
    const backfill = queries.indexOf(AUDIT_CZ_BACKFILL_SQL)
    expect(lastAlter).toBeGreaterThan(-1)
    expect(backfill).toBeGreaterThan(lastAlter)
  })

  it('the backfill is idempotent and maps like the detail cron: exact url or alias, numbers only, NULL stays NULL', () => {
    expect(AUDIT_CZ_BACKFILL_SQL).toContain('IS DISTINCT FROM')
    expect(AUDIT_CZ_BACKFILL_SQL).toContain("rtrim(m.url, '/') = d.url")
    expect(AUDIT_CZ_BACKFILL_SQL).toContain('FROM audit_cz_aliases a WHERE a.mint_url = d.url')
    expect(AUDIT_CZ_BACKFILL_SQL).toContain("'^[0-9]{1,8}$'")
    // joins on audit_cz_detail rows only: a mint without a detail row is never touched
    expect(AUDIT_CZ_BACKFILL_SQL).toContain('FROM audit_cz_detail d')
    expect(AUDIT_CZ_BACKFILL_SQL).toMatch(/^UPDATE mints m/)
  })

  it('does not drop or rename the audit.8333.space audit_recent_* columns', async () => {
    await initDb()
    expect(queries.some(q => /audit_recent_/.test(q) && /(DROP|RENAME)/i.test(q))).toBe(false)
  })

  it('adds the audit_cz_daily history columns additively (IF NOT EXISTS) and never drops them', async () => {
    await initDb()
    for (const col of [
      'success INTEGER', 'avg_ms INTEGER', 'amount BIGINT', 'fees BIGINT',
      'dest_total INTEGER', 'dest_success INTEGER', 'dest_failed INTEGER', 'dest_avg_ms INTEGER', 'dest_amount BIGINT', 'dest_fees BIGINT',
      'source_total INTEGER', 'source_success INTEGER', 'source_failed INTEGER', 'source_avg_ms INTEGER', 'source_amount BIGINT', 'source_fees BIGINT',
    ]) {
      expect(queries).toContain(`ALTER TABLE audit_cz_daily ADD COLUMN IF NOT EXISTS ${col}`)
    }
    expect(queries.some(q => /audit_cz_daily/i.test(q) && /DROP COLUMN/i.test(q))).toBe(false)
  })

  it('adds the 30-day swap graph columns on audit_cz_mints additively (IF NOT EXISTS) and never drops them', async () => {
    await initDb()
    for (const col of [
      'network30_paid INTEGER', 'network30_failed INTEGER', 'network30_amount BIGINT', 'network30_avg_ms INTEGER',
      'network30_dest_paid INTEGER', 'network30_dest_failed INTEGER', 'network30_dest_amount BIGINT',
      'network30_source_paid INTEGER', 'network30_source_failed INTEGER', 'network30_source_amount BIGINT',
      'network30_fetched_at TIMESTAMPTZ',
    ]) {
      expect(queries).toContain(`ALTER TABLE audit_cz_mints ADD COLUMN IF NOT EXISTS ${col}`)
    }
    expect(queries.some(q => /network30_/i.test(q) && /DROP COLUMN/i.test(q))).toBe(false)
  })
})
