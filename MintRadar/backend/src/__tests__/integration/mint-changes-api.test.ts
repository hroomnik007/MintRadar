import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// Mint change log on the wire: the wallet API's additive `changes` (single mint always, list only with include=changes plus the
// `changedSince` filter) and the website route GET /api/mints/changes. The pool is mocked at the db.js boundary exactly like
// wallet-api-w2b.test.ts (the snapshot SQL itself runs against Postgres in walletApi.pg.test.ts).

vi.mock('../../db.js', () => ({ pool: { query: vi.fn() }, initDb: vi.fn() }))
vi.mock('../../versionCatalog.js', () => ({
  getLatestVersionsMap: vi.fn().mockResolvedValue({ nutshell: { major: 0, minor: 21 }, cdk: { major: 0, minor: 18 } }),
}))

let app: Express
let query: ReturnType<typeof vi.fn>

const DAY = 86_400_000
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString()

const change = (i: number, daysAgo: number, o: Record<string, unknown> = {}) => ({
  type: 'motd_changed', field: 'motd', old: `old ${i}`, new: `new ${i}`, observed: ago(daysAgo), first: ago(daysAgo + 0.01), ...o,
})

function row(url: string, o: Record<string, unknown> = {}) {
  return {
    url, name: 'Mint', icon_url: null, version: 'Nutshell/0.21.0', nut_count: 12, nuts_limits: { '4': {}, '5': {} }, units: ['sat'],
    mint_methods: null, melt_methods: null, pubkey: null, audit_cz_total: null, audit_cz_blamed: null, audit_cz_fetched_at: null,
    discovered_at: ago(200), last_reliability_score: 90, last_error: null, has_onion: false, review_count: 0, review_avg_rating: null,
    review_rated_count: 0, review_operator_count: 0, total: 288, online_count: 288, total_7d: 2016, online_count_7d: 2016,
    latest_online: true, latest_latency_ms: 100, latest_checked_at: ago(0.001), last_online_at: ago(0.001),
    score_breakdown: null, keysets_checked_at: null, keysets_json: null, down_since: null, changes_json: null, ...o,
  }
}

const MANY = Array.from({ length: 60 }, (_, i) => change(i, 0.01 * (i + 1)))
const ROWS = [
  row('https://history.example.com', { changes_json: [change(1, 1, { type: 'input_fee_changed', field: 'input_fee', old: 'sat: 0 ppk', new: 'sat: 100 ppk' }), change(2, 40)] }),
  row('https://none.example.com', { last_reliability_score: 80, changes_json: null }),
  row('https://many.example.com', { last_reliability_score: 70, changes_json: MANY.slice(0, 50) }),
  row('https://old.example.com', { last_reliability_score: 60, changes_json: [change(3, 100)] }),
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
const by = (body: { mints: Array<{ url: string }> }, u: string) => body.mints.find(m => m.url === u) as Record<string, unknown> & { changes?: unknown[] }
const urls = (body: { mints: Array<{ url: string }> }) => body.mints.map(m => m.url).sort()

describe('wallet API: changes', () => {
  it('the DEFAULT list has no `changes` key at all (its shape did not change)', async () => {
    const res = await list()
    expect(res.status).toBe(200)
    for (const m of res.body.mints) expect(Object.keys(m), m.url).not.toContain('changes')
    expect(Object.keys(res.body).sort()).toEqual(['count', 'generatedAt', 'methodology', 'mints', 'total', 'truncated'])
    // other include values do not add it either
    for (const inc of ['facts', 'keysets', 'methods', 'breakdown', 'facts,keysets,methods,breakdown']) {
      for (const m of (await list('?include=' + inc)).body.mints) expect(Object.keys(m), inc).not.toContain('changes')
    }
  })

  it('the single-mint endpoint ALWAYS carries `changes`: newest first, {type, field, oldValue, newValue, observedAt, firstSeenAt}', async () => {
    const m = (await one('https://history.example.com')).body.mint
    expect(m.changes).toHaveLength(2)
    expect(m.changes[0]).toEqual({
      type: 'input_fee_changed', field: 'input_fee', oldValue: 'sat: 0 ppk', newValue: 'sat: 100 ppk',
      observedAt: ROWS[0]!.changes_json![0]!.observed, firstSeenAt: ROWS[0]!.changes_json![0]!.first,
    })
    expect(Object.keys(m.changes[0]).sort()).toEqual(['field', 'firstSeenAt', 'newValue', 'observedAt', 'oldValue', 'type'])
    expect(m.changes[0].observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(Date.parse(m.changes[0].observedAt)).toBeGreaterThan(Date.parse(m.changes[1].observedAt))
  })

  it('zero changes is an empty array, never null or missing; a mint with 50 stored changes returns all 50', async () => {
    expect((await one('https://none.example.com')).body.mint.changes).toEqual([])
    expect((await one('https://many.example.com')).body.mint.changes).toHaveLength(50)
  })

  it('include=changes adds the array to every list object, capped at 10 per mint', async () => {
    const res = await list('?include=changes')
    expect(by(res.body, 'https://many.example.com').changes).toHaveLength(10)
    expect(by(res.body, 'https://history.example.com').changes).toHaveLength(2)
    expect(by(res.body, 'https://none.example.com').changes).toEqual([])
    // the 10 are the NEWEST 10
    expect((by(res.body, 'https://many.example.com').changes as Array<{ newValue: string }>).map(c => c.newValue)).toEqual(MANY.slice(0, 10).map(c => c.new))
  })

  it('changedSince keeps only mints with a confirmed change after that time (ISO, bare date or UNIX seconds)', async () => {
    const day = (n: number) => new Date(Date.now() - n * DAY).toISOString()
    expect(urls((await list('?changedSince=' + encodeURIComponent(day(2)))).body)).toEqual(['https://history.example.com', 'https://many.example.com'])
    expect(urls((await list('?changedSince=' + encodeURIComponent(day(50)))).body)).toEqual(['https://history.example.com', 'https://many.example.com'])
    expect(urls((await list('?changedSince=' + encodeURIComponent(day(150)))).body)).toEqual(['https://history.example.com', 'https://many.example.com', 'https://old.example.com'])
    const unix = Math.floor((Date.now() - 2 * DAY) / 1000)
    expect(urls((await list('?changedSince=' + unix)).body)).toEqual(['https://history.example.com', 'https://many.example.com'])
    expect(urls((await list('?changedSince=2999-01-01')).body)).toEqual([])
    // the default list is not filtered, and `changes` does not appear just because the filter is used
    expect(by((await list('?changedSince=' + unix)).body, 'https://history.example.com')).not.toHaveProperty('changes')
  })

  it('total and truncated count the changedSince matches; limit still cuts', async () => {
    const since = encodeURIComponent(new Date(Date.now() - 2 * DAY).toISOString())
    const res = await list(`?changedSince=${since}&limit=1`)
    expect(res.body).toMatchObject({ count: 1, total: 2, truncated: true })
  })

  it.each(['yesterday', '2026-13-45', '2026-10-20T12:00:00', '12345', '1234567890123456', 'NaN', '-1', '2026-10-20T12:00:00Z&changedSince=2026-10-21'])(
    'an invalid changedSince (%s) is a 400 invalid_parameter in the existing error shape', async (v) => {
      const res = await list('?changedSince=' + (v.includes('&') ? v : encodeURIComponent(v)))
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ error: { code: 'invalid_parameter', message: expect.stringContaining('changedSince') } })
    })

  it('an empty changedSince is a 400 too', async () => {
    expect((await list('?changedSince=')).status).toBe(400)
  })
})

