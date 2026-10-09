import { describe, it, expect, vi, beforeEach } from 'vitest'

// initDb() creates the app_state key/value table (one-time application state, first user: the
// 'known_mints_seeded' flag). pg is mocked: the statement must be additive and idempotent.

const { queries } = vi.hoisted(() => ({ queries: [] as string[] }))
vi.mock('pg', () => ({
  Pool: class { query = async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 0 } } },
}))

import { initDb } from '../db.js'

beforeEach(() => { queries.length = 0 })

describe('initDb — app_state', () => {
  it('creates app_state with IF NOT EXISTS and the expected columns', async () => {
    await initDb()
    const sql = queries.find(q => /CREATE TABLE IF NOT EXISTS app_state/.test(q))
    expect(sql).toBeDefined()
    expect(sql).toMatch(/key TEXT PRIMARY KEY/)
    expect(sql).toMatch(/value TEXT NOT NULL/)
    expect(sql).toMatch(/updated_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/)
  })

  it('is idempotent: running initDb twice runs the same additive statement and never drops it', async () => {
    await initDb()
    await initDb()
    expect(queries.filter(q => /CREATE TABLE IF NOT EXISTS app_state/.test(q))).toHaveLength(2)
    expect(queries.some(q => /DROP TABLE[^;]*app_state/i.test(q))).toBe(false)
  })
})
