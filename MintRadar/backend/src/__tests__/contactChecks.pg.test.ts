import { describe, it, expect, vi } from 'vitest'

// Real Postgres, only when MR_PG_TEST_URL is set (CI has no database); see dbKeysets.pg.test.ts for a throwaway container.
// The contact checks are stored as a small JSONB on the mint: four fields per entry, and neither the contact value nor its
// domain anywhere in the database.
const url = process.env['MR_PG_TEST_URL']

describe.skipIf(!url)('mints.contact_checks against a real Postgres', () => {
  it('the column exists after initDb (run twice), takes the checks and keeps no contact value or domain', async () => {
    process.env['DATABASE_URL'] = url
    vi.resetModules()
    vi.doUnmock('dns/promises')
    const { initDb, pool } = await import('../db.js')
    const { scheduleContactChecks, createDomainChecker, readStoredContactChecks } = await import('../contactChecks.js')
    const mint = 'https://pg-contact-checks.example.com'
    const contact = [
      { method: 'email', info: 'zq7canary.person@canary-mail-7f3a9c.com' },
      { method: 'nostr', info: 'ab'.repeat(32) },
      { method: 'twitter', info: '@canaryhandle7f3a9c' },
      { method: 'website', info: 'https://canary-site-7f3a9c.com/contact' },
    ]
    try {
      await initDb()
      await initDb()
      const col = await pool.query(`SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'mints' AND column_name = 'contact_checks'`)
      expect(col.rows).toEqual([{ data_type: 'jsonb', is_nullable: 'YES', column_default: null }])

      await pool.query('INSERT INTO mints (url) VALUES ($1) ON CONFLICT DO NOTHING', [mint])
      expect((await pool.query('SELECT contact_checks FROM mints WHERE url = $1', [mint])).rows[0].contact_checks).toBeNull()

      const now = () => Date.UTC(2026, 9, 20, 12, 0, 0)
      await scheduleContactChecks(mint, contact, null, { now, domains: createDomainChecker({ lookup: async () => true, now }) })

      const stored = (await pool.query('SELECT contact_checks FROM mints WHERE url = $1', [mint])).rows[0].contact_checks
      expect(readStoredContactChecks(stored)).toEqual([
        { kind: 'email', formatValid: true, domainResolves: true, checkedAt: '2026-10-20T12:00:00.000Z' },
        { kind: 'nostr', formatValid: true, domainResolves: null, checkedAt: '2026-10-20T12:00:00.000Z' },
        { kind: 'twitter', formatValid: true, domainResolves: null, checkedAt: '2026-10-20T12:00:00.000Z' },
        { kind: 'url', formatValid: true, domainResolves: null, checkedAt: '2026-10-20T12:00:00.000Z' },
      ])
      for (const e of stored as Array<Record<string, unknown>>) expect(Object.keys(e).sort()).toEqual(['checkedAt', 'domainResolves', 'formatValid', 'kind'])

      // Canary: not in this mint's row, and not in any table of the public schema.
      const tables = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).rows.map(r => r.tablename as string)
      let dump = ''
      for (const t of tables) dump += JSON.stringify((await pool.query(`SELECT x::text AS r FROM "${t}" x`)).rows)
      for (const needle of ['canary', 'zq7', 'abababab']) expect(dump.toLowerCase(), needle).not.toContain(needle)
    } finally {
      await pool.query('DELETE FROM mints WHERE url = $1', [mint])
      await pool.end()
    }
  })
})
