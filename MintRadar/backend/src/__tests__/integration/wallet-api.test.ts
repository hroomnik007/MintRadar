import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { METHODOLOGY_VERSION } from '../../shared/methodology.js'

// Wallet API v1 (/api/wallets/*, docs/API.md): the contract (exact key sets, envelope), the filters and the
// default exclusions, ordering, the single-mint endpoint, caching (Cache-Control + strong ETag on hit and miss,
// 304), CORS (any origin on the public read routes, JSON 403 elsewhere), JSON errors and both rate limiters.
// The pool is mocked at the db.js boundary; the real middleware stack and route handlers run.

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))
vi.mock('../../versionCatalog.js', () => ({
  getLatestVersionsMap: vi.fn().mockResolvedValue({ nutshell: { major: 0, minor: 21 }, cdk: { major: 0, minor: 18 } }),
}))

let app: Express
let query: ReturnType<typeof vi.fn>

const DAY = 86_400_000
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString()
const FOREIGN = 'https://example.org'

/** A row as returned by the /api/mints/known SQL projection (an online, mature, scored mint by default). */
function row(url: string, o: Record<string, unknown> = {}) {
  return {
    url,
    name: 'Mint ' + url.slice(8, 9).toUpperCase(),
    icon_url: 'https://icons.example/' + url.slice(8, 9) + '.png',
    version: 'Nutshell/0.21.0',
    nut_count: 12,
    tos_url: 'https://contact.example/tos',
    description_long: 'Write to operator@example.com or +1 555 0100',
    nuts_limits: { '4': {}, '5': {}, '7': {} },
    units: ['sat'],
    mint_methods: null,
    melt_methods: null,
    pubkey: '02' + 'ab'.repeat(32),
    audit_cz_total: 104,
    audit_cz_blamed: 2,
    audit_cz_fetched_at: new Date(ago(0.1)),
    discovered_at: ago(200),
    last_reliability_score: 90,
    last_error: 'ECONNRESET 203.0.113.7',
    server_location: 'Frankfurt am Main, DE',
    ip_address: '203.0.113.7',
    net_asn: 14061,
    net_org: 'DigitalOcean, LLC',
    net_country: 'US',
    has_onion: true,
    review_count: 12,
    review_avg_rating: 4.5,
    review_rated_count: 10,
    review_operator_count: 1,
    nostr_announce_pubkey: 'cd'.repeat(32),
    total: 288,
    online_count: 288,
    total_7d: 2016,
    online_count_7d: 2016,
    latest_online: true,
    latest_latency_ms: 120,
    latest_checked_at: ago(0.001),
    last_online_at: ago(0.001),
    ...o,
  }
}

const ROWS = [
  row('https://a.example.com', { last_reliability_score: 90, online_count_7d: 2016 }),
  row('https://b.example.com', { last_reliability_score: 90, online_count_7d: 1900, name: 'Bravo' }),
  row('https://c.example.com', { last_reliability_score: 80, units: ['sat', 'usd'], nuts_limits: { '4': {}, '5': {}, '7': {}, '8': {} } }),
  row('https://new.example.com', { last_reliability_score: 70, discovered_at: ago(5) }),
  row('https://offline.example.com', { last_reliability_score: 60, latest_online: false, online_count: 280, last_online_at: ago(0.2) }),
  row('https://degraded.example.com', { last_reliability_score: 20, latest_online: false, online_count: 0, last_online_at: ago(3) }),
  row('https://archived.example.com', { last_reliability_score: 10, latest_online: false, online_count: 0, last_online_at: ago(60), latest_checked_at: ago(0.001) }),
  row('https://testnut.cashu.space', { last_reliability_score: 99 }),
  row('https://unscored.example.com', { last_reliability_score: null }),
]

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  query.mockResolvedValue({ rows: ROWS })
  ;({ app } = await import('../../index.js'))
})

const urls = (body: { mints: Array<{ url: string }> }) => body.mints.map(m => m.url)
const list = (qs = '') => request(app).get('/api/wallets/mints' + qs)

// The keys of the 2026-10-20 additive fields are in W2B_LIGHT_KEYS (every object) and W2B_HEAVY_KEYS (include= / single mint).
const V1_KEYS = [
  'audit', 'eligibleForRecommendation', 'isTest', 'lastCheckedAt', 'name', 'nuts', 'outdated', 'reviews', 'score',
  'scoreCappedNew', 'software', 'status', 'units', 'uptime24hPct', 'uptime7dPct', 'url',
]
const W2B_LIGHT_KEYS = ['auditNeutralReason', 'authRequired', 'downSince', 'hasOnion']
const W2B_HEAVY_KEYS = ['changes', 'contactChecks', 'firstSeenAt', 'keysets', 'keysetsCheckedAt', 'lastOnlineAt', 'methods', 'pubkey', 'sample', 'scoreBreakdown']
const MINT_KEYS = [...V1_KEYS, ...W2B_LIGHT_KEYS].sort()
const MINT_KEYS_FULL = [...MINT_KEYS, ...W2B_HEAVY_KEYS].sort()

function allKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach(x => allKeys(x, out))
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); allKeys(x, out) }
  return out
}

