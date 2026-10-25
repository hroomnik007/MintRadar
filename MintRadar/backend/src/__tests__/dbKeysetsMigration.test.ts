import { describe, it, expect, vi, beforeEach } from 'vitest'

// initDb() adds mint_keysets (keysetsSync.ts) and mints.keysets_checked_at. pg is mocked here, so this checks the SQL
// text and that a second boot issues the same statements (every one idempotent); the SQL itself is also run twice
// against a real PostgreSQL in dbKeysets.pg.test.ts when MR_PG_TEST_URL is set.

const { queries } = vi.hoisted(() => ({ queries: [] as string[] }))
vi.mock('pg', () => ({
  Pool: class { on = () => this; query = async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 0 } } },
}))

import { initDb } from '../db.js'

beforeEach(() => { queries.length = 0 })

describe('initDb — mint_keysets', () => {
  it('creates the table, the url index and the mints column additively (IF NOT EXISTS), after mints exists', async () => {
    await initDb()
    const table = queries.find(q => q.includes('CREATE TABLE IF NOT EXISTS mint_keysets'))!
    expect(table).toBeDefined()
    for (const part of ['url TEXT NOT NULL REFERENCES mints(url) ON DELETE CASCADE', 'keyset_id TEXT NOT NULL', 'unit TEXT NOT NULL',
      'active BOOLEAN NOT NULL', 'input_fee_ppk INTEGER,', 'final_expiry TIMESTAMPTZ,', 'id_version TEXT NOT NULL', 'id_valid BOOLEAN,',
      'first_seen_at TIMESTAMPTZ NOT NULL', 'last_seen_at TIMESTAMPTZ NOT NULL', 'last_checked_at TIMESTAMPTZ NOT NULL', 'PRIMARY KEY (url, keyset_id)']) {
      expect(table).toContain(part)
    }
    expect(queries).toContain('CREATE INDEX IF NOT EXISTS idx_mint_keysets_url ON mint_keysets(url)')
    expect(queries).toContain('ALTER TABLE mints ADD COLUMN IF NOT EXISTS keysets_checked_at TIMESTAMPTZ')
    expect(queries.findIndex(q => q.includes('CREATE TABLE IF NOT EXISTS mints'))).toBeLessThan(queries.indexOf(table))
  })

  it('running it twice issues the same statements, and none of them is destructive or non-idempotent', async () => {
    await initDb()
    const first = queries.filter(q => /mint_keysets|keysets_checked_at/.test(q))
    queries.length = 0
    await initDb()
    expect(queries.filter(q => /mint_keysets|keysets_checked_at/.test(q))).toEqual(first)
    for (const q of first) {
      // The pending keysets backfill (mint_change_state, guarded by `pending_keysets IS NULL`) reads mint_keysets; see
      // dbMintChangesMigration.test.ts. Every schema statement is IF NOT EXISTS.
      if (!/^\s*UPDATE mint_change_state/.test(q)) expect(q).toMatch(/IF NOT EXISTS/)
      expect(q.replace('ON DELETE CASCADE', '')).not.toMatch(/DROP|TRUNCATE|DELETE|RENAME/i)
    }
  })
})

describe('initDb — mints.score_breakdown', () => {
  const COL = 'ALTER TABLE mints ADD COLUMN IF NOT EXISTS score_breakdown JSONB'

  it('adds a nullable jsonb column without default, additively, after mints exists', async () => {
    await initDb()
    expect(queries).toContain(COL)
    expect(queries.indexOf(COL)).toBeGreaterThan(queries.findIndex(q => q.includes('CREATE TABLE IF NOT EXISTS mints')))
  })

  it('running it twice issues the identical statement, which is idempotent and not destructive', async () => {
    await initDb()
    const first = queries.filter(q => q.includes('score_breakdown'))
    queries.length = 0
    await initDb()
    expect(queries.filter(q => q.includes('score_breakdown'))).toEqual(first)
    expect(first).toEqual([COL])
    expect(first[0]).toMatch(/IF NOT EXISTS/)
    expect(first[0]).not.toMatch(/DROP|TRUNCATE|DELETE|RENAME|NOT NULL|DEFAULT/i)
  })
})

