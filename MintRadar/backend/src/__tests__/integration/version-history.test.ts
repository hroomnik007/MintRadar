import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// GET /api/mints/version-history — latestGlobalVersion must be scoped to the
// requested mint's own software family. Previously it was the network-wide
// max version string across ALL mints regardless of software (SELECT DISTINCT
// version FROM mint_version_history + a plain numeric versionGt() compare),
// so a cdk-mintd mint could be flagged against a Nutshell mint's higher
// version number — two unrelated projects with independent numbering. Same
// mocking approach as og-mint.test.ts: mock the pg-backed pool at the db.js
// boundary so the real route handler runs end-to-end without a database.

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))
// isSafeUrl() does a real DNS lookup to reject SSRF targets — mock it to a
// public address so these tests don't depend on outbound DNS resolution
// actually working in the test environment. Same pattern as error-leakage.test.ts.
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))

let app: Express
let query: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  const dns = await import('dns/promises')
  const lookup = dns.lookup as unknown as ReturnType<typeof vi.fn>
  lookup.mockReset()
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never) // public → isSafeUrl passes
  ;({ app } = await import('../../index.js'))
})

// The route issues 3 queries in this fixed order via Promise.all:
// 1. mint_version_history (this mint's own version timeline)
// 2. mints (this mint's current `version` string, to determine its software)
// 3. software_versions (via getLatestVersionsMap(), for every tracked software)
function mockQueries(opts: {
  history?: Array<{ version: string; first_seen_at: Date }>
  mintVersion?: string | null
  softwareVersions?: Array<{ software: string; latest_version: string; previous_version: string | null; released_at: Date | null }>
}) {
  query
    .mockResolvedValueOnce({ rows: opts.history ?? [] })
    .mockResolvedValueOnce({ rows: [{ version: opts.mintVersion ?? null }] })
    .mockResolvedValueOnce({ rows: opts.softwareVersions ?? [] })
}

const OLD_RELEASE = new Date('2020-01-01T00:00:00Z') // always past any grace period

describe('GET /api/mints/version-history', () => {
  it('scopes latestGlobalVersion to the mint\'s own software — a cdk-mintd mint is never compared against Nutshell', async () => {
    mockQueries({
      mintVersion: 'cdk-mintd/0.15.1',
      softwareVersions: [
        { software: 'cdk', latest_version: '0.17.5', previous_version: '0.16.2', released_at: OLD_RELEASE },
        // Nutshell's number is far higher — must NOT leak into the cdk mint's comparison.
        { software: 'nutshell', latest_version: '0.20.3', previous_version: '0.19.1', released_at: OLD_RELEASE },
      ],
    })

    const res = await request(app).get('/api/mints/version-history').query({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    expect(res.body.latestGlobalVersion).toBe('cdk/0.17') // major.minor only, never nutshell's 0.20
  })

  it('the reverse: a Nutshell mint is never compared against cdk\'s (lower) numbering', async () => {
    mockQueries({
      mintVersion: 'Nutshell/0.18.0',
      softwareVersions: [
        { software: 'cdk', latest_version: '0.17.5', previous_version: '0.16.2', released_at: OLD_RELEASE },
        { software: 'nutshell', latest_version: '0.20.3', previous_version: '0.19.1', released_at: OLD_RELEASE },
      ],
    })

    const res = await request(app).get('/api/mints/version-history').query({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    expect(res.body.latestGlobalVersion).toBe('nutshell/0.20')
  })

  it('applies the version-freshness grace period — a version released 5 days ago is not yet "latest"', async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    mockQueries({
      mintVersion: 'cdk-mintd/0.16.2',
      softwareVersions: [
        { software: 'cdk', latest_version: '0.17.5', previous_version: '0.16.2', released_at: fiveDaysAgo },
      ],
    })

    const res = await request(app).get('/api/mints/version-history').query({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    expect(res.body.latestGlobalVersion).toBe('cdk/0.16') // previous_version, still in grace
  })

  it('returns null latestGlobalVersion for unrecognized software — no ladder to compare against', async () => {
    mockQueries({
      mintVersion: 'LekMint/1.1.1',
      softwareVersions: [
        { software: 'cdk', latest_version: '0.17.5', previous_version: null, released_at: OLD_RELEASE },
      ],
    })

    const res = await request(app).get('/api/mints/version-history').query({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    expect(res.body.latestGlobalVersion).toBeNull()
  })

  it('returns null latestGlobalVersion when the mint has no stored version', async () => {
    mockQueries({ mintVersion: null, softwareVersions: [] })

    const res = await request(app).get('/api/mints/version-history').query({ url: 'https://mint.example.com' })

    expect(res.status).toBe(200)
    expect(res.body.latestGlobalVersion).toBeNull()
  })

  it('still returns this mint\'s own version history unchanged', async () => {
    const seenAt = new Date('2026-08-01T00:00:00Z')
    mockQueries({
      history: [{ version: 'cdk-mintd/0.15.1', first_seen_at: seenAt }],
      mintVersion: 'cdk-mintd/0.15.1',
      softwareVersions: [{ software: 'cdk', latest_version: '0.17.5', previous_version: null, released_at: OLD_RELEASE }],
    })

    const res = await request(app).get('/api/mints/version-history').query({ url: 'https://mint.example.com' })

    expect(res.body.history).toEqual([{ version: 'cdk-mintd/0.15.1', firstSeenAt: seenAt.toISOString() }])
  })
})