describe('contract', () => {
  it('list envelope and the exact mint key set', async () => {
    const res = await list('?includeTest=true&includeOffline=true&includeArchived=true&includeUnscored=true')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(Object.keys(res.body).sort()).toEqual(['count', 'generatedAt', 'methodology', 'mints', 'total', 'truncated'])
    expect(res.body.methodology).toBe(METHODOLOGY_VERSION)
    expect(Number.isInteger(res.body.methodology)).toBe(true)
    expect(new Date(res.body.generatedAt).toISOString()).toBe(res.body.generatedAt)
    expect(res.body.count).toBe(res.body.mints.length)
    expect(res.body.count).toBe(ROWS.length)
    for (const m of res.body.mints) {
      expect(Object.keys(m).sort()).toEqual(MINT_KEYS)
      if (m.audit !== null) expect(Object.keys(m.audit).sort()).toEqual(['attributedFailures', 'fetchedAt', 'swaps7d'])
      expect(Object.keys(m.reviews).sort()).toEqual(['avg', 'count', 'operatorCount', 'ratedCount'])
    }
  })

  it('value types of a typical mint', async () => {
    const m = (await list('?unit=sat')).body.mints.find((x: { url: string }) => x.url === 'https://a.example.com')
    expect(m).toMatchObject({
      url: 'https://a.example.com', name: 'Mint A', status: 'online', score: 90, scoreCappedNew: false,
      uptime24hPct: 100, uptime7dPct: 100, units: ['sat'], nuts: ['4', '5', '7'], software: 'Nutshell/0.21.0',
      outdated: false, isTest: false, eligibleForRecommendation: true,
      reviews: { count: 12, ratedCount: 10, avg: 4.5, operatorCount: 1 },
    })
    expect(m.audit).toEqual({ swaps7d: 104, attributedFailures: 2, fetchedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) })
    expect(m.lastCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
  })

  it('carries no IP, network, onion, key, contact or review-text data, by key or by value', async () => {
    const res = await list('?includeTest=true&includeOffline=true&includeArchived=true&includeUnscored=true')
    // Since 2026-10-20 the object carries the mint's public NUT-06 `pubkey` and the boolean `hasOnion` (and nothing else of these kinds).
    const forbiddenKeys = ['ip', 'ipaddress', 'netasn', 'netorg', 'netcountry', 'onion', 'onionaddress', 'nostrannouncepubkey',
      'content', 'text', 'contact', 'tosurl', 'descriptionlong', 'serverlocation', 'lasterror', 'iconurl', 'reviewer', 'author', 'asn', 'org', 'location']
    for (const k of allKeys(res.body)) {
      expect(forbiddenKeys, `key ${k}`).not.toContain(k.toLowerCase())
      if (!['pubkey', 'hasonion'].includes(k.toLowerCase())) expect(k.toLowerCase(), `key ${k}`).not.toMatch(/pubkey|onion|contact|^net[A-Z]?/i)
    }
    const text = JSON.stringify(res.body)
    for (const needle of ['203.0.113.7', 'operator@example.com', 'DigitalOcean', 'Frankfurt', 'ECONNRESET', 'cd'.repeat(32), 'icons.example']) {
      expect(text).not.toContain(needle)
    }
  })

  it('/api/mints/known keeps its shape (key snapshot)', async () => {
    const res = await request(app).get('/api/mints/known')
    expect(res.status).toBe(200)
    expect(Object.keys(res.body[0]).sort()).toMatchInlineSnapshot(`
      [
        "archived",
        "auditAvgTimeMs",
        "auditCheckedAt",
        "auditCzBlamed",
        "auditCzFetchedAt",
        "auditCzTotal",
        "auditNErrors",
        "auditNMelts",
        "auditNMints",
        "auditRecentErrors",
        "auditRecentTotal",
        "auditSyncedAt",
        "degraded",
        "descriptionLong",
        "discoveredAt",
        "hasOnion",
        "iconUrl",
        "ipAddress",
        "lastCheckedAt",
        "lastError",
        "lastKeysets",
        "lastKeysetsCheckedAt",
        "lastOnlineAt",
        "latencyMs",
        "meltMethods",
        "mintMethods",
        "name",
        "netAsn",
        "netCountry",
        "netOrg",
        "nostrAnnounceD",
        "nostrAnnounceId",
        "nostrAnnouncePubkey",
        "nostrAnnouncedAt",
        "nutCount",
        "nutsLimits",
        "offlineSince",
        "online",
        "operatorReviewCount",
        "pubkey",
        "reliabilityScore",
        "reviewAvgRating",
        "reviewCount",
        "reviewRatedCount",
        "reviewSurge",
        "reviewWeightedRating",
        "serverLocation",
        "softwareLatest",
        "tosUrl",
        "units",
        "uptimePct24h",
        "uptimePct7d",
        "url",
        "version",
      ]
    `)
  })
})

describe('status, flags and fields', () => {
  it('derives status, isTest, scoreCappedNew, eligibility and outdated', async () => {
    const res = await list('?includeTest=true&includeOffline=true&includeArchived=true&includeUnscored=true&limit=200')
    const by = Object.fromEntries(res.body.mints.map((m: { url: string }) => [m.url, m]))
    expect(by['https://offline.example.com'].status).toBe('offline')
    expect(by['https://degraded.example.com'].status).toBe('degraded')
    expect(by['https://archived.example.com'].status).toBe('archived')
    expect(by['https://testnut.cashu.space']).toMatchObject({ isTest: true, eligibleForRecommendation: false, status: 'online' })
    expect(by['https://new.example.com']).toMatchObject({ scoreCappedNew: true, eligibleForRecommendation: false })
    expect(by['https://unscored.example.com']).toMatchObject({ score: null, eligibleForRecommendation: false })
    expect(by['https://a.example.com']).toMatchObject({ scoreCappedNew: false, eligibleForRecommendation: true })
    expect(by['https://offline.example.com'].eligibleForRecommendation).toBe(false)
    expect(by['https://archived.example.com'].eligibleForRecommendation).toBe(false)
  })

  it('outdated follows the shared version rule; unknown or missing software is null', async () => {
    query.mockResolvedValue({
      rows: [
        row('https://a.example.com', { version: 'Nutshell/0.19.0' }),
        row('https://b.example.com', { version: 'Nutshell/0.20.9' }),
        row('https://c.example.com', { version: 'SomethingElse/1.2.3' }),
        row('https://d.example.com', { version: null }),
      ],
    })
    const res = await list()
    const by = Object.fromEntries(res.body.mints.map((m: { url: string; outdated: boolean | null }) => [m.url, m.outdated]))
    expect(by).toEqual({
      'https://a.example.com': true, 'https://b.example.com': false, 'https://c.example.com': null, 'https://d.example.com': null,
    })
  })

  it('audit is null unless total, attributed failures and fetch time are all there; nuts null without nutsLimits', async () => {
    query.mockResolvedValue({ rows: [row('https://a.example.com', { audit_cz_blamed: null, nuts_limits: null })] })
    const m = (await list()).body.mints[0]
    expect(m.audit).toBeNull()
    expect(m.nuts).toBeNull()
  })

  it('attributedFailures never exceeds swaps7d', async () => {
    query.mockResolvedValue({ rows: [row('https://a.example.com', { audit_cz_total: 12, audit_cz_blamed: 30 })] })
    const m = (await list()).body.mints[0]
    expect(m.audit).toMatchObject({ swaps7d: 12, attributedFailures: 12 })
  })

  it('name is the cleaned display name and honours the hidden-names list (null = show the hostname)', async () => {
    const names = await import('../../mintNames.js')
    names._setHiddenMintNamesForTest(new Map([['https://b.example.com', 'test']]))
    query.mockResolvedValue({
      rows: [row('https://a.example.com', { name: '  Spaced​   Name  ' }), row('https://b.example.com', { name: 'Secret' })],
    })
    const by = Object.fromEntries((await list()).body.mints.map((m: { url: string; name: string | null }) => [m.url, m.name]))
    expect(by['https://a.example.com']).toBe('Spaced Name')
    expect(by['https://b.example.com']).toBeNull()
    expect(JSON.stringify(by)).not.toContain('Secret')
  })
})

