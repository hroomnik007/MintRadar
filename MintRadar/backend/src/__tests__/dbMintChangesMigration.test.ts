import { describe, it, expect, vi, beforeEach } from 'vitest'

// initDb() adds the mint change log (mintChanges.ts): mint_changes, mint_change_state and the DM dedupe column. pg is mocked
// here, so this checks the SQL text and that a second boot issues the same statements (every one idempotent); the SQL itself is
// run twice against a real PostgreSQL in mintChanges.pg.test.ts when MR_PG_TEST_URL is set.

const { queries } = vi.hoisted(() => ({ queries: [] as string[] }))
vi.mock('pg', () => ({
  Pool: class { on = () => this; query = async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 0 } } },
}))

import { initDb } from '../db.js'

beforeEach(() => { queries.length = 0 })

describe('initDb — mint change log', () => {
  it('creates both tables, the (url, observed_at DESC) index and the DM column additively, after mints exists', async () => {
    await initDb()
    const changes = queries.find(q => q.includes('CREATE TABLE IF NOT EXISTS mint_changes'))!
    expect(changes).toBeDefined()
    for (const part of ['id BIGSERIAL PRIMARY KEY', 'url TEXT NOT NULL REFERENCES mints(url) ON DELETE CASCADE', 'change_type TEXT NOT NULL', 'field TEXT NOT NULL',
      'old_value TEXT,', 'new_value TEXT,', 'observed_at TIMESTAMPTZ NOT NULL', 'first_seen_at TIMESTAMPTZ NOT NULL', "source TEXT NOT NULL CHECK (source IN ('info', 'keysets'))"]) {
      expect(changes).toContain(part)
    }
    const state = queries.find(q => q.includes('CREATE TABLE IF NOT EXISTS mint_change_state'))!
    expect(state).toContain('url TEXT PRIMARY KEY REFERENCES mints(url) ON DELETE CASCADE')
    expect(state).toContain('tracking_since TIMESTAMPTZ NOT NULL')
    expect(queries).toContain('CREATE INDEX IF NOT EXISTS idx_mint_changes_url_observed ON mint_changes(url, observed_at DESC)')
    expect(queries).toContain('ALTER TABLE notification_subscriptions ADD COLUMN IF NOT EXISTS last_notified_change_id BIGINT')
    const mints = queries.findIndex(q => q.includes('CREATE TABLE IF NOT EXISTS mints'))
    expect(mints).toBeLessThan(queries.indexOf(changes))
    expect(mints).toBeLessThan(queries.indexOf(state))
  })

  it('running it twice issues the same statements, and none of them is destructive or non-idempotent', async () => {
    await initDb()
    const pick = (list: string[]) => list.filter(q => /mint_changes|mint_change_state|last_notified_change_id/.test(q))
    const first = pick(queries)
    queries.length = 0
    await initDb()
    expect(pick(queries)).toEqual(first)
    expect(first.length).toBeGreaterThanOrEqual(4)
    for (const q of first) {
      expect(q).toMatch(/IF NOT EXISTS/)
      expect(q.replace(/ON DELETE CASCADE/g, '')).not.toMatch(/DROP|TRUNCATE|DELETE|RENAME/i)
    }
  })
})