describe('GET /api/mints/changes (website route)', () => {
  const get = (url?: string) => request(app).get('/api/mints/changes').query(url === undefined ? {} : { url })
  function stub(known: boolean) {
    query.mockImplementation(async (sql: string) => {
      if (/SELECT 1 FROM mints WHERE url/.test(sql)) return { rows: known ? [{ '?column?': 1 }] : [], rowCount: known ? 1 : 0 }
      if (/FROM mint_changes WHERE url/.test(sql)) {
        return { rows: [{ change_type: 'pubkey_changed', field: 'pubkey', old_value: 'aa', new_value: 'bb', observed_at: new Date('2026-10-20T12:00:00Z'), first_seen_at: new Date('2026-10-20T11:55:00Z') }] }
      }
      if (/FROM mint_change_state/.test(sql)) return { rows: [{ tracking_since: new Date('2026-10-20T08:00:00Z') }] }
      return { rows: [], rowCount: 0 }
    })
  }

  it('400 for a missing or malformed url, 404 for a mint that is not tracked', async () => {
    stub(false)
    expect((await get()).status).toBe(400)
    expect((await get('http://mint.example.com')).status).toBe(400)
    expect((await get('https://localhost')).status).toBe(400)
    expect((await get('https://' + 'a'.repeat(3000) + '.example.com')).status).toBe(400)
    expect((await get('https://unknown.example.com')).status).toBe(404)
  })

  it('200: url, trackingSince and the changes with ISO times, cacheable like the other shared-data routes', async () => {
    stub(true)
    const res = await get('https://mint.example.com')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      url: 'https://mint.example.com', trackingSince: '2026-10-20T08:00:00.000Z',
      changes: [{ type: 'pubkey_changed', field: 'pubkey', oldValue: 'aa', newValue: 'bb', observedAt: '2026-10-20T12:00:00.000Z', firstSeenAt: '2026-10-20T11:55:00.000Z' }],
    })
    expect(res.headers['cache-control']).toBe('public, max-age=60')
    expect(res.headers['etag']).toBeTruthy()
  })

  it('a database error is a plain 500 without details', async () => {
    query.mockRejectedValue(new Error('boom: secret'))
    const res = await get('https://mint.example.com')
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('secret')
  })

  it('is a website route: a foreign Origin gets the JSON 403 (it is not on the public CORS list), no Origin works', async () => {
    stub(true)
    const foreign = await request(app).get('/api/mints/changes').query({ url: 'https://mint.example.com' }).set('Origin', 'https://evil.example')
    expect(foreign.status).toBe(403)
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined()
    expect((await get('https://mint.example.com')).status).toBe(200)
  })

  it('is on the read-only per-IP limit (150/min): the 151st request is a 429', async () => {
    stub(true)
    let last = 200
    for (let i = 0; i < 151; i++) last = (await get('https://mint.example.com')).status
    expect(last).toBe(429)
  })
})