describe('list filters', () => {
  it('default: no test, offline, degraded, archived or unscored mints; unit filter optional', async () => {
    const res = await list()
    expect(urls(res.body)).toEqual(['https://a.example.com', 'https://b.example.com', 'https://c.example.com', 'https://new.example.com'])
    expect(res.body.count).toBe(4)
  })

  it('include* flags add them back; includeArchived alone is enough for archived', async () => {
    expect(urls((await list('?includeTest=true')).body)).toContain('https://testnut.cashu.space')
    expect(urls((await list('?includeOffline=true')).body)).toEqual(expect.arrayContaining(['https://offline.example.com', 'https://degraded.example.com']))
    expect(urls((await list('?includeOffline=true')).body)).not.toContain('https://archived.example.com')
    expect(urls((await list('?includeArchived=true')).body)).toContain('https://archived.example.com')
    expect(urls((await list('?includeUnscored=true')).body)).toContain('https://unscored.example.com')
  })

  it('unit, minScore and limit', async () => {
    expect(urls((await list('?unit=usd')).body)).toEqual(['https://c.example.com'])
    expect(urls((await list('?unit=USD')).body)).toEqual(['https://c.example.com'])
    expect(urls((await list('?unit=eur')).body)).toEqual([])
    expect(urls((await list('?minScore=85')).body)).toEqual(['https://a.example.com', 'https://b.example.com'])
    expect(urls((await list('?minScore=0&includeUnscored=true')).body)).not.toContain('https://unscored.example.com')
    expect((await list('?limit=2')).body.count).toBe(2)
  })

  it('orders by score desc (nulls last), then uptime7dPct desc, then name', async () => {
    const res = await list('?includeTest=true&includeOffline=true&includeArchived=true&includeUnscored=true')
    expect(urls(res.body)).toEqual([
      'https://testnut.cashu.space', 'https://a.example.com', 'https://b.example.com', 'https://c.example.com',
      'https://new.example.com', 'https://offline.example.com', 'https://degraded.example.com', 'https://archived.example.com',
      'https://unscored.example.com',
    ])
  })

  it('ties on score and uptime break by name (case-insensitive, the hostname when the name is null)', async () => {
    query.mockResolvedValue({
      rows: [row('https://z.example.com', { name: 'Alpha' }), row('https://y.example.com', { name: 'beta' }), row('https://a-host.example.com', { name: null }), row('https://q.example.com', { name: 'Zed' })],
    })
    expect(urls((await list('?minScore=1')).body)).toEqual([
      'https://a-host.example.com', 'https://z.example.com', 'https://y.example.com', 'https://q.example.com',
    ])
  })

  it('invalid values give 400 in the new error shape; unknown parameters are ignored', async () => {
    for (const qs of ['?unit=', '?unit=a%20b', '?unit=x&unit=y', '?minScore=101', '?minScore=-1', '?minScore=abc', '?includeTest=yes',
      '?includeOffline=1', '?limit=0', '?limit=201', '?limit=abc', '?limit=1.5']) {
      const res = await list(qs)
      expect(res.status, qs).toBe(400)
      expect(res.body, qs).toEqual({ error: { code: 'invalid_parameter', message: expect.any(String) } })
    }
    expect((await list('?foo=bar&sort=score')).status).toBe(200)
  })
})

