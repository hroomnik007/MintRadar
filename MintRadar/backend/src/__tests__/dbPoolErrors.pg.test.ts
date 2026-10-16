import { describe, it, expect } from 'vitest'
import pg from 'pg'
import { attachPoolErrorHandler } from '../db.js'

// Real Postgres, only when MR_PG_TEST_URL is set (CI has no database), e.g. a throwaway container:
//   podman run -d --name mr-pg-test -e POSTGRES_PASSWORD=... -p 127.0.0.1:55432:5432 postgres:17-alpine
//   MR_PG_TEST_URL=postgres://postgres:...@127.0.0.1:55432/postgres npx vitest run dbPoolErrors.pg
const url = process.env['MR_PG_TEST_URL']

function newPool(): pg.Pool {
  const p = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 })
  attachPoolErrorHandler(p)
  return p
}

async function killOtherBackends(): Promise<void> {
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database()')
  await admin.end()
}

describe.skipIf(!url)('pool errors against a real Postgres', () => {
  it('killing idle backends raises no uncaughtException and the next query uses a new connection', async () => {
    const stray: string[] = []
    const onUncaught = (e: Error): void => { stray.push(e.message) }
    process.on('uncaughtException', onUncaught)
    const pool = newPool()
    try {
      const clients = await Promise.all([1, 2, 3, 4, 5].map(() => pool.connect()))
      clients.forEach(c => c.release())
      await killOtherBackends()
      await new Promise(r => setTimeout(r, 500))
      expect(stray).toEqual([])
      expect((await pool.query('SELECT 1 AS x')).rows[0].x).toBe(1)
    } finally {
      process.off('uncaughtException', onUncaught)
      await pool.end()
    }
  })

  it('a backend killed while a query runs rejects that query with 57P01 and the pool recovers', async () => {
    const stray: string[] = []
    const onUncaught = (e: Error): void => { stray.push(e.message) }
    process.on('uncaughtException', onUncaught)
    const pool = newPool()
    try {
      const running = pool.query('SELECT pg_sleep(5)')
      const settled = running.then(() => 'resolved', (e: { code?: string }) => `rejected ${e.code}`)
      await new Promise(r => setTimeout(r, 300))
      await killOtherBackends()
      expect(await settled).toBe('rejected 57P01')
      await new Promise(r => setTimeout(r, 300))
      expect(stray).toEqual([])
      expect((await pool.query('SELECT 2 AS x')).rows[0].x).toBe(2)
    } finally {
      process.off('uncaughtException', onUncaught)
      await pool.end()
    }
  })
})
