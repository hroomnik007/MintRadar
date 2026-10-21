import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'

// Real Postgres, only when MR_PG_TEST_URL is set (see dbKeysets.pg.test.ts): the snapshot SQL of /api/mints/known that
// feeds the wallet API's downSince, keysets (latest successful check only), probes24h and stored score breakdown.
const url = process.env['MR_PG_TEST_URL']

describe.skipIf(!url)('wallet API snapshot SQL against a real Postgres', () => {
  it('downSince, keysets of the latest check, probes24h and scoreBreakdown come out of the real query', async () => {
    process.env['DATABASE_URL'] = url
    vi.resetModules()
    const { initDb, pool } = await import('../db.js')
    try {
      await initDb()
      await initDb() // idempotent
      const down = 'https://pg-w2b-down.example.com'
      const up = 'https://pg-w2b-up.example.com'
      const never = 'https://pg-w2b-never.example.com'
      await pool.query('DELETE FROM mints WHERE url = ANY($1)', [[down, up, never]])
      for (const u of [down, up, never]) await pool.query('INSERT INTO mints (url, discovered_at) VALUES ($1, NOW() - INTERVAL \'60 days\')', [u])
      const bd = { uptime: { points: 30, max: 40 }, audit: { points: 12.5, max: 25 }, nuts: { points: 5, max: 15 }, version: { points: 15, max: 15 }, contact: { points: 0, max: 5 }, newMintCap: { points: 0, cap: 75 }, sum: 63 }
      await pool.query('UPDATE mints SET last_reliability_score = 63, score_breakdown = $2::jsonb WHERE url = $1', [down, JSON.stringify(bd)])
      // down: ok at -3h (last_online_at), failures at -2h30, -2h, -1h; the earlier failure at -5h is before the success and must not count
      await pool.query('UPDATE mints SET last_online_at = NOW() - INTERVAL \'3 hours\' WHERE url = $1', [down])
      for (const [u, online, ago] of [[down, false, '5 hours'], [down, true, '3 hours 0 minutes'], [down, false, '2 hours 30 minutes'], [down, false, '2 hours'], [down, false, '1 hour'],
        [up, false, '4 hours'], [up, true, '10 minutes'], [never, false, '9 hours'], [never, false, '1 hour']] as const) {
        await pool.query(`INSERT INTO mint_history (url, online, checked_at) VALUES ($1, $2, NOW() - $3::interval)`, [u, online, ago])
      }
      await pool.query('UPDATE mints SET last_online_at = NOW() - INTERVAL \'3 hours\' WHERE url = $1', [down])
      await pool.query('UPDATE mints SET last_online_at = NOW() - INTERVAL \'10 minutes\' WHERE url = $1', [up])
      // keysets: k1 listed in the latest check, k2 dropped from it an hour earlier (kept in the table, not shown)
      await pool.query('UPDATE mints SET keysets_checked_at = NOW() WHERE url = $1', [up])
      await pool.query(`INSERT INTO mint_keysets (url, keyset_id, unit, active, input_fee_ppk, id_version, id_valid, last_seen_at, last_checked_at)
        VALUES ($1, '00k1', 'sat', true, 100, 'v1', true, NOW() - INTERVAL '1 second', NOW()),
               ($1, '00k2', 'sat', false, 0, 'v1', null, NOW() - INTERVAL '70 minutes', NOW() - INTERVAL '70 minutes')`, [up])

      // change log: two confirmed changes on `up` (newest first), none on the others
      await pool.query(`INSERT INTO mint_changes (url, change_type, field, old_value, new_value, observed_at, first_seen_at, source) VALUES
        ($1, 'motd_changed', 'motd', 'a', 'b', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours 5 minutes', 'info'),
        ($1, 'input_fee_changed', 'input_fee', 'sat: 0 ppk', 'sat: 100 ppk', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour 5 minutes', 'keysets')`, [up])

      const { app } = await import('../index.js')
      const get = async (u: string) => (await request(app).get('/api/wallets/mints/' + encodeURIComponent(u))).body.mint
      const d = await get(down), u = await get(up), n = await get(never)

      expect(d.status).toBe('offline')
      const failAt = (await pool.query(`SELECT checked_at FROM mint_history WHERE url = $1 AND online = false AND checked_at > NOW() - INTERVAL '3 hours' ORDER BY checked_at LIMIT 1`, [down])).rows[0].checked_at as Date
      expect(d.downSince).toBe(failAt.toISOString())
      expect(d.scoreBreakdown).toEqual(bd)
      expect(d.sample.probes24h).toBe(5)
      expect(d.keysets).toEqual([])
      expect(d.keysetsCheckedAt).toBeNull()

      expect(u.status).toBe('online')
      expect(u.downSince).toBeNull()
      expect(u.keysets.map((k: { id: string }) => k.id)).toEqual(['00k1'])
      expect(u.keysets[0]).toMatchObject({ unit: 'sat', active: true, inputFeePpk: 100, idVersion: 'v1', idValid: true, finalExpiry: null })
      expect(u.keysetsCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(u.scoreBreakdown).toBeNull()
      expect(u.changes.map((c: { type: string }) => c.type)).toEqual(['input_fee_changed', 'motd_changed'])
      expect(u.changes[0]).toEqual({ type: 'input_fee_changed', field: 'input_fee', oldValue: 'sat: 0 ppk', newValue: 'sat: 100 ppk', observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/), firstSeenAt: expect.stringMatching(/Z$/) })
      expect(d.changes).toEqual([])
      expect(n.changes).toEqual([])
      const since = new Date(Date.now() - 90 * 60_000).toISOString()
      const changed = (await request(app).get('/api/wallets/mints').query({ changedSince: since, includeOffline: 'true', includeUnscored: 'true' })).body
      expect(changed.mints.map((m: { url: string }) => m.url)).toEqual([up])

      // never online: the streak starts at its first retained failure
      const first = (await pool.query(`SELECT MIN(checked_at) AS t FROM mint_history WHERE url = $1`, [never])).rows[0].t as Date
      expect(n.downSince).toBe(first.toISOString())
      expect(n.lastOnlineAt).toBeNull()

      await pool.query('DELETE FROM mints WHERE url = ANY($1)', [[down, up, never]])
    } finally {
      await pool.end()
    }
  })
  it('auditByDirection and feeExamples come out of the real query: the mint\'s own detail row, else the alias row, else nothing', async () => {
    process.env['DATABASE_URL'] = url
    vi.resetModules()
    const { initDb, pool } = await import('../db.js')
    try {
      await initDb()
      const own = 'https://pg-w6b-own.example.com'
      const viaAlias = 'https://pg-w6b-alias.example.com'
      const canonical = 'https://pg-w6b-canonical.example.com'
      const none = 'https://pg-w6b-none.example.com'
      await pool.query('DELETE FROM mints WHERE url = ANY($1)', [[own, viaAlias, none]])
      await pool.query('DELETE FROM audit_cz_detail WHERE url = ANY($1)', [[own, canonical]])
      await pool.query('DELETE FROM audit_cz_aliases WHERE alias_url = $1', [viaAlias])
      for (const u of [own, viaAlias, none]) await pool.query('INSERT INTO mints (url, discovered_at) VALUES ($1, NOW() - INTERVAL \'60 days\')', [u])
      const detail = (asSource: unknown, asDest: unknown) => JSON.stringify({ swaps7d: { all: { total: 9 }, asSource, asDest } })
      await pool.query('INSERT INTO audit_cz_detail (url, detail, fetched_at) VALUES ($1, $2::jsonb, NOW() - INTERVAL \'1 hour\'), ($3, $4::jsonb, NOW() - INTERVAL \'2 hours\')', [
        own, detail({ total: 64, success: 51, failed: 13 }, { total: 62, success: 56, failed: 6 }), canonical, detail({ total: 4, success: 4, failed: 0 }, undefined),
      ])
      await pool.query('INSERT INTO audit_cz_aliases (alias_url, mint_url) VALUES ($1, $2)', [viaAlias, canonical])
      await pool.query('UPDATE mints SET keysets_checked_at = NOW() WHERE url = $1', [own])
      await pool.query(`INSERT INTO mint_keysets (url, keyset_id, unit, active, input_fee_ppk, id_version, last_seen_at) VALUES
        ($1, '00k1', 'sat', true, 100, 'v1', NOW()), ($1, '00k2', 'sat', true, 250, 'v1', NOW()), ($1, '00k3', 'sat', false, 5000, 'v1', NOW())`, [own])

      const { app } = await import('../index.js')
      const get = async (u: string) => (await request(app).get('/api/wallets/mints/' + encodeURIComponent(u))).body.mint
      const a = await get(own), b = await get(viaAlias), c = await get(none)
      expect(a.auditByDirection.mint).toMatchObject({ attempts: 62, failures: 6, windowDays: 7, source: 'cashu.info' })
      expect(a.auditByDirection.melt).toMatchObject({ attempts: 64, failures: 13 })
      expect(a.auditByDirection.mint.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
      expect(b.auditByDirection.melt).toMatchObject({ attempts: 4, failures: 0 })
      expect(b.auditByDirection.mint).toBeNull()
      expect(c.auditByDirection).toEqual({ mint: null, melt: null })
      expect(a.feeExamples).toEqual([{ unit: 'sat', inputFeePpk: 250, examples: [{ proofs: 1, fee: 1 }, { proofs: 16, fee: 4 }, { proofs: 100, fee: 25 }] }])
      expect(c.feeExamples).toEqual([])

      await pool.query('DELETE FROM mints WHERE url = ANY($1)', [[own, viaAlias, none]])
      await pool.query('DELETE FROM audit_cz_detail WHERE url = ANY($1)', [[own, canonical]])
      await pool.query('DELETE FROM audit_cz_aliases WHERE alias_url = $1', [viaAlias])
    } finally {
      await pool.end()
    }
  })
})