describe('GET /api/wallets/mints/:url', () => {
  const one = (path: string) => request(app).get('/api/wallets/mints/' + path)

  it('returns the envelope with one mint for a percent-encoded url', async () => {
    const res = await one(encodeURIComponent('https://a.example.com'))
    expect(res.status).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['canonicalUrl', 'generatedAt', 'methodology', 'mint'])
    expect(res.body.canonicalUrl).toBeNull()
    expect(res.body.methodology).toBe(METHODOLOGY_VERSION)
    expect(Object.keys(res.body.mint).sort()).toEqual(MINT_KEYS_FULL)
    expect(res.body.mint.url).toBe('https://a.example.com')
  })

  it('normalises a trailing slash, an uppercase host and http to the stored url; also works unencoded and via /api/v1', async () => {
    for (const p of [
      encodeURIComponent('https://A.Example.COM/'), encodeURIComponent('http://a.example.com'), 'https://a.example.com',
      encodeURIComponent('https://a.example.com/'),
    ]) {
      const res = await one(p)
      expect(res.status, p).toBe(200)
      expect(res.body.mint.url).toBe('https://a.example.com')
    }
    expect((await request(app).get('/api/v1/wallets/mints/' + encodeURIComponent('https://a.example.com'))).status).toBe(200)
  })

  it('serves a test, archived or offline mint when asked for by url (status tells them apart)', async () => {
    expect((await one(encodeURIComponent('https://testnut.cashu.space'))).body.mint.isTest).toBe(true)
    expect((await one(encodeURIComponent('https://archived.example.com'))).body.mint.status).toBe('archived')
  })

  it('400 for a malformed url, 404 for an unknown mint, in the new error shape', async () => {
    for (const p of ['not-a-url', encodeURIComponent('https://127.0.0.1'), encodeURIComponent('https://localhost'), '%E0%A4%A', encodeURIComponent('https://')]) {
      const res = await one(p)
      expect(res.status, p).toBe(400)
      expect(res.headers['content-type'], p).toMatch(/application\/json/)
      expect(res.body, p).toEqual({ error: { code: 'invalid_url', message: expect.any(String) } })
    }
    const nf = await one(encodeURIComponent('https://unknown.example.com'))
    expect(nf.status).toBe(404)
    expect(nf.body).toEqual({ error: { code: 'mint_not_found', message: expect.any(String) } })
  })

  it('400 invalid_url (never 404) for a scheme other than http or https, however it is written', async () => {
    const enc = encodeURIComponent
    const bad: Array<[string, string]> = [
      ['ftp', enc('ftp://a.example.com')],
      ['ftp, uppercase', enc('FTP://a.example.com')],
      ['ws', enc('ws://a.example.com')],
      ['wss', enc('wss://a.example.com')],
      ['file', enc('file:///etc/passwd')],
      ['javascript', enc('javascript:alert(1)')],
      ['data', enc('data:text/html,<script>alert(1)</script>')],
      ['unencoded ftp', 'ftp://a.example.com'],
      ['leading blanks', enc('  ftp://a.example.com')],
      ['empty (blank)', '%20'],
      ['empty (NUL)', '%00'],
      ['very long host', enc('https://' + 'a'.repeat(600) + '.example.com')],
      ['very long path', enc('https://a.example.com/' + 'x'.repeat(5000))],
      ['very long junk', 'x'.repeat(6000)],
      ['double-encoded https', enc(enc('https://a.example.com'))],
      ['double-encoded ftp', enc(enc('ftp://a.example.com'))],
    ]
    for (const [label, p] of bad) {
      const res = await one(p)
      expect(res.status, label).toBe(400)
      expect(res.headers['content-type'], label).toMatch(/application\/json/)
      expect(res.body, label).toEqual({ error: { code: 'invalid_url', message: expect.any(String) } })
    }
    // http:// is still normalised to the stored https:// url, and an https:// url with no such mint is still a 404
    const http = await one(enc('http://a.example.com'))
    expect(http.status).toBe(200)
    expect(http.body.mint.url).toBe('https://a.example.com')
    expect((await one(enc('HTTPS://A.EXAMPLE.COM'))).status).toBe(200)
    expect((await one(enc('https://unknown.example.com'))).status).toBe(404)
  })

  it('an unknown route below /api/wallets is a JSON 404', async () => {
    const res = await request(app).get('/api/wallets/nothing')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('not_found')
  })

  it('a mint without a trailing-slash twin: GET /api/wallets/mints/ (empty) is the list', async () => {
    const res = await request(app).get('/api/wallets/mints/')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.mints)).toBe(true)
  })
})

