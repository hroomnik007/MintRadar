import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// Wallet API additive fields of 2026-10-20 (W2b): facts, sample sizes, keysets, methods, score breakdown, the `method`,
// `maxInputFeePpk` and `include` parameters, `total`/`truncated`, the canonical URL of the single-mint endpoint and the
// exposed deprecation headers. The pool is mocked at the db.js boundary (one query returns the snapshot rows, as in
// wallet-api.test.ts); the real middleware stack and handlers run.

vi.mock('../../db.js', () => ({ pool: { query: vi.fn() }, initDb: vi.fn() }))
vi.mock('../../versionCatalog.js', () => ({
  getLatestVersionsMap: vi.fn().mockResolvedValue({ nutshell: { major: 0, minor: 21 }, cdk: { major: 0, minor: 18 } }),
}))

let app: Express
let query: ReturnType<typeof vi.fn>

const DAY = 86_400_000
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString()
const PUBKEY = '02' + 'ab'.repeat(32)

const BREAKDOWN = {
  uptime: { points: 40, max: 40 }, audit: { points: 20, max: 25 }, nuts: { points: 13, max: 15 },
  version: { points: 15, max: 15 }, contact: { points: 2, max: 5 }, newMintCap: { points: 0, cap: 75 }, sum: 90,
}
const KEYSETS = [
  { id: '00aaaaaaaaaaaaaa', unit: 'sat', active: true, fee: 100, expiry: null, version: 'v1', valid: true },
  { id: '00bbbbbbbbbbbbbb', unit: 'sat', active: false, fee: 5000, expiry: '2026-12-01T00:00:00Z', version: 'v1', valid: null },
  { id: '01cccccccccccccc', unit: 'usd', active: true, fee: 0, expiry: null, version: 'v2', valid: false },
]

function row(url: string, o: Record<string, unknown> = {}) {
  return {
    url, name: 'Mint ' + url.slice(8, 9).toUpperCase(), icon_url: null, version: 'Nutshell/0.21.0', nut_count: 12,
    nuts_limits: { '4': {}, '5': {}, '7': {} }, units: ['sat'],
    mint_methods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 1000000 }],
    melt_methods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 1000000 }],
    pubkey: PUBKEY, audit_cz_total: 104, audit_cz_blamed: 2, audit_cz_fetched_at: new Date(ago(0.1)),
    discovered_at: ago(200), last_reliability_score: 90, last_error: 'ECONNRESET 203.0.113.7', server_location: 'Frankfurt am Main, DE',
    ip_address: '203.0.113.7', net_asn: 14061, net_org: 'DigitalOcean, LLC', net_country: 'US', has_onion: true,
    review_count: 0, review_avg_rating: null, review_rated_count: 0, review_operator_count: 0,
    total: 288, online_count: 288, total_7d: 2016, online_count_7d: 2016,
    latest_online: true, latest_latency_ms: 120, latest_checked_at: ago(0.001), last_online_at: ago(0.001),
    score_breakdown: BREAKDOWN, keysets_checked_at: ago(0.01), keysets_json: KEYSETS, down_since: null,
    ...o,
  }
}

const ROWS = [
  row('https://a.example.com'),
  row('https://b.example.com', { last_reliability_score: 80, mint_methods: [{ method: 'bolt11', unit: 'sat' }, { method: 'bolt12', unit: 'sat', min_amount: 10 }], melt_methods: [{ method: 'bolt11', unit: 'sat' }], keysets_json: [{ ...KEYSETS[0], fee: 0 }] }),
  row('https://c.example.com', { last_reliability_score: 70, mint_methods: [{ method: 'onchain', unit: 'btc' }], melt_methods: null, units: ['btc'], keysets_json: [] , keysets_checked_at: null, score_breakdown: null }),
  row('https://nomethods.example.com', { last_reliability_score: 60, mint_methods: null, melt_methods: null, keysets_json: null }),
]

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  query.mockResolvedValue({ rows: ROWS })
  ;({ app } = await import('../../index.js'))
})

