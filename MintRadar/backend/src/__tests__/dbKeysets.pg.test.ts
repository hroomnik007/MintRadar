import { describe, it, expect, vi } from 'vitest'

// Real Postgres, only when MR_PG_TEST_URL is set (CI has no database), e.g. a throwaway container:
//   podman run -d --name mr-pg-test -e POSTGRES_PASSWORD=... -p 127.0.0.1:55432:5432 postgres:17-alpine
//   MR_PG_TEST_URL=postgres://postgres:...@127.0.0.1:55432/postgres npx vitest run dbKeysets.pg
const url = process.env['MR_PG_TEST_URL']

describe.skipIf(!url)('mint_keysets against a real Postgres', () => {
  it('initDb runs twice, the upsert keeps first_seen_at and a stored verdict, and deleting the mint cascades', async () => {
    process.env['DATABASE_URL'] = url
    vi.resetModules()
    const { initDb, pool } = await import('../db.js')
    const { UPSERT_KEYSETS_SQL } = await import('../keysetsSync.js')
    try {
      await initDb()
      await initDb()
      const m = 'https://pg-test-mint.example.com'
      await pool.query('INSERT INTO mints (url) VALUES ($1) ON CONFLICT DO NOTHING', [m])
      const args = (valid: boolean | null, active: boolean) => [m, ['0011223344556677'], ['sat'], [active], [100], [2059210353], ['v1'], [valid]]
      await pool.query(UPSERT_KEYSETS_SQL, args(true, true))
      const first = (await pool.query('SELECT * FROM mint_keysets WHERE url = $1', [m])).rows[0]
      expect(first.id_valid).toBe(true)
      expect(new Date(first.final_expiry).getTime()).toBe(2059210353 * 1000)
      await new Promise(r => setTimeout(r, 20))
      await pool.query(UPSERT_KEYSETS_SQL, args(null, false))
      const second = (await pool.query('SELECT * FROM mint_keysets WHERE url = $1', [m])).rows[0]
      expect(second.id_valid).toBe(true) // NULL never overwrites a stored verdict
      expect(second.active).toBe(false)
      expect(second.first_seen_at.getTime()).toBe(first.first_seen_at.getTime())
      expect(second.last_seen_at.getTime()).toBeGreaterThan(first.last_seen_at.getTime())
      await pool.query(UPSERT_KEYSETS_SQL, args(false, false))
      expect((await pool.query('SELECT id_valid FROM mint_keysets WHERE url = $1', [m])).rows[0].id_valid).toBe(false)
      await pool.query('DELETE FROM mints WHERE url = $1', [m])
      expect((await pool.query('SELECT 1 FROM mint_keysets WHERE url = $1', [m])).rowCount).toBe(0)
    } finally {
      await pool.end()
    }
  })
})
