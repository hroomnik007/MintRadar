import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'

// Real Postgres, only when MR_PG_TEST_URL is set (see dbKeysets.pg.test.ts): the daily rows of the long audit
// window (audit_cz_daily), what the detail cron copies onto the mint, and what /api/mints/audit-cz and the wallet
// API read back.
const url = process.env['MR_PG_TEST_URL']

describe.skipIf(!url)('long audit window against a real Postgres', () => {
  it('the cron keeps the first totals of a day, sums rows 7 days apart and the endpoints show them', async () => {
    process.env['DATABASE_URL'] = url
    vi.resetModules()
    const detail = { id: 'longwin01', swaps7d: { all: { total: 50, success: 49, failed: 1 }, errorsBlamed: 0 } }
    vi.doMock('../ssrf.js', async orig => {
      const real = await orig<typeof import('../ssrf.js')>()
      return { ...real, safeFetch: vi.fn(async () => new Response(JSON.stringify(detail), { status: 200, headers: { 'content-type': 'application/json' } })) }
    })
    const { initDb, pool } = await import('../db.js')
    try {
      await initDb()
      const m = 'https://pg-long-window.example.com'
      for (const t of ['audit_cz_daily', 'audit_cz_detail', 'audit_cz_mints']) await pool.query(`DELETE FROM ${t} WHERE url = $1`, [m])
      await pool.query('DELETE FROM audit_cz_swaps WHERE from_url = $1 OR to_url = $1', [m])
      await pool.query('DELETE FROM mints WHERE url = $1', [m])
      await pool.query('INSERT INTO mints (url, discovered_at) VALUES ($1, NOW() - INTERVAL \'60 days\')', [m])
      await pool.query(
        `INSERT INTO audit_cz_mints (url, state, page, fetched_at, source) VALUES ($1, 'ok', 'https://cashu.info/mint/longwin01', NOW(), 'audit.cashu.cz')`, [m])
      // Older rows: 7 and 14 days back count, 3 days back would overlap, 28 days back is behind a gap (21 is missing).
      const rows: Array<[number, number, number]> = [[7, 40, 4], [14, 30, 0], [3, 999, 999], [28, 500, 0]]
      for (const [back, total, blamed] of rows) {
        await pool.query(`INSERT INTO audit_cz_daily (url, day, total, blamed) VALUES ($1, (NOW() AT TIME ZONE 'UTC')::date - $2::integer, $3, $4)`, [m, back, total, blamed])
      }
      await pool.query(`INSERT INTO audit_cz_swaps (id, at, status, from_url, to_url, fetched_at, source) VALUES
        ('lw1', NOW(), 'success', $1, 'https://other.example', NOW(), 'audit.cashu.cz'),
        ('lw2', NOW(), 'failed', 'https://other.example', $1, NOW(), 'audit.cashu.cz'),
        ('lw3', NOW() - INTERVAL '9 days', 'success', $1, 'https://other.example', NOW(), 'audit.cashu.cz')`, [m])

      const { syncAuditCzDetails } = await import('../auditCzDetail.js')
      const only = { pauseMs: 0, sleep: async () => {} }
      await syncAuditCzDetails(only)
      const col = async () => (await pool.query('SELECT audit_cz_total, audit_cz_blamed, audit_cz_long_total, audit_cz_long_blamed, audit_cz_long_days FROM mints WHERE url = $1', [m])).rows[0]
      expect(await col()).toEqual({ audit_cz_total: 50, audit_cz_blamed: 0, audit_cz_long_total: 120, audit_cz_long_blamed: 4, audit_cz_long_days: 21 })

      // A later run of the same day with other totals: the 7-day inputs follow, the day's row does not.
      detail.swaps7d = { all: { total: 60, success: 58, failed: 2 }, errorsBlamed: 1 }
      await syncAuditCzDetails(only)
      expect(await col()).toEqual({ audit_cz_total: 60, audit_cz_blamed: 1, audit_cz_long_total: 120, audit_cz_long_blamed: 4, audit_cz_long_days: 21 })
      const today = (await pool.query(`SELECT total, blamed FROM audit_cz_daily WHERE url = $1 AND day = (NOW() AT TIME ZONE 'UTC')::date`, [m])).rows[0]
      expect(today).toEqual({ total: 50, blamed: 0 })

      const { app } = await import('../index.js')
      const a = (await request(app).get('/api/mints/audit-cz').query({ url: m })).body
      expect(a.long).toEqual({ windowDays: 21, swaps: 120, attributedFailures: 4 })
      expect(a.since.swaps).toBe(620) // 50 + 40 + 30 + the row 28 days back; the row 3 days back overlaps and is left out
      expect(a.since.attributedFailures).toBe(4)
      expect(a.daily7d).toHaveLength(7)
      expect(a.daily7d[6]).toMatchObject({ ok: 1, failed: 1, other: 0 })
      expect(a.daily7d.slice(0, 6).every((d: { ok: number; failed: number }) => d.ok + d.failed === 0)).toBe(true)

      const w = (await request(app).get('/api/wallets/mints/' + encodeURIComponent(m))).body.mint
      expect(w.auditLong).toEqual({ swaps: 120, attributedFailures: 4, windowDays: 21 })
      expect(w.audit).toMatchObject({ swaps7d: 60, attributedFailures: 1 })
    } finally {
      await pool.end()
    }
  })
})