describe('one shared computation', () => {
  it('makes one database read for /known, the list, a single mint and several parameters', async () => {
    await request(app).get('/api/mints/known')
    await list()
    await list('?unit=usd')
    await request(app).get('/api/wallets/mints/' + encodeURIComponent('https://a.example.com'))
    await Promise.all([list(), list('?minScore=50'), request(app).get('/api/mints/known')])
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('concurrent first requests join one read', async () => {
    await Promise.all([list(), list('?unit=usd'), request(app).get('/api/mints/known'), list('?limit=3')])
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('a failing read is a JSON 500 on the wallet routes and does not leak the error', async () => {
    query.mockReset()
    query.mockRejectedValue(new Error('connection refused at 10.0.0.5'))
    const res = await list()
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: { code: 'internal_error', message: 'Internal server error' } })
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5')
  })
})

describe('caching', () => {
  it('Cache-Control and a strong ETag on a miss and on a hit; If-None-Match gives 304 with the same headers', async () => {
    const miss = await list('?unit=sat')
    const hit = await list('?unit=sat')
    expect(query).toHaveBeenCalledTimes(1)
    for (const r of [miss, hit]) {
      expect(r.headers['cache-control']).toBe('public, max-age=300')
      expect(r.headers['etag']).toMatch(/^"[0-9a-f]{32}"$/)
      expect(r.headers['vary']).toBeUndefined()
    }
    expect(hit.headers['etag']).toBe(miss.headers['etag'])
    expect(hit.body).toEqual(miss.body)

    const nm = await list('?unit=sat').set('If-None-Match', miss.headers['etag'] as string)
    expect(nm.status).toBe(304)
    expect(nm.headers['cache-control']).toBe('public, max-age=300')
    expect(nm.headers['etag']).toBe(miss.headers['etag'])
    expect(nm.headers['access-control-allow-origin']).toBe('*')
    expect(nm.text).toBe('')

    const other = await list('?unit=usd')
    expect(other.headers['etag']).not.toBe(miss.headers['etag'])
    const stale = await list('?unit=sat').set('If-None-Match', '"something-else"')
    expect(stale.status).toBe(200)
  })

  it('the single mint is cached the same way', async () => {
    const p = '/api/wallets/mints/' + encodeURIComponent('https://a.example.com')
    const r = await request(app).get(p)
    expect(r.headers['cache-control']).toBe('public, max-age=300')
    const nm = await request(app).get(p).set('If-None-Match', r.headers['etag'] as string)
    expect(nm.status).toBe(304)
  })

  it('errors are not cached publicly', async () => {
    expect((await list('?limit=0')).headers['cache-control']).toBeUndefined()
  })
})

describe('CORS', () => {
  const PUBLIC = ['/api/wallets/mints', '/api/wallets/mints/' + encodeURIComponent('https://a.example.com'), '/api/mints/recommend', '/health',
    '/api/v1/wallets/mints', '/api/v1/mints/recommend', '/api/v1/health']

  it.each(PUBLIC)('%s answers a foreign origin with * and exposes the headers', async (path) => {
    query.mockResolvedValue({ rows: ROWS })
    const res = await request(app).get(path).set('Origin', FOREIGN)
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['access-control-allow-credentials']).toBeUndefined()
    expect(res.headers['access-control-expose-headers']).toBe('ETag, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Deprecation, Sunset, Link')
  })

  it('HEAD works with * too', async () => {
    const res = await request(app).head('/api/wallets/mints').set('Origin', FOREIGN)
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('*')
  })

  it.each(['/api/wallets/mints', '/api/mints/recommend', '/health', '/api/v1/wallets/mints'])('preflight on %s is a 204', async (path) => {
    const res = await request(app).options(path).set('Origin', FOREIGN).set('Access-Control-Request-Method', 'GET').set('Access-Control-Request-Headers', 'If-None-Match')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['access-control-allow-methods']).toBe('GET, HEAD, OPTIONS')
    expect(res.headers['access-control-allow-headers']).toBe('If-None-Match')
    expect(res.headers['access-control-allow-credentials']).toBeUndefined()
    expect(res.text).toBe('')
    expect(query).not.toHaveBeenCalled()
  })

  it('a preflight asking for odd header names gets the default list', async () => {
    const res = await request(app).options('/api/wallets/mints').set('Origin', FOREIGN).set('Access-Control-Request-Headers', 'x bad;header')
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type, If-None-Match')
  })

  it.each(['/api', '/api/stats', '/api/mints/known', '/api/v1/mints/known', '/api/mints/history?url=https://a.example.com', '/api/mint/probe?url=https://a.example.com', '/api/nuts', '/sitemap.xml'])(
    'restricted GET %s with a foreign origin is a JSON 403', async (path) => {
      const res = await request(app).get(path).set('Origin', FOREIGN)
      expect(res.status).toBe(403)
      expect(res.headers['content-type']).toMatch(/application\/json/)
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
      expect(res.body).toEqual({ error: { code: 'cors_forbidden', message: expect.any(String) } })
    })

  it.each([
    ['post', '/api/mint/submit'], ['post', '/api/mints/discover'], ['post', '/api/notifications/subscribe'], ['post', '/api/notifications/unsubscribe'],
    ['post', '/api/wallets/mints'], ['options', '/api/mint/submit'],
  ] as const)('restricted %s %s with a foreign origin is a JSON 403 and nothing runs', async (method, path) => {
    const res = await request(app)[method](path).set('Origin', FOREIGN)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('cors_forbidden')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('the app\'s own origin and requests without an Origin keep working on restricted routes', async () => {
    const own = await request(app).get('/api').set('Origin', 'https://mintradar.org')
    expect(own.status).toBe(200)
    expect(own.headers['access-control-allow-origin']).toBe('https://mintradar.org')
    expect((await request(app).get('/api')).status).toBe(200)
    const pre = await request(app).options('/api/mint/submit').set('Origin', 'https://mintradar.org').set('Access-Control-Request-Method', 'POST')
    expect(pre.headers['access-control-allow-origin']).toBe('https://mintradar.org')
  })
})

describe('rate limits', () => {
  it('/api/wallets/* has its own 300/min per-IP limit with X-RateLimit-* and a 429 with Retry-After', async () => {
    const ip = '198.51.100.20'
    const get = () => request(app).get('/api/wallets/mints').set('X-Forwarded-For', ip)
    const first = await get()
    expect(first.headers['x-ratelimit-limit']).toBe('300')
    expect(first.headers['x-ratelimit-remaining']).toBe('299')
    expect(Number(first.headers['x-ratelimit-reset'])).toBeGreaterThan(Date.now() / 1000)
    for (let i = 1; i < 300; i++) expect((await get()).status).toBe(200)
    const blocked = await get().set('Origin', FOREIGN)
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: { code: 'rate_limited', message: expect.any(String), retryAfterSec: expect.any(Number) } })
    const ra = Number(blocked.headers['retry-after'])
    expect(ra).toBeGreaterThanOrEqual(1)
    expect(ra).toBeLessThanOrEqual(60)
    expect(blocked.body.error.retryAfterSec).toBe(ra)
    expect(blocked.headers['access-control-allow-origin']).toBe('*') // a browser wallet can read the 429
    // another IP and the 60/min limiter are unaffected
    expect((await request(app).get('/api/wallets/mints').set('X-Forwarded-For', '198.51.100.21')).status).toBe(200)
    expect((await request(app).get('/api').set('X-Forwarded-For', ip)).status).toBe(200)
  }, 60_000)

  it('the general 60/min limiter keeps its shape and now sends Retry-After', async () => {
    const ip = '198.51.100.30'
    const get = () => request(app).get('/api').set('X-Forwarded-For', ip)
    for (let i = 0; i < 60; i++) expect((await get()).status).toBe(200)
    const blocked = await get()
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many requests' })
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect(blocked.headers['x-ratelimit-limit']).toBe('60')
    expect(blocked.headers['x-ratelimit-remaining']).toBe('0')
    // wallet routes are on their own budget
    expect((await request(app).get('/api/wallets/mints').set('X-Forwarded-For', ip)).status).toBe(200)
    // /api/mints/known is on the general budget like the other website routes; /health stays exempt
    const known = await request(app).get('/api/mints/known').set('X-Forwarded-For', ip)
    expect(known.status).toBe(429)
    expect(known.headers['x-ratelimit-limit']).toBe('60')
    const health = await request(app).get('/health').set('X-Forwarded-For', ip)
    expect(health.status).toBe(200)
    expect(health.headers['x-ratelimit-limit']).toBeUndefined()
  })

  it('the submit limiter sends Retry-After on its 429', async () => {
    const ip = '198.51.100.40'
    for (let i = 0; i < 20; i++) expect((await request(app).post('/api/mint/submit').set('X-Forwarded-For', ip).send({})).status).toBe(400)
    const blocked = await request(app).post('/api/mint/submit').set('X-Forwarded-For', ip).send({})
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect(blocked.body).toEqual({ error: 'Too many requests. Try again later.' })
  })
})

