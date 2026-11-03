import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'

// Real Postgres, only when MR_PG_TEST_URL is set (CI has no database; see dbKeysets.pg.test.ts): the new
// `healthRecordPublishedAt` of /api/mints/known comes out of the real snapshot query (a sub-select on attestation_state).
const url = process.env['MR_PG_TEST_URL']

describe.skipIf(!url)('/api/mints/known healthRecordPublishedAt against a real Postgres', () => {
  it('the last accepted event time for a current record; null for a mint never published, without a stored score, and archived', async () => {
    process.env['DATABASE_URL'] = url
    vi.resetModules()
    const { initDb, pool } = await import('../db.js')
    try {
      await initDb()
      const current = 'https://pg-h1-current.example.com'
      const never = 'https://pg-h1-never.example.com'
      const noscore = 'https://pg-h1-noscore.example.com'
      const archived = 'https://pg-h1-archived.example.com'
      const all = [current, never, noscore, archived]
      await pool.query('DELETE FROM attestation_state WHERE mint_url = ANY($1)', [all])
      await pool.query('DELETE FROM mints WHERE url = ANY($1)', [all])
      for (const u of all) await pool.query("INSERT INTO mints (url, discovered_at) VALUES ($1, NOW() - INTERVAL '60 days')", [u])
      await pool.query('UPDATE mints SET last_reliability_score = 80 WHERE url = ANY($1)', [[current, never, archived]])
      // current: online now. archived: the last success is 40 days old and the latest probe failed (archived.ts).
      await pool.query("UPDATE mints SET last_online_at = NOW() WHERE url = ANY($1)", [[current, never, noscore]])
      await pool.query("UPDATE mints SET last_online_at = NOW() - INTERVAL '40 days' WHERE url = $1", [archived])
      await pool.query('INSERT INTO mint_history (url, online, checked_at) VALUES ($1, true, NOW()), ($2, true, NOW()), ($3, true, NOW()), ($4, false, NOW())', [current, never, noscore, archived])
      const created = Math.floor(Date.now() / 1000) - 7200
      await pool.query(
        `INSERT INTO attestation_state (mint_url, last_event_id, last_created_at, last_rank, last_status, last_methodology)
         VALUES ($1, 'e1', $4, 80, 'online', 6), ($2, 'e2', $4, 80, 'online', 6), ($3, 'e3', $4, 80, 'offline', 6)`,
        [current, noscore, archived, created],
      )
      const { app } = await import('../index.js')
      const body = (await request(app).get('/api/mints/known')).body as Array<Record<string, unknown>>
      const by = (u: string) => body.find(r => r['url'] === u)
      expect(by(current)).toMatchObject({ archived: false, healthRecordPublishedAt: new Date(created * 1000).toISOString() })
      expect(by(never)).toMatchObject({ healthRecordPublishedAt: null })
      expect(by(noscore)).toMatchObject({ healthRecordPublishedAt: null })
      expect(by(archived)).toMatchObject({ archived: true, healthRecordPublishedAt: null })
      // The wallet API does not carry the field.
      const wallet = await request(app).get('/api/wallets/mints/' + encodeURIComponent(current))
      expect(JSON.stringify(wallet.body)).not.toContain('healthRecordPublishedAt')
      await pool.query('DELETE FROM attestation_state WHERE mint_url = ANY($1)', [all])
      await pool.query('DELETE FROM mints WHERE url = ANY($1)', [all])
    } finally {
      await pool.end()
    }
  })
})
