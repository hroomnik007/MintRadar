import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'

// Real Postgres, only when MR_PG_TEST_URL is set (see dbKeysets.pg.test.ts): percentile_cont on fixed rows for the
// History summary (p50LatencyMs / p95LatencyMs of /api/mints/history) and the wallet API (latency24h, uptime30dPct).
const url = process.env['MR_PG_TEST_URL']

describe.skipIf(!url)('latency percentiles and 30-day uptime against a real Postgres', () => {
  it('history p50/p95 per period, wallet latency24h and uptime30dPct come out of the real queries', async () => {
    process.env['DATABASE_URL'] = url
    vi.resetModules()
    const { initDb, pool } = await import('../db.js')
    try {
      await initDb()
      const m = 'https://pg-latency-pct.example.com'
      await pool.query('DELETE FROM mint_history WHERE url = $1', [m])
      await pool.query('DELETE FROM mints WHERE url = $1', [m])
      await pool.query('INSERT INTO mints (url, discovered_at, last_online_at) VALUES ($1, NOW() - INTERVAL \'60 days\', NOW() - INTERVAL \'1 hour\')', [m])
      // last 24h: online 100, 200, 300, 400, 1000 ms; one failed probe whose latency must not count; one online without a latency
      // 10 days ago: online 9000 ms (in 30d, not in 24h/7d)
      const rows: Array<[boolean, number | null, string]> = [
        [true, 100, '1 hour'], [true, 200, '2 hours'], [true, 300, '3 hours'], [true, 400, '4 hours'], [true, 1000, '5 hours'],
        [false, 5000, '6 hours'], [true, null, '7 hours'], [true, 9000, '10 days'],
      ]
      for (const [online, latency, ago] of rows) {
        await pool.query('INSERT INTO mint_history (url, online, latency_ms, checked_at) VALUES ($1, $2, $3, NOW() - $4::interval)', [m, online, latency, ago])
      }
      const { app } = await import('../index.js')

      const h24 = (await request(app).get('/api/mints/history').query({ url: m, period: '24h' })).body
      expect(h24.p50LatencyMs).toBe(300)
      expect(h24.p95LatencyMs).toBe(880) // 400 + 0.8 × (1000 − 400)
      const h30 = (await request(app).get('/api/mints/history').query({ url: m, period: '30d' })).body
      expect(h30.p50LatencyMs).toBe(350)
      expect(h30.p95LatencyMs).toBe(7000) // 1000 + 0.75 × (9000 − 1000)

      const w = (await request(app).get('/api/wallets/mints/' + encodeURIComponent(m))).body.mint
      expect(w.latency24h).toEqual({ p50Ms: 300, p95Ms: 880, samples: 5 }) // the online probe without a latency is not a sample
      expect(w.uptime30dPct).toBe(88) // 7 of 8 probes in 30 days online
    } finally {
      await pool.end()
    }
  })
})