describe('GET /api/mints/recommend', () => {
  const rec = (qs = '') => request(app).get('/api/mints/recommend' + qs)
  const recUrls = (body: { recommended: Array<{ url: string }> }) => body.recommended.map(r => r.url)

  it('keeps its response shape (additive: methodology) and orders like the wallet list', async () => {
    const res = await rec('?unit=sat&minScore=0&limit=10')
    expect(res.status).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['generatedAt', 'methodology', 'recommended'])
    expect(res.body.methodology).toBe(METHODOLOGY_VERSION)
    expect(new Date(res.body.generatedAt).toISOString()).toBe(res.body.generatedAt)
    expect(Object.keys(res.body.recommended[0]).sort()).toEqual(['latencyMs', 'name', 'reliabilityScore', 'units', 'uptimePct24h', 'url', 'version'])
    expect(res.body.recommended[0]).toEqual({
      url: 'https://a.example.com', name: 'Mint A', reliabilityScore: 90, uptimePct24h: 100, latencyMs: 120, version: 'Nutshell/0.21.0', units: ['sat'],
    })
    expect(recUrls(res.body)).toEqual(['https://a.example.com', 'https://b.example.com', 'https://c.example.com'])
  })

  it('never returns a test mint, an unscored, offline, degraded or archived mint, or a mint under 14 days', async () => {
    query.mockResolvedValue({
      rows: [
        ...ROWS,
        row('https://almost.example.com', { last_reliability_score: 97, discovered_at: ago(13.9) }),
        row('https://mature.example.com', { last_reliability_score: 50, discovered_at: ago(14.1) }),
        row('https://nofirstseen.example.com', { last_reliability_score: 98, discovered_at: null }),
      ],
    })
    const res = await rec('?minScore=0&limit=10')
    expect(recUrls(res.body)).toEqual(['https://a.example.com', 'https://b.example.com', 'https://c.example.com', 'https://mature.example.com'])
    for (const banned of ['testnut.cashu.space', 'new.example.com', 'almost.example.com', 'nofirstseen.example.com', 'offline.example.com',
      'degraded.example.com', 'archived.example.com', 'unscored.example.com']) {
      expect(JSON.stringify(res.body)).not.toContain(banned)
    }
  })

  it('filters by unit, minScore (default 80) and nuts, and caps limit at 10 (default 5)', async () => {
    expect(recUrls((await rec('?unit=usd&minScore=0')).body)).toEqual(['https://c.example.com'])
    expect((await rec('?unit=usd&minScore=0')).body.recommended[0].units).toEqual(['sat', 'usd'])
    expect(recUrls((await rec()).body)).toEqual(['https://a.example.com', 'https://b.example.com', 'https://c.example.com']) // minScore 80 default
    expect(recUrls((await rec('?minScore=85')).body)).toEqual(['https://a.example.com', 'https://b.example.com'])
    expect(recUrls((await rec('?minScore=0&nuts=8')).body)).toEqual(['https://c.example.com'])
    expect(recUrls((await rec('?minScore=0&nuts=4,5,08')).body)).toEqual(['https://c.example.com'])
    expect(recUrls((await rec('?minScore=0&nuts=4,99')).body)).toEqual([])
    expect((await rec('?minScore=0&limit=1')).body.recommended).toHaveLength(1)
  })

  it('limit is applied after the nuts filter and caps at 10', async () => {
    query.mockResolvedValue({
      rows: Array.from({ length: 14 }, (_, i) => row(`https://m${String.fromCharCode(97 + i)}.example.com`, { last_reliability_score: 90 - i, nuts_limits: i === 13 ? { '4': {}, '9': {} } : { '4': {} } })),
    })
    expect((await rec('?limit=99')).body.recommended).toHaveLength(10)
    expect(recUrls((await rec('?minScore=0&nuts=9&limit=1')).body)).toEqual(['https://mn.example.com'])
    expect((await rec('?limit=0')).body.recommended).toHaveLength(1)
  })

  it('sends Cache-Control and a strong ETag on a miss and a hit, 304 on If-None-Match, from the shared snapshot', async () => {
    const miss = await rec('?unit=sat')
    const hit = await rec('?unit=sat')
    expect(query).toHaveBeenCalledTimes(1)
    for (const r of [miss, hit]) {
      expect(r.headers['cache-control']).toBe('public, max-age=300')
      expect(r.headers['etag']).toMatch(/^"[0-9a-f]{32}"$/)
    }
    expect(hit.headers['etag']).toBe(miss.headers['etag'])
    const nm = await rec('?unit=sat').set('If-None-Match', miss.headers['etag'] as string)
    expect(nm.status).toBe(304)
    expect(nm.headers['access-control-allow-origin']).toBe('*')
  })

  it('is on the wallet budget (300/min per IP, one counter with /api/wallets/*): the 61st request is fine, the 301st gets 429 with Retry-After', async () => {
    const ip = '198.51.100.50'
    const get = (path = '/api/mints/recommend') => request(app).get(path).set('X-Forwarded-For', ip)
    const first = await get()
    expect(first.headers['x-ratelimit-limit']).toBe('300')
    expect(first.headers['x-ratelimit-remaining']).toBe('299')
    for (let i = 1; i < 61; i++) expect((await get()).status).toBe(200) // past the general 60/min limit
    const sixtyOne = await get()
    expect(sixtyOne.status).toBe(200)
    expect(sixtyOne.headers['x-ratelimit-limit']).toBe('300')
    expect(sixtyOne.headers['x-ratelimit-remaining']).toBe(String(300 - 62))
    // the wallet routes count against the same budget; every spelling Express routes to the handler too
    expect((await get('/api/wallets/mints')).headers['x-ratelimit-remaining']).toBe(String(300 - 63))
    expect((await get('/api/v1/mints/recommend/')).headers['x-ratelimit-remaining']).toBe(String(300 - 64))
    expect((await get('/API/MINTS/RECOMMEND')).headers['x-ratelimit-remaining']).toBe(String(300 - 65))
    for (let i = 65; i < 300; i++) expect((await get()).status).toBe(200)
    const blocked = await get().set('Origin', FOREIGN)
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many requests' }) // recommend keeps its { error: "text" } shape
    const ra = Number(blocked.headers['retry-after'])
    expect(ra).toBeGreaterThanOrEqual(1)
    expect(ra).toBeLessThanOrEqual(60)
    expect(blocked.headers['x-ratelimit-limit']).toBe('300')
    expect(blocked.headers['x-ratelimit-remaining']).toBe('0')
    expect(blocked.headers['access-control-allow-origin']).toBe('*')
    // the wallet routes are blocked by the same counter and answer in their own envelope
    const walletBlocked = await get('/api/wallets/mints')
    expect(walletBlocked.status).toBe(429)
    expect(walletBlocked.body.error.code).toBe('rate_limited')
    // another IP is unaffected; the general 60/min limiter has its own counter
    expect((await request(app).get('/api/mints/recommend').set('X-Forwarded-For', '198.51.100.51')).status).toBe(200)
    expect((await get('/api')).status).toBe(200)
  }, 60_000)

  it('does not give other routes the wallet budget (a look-alike path stays on 60/min)', async () => {
    const ip = '198.51.100.52'
    const get = () => request(app).get('/api/mints/recommendations').set('X-Forwarded-For', ip)
    expect((await get()).headers['x-ratelimit-limit']).toBe('60')
    expect((await request(app).get('/api/nuts').set('X-Forwarded-For', ip)).headers['x-ratelimit-limit']).toBe('60')
  })

  it('keeps the old error shape on a server error', async () => {
    query.mockReset()
    query.mockRejectedValue(new Error('boom'))
    // the snapshot is cached, so force a failing read with a fresh app
    vi.resetModules()
    const db = await import('../../db.js')
    const q2 = db.pool.query as unknown as ReturnType<typeof vi.fn>
    q2.mockReset()
    q2.mockRejectedValue(new Error('boom'))
    const { app: app2 } = await import('../../index.js')
    const failed = await request(app2).get('/api/mints/recommend')
    expect(failed.status).toBe(500)
    expect(failed.body).toEqual({ error: 'Internal server error' })
  })
})

