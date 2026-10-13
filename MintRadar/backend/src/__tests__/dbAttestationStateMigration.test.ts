import { describe, it, expect, vi, beforeEach } from 'vitest'

// initDb() creates attestation_state (what the health-assertion publisher last published per mint). pg is mocked:
// the statement must be additive and idempotent (initDb runs at every boot).

const { queries } = vi.hoisted(() => ({ queries: [] as string[] }))
vi.mock('pg', () => ({
  Pool: class { query = async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 0 } } },
}))

import { initDb } from '../db.js'

beforeEach(() => { queries.length = 0 })

describe('initDb — attestation_state', () => {
  it('creates attestation_state with IF NOT EXISTS and the agreed columns', async () => {
    await initDb()
    const sql = queries.find(q => /CREATE TABLE IF NOT EXISTS attestation_state/.test(q))
    expect(sql).toBeDefined()
    expect(sql).toMatch(/mint_url TEXT PRIMARY KEY/)
    expect(sql).toMatch(/last_event_id TEXT/)
    expect(sql).toMatch(/last_created_at BIGINT/)
    expect(sql).toMatch(/last_rank INTEGER/)
    expect(sql).toMatch(/last_status TEXT/)
    expect(sql).toMatch(/last_methodology INTEGER/)
  })

  it('is idempotent: running initDb twice repeats the same additive statement and never drops or alters it', async () => {
    await initDb()
    await initDb()
    expect(queries.filter(q => /CREATE TABLE IF NOT EXISTS attestation_state/.test(q))).toHaveLength(2)
    expect(queries.some(q => /DROP TABLE[^;]*attestation_state/i.test(q))).toBe(false)
    expect(queries.some(q => /(ALTER|DELETE|TRUNCATE)[^;]*attestation_state/i.test(q))).toBe(false)
  })
})
