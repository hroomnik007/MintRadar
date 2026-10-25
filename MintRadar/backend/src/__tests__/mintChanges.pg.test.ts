import { describe, it, expect, vi } from 'vitest'

// Real Postgres, only when MR_PG_TEST_URL is set (CI has no database), e.g. a throwaway container:
//   podman run -d --name mr-pg-test -e POSTGRES_PASSWORD=... -p 127.0.0.1:55432:5432 postgres:17-alpine
//   MR_PG_TEST_URL=postgres://postgres:...@127.0.0.1:55432/postgres npx vitest run mintChanges.pg
const url = process.env['MR_PG_TEST_URL']

describe.skipIf(!url)('mint_changes / mint_change_state against a real Postgres', () => {
  async function setup() {
    process.env['DATABASE_URL'] = url
    vi.resetModules()
    const db = await import('../db.js')
    const changes = await import('../mintChanges.js')
    await db.initDb()
    await db.initDb() // idempotent: a second boot runs the same statements again
    return { ...db, ...changes }
  }

  const change = (type: string, n: number, extra: Record<string, unknown> = {}) => ({
    type, field: 'motd', oldValue: `old ${n}`, newValue: `new ${n}`, firstSeenAt: Date.now() - 60_000, source: 'info' as const, ...extra,
  })

  it('stores a change with its first-seen time, lists it newest first, and deleting the mint cascades', async () => {
    const m = await setup()
    const mint = 'https://pg-changes-a.example.com'
    try {
      await m.pool.query('INSERT INTO mints (url) VALUES ($1) ON CONFLICT DO NOTHING', [mint])
      const stored = await m.commitChanges(mint, { info: { name: 'A' } }, [change('motd_changed', 1) as never, change('pubkey_changed', 2, { field: 'pubkey' }) as never])
      expect(stored.map(s => [s.type, s.merged])).toEqual([['motd_changed', false], ['pubkey_changed', false]])
      const listed = await m.listMintChanges(mint)
      expect(listed.changes.map(c => c.type)).toEqual(['pubkey_changed', 'motd_changed']) // newest first
      expect(listed.trackingSince).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      const row = (await m.pool.query('SELECT * FROM mint_changes WHERE url = $1 ORDER BY id', [mint])).rows[0]
      expect(row.first_seen_at.getTime()).toBeLessThan(row.observed_at.getTime())
      expect((await m.pool.query('SELECT info FROM mint_change_state WHERE url = $1', [mint])).rows[0].info).toEqual({ name: 'A' })
      await m.pool.query('DELETE FROM mints WHERE url = $1', [mint])
      expect((await m.pool.query('SELECT 1 FROM mint_changes WHERE url = $1', [mint])).rowCount).toBe(0)
      expect((await m.pool.query('SELECT 1 FROM mint_change_state WHERE url = $1', [mint])).rowCount).toBe(0)
    } finally {
      await m.pool.query('DELETE FROM mints WHERE url = $1', [mint])
      await m.pool.end()
    }
  })

  it('nuts_rules: a row starts at 0, loadState reads it, a patch with nutsRules sets it and a patch without leaves it', async () => {
    const m = await setup()
    const mint = 'https://pg-changes-nutrules.example.com'
    try {
      await m.pool.query('INSERT INTO mints (url) VALUES ($1) ON CONFLICT DO NOTHING', [mint])
      expect((await m.loadState(mint)).nutsRules).toBe(0) // no row yet: 0
      await m.commitChanges(mint, { info: { nuts: '4, 5, 7' } }, [])
      expect((await m.loadState(mint)).nutsRules).toBe(0)
      await m.commitChanges(mint, { info: { nuts: '4, 5' }, nutsRules: m.NUTS_RULES_VERSION }, [])
      expect(await m.loadState(mint)).toMatchObject({ info: { nuts: '4, 5' }, nutsRules: m.NUTS_RULES_VERSION })
      await m.commitChanges(mint, { info: { nuts: '4, 5, 12' } }, [])
      expect((await m.loadState(mint)).nutsRules).toBe(m.NUTS_RULES_VERSION)
    } finally {
      await m.pool.query('DELETE FROM mints WHERE url = $1', [mint])
      await m.pool.end()
    }
  })

  it('a row for an unknown mint is refused by the foreign key, and the whole commit (state included) rolls back', async () => {
    const m = await setup()
    try {
      await expect(m.commitChanges('https://pg-changes-unknown.example.com', { info: { name: 'x' } }, [change('motd_changed', 1) as never])).rejects.toThrow()
      expect((await m.pool.query('SELECT 1 FROM mint_change_state WHERE url = $1', ['https://pg-changes-unknown.example.com'])).rowCount).toBe(0)
    } finally {
      await m.pool.end()
    }
  })

  it('per-day cap: 20 rows of their own, the rest of the day merged into ONE "multiple changes" row per type', async () => {
    const m = await setup()
    const mint = 'https://pg-changes-cap.example.com'
    try {
      await m.pool.query('INSERT INTO mints (url) VALUES ($1) ON CONFLICT DO NOTHING', [mint])
      const first = await m.commitChanges(mint, {}, Array.from({ length: 22 }, (_, i) => change('motd_changed', i) as never))
      expect(first.filter(s => !s.merged)).toHaveLength(m.MAX_CHANGES_PER_MINT_PER_DAY)
      expect(first.filter(s => s.merged)).toHaveLength(2)
      // two over the cap of the same type = ONE merged row (the second only touches it)
      const rows = (await m.pool.query('SELECT change_type, old_value, new_value FROM mint_changes WHERE url = $1', [mint])).rows
      expect(rows).toHaveLength(21)
      const merged = rows.filter(r => r.new_value === m.MULTIPLE_CHANGES_TEXT)
      expect(merged).toEqual([{ change_type: 'motd_changed', old_value: null, new_value: m.MULTIPLE_CHANGES_TEXT }])
      // another type over the cap gets its own single merged row, a later change of a type already merged only touches that row
      await m.commitChanges(mint, {}, [change('name_changed', 1, { field: 'name' }) as never, change('motd_changed', 99) as never, change('name_changed', 2, { field: 'name' }) as never])
      const after = (await m.pool.query('SELECT change_type FROM mint_changes WHERE url = $1 AND new_value = $2 ORDER BY change_type', [mint, m.MULTIPLE_CHANGES_TEXT])).rows
      expect(after.map(r => r.change_type)).toEqual(['motd_changed', 'name_changed'])
    } finally {
      await m.pool.query('DELETE FROM mints WHERE url = $1', [mint])
      await m.pool.end()
    }
  })

  it('the (url, observed_at DESC) index serves the per-mint listing', async () => {
    const m = await setup()
    const mint = 'https://pg-changes-index.example.com'
    try {
      await m.pool.query('INSERT INTO mints (url) VALUES ($1) ON CONFLICT DO NOTHING', [mint])
      await m.pool.query(
        `INSERT INTO mint_changes (url, change_type, field, old_value, new_value, observed_at, first_seen_at, source)
         SELECT $1, 'motd_changed', 'motd', 'a', 'b', NOW() - (g || ' hours')::interval, NOW() - (g || ' hours')::interval, 'info' FROM generate_series(1, 400) g`, [mint])
      await m.pool.query('ANALYZE mint_changes')
      const client = await m.pool.connect()
      try {
        await client.query('SET enable_seqscan = off') // tiny table: prove the index can serve the query, the planner would otherwise scan
        const plan = JSON.stringify((await client.query('EXPLAIN (FORMAT JSON) SELECT * FROM mint_changes WHERE url = $1 ORDER BY observed_at DESC LIMIT 100', [mint])).rows[0]['QUERY PLAN'])
        expect(plan).toContain('idx_mint_changes_url_observed')
        expect(plan).not.toContain('"Node Type":"Sort"')
      } finally {
        client.release()
      }
    } finally {
      await m.pool.query('DELETE FROM mints WHERE url = $1', [mint])
      await m.pool.end()
    }
  })

  it('retention: the maintenance prune deletes rows older than 365 days and keeps the rest', async () => {
    const m = await setup()
    const mint = 'https://pg-changes-retention.example.com'
    try {
      await m.pool.query('INSERT INTO mints (url) VALUES ($1) ON CONFLICT DO NOTHING', [mint])
      await m.pool.query(
        `INSERT INTO mint_changes (url, change_type, field, old_value, new_value, observed_at, first_seen_at, source) VALUES
           ($1, 'motd_changed', 'motd', 'a', 'old', NOW() - INTERVAL '366 days', NOW() - INTERVAL '366 days', 'info'),
           ($1, 'motd_changed', 'motd', 'a', 'edge', NOW() - INTERVAL '364 days', NOW() - INTERVAL '364 days', 'info'),
           ($1, 'motd_changed', 'motd', 'a', 'new', NOW(), NOW(), 'info')`, [mint])
      expect(m.MINT_CHANGES_RETENTION_DAYS).toBe(365)
      expect(await m.pruneOldMintChanges()).toBeGreaterThanOrEqual(1)
      const left = (await m.pool.query('SELECT new_value FROM mint_changes WHERE url = $1 ORDER BY observed_at', [mint])).rows.map(r => r.new_value)
      expect(left).toEqual(['edge', 'new'])
    } finally {
      await m.pool.query('DELETE FROM mints WHERE url = $1', [mint])
      await m.pool.end()
    }
  })

  it('the snapshot sub-select used by the wallet API returns the newest 50 per mint, newest first', async () => {
    const m = await setup()
    const mint = 'https://pg-changes-snapshot.example.com'
    try {
      await m.pool.query('INSERT INTO mints (url) VALUES ($1) ON CONFLICT DO NOTHING', [mint])
      await m.pool.query(
        `INSERT INTO mint_changes (url, change_type, field, old_value, new_value, observed_at, first_seen_at, source)
         SELECT $1, 'motd_changed', 'motd', 'a', 'v' || g, NOW() - (g || ' minutes')::interval, NOW() - (g || ' minutes')::interval, 'info' FROM generate_series(1, 60) g`, [mint])
      const res = await m.pool.query(
        `SELECT (SELECT json_agg(json_build_object('new', c.new_value, 'observed', to_char(c.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY c.observed_at DESC, c.id DESC)
                   FROM (SELECT * FROM mint_changes WHERE url = x.url ORDER BY observed_at DESC, id DESC LIMIT ${m.WALLET_CHANGES_PER_MINT}) c) AS changes_json
           FROM mints x WHERE x.url = $1`, [mint])
      const list = res.rows[0].changes_json as Array<{ new: string; observed: string }>
      expect(list).toHaveLength(50)
      expect(list[0]!.new).toBe('v1')
      expect(list[0]!.observed).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    } finally {
      await m.pool.query('DELETE FROM mints WHERE url = $1', [mint])
      await m.pool.end()
    }
  })

  it('pending state: savePendingState persists keysets and info, loadState reads them back as the compared signature, a restart confirms', async () => {
    const m = await setup()
    const mint = 'https://pg-changes-pending.example.com'
    try {
      await m.pool.query('INSERT INTO mints (url) VALUES ($1) ON CONFLICT DO NOTHING', [mint])
      const A = [{ id: '00aa', unit: 'sat', active: true, fee: 0, expiry: null }]
      const B = [{ id: '00aa', unit: 'sat', active: true, fee: 100, expiry: null }]
      await m.commitChanges(mint, { keysets: A, info: { motd: 'old' } }, [])
      await m.savePendingState(mint, { keysets: { value: JSON.stringify(B), firstSeenAt: Date.parse('2026-10-23T10:00:00Z') }, info: { motd: { value: 'new', firstSeenAt: 5 } } })
      const st = await m.loadState(mint)
      expect(st.pendingKeysets).toEqual({ value: JSON.stringify(B), firstSeenAt: Date.parse('2026-10-23T10:00:00Z') })
      expect(st.pendingInfo).toEqual({ motd: { value: 'new', firstSeenAt: 5 } })
      const read = await m.listMintChanges(mint)
      expect(read.changes).toEqual([])
      expect(read.pending!.diff.map(d => d.type)).toEqual(['input_fee_changed', 'motd_changed'])
      // a "restart": an empty in-memory map, the real load; the second matching check confirms with the stored first sighting
      const stored = await m.observeKeysets(mint, B, { load: m.loadState, commit: m.commitChanges, savePending: m.savePendingState, pending: new Map(), now: () => Date.now() })
      expect(stored).toMatchObject([{ type: 'input_fee_changed', firstSeenAt: Date.parse('2026-10-23T10:00:00Z') }])
      expect((await m.loadState(mint)).pendingKeysets).toBeNull()
      await m.savePendingState(mint, { info: { motd: null } })
      expect((await m.pool.query('SELECT pending_info FROM mint_change_state WHERE url = $1', [mint])).rows[0].pending_info).toBeNull()
    } finally {
      await m.pool.query('DELETE FROM mints WHERE url = $1', [mint])
      await m.pool.end()
    }
  })

  it('backfill: a keyset first seen after tracking_since and missing from the baseline becomes pending (whole current list), idempotent, no mint_changes row', async () => {
    const m = await setup()
    const mint = 'https://pg-changes-backfill.example.com'
    const quiet = 'https://pg-changes-backfill-quiet.example.com'
    const OLD = '00' + 'ab'.repeat(7)
    const NEW = '01' + 'cb'.repeat(32)
    try {
      for (const u of [mint, quiet]) {
        await m.pool.query("INSERT INTO mints (url, keysets_checked_at) VALUES ($1, '2026-10-24T09:00:00Z') ON CONFLICT (url) DO UPDATE SET keysets_checked_at = EXCLUDED.keysets_checked_at", [u])
        await m.commitChanges(u, { keysets: [{ id: OLD, unit: 'sat', active: true, fee: 100, expiry: null }] }, [])
        await m.pool.query("UPDATE mint_change_state SET tracking_since = '2026-10-20T00:00:00Z', pending_keysets = NULL, pending_keysets_first_seen_at = NULL WHERE url = $1", [u])
      }
      const ks = (u: string, id: string, active: boolean, fee: number, first: string) => m.pool.query(
        `INSERT INTO mint_keysets (url, keyset_id, unit, active, input_fee_ppk, final_expiry, id_version, id_valid, first_seen_at, last_seen_at, last_checked_at)
         VALUES ($1, $2, 'sat', $3, $4, NULL, 'v2', true, $5, '2026-10-24T09:00:00Z', '2026-10-24T09:00:00Z')
         ON CONFLICT (url, keyset_id) DO UPDATE SET active = EXCLUDED.active, input_fee_ppk = EXCLUDED.input_fee_ppk, first_seen_at = EXCLUDED.first_seen_at`, [u, id, active, fee, first])
      await ks(mint, OLD, false, 100, '2026-10-01T00:00:00Z')
      await ks(mint, NEW, true, 200, '2026-10-23T10:00:00Z')
      await ks(quiet, OLD, true, 100, '2026-10-01T00:00:00Z') // nothing new: no pending
      await m.initDb()
      await m.initDb() // idempotent
      const row = (await m.pool.query('SELECT pending_keysets, pending_keysets_first_seen_at FROM mint_change_state WHERE url = $1', [mint])).rows[0]
      expect(row.pending_keysets).toEqual([
        { id: OLD, unit: 'sat', active: false, fee: 100, expiry: null },
        { id: NEW, unit: 'sat', active: true, fee: 200, expiry: null },
      ])
      expect(row.pending_keysets_first_seen_at.toISOString()).toBe('2026-10-23T10:00:00.000Z')
      expect((await m.pool.query('SELECT pending_keysets FROM mint_change_state WHERE url = $1', [quiet])).rows[0].pending_keysets).toBeNull()
      expect((await m.pool.query('SELECT 1 FROM mint_changes WHERE url = ANY($1)', [[mint, quiet]])).rowCount).toBe(0)
      const read = await m.listMintChanges(mint)
      expect(read.pending).toMatchObject({ firstSeenAt: '2026-10-23T10:00:00.000Z' })
      expect(read.pending!.diff.map(d => d.type)).toEqual(['keyset_added', 'keyset_deactivated', 'input_fee_changed'])
      expect(read.keysetsSeen.map(k => k.id)).toEqual([OLD, NEW])
      // an existing pending value is never overwritten by a later boot
      await m.pool.query("UPDATE mint_change_state SET pending_keysets_first_seen_at = '2026-10-23T11:00:00Z' WHERE url = $1", [mint])
      await m.initDb()
      expect((await m.pool.query('SELECT pending_keysets_first_seen_at FROM mint_change_state WHERE url = $1', [mint])).rows[0].pending_keysets_first_seen_at.toISOString()).toBe('2026-10-23T11:00:00.000Z')
      // the next matching keysets check confirms it with the backfilled first sighting
      const list = m.normalizeStoredKeysets(row.pending_keysets)!
      await m.pool.query("UPDATE mint_change_state SET pending_keysets_first_seen_at = '2026-10-23T10:00:00Z' WHERE url = $1", [mint])
      const stored = await m.observeKeysets(mint, list, { load: m.loadState, commit: m.commitChanges, savePending: m.savePendingState, pending: new Map(), now: () => Date.now() })
      expect(stored.map(c => c.type)).toEqual(['keyset_added', 'keyset_deactivated', 'input_fee_changed'])
      expect(stored[0]!.firstSeenAt).toBe(Date.parse('2026-10-23T10:00:00Z'))
    } finally {
      await m.pool.query('DELETE FROM mints WHERE url = ANY($1)', [[mint, quiet]])
      await m.pool.end()
    }
  })
})