describe('list filters nuts and eligible (replace /mints/recommend)', () => {
  const FIXTURE = [
    ...ROWS,
    row('https://almost.example.com', { last_reliability_score: 97, discovered_at: ago(13.9) }),
    row('https://mature.example.com', { last_reliability_score: 50, discovered_at: ago(14.1), nuts_limits: { '4': {}, '5': {}, '9': {} } }),
    row('https://nofirstseen.example.com', { last_reliability_score: 98, discovered_at: null }),
    row('https://nonuts.example.com', { last_reliability_score: 85, nuts_limits: null }),
  ]
  beforeEach(() => { query.mockResolvedValue({ rows: FIXTURE }) })
  const rec = (qs: string) => request(app).get('/api/mints/recommend' + qs)
  const recUrls = (body: { recommended: Array<{ url: string }> }) => body.recommended.map(r => r.url)

  it('nuts keeps only mints that advertise all the listed NUTs (leading zeros ignored, order and repeats do not matter)', async () => {
    expect(urls((await list('?nuts=8')).body)).toEqual(['https://c.example.com'])
    expect(urls((await list('?nuts=4,5,08')).body)).toEqual(['https://c.example.com'])
    expect(urls((await list('?nuts=8,4,4')).body)).toEqual(['https://c.example.com'])
    expect(urls((await list('?nuts=4,99')).body)).toEqual([])
    expect(urls((await list('?nuts=9&includeUnscored=true')).body)).toEqual(['https://mature.example.com'])
    // a mint whose nuts are unknown never matches; without the parameter it is listed
    expect(urls((await list()).body)).toContain('https://nonuts.example.com')
    expect(urls((await list('?nuts=4')).body)).not.toContain('https://nonuts.example.com')
  })

  it('eligible=true keeps what /recommend would consider; eligible=false keeps only the others; absent = no filter', async () => {
    const all = urls((await list('?limit=200')).body)
    const yes = urls((await list('?eligible=true&limit=200')).body)
    const no = urls((await list('?eligible=false&limit=200')).body)
    for (const young of ['https://new.example.com', 'https://almost.example.com', 'https://nofirstseen.example.com']) {
      expect(yes).not.toContain(young)
      expect(no).toContain(young)
    }
    expect(yes).toContain('https://mature.example.com')
    expect(new Set([...yes, ...no])).toEqual(new Set(all))
    expect(yes.filter(u => no.includes(u))).toEqual([])
    const body = (await list('?eligible=true&limit=200')).body
    expect(body.mints.every((m: { eligibleForRecommendation: boolean }) => m.eligibleForRecommendation)).toBe(true)
  })

  it.each([
    ['', '?eligible=true&unit=sat&minScore=80&limit=5'],
    ['?unit=usd&minScore=0', '?eligible=true&unit=usd&minScore=0&limit=5'],
    ['?minScore=0&nuts=4,5,08', '?eligible=true&unit=sat&minScore=0&nuts=4,5,08&limit=5'],
    ['?minScore=0&nuts=9', '?eligible=true&unit=sat&minScore=0&nuts=9&limit=5'],
    ['?minScore=85', '?eligible=true&unit=sat&minScore=85&limit=5'],
    ['?minScore=0&limit=2', '?eligible=true&unit=sat&minScore=0&limit=2'],
    ['?minScore=0&nuts=4,99', '?eligible=true&unit=sat&minScore=0&nuts=4,99&limit=5'],
  ])('/recommend%s returns the same mints in the same order as /api/v1/wallets/mints%s', async (recQs, walletQs) => {
    const r = recUrls((await rec(recQs)).body)
    const w = urls((await request(app).get('/api/v1/wallets/mints' + walletQs)).body)
    expect(w).toEqual(r)
  })

  it('the documented replacement query returns a non-empty, equal set', async () => {
    const w = urls((await request(app).get('/api/v1/wallets/mints?eligible=true&unit=sat&minScore=80&nuts=4,5&limit=5')).body)
    expect(w.length).toBeGreaterThan(0)
    expect(w).toEqual(recUrls((await rec('?unit=sat&minScore=80&nuts=4,5&limit=5')).body))
  })

  it('invalid nuts and eligible values are 400 invalid_parameter, like the other bad parameters', async () => {
    const many = Array.from({ length: 33 }, (_, i) => i + 1).join(',')
    for (const qs of ['?nuts=', '?nuts=abc', '?nuts=4,', '?nuts=,4', '?nuts=4,,5', '?nuts=4,x', '?nuts=1000', '?nuts=-4', '?nuts=4.5', '?nuts=4%205',
      '?nuts=4&nuts=5', `?nuts=${many}`, '?eligible=', '?eligible=yes', '?eligible=1', '?eligible=TRUE', '?eligible=true&eligible=false']) {
      const res = await list(qs)
      expect(res.status, qs).toBe(400)
      expect(res.body, qs).toEqual({ error: { code: 'invalid_parameter', message: expect.any(String) } })
    }
    expect((await list('?nuts=4,5&eligible=true')).status).toBe(200)
    expect((await list('?nuts=4, 5')).status).toBe(200) // spaces around a number are trimmed
  })
})