const list = (qs = '') => request(app).get('/api/wallets/mints' + qs)
const one = (url: string) => request(app).get('/api/wallets/mints/' + encodeURIComponent(url))
const by = (body: { mints: Array<{ url: string }> }, u: string) => body.mints.find(m => m.url === u) as Record<string, unknown>
const urlsOf = (body: { mints: Array<{ url: string }> }) => body.mints.map(m => m.url)
const withRows = (rows: unknown[]) => query.mockResolvedValue({ rows })
// The snapshot is cached for 60 s per module instance: a second set of rows inside one test needs a fresh app.
async function listWith(rows: unknown[], qs = '') {
  vi.resetModules()
  const db = await import('../../db.js')
  const q = db.pool.query as unknown as ReturnType<typeof vi.fn>
  q.mockReset()
  q.mockResolvedValue({ rows })
  const { app: fresh } = await import('../../index.js')
  return request(fresh).get('/api/wallets/mints' + qs)
}

const FACTS = ['pubkey', 'firstSeenAt', 'lastOnlineAt', 'sample']

describe('facts and sample sizes', () => {
  it('pubkey, firstSeenAt, lastOnlineAt, sample come with include=facts; hasOnion and authRequired are on every object', async () => {
    withRows([row('https://a.example.com', { nuts_limits: { '4': {}, '21': { x: 1 }, '22': {} }, total: 281 })])
    const plain = (await list()).body.mints[0]
    for (const k of FACTS) expect(plain, k).not.toHaveProperty(k)
    expect(plain).toMatchObject({ hasOnion: true, authRequired: { clear: true, blind: true } })
    const m = (await list('?include=facts')).body.mints[0]
    expect(Object.keys(m)).toEqual(expect.arrayContaining(FACTS))
    expect(m.pubkey).toBe(PUBKEY)
    expect(m.firstSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
    expect(m.lastOnlineAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
    expect(m.hasOnion).toBe(true)
    expect(m.authRequired).toEqual({ clear: true, blind: true })
    expect(m.sample).toEqual({ probes24h: 281, swaps7d: 104 })
  })

  it('authRequired reads only the advertised NUT-21 and NUT-22 keys; null when the NUTs are unknown', async () => {
    withRows([
      row('https://a.example.com', { nuts_limits: { '4': {}, '21': {} } }),
      row('https://b.example.com', { nuts_limits: { '22': {}, '21': null } }),
      row('https://c.example.com', { nuts_limits: {} }),
      row('https://d.example.com', { nuts_limits: null }),
    ])
    const body = (await list('?minScore=0')).body
    expect(by(body, 'https://a.example.com')['authRequired']).toEqual({ clear: true, blind: false })
    expect(by(body, 'https://b.example.com')['authRequired']).toEqual({ clear: false, blind: true })
    expect(by(body, 'https://c.example.com')['authRequired']).toEqual({ clear: false, blind: false })
    expect(by(body, 'https://d.example.com')['authRequired']).toBeNull()
  })

  it('null / false / zero cases: no pubkey, no onion flag, never online, no detail', async () => {
    withRows([row('https://a.example.com', { pubkey: null, has_onion: null, last_online_at: null, audit_cz_total: null, audit_cz_blamed: null, audit_cz_fetched_at: null, total: 0 })])
    const m = (await list('?include=facts')).body.mints[0]
    expect(m).toMatchObject({ pubkey: null, hasOnion: false, lastOnlineAt: null, sample: { probes24h: 0, swaps7d: null } })
  })

  it('a stored value that is not a 66-character hex key is not exposed', async () => {
    withRows([row('https://a.example.com', { pubkey: 'not-a-key' })])
    expect((await list('?include=facts')).body.mints[0].pubkey).toBeNull()
  })

  it('downSince is the stored offline-streak start, and null for an online mint whatever the column holds', async () => {
    const start = ago(2)
    withRows([
      row('https://off.example.com', { latest_online: false, down_since: start, last_online_at: ago(2.1) }),
      row('https://on.example.com', { down_since: start }),
    ])
    const body = (await list('?includeOffline=true')).body
    expect(by(body, 'https://off.example.com')['downSince']).toBe(new Date(start).toISOString())
    expect(by(body, 'https://on.example.com')['downSince']).toBeNull()
  })

  it('/api/mints/known carries offlineSince and the last keysets for a mint that is not online only', async () => {
    const start = ago(2)
    withRows([
      row('https://off.example.com', { latest_online: false, down_since: start, last_online_at: ago(2.1) }),
      row('https://on.example.com', { down_since: start }),
    ])
    const rows = (await request(app).get('/api/mints/known')).body as Array<Record<string, unknown>>
    const off = rows.find(r => r['url'] === 'https://off.example.com')!
    const on = rows.find(r => r['url'] === 'https://on.example.com')!
    expect(off['offlineSince']).toBe(new Date(start).toISOString())
    expect(Array.isArray(off['lastKeysets']) && (off['lastKeysets'] as unknown[]).length).toBeGreaterThan(0)
    expect(typeof off['lastKeysetsCheckedAt']).toBe('string')
    expect(on['offlineSince']).toBeNull()
    expect(on['lastKeysets']).toEqual([])
    expect(on['lastKeysetsCheckedAt']).toBeNull()
  })

  it('the snapshot SQL defines downSince as the first failed probe after last_online_at (nothing older than that)', async () => {
    await list()
    const sql = String(query.mock.calls[0]![0])
    expect(sql).toMatch(/CASE WHEN latest\.online = false THEN\s+\(SELECT MIN\(d\.checked_at\) FROM mint_history d\s+WHERE d\.url = m\.url AND d\.online = false AND d\.checked_at > COALESCE\(m\.last_online_at, '-infinity'::timestamptz\)\)/)
    expect(sql).toContain('k.last_seen_at >= m.keysets_checked_at - INTERVAL')
  })
})

describe('auditNeutralReason (the audit rule decides)', () => {
  it('null when measured; low_sample, stale and no_data otherwise', async () => {
    withRows([
      row('https://a.example.com'),
      row('https://b.example.com', { audit_cz_total: 9, audit_cz_blamed: 0 }),
      row('https://c.example.com', { audit_cz_fetched_at: new Date(ago(8)) }),
      row('https://d.example.com', { audit_cz_total: null, audit_cz_blamed: null, audit_cz_fetched_at: null }),
      row('https://e.example.com', { audit_cz_total: 10, audit_cz_blamed: 0 }),
    ])
    const body = (await list()).body
    const r = (u: string) => by(body, u)['auditNeutralReason']
    expect(r('https://a.example.com')).toBeNull()
    expect(r('https://b.example.com')).toBe('low_sample')
    expect(r('https://c.example.com')).toBe('stale')
    expect(r('https://d.example.com')).toBe('no_data')
    expect(r('https://e.example.com')).toBeNull() // exactly the minimum is scored
  })
})

describe('include= and the single-mint endpoint', () => {
  it('the default list has none of the heavy fields', async () => {
    const m = (await list()).body.mints[0]
    for (const k of ['pubkey', 'firstSeenAt', 'lastOnlineAt', 'sample', 'keysets', 'keysetsCheckedAt', 'methods', 'scoreBreakdown', 'changes']) expect(m, k).not.toHaveProperty(k)
  })

  it('each include value adds exactly its own fields', async () => {
    const ALL = ['pubkey', 'firstSeenAt', 'lastOnlineAt', 'sample', 'keysets', 'keysetsCheckedAt', 'methods', 'scoreBreakdown', 'changes']
    const keys = async (inc: string) => Object.keys((await list('?include=' + inc)).body.mints[0]).filter(k => ALL.includes(k)).sort()
    expect(await keys('facts')).toEqual(['firstSeenAt', 'lastOnlineAt', 'pubkey', 'sample'])
    expect(await keys('keysets')).toEqual(['keysets', 'keysetsCheckedAt'])
    expect(await keys('methods')).toEqual(['methods'])
    expect(await keys('breakdown')).toEqual(['scoreBreakdown'])
    expect(await keys('changes')).toEqual(['changes'])
    expect(await keys('keysets,methods,breakdown')).toEqual(['keysets', 'keysetsCheckedAt', 'methods', 'scoreBreakdown'])
    expect(await keys('breakdown,facts,methods,keysets,changes')).toEqual([...ALL].sort())
    expect(await keys('breakdown,breakdown')).toEqual(['scoreBreakdown'])
  })

  it('unknown, empty and repeated include values are a 400 invalid_parameter', async () => {
    for (const qs of ['?include=foo', '?include=keysets,foo', '?include=', '?include=keysets&include=methods', '?include=Keysets']) {
      const res = await list(qs)
      expect(res.status, qs).toBe(400)
      expect(res.body, qs).toEqual({ error: { code: 'invalid_parameter', message: expect.any(String) } })
    }
  })

  it('the single-mint endpoint always carries every heavy field', async () => {
    const m = (await one('https://a.example.com')).body.mint
    for (const k of ['pubkey', 'firstSeenAt', 'lastOnlineAt', 'sample', 'keysets', 'keysetsCheckedAt', 'methods', 'scoreBreakdown', 'changes']) expect(m, k).toHaveProperty(k)
  })

  it('different include sets are different cached bodies (and different ETags)', async () => {
    const a = await list(), b = await list('?include=breakdown')
    expect(a.headers['etag']).not.toBe(b.headers['etag'])
    expect(Object.keys(a.body.mints[0])).not.toContain('scoreBreakdown')
    expect(Object.keys(b.body.mints[0])).toContain('scoreBreakdown')
  })
})

describe('keysets, methods and scoreBreakdown values', () => {
  it('keysets: id, unit, active, inputFeePpk, finalExpiry, idVersion, idValid, plus keysetsCheckedAt', async () => {
    const m = by((await list('?include=keysets')).body, 'https://a.example.com')
    expect(m['keysets']).toEqual([
      { id: '00aaaaaaaaaaaaaa', unit: 'sat', active: true, inputFeePpk: 100, finalExpiry: null, idVersion: 'v1', idValid: true },
      { id: '00bbbbbbbbbbbbbb', unit: 'sat', active: false, inputFeePpk: 5000, finalExpiry: '2026-12-01T00:00:00.000Z', idVersion: 'v1', idValid: null },
      { id: '01cccccccccccccc', unit: 'usd', active: true, inputFeePpk: 0, finalExpiry: null, idVersion: 'v2', idValid: false },
    ])
    expect(m['keysetsCheckedAt']).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
  })

  it('never checked: an empty array and keysetsCheckedAt null (also when the column is missing or malformed)', async () => {
    const body = (await list('?include=keysets')).body
    expect(by(body, 'https://c.example.com')).toMatchObject({ keysets: [], keysetsCheckedAt: null })
    expect(by(body, 'https://nomethods.example.com')).toMatchObject({ keysets: [], keysetsCheckedAt: expect.any(String) })
    const bad = [row('https://a.example.com', { keysets_json: [{ id: 5 }, null, 'x', { id: 'ok', unit: 'sat', active: true, fee: -3, version: 'v1', valid: 'yes' }] })]
    expect((await listWith(bad, '?include=keysets')).body.mints[0].keysets).toEqual([
      { id: 'ok', unit: 'sat', active: true, inputFeePpk: null, finalExpiry: null, idVersion: 'v1', idValid: null },
    ])
  })

  it('methods: mint and melt entries with min and max amounts (null when not stated); null when neither is stored', async () => {
    const body = (await list('?include=methods')).body
    expect(by(body, 'https://b.example.com')['methods']).toEqual({
      mint: [{ method: 'bolt11', unit: 'sat', minAmount: null, maxAmount: null }, { method: 'bolt12', unit: 'sat', minAmount: 10, maxAmount: null }],
      melt: [{ method: 'bolt11', unit: 'sat', minAmount: null, maxAmount: null }],
    })
    expect(by(body, 'https://a.example.com')['methods']).toEqual({
      mint: [{ method: 'bolt11', unit: 'sat', minAmount: 1, maxAmount: 1000000 }], melt: [{ method: 'bolt11', unit: 'sat', minAmount: 1, maxAmount: 1000000 }],
    })
    expect(by(body, 'https://c.example.com')['methods']).toEqual({ mint: [{ method: 'onchain', unit: 'btc', minAmount: null, maxAmount: null }], melt: [] })
    expect(by(body, 'https://nomethods.example.com')['methods']).toBeNull()
  })

  it('methods: entries of the wrong shape are dropped and amounts must be integers', async () => {
    withRows([row('https://a.example.com', { mint_methods: [{ method: 'bolt11', unit: 'sat', min_amount: -1, max_amount: 1.5 }, { method: 'x'.repeat(40), unit: 'sat' }, { method: 'ok', unit: 'bad unit' }, null] })])
    expect((await list('?include=methods')).body.mints[0].methods.mint).toEqual([{ method: 'bolt11', unit: 'sat', minAmount: null, maxAmount: null }])
  })

  it('scoreBreakdown: the stored object, sum equal to score; null until stored or when malformed', async () => {
    const body = (await list('?include=breakdown')).body
    const a = by(body, 'https://a.example.com') as { score: number; scoreBreakdown: typeof BREAKDOWN }
    expect(a.scoreBreakdown).toEqual(BREAKDOWN)
    expect(a.scoreBreakdown.sum).toBe(a.score)
    expect(by(body, 'https://c.example.com')['scoreBreakdown']).toBeNull()
    for (const bad of [{ ...BREAKDOWN, uptime: { points: 41, max: 40 } }, { ...BREAKDOWN, sum: 101 }, { ...BREAKDOWN, newMintCap: { points: 3, cap: 75 } }, 'x', []]) {
      const res = await listWith([row('https://a.example.com', { score_breakdown: bad })], '?include=breakdown')
      expect(res.body.mints[0].scoreBreakdown, JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('total and truncated', () => {
  it('total counts the matches before limit; truncated says whether limit cut the list', async () => {
    const cut = (await list('?limit=1')).body
    expect(cut).toMatchObject({ count: 1, total: 4, truncated: true })
    const all = (await list()).body
    expect(all).toMatchObject({ count: 4, total: 4, truncated: false })
    const exact = (await list('?limit=4')).body
    expect(exact).toMatchObject({ count: 4, total: 4, truncated: false })
    const filtered = (await list('?minScore=75&limit=1')).body
    expect(filtered).toMatchObject({ count: 1, total: 2, truncated: true })
    const none = (await list('?minScore=100')).body
    expect(none).toMatchObject({ count: 0, total: 0, truncated: false })
  })
})

describe('method= filter', () => {
  it('keeps the mints that advertise the method for mint or melt, on any unit', async () => {
    expect(urlsOf((await list('?method=bolt12')).body)).toEqual(['https://b.example.com'])
    expect(urlsOf((await list('?method=bolt11')).body)).toEqual(['https://a.example.com', 'https://b.example.com'])
    expect(urlsOf((await list('?method=onchain')).body)).toEqual(['https://c.example.com'])
    expect(urlsOf((await list('?method=BOLT12')).body)).toEqual(['https://b.example.com'])
  })

  it('melt-only advertising counts', async () => {
    withRows([row('https://a.example.com', { mint_methods: [{ method: 'bolt11', unit: 'sat' }], melt_methods: [{ method: 'bolt12', unit: 'sat' }] })])
    expect(urlsOf((await list('?method=bolt12')).body)).toEqual(['https://a.example.com'])
  })

  it('with unit it must be advertised for that unit; unknown methods never match', async () => {
    withRows([row('https://a.example.com', { units: ['sat', 'usd'], mint_methods: [{ method: 'bolt12', unit: 'usd' }, { method: 'bolt11', unit: 'sat' }], melt_methods: [] })])
    expect(urlsOf((await list('?method=bolt12&unit=usd')).body)).toEqual(['https://a.example.com'])
    expect(urlsOf((await list('?method=bolt12&unit=sat')).body)).toEqual([])
    expect(urlsOf((await list('?method=bolt12')).body)).toEqual(['https://a.example.com'])
    expect(urlsOf((await listWith([row('https://a.example.com', { mint_methods: null, melt_methods: null })], '?method=bolt11')).body)).toEqual([])
  })

  it('anything but bolt11, bolt12 or onchain is a 400', async () => {
    for (const qs of ['?method=', '?method=lightning', '?method=bolt11,bolt12', '?method=bolt11&method=bolt12']) {
      const res = await list(qs)
      expect(res.status, qs).toBe(400)
      expect(res.body.error.code).toBe('invalid_parameter')
    }
  })
})

describe('maxInputFeePpk= filter', () => {
  const feeRows = () => withRows([
    row('https://a.example.com', { keysets_json: [{ id: 'a1', unit: 'sat', active: true, fee: 100, version: 'v1', valid: true }, { id: 'a2', unit: 'sat', active: false, fee: 9000, version: 'v1', valid: true }] }),
    row('https://b.example.com', { keysets_json: [{ id: 'b1', unit: 'sat', active: true, fee: 0, version: 'v1', valid: true }, { id: 'b2', unit: 'usd', active: true, fee: 400, version: 'v1', valid: true }] }),
    row('https://unknown.example.com', { keysets_json: [{ id: 'u1', unit: 'sat', active: true, fee: null, version: 'v1', valid: null }] }),
    row('https://mixed.example.com', { keysets_json: [{ id: 'm1', unit: 'sat', active: true, fee: 50, version: 'v1', valid: true }, { id: 'm2', unit: 'sat', active: true, fee: null, version: 'v1', valid: true }] }),
    row('https://nokeysets.example.com', { keysets_json: [] }),
    row('https://inactive.example.com', { keysets_json: [{ id: 'i1', unit: 'sat', active: false, fee: 0, version: 'v1', valid: true }] }),
  ])

  it('keeps mints whose active keysets in scope all have a known fee at or below the limit (inactive keysets do not count)', async () => {
    feeRows()
    expect(urlsOf((await list('?maxInputFeePpk=100&unit=sat')).body).sort()).toEqual(['https://a.example.com', 'https://b.example.com'])
    expect(urlsOf((await list('?maxInputFeePpk=99&unit=sat')).body)).toEqual(['https://b.example.com'])
    expect(urlsOf((await list('?maxInputFeePpk=0&unit=sat')).body)).toEqual(['https://b.example.com'])
  })

  it('without unit every active keyset must be at or below the limit; with unit only that unit counts', async () => {
    feeRows()
    expect(urlsOf((await list('?maxInputFeePpk=100')).body)).toEqual(['https://a.example.com'])
    expect(urlsOf((await list('?maxInputFeePpk=400')).body).sort()).toEqual(['https://a.example.com', 'https://b.example.com'])
    expect(urlsOf((await list('?maxInputFeePpk=100&unit=usd')).body)).toEqual([])
  })

  it('unknown fees, no active keyset and never-checked mints are excluded', async () => {
    feeRows()
    const got = urlsOf((await list('?maxInputFeePpk=1000000')).body)
    for (const u of ['unknown', 'mixed', 'nokeysets', 'inactive']) expect(got).not.toContain(`https://${u}.example.com`)
    expect(got.sort()).toEqual(['https://a.example.com', 'https://b.example.com'])
  })

  it('the bounds: 0 and 1000000 pass, everything else is a 400', async () => {
    expect((await list('?maxInputFeePpk=0')).status).toBe(200)
    expect((await list('?maxInputFeePpk=1000000')).status).toBe(200)
    for (const qs of ['?maxInputFeePpk=1000001', '?maxInputFeePpk=-1', '?maxInputFeePpk=abc', '?maxInputFeePpk=1.5', '?maxInputFeePpk=', '?maxInputFeePpk=1&maxInputFeePpk=2', '?maxInputFeePpk=99999999']) {
      const res = await list(qs)
      expect(res.status, qs).toBe(400)
      expect(res.body.error.code).toBe('invalid_parameter')
    }
  })
})

describe('single mint: canonical URL', () => {
  const casing = [
    row('https://case.example.com/CashuMint'),
    row('https://dup.example.com/Path'),
    row('https://dup.example.com/PATH'),
    row('https://other.example.com/x'),
  ]

  it('the exact URL: 200 and canonicalUrl null', async () => {
    withRows(casing)
    const res = await one('https://case.example.com/CashuMint')
    expect(res.status).toBe(200)
    expect(res.body.canonicalUrl).toBeNull()
  })

  it('a path that differs only in case and matches exactly one mint: 200 with that mint and canonicalUrl set', async () => {
    withRows(casing)
    for (const asked of ['https://case.example.com/cashumint', 'https://CASE.example.com/CASHUMINT/', 'http://case.example.com/cashuMINT']) {
      const res = await one(asked)
      expect(res.status, asked).toBe(200)
      expect(res.body.mint.url).toBe('https://case.example.com/CashuMint')
      expect(res.body.canonicalUrl).toBe('https://case.example.com/CashuMint')
    }
  })

  it('several candidates, a different host, a different path or no mint: the old 404', async () => {
    withRows(casing)
    for (const asked of ['https://dup.example.com/path', 'https://case.example.com/other', 'https://nope.example.com/cashumint', 'https://other.example.com/y']) {
      const res = await one(asked)
      expect(res.status, asked).toBe(404)
      expect(res.body).toEqual({ error: { code: 'mint_not_found', message: 'No tracked mint has this URL' } })
    }
    expect((await one('https://dup.example.com/Path')).status).toBe(200) // an exact match still wins among look-alikes
  })

  it('canonicalUrl is on the single-mint response only', async () => {
    expect(Object.keys((await list()).body)).not.toContain('canonicalUrl')
    expect((await list()).body.mints[0]).not.toHaveProperty('canonicalUrl')
  })
})

describe('privacy rule and CORS', () => {
  const forbidden = ['ip', 'ipaddress', 'netasn', 'netorg', 'netcountry', 'serverlocation', 'lasterror', 'asn', 'org', 'location', 'hostingorganisation', 'nostrannouncepubkey']
  const keysOf = (v: unknown, out: string[] = []): string[] => {
    if (Array.isArray(v)) v.forEach(x => keysOf(x, out))
    else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k.toLowerCase()); keysOf(x, out) }
    return out
  }

  it('no IP, ASN, hosting organisation, server location or lastError in the list (all includes) or the single-mint answer', async () => {
    for (const res of [await list('?include=facts,keysets,methods,breakdown&includeOffline=true&includeTest=true'), await one('https://a.example.com')]) {
      const ks = keysOf(res.body)
      for (const k of forbidden) expect(ks, k).not.toContain(k)
      const text = JSON.stringify(res.body)
      for (const needle of ['203.0.113.7', 'DigitalOcean', 'Frankfurt', 'ECONNRESET', '14061']) expect(text).not.toContain(needle)
    }
  })

  it('the exposed header list names Deprecation, Sunset and Link on the wallet routes and on the deprecated recommend routes', async () => {
    for (const path of ['/api/wallets/mints', '/api/mints/recommend', '/api/v1/mints/recommend', '/api/v1/wallets/mints']) {
      const res = await request(app).get(path).set('Origin', 'https://example.org')
      const exposed = String(res.headers['access-control-expose-headers']).split(',').map(s => s.trim())
      expect(exposed, path).toEqual(expect.arrayContaining(['Deprecation', 'Sunset', 'Link', 'ETag']))
    }
    const rec = await request(app).get('/api/v1/mints/recommend').set('Origin', 'https://example.org')
    expect(Object.keys(rec.headers)).toEqual(expect.arrayContaining(['deprecation', 'sunset', 'link']))
    const pre = await request(app).options('/api/wallets/mints').set('Origin', 'https://example.org')
    expect(pre.status).toBe(204)
    expect(String(pre.headers['access-control-expose-headers'])).toContain('Deprecation')
  })

  it('/api/mints/known is unchanged: none of the new wallet-only snapshot columns leaks into it', async () => {
    const res = await request(app).get('/api/mints/known')
    const ks = Object.keys(res.body[0])
    for (const k of ['scoreBreakdown', 'keysets', 'downSince', 'probes24h', 'walletExtra', 'keysetsJson', 'score_breakdown']) expect(ks).not.toContain(k)
  })
})
