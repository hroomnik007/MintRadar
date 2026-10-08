import { describe, it, expect, vi, beforeEach } from 'vitest'

// initDb() adds the Reliability Score's audit inputs (mints.audit_cz_*) and backfills them from the stored
// audit_cz_detail rows, so scores do not dip to neutral between a deploy and the next detail cron run.
// pg is mocked here (the SQL itself was also run twice against a real PostgreSQL 17, see the commit notes).

const { queries } = vi.hoisted(() => ({ queries: [] as string[] }))
vi.mock('pg', () => ({
  Pool: class { query = async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 0 } } },
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
})