describe('JSON 404 for unmatched /api paths', () => {
  it('/api/v1/* answers the wallet error envelope', async () => {
    for (const path of ['/api/v1/foo', '/api/v1/foo/bar', '/api/v1/health/extra', '/api/v1/wallets/nothing', '/api/v1/mints/nothing', '/API/V1/foo']) {
      const res = await request(app).get(path)
      expect(res.status, path).toBe(404)
      expect(res.headers['content-type'], path).toMatch(/application\/json/)
      expect(res.body, path).toEqual({ error: { code: 'not_found', message: expect.any(String) } })
    }
  })

  it('other /api/* paths answer { error: "Not found" }, for any method', async () => {
    for (const path of ['/api/foo', '/api/mints/nothing', '/api/mints/known/extra']) {
      const res = await request(app).get(path)
      expect(res.status, path).toBe(404)
      expect(res.headers['content-type'], path).toMatch(/application\/json/)
      expect(res.body, path).toEqual({ error: 'Not found' })
    }
    const post = await request(app).post('/api/nothing').send({})
    expect(post.status).toBe(404)
    expect(post.body).toEqual({ error: 'Not found' })
    expect(JSON.stringify(post.body)).not.toContain('Cannot')
  })

  it('does not swallow real routes', async () => {
    expect((await request(app).get('/api')).status).toBe(200)
    expect((await request(app).get('/api/v1')).status).toBe(200)
    expect((await request(app).get('/api/v1/health')).status).toBe(200)
    expect((await request(app).get('/api/v1/wallets/mints')).status).toBe(200)
  })
})

describe('deprecation of /mints/recommend', () => {
  const HEADERS = ['deprecation', 'sunset', 'link']

  it('/api/v1/mints/recommend and its unversioned alias carry Deprecation (@unix), Sunset (HTTP-date) and the successor Link', async () => {
    for (const path of ['/api/v1/mints/recommend', '/api/mints/recommend']) {
      const res = await request(app).get(path)
      expect(res.status, path).toBe(200)
      expect(res.headers['deprecation'], path).toBe('@1792454400')
      expect(res.headers['sunset'], path).toBe('Tue, 26 Jan 2027 00:00:00 GMT')
      expect(res.headers['link'], path).toBe('<https://mintradar.org/api/v1/wallets/mints?eligible=true&unit=sat&minScore=80&limit=5>; rel="successor-version"')
      expect(res.body.recommended, path).toBeDefined() // the body is unchanged
    }
  })

  it('a 304 and a CORS preflight-free GET from a foreign origin keep the headers; the body shape is unchanged', async () => {
    const first = await request(app).get('/api/v1/mints/recommend').set('Origin', FOREIGN)
    const again = await request(app).get('/api/v1/mints/recommend').set('Origin', FOREIGN).set('If-None-Match', first.headers['etag'] as string)
    expect(again.status).toBe(304)
    for (const h of HEADERS) expect(again.headers[h], h).toBe(first.headers[h])
    expect(Object.keys(first.body).sort()).toEqual(['generatedAt', 'methodology', 'recommended'])
  })

  it('no other route sends them', async () => {
    for (const path of ['/api/v1/wallets/mints', '/api/v1/wallets/mints/' + encodeURIComponent('https://a.example.com'), '/api/v1/mints/known', '/api/stats', '/api', '/api/v1/health']) {
      const res = await request(app).get(path)
      for (const h of HEADERS) expect(res.headers[h], `${path} ${h}`).toBeUndefined()
    }
  })
})

describe('/api/mints/known is a website route', () => {
  it.each(['/api/mints/known', '/api/v1/mints/known'])('%s: a foreign Origin is a JSON 403 without CORS headers', async (path) => {
    const res = await request(app).get(path).set('Origin', FOREIGN)
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: { code: 'cors_forbidden', message: expect.any(String) } })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    const pre = await request(app).options(path).set('Origin', FOREIGN).set('Access-Control-Request-Method', 'GET')
    expect(pre.status).toBe(403)
    expect(pre.headers['access-control-allow-origin']).toBeUndefined()
  })

  it.each(['/api/mints/known', '/api/v1/mints/known'])('%s: the website\'s own origin and a request without Origin keep working, with the cache headers', async (path) => {
    const own = await request(app).get(path).set('Origin', 'https://mintradar.org')
    expect(own.status).toBe(200)
    expect(own.headers['access-control-allow-origin']).toBe('https://mintradar.org')
    expect(own.headers['cache-control']).toBe('public, max-age=300')
    expect(own.headers['etag']).toBeDefined()
    const none = await request(app).get(path)
    expect(none.status).toBe(200)
    expect(none.headers['access-control-allow-origin']).toBeUndefined()
    expect(Array.isArray(none.body)).toBe(true)
  })

  it('every field is still there (nothing was removed)', async () => {
    const res = await request(app).get('/api/mints/known')
    expect(Object.keys(res.body[0])).toEqual(expect.arrayContaining(['ipAddress', 'netAsn', 'netOrg', 'netCountry', 'serverLocation', 'pubkey', 'lastError', 'auditNErrors', 'reviewWeightedRating']))
  })

  it('shares the general 60/min budget per IP (X-RateLimit-*), the 61st request is a 429 with Retry-After', async () => {
    const ip = '198.51.100.40'
    const get = () => request(app).get('/api/mints/known').set('X-Forwarded-For', ip)
    const first = await get()
    expect(first.headers['x-ratelimit-limit']).toBe('60')
    expect(first.headers['x-ratelimit-remaining']).toBe('59')
    for (let i = 1; i < 60; i++) expect((await get()).status).toBe(200)
    const blocked = await get()
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'Too many requests' })
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1)
  }, 60_000)
})
