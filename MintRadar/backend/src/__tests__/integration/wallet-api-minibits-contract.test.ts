import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// CONTRACT: used by the Minibits wallet; do not break.
//
// Since 0.4.5-beta.5 (2026-11-12) the Minibits wallet shows an "Availability" card on its mint detail screen, built
// from ONE call to GET /api/v1/wallets/mints/{encodeURIComponent(mintUrl)} (no query string, Accept: application/json,
// the default React Native user agent). Client and its tests:
//   https://github.com/minibits-cash/minibits_wallet/blob/eefdfb9e055968135a1a9314b637798500360acd/src/services/mintAuditService.ts
//   https://github.com/minibits-cash/minibits_wallet/blob/eefdfb9e055968135a1a9314b637798500360acd/__tests__/mintAuditService.test.ts
// The wallet reads `{ mint }` and drops the WHOLE answer when `mint.url` is not a string; any field below that
// disappears or changes type silently removes (part of) the card for every Minibits user. A 404 hides the card, so an
// unknown mint must stay a clean JSON 404. The card links to https://mintradar.org/mint/{encodeURIComponent(mint.url)},
// so `mint.url` must be the stored URL the SPA route knows (e2e/minibits-mint-link.spec.ts covers the page).
// Changing anything pinned here needs a heads-up to Minibits first (docs/API.md, "Used by Minibits").
//
// The pool is mocked at the db.js boundary like wallet-api.test.ts; the real middleware stack and handlers run.

vi.mock('../../db.js', () => ({ pool: { query: vi.fn() }, initDb: vi.fn() }))
vi.mock('../../versionCatalog.js', () => ({
  getLatestVersionsMap: vi.fn().mockResolvedValue({ nutshell: { major: 0, minor: 21 }, cdk: { major: 0, minor: 18 } }),
}))

let app: Express
let query: ReturnType<typeof vi.fn>

const DAY = 86_400_000
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString()

const MINIBITS = 'https://mint.minibits.cash/Bitcoin'
const OFFLINE = 'https://offline.example.com'
const TEST_MINT = 'https://testnut.cashu.space'

/** A row as the /api/mints/known snapshot SQL returns it (an online, mature, scored mint by default). */
function row(url: string, o: Record<string, unknown> = {}) {
  return {
    url, name: 'Mint', icon_url: null, version: 'cdk-mintd/0.18.3', nut_count: 12,
    nuts_limits: { '4': {}, '5': {}, '7': {} }, units: ['sat'], mint_methods: null, melt_methods: null, pubkey: null,
    audit_cz_total: 12, audit_cz_blamed: 0, audit_cz_fetched_at: new Date(ago(0.1)),
    discovered_at: ago(200), last_reliability_score: 98, last_error: null,
    review_count: 0, review_avg_rating: null, review_rated_count: 0, review_operator_count: 0,
    total: 288, online_count: 288, total_7d: 2016, online_count_7d: 2016, total_30d: 8640, online_count_30d: 8640,
    latest_online: true, latest_latency_ms: 230, latest_checked_at: ago(0.001), last_online_at: ago(0.001),
    latency_p50_24h: 230.4, latency_p95_24h: 485.2, latency_samples_24h: 285,
    down_since: null,
    ...o,
  }
}

const ROWS = [
  row(MINIBITS, { name: 'Minibits mint' }),
  // Down for 5 h, with the NUT-04/05 switches off and an old version: every optional field of the card is filled.
  row(OFFLINE, {
    version: 'Nutshell/0.15.0', latest_online: false, online_count: 228, online_count_7d: 1900, online_count_30d: 8000,
    last_online_at: ago(0.2), down_since: ago(0.2), nuts_limits: { '4': { disabled: true }, '5': { disabled: true } },
    audit_cz_total: 20, audit_cz_blamed: 4, latency_p50_24h: null, latency_p95_24h: null, latency_samples_24h: 0,
  }),
  row(TEST_MINT),
]

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  query.mockResolvedValue({ rows: ROWS })
  ;({ app } = await import('../../index.js'))
})

/** Exactly what mintAuditService.fetchJson sends: the v1 path, the encoded URL, no query, Accept JSON, a RN user agent. */
const minibitsGet = (mintUrl: string, userAgent = 'okhttp/4.9.2') =>
  request(app)
    .get(`/api/v1/wallets/mints/${encodeURIComponent(mintUrl)}`)
    .set('Accept', 'application/json')
    .set('User-Agent', userAgent)

const STATUSES = ['online', 'offline', 'degraded', 'archived']
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const isInt = (v: unknown) => Number.isInteger(v)
const nullOr = (v: unknown, check: (x: unknown) => boolean) => v === null || check(v)
const isIso = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v

/** Every field Minibits reads (MintRadarMint in mintAuditService.ts), with the type its parser accepts. */
function expectMinibitsShape(m: Record<string, unknown>): void {
  expect(typeof m.url, 'url').toBe('string')
  expect(STATUSES, 'status').toContain(m.status)
  expect(nullOr(m.score, isNum), 'score').toBe(true)
  expect(typeof m.scoreStale, 'scoreStale').toBe('boolean')
  for (const k of ['uptime24hPct', 'uptime7dPct', 'uptime30dPct']) {
    // Whole percent: the card prints them as they come.
    expect(nullOr(m[k], v => isInt(v) && (v as number) >= 0 && (v as number) <= 100), k).toBe(true)
  }
  expect(nullOr(m.lastCheckedAt, isIso), 'lastCheckedAt').toBe(true)
  expect(m, 'downSince').toHaveProperty('downSince')
  expect(nullOr(m.downSince, isIso), 'downSince').toBe(true)
  expect(nullOr(m.mintDisabled, v => typeof v === 'boolean'), 'mintDisabled').toBe(true)
  expect(nullOr(m.meltDisabled, v => typeof v === 'boolean'), 'meltDisabled').toBe(true)
  expect(nullOr(m.software, v => typeof v === 'string'), 'software').toBe(true)
  expect(nullOr(m.outdated, v => typeof v === 'boolean'), 'outdated').toBe(true)
  expect(typeof m.isTest, 'isTest').toBe('boolean')
  const audit = m.audit as Record<string, unknown> | null
  expect(audit === null || typeof audit === 'object', 'audit').toBe(true)
  if (audit !== null) {
    expect(isInt(audit.swaps7d), 'audit.swaps7d').toBe(true)
    expect(isInt(audit.attributedFailures), 'audit.attributedFailures').toBe(true)
    expect(audit.attributedFailures as number).toBeLessThanOrEqual(audit.swaps7d as number)
  }
  const latency = m.latency24h as Record<string, unknown> | null
  expect(m, 'latency24h').toHaveProperty('latency24h')
  expect(latency === null || typeof latency === 'object', 'latency24h').toBe(true)
  if (latency !== null) expect(isNum(latency.p50Ms), 'latency24h.p50Ms').toBe(true)
}

describe('Minibits contract: GET /api/v1/wallets/mints/{url}', () => {
  it('answers JSON with the { mint } envelope and every field the Availability card reads', async () => {
    const res = await minibitsGet(MINIBITS)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.body).toHaveProperty('mint')
    const m = res.body.mint
    expectMinibitsShape(m)
    // The values of a healthy mint, as the card renders them.
    expect(m).toMatchObject({
      url: MINIBITS, status: 'online', score: 98, scoreStale: false,
      uptime24hPct: 100, uptime7dPct: 100, uptime30dPct: 100,
      downSince: null, mintDisabled: false, meltDisabled: false, software: 'cdk-mintd/0.18.3', outdated: false, isTest: false,
      audit: { swaps7d: 12, attributedFailures: 0 },
    })
    expect(m.latency24h.p50Ms).toBe(230)
    expect(isIso(m.lastCheckedAt)).toBe(true)
  })

  it('an offline, disabled, outdated mint keeps the same types and fills downSince', async () => {
    const m = (await minibitsGet(OFFLINE)).body.mint
    expectMinibitsShape(m)
    expect(m).toMatchObject({ url: OFFLINE, status: 'offline', scoreStale: true, mintDisabled: true, meltDisabled: true, outdated: true, software: 'Nutshell/0.15.0' })
    expect(isIso(m.downSince)).toBe(true)
    expect(m.audit).toMatchObject({ swaps7d: 20, attributedFailures: 4 })
    expect(m.uptime30dPct).toBe(93) // 8000 / 8640, rounded: below the 95 % line Minibits warns at
    expect(m.latency24h).toBeNull()
  })

  it('a test mint is returned when asked for by URL, flagged with isTest', async () => {
    const m = (await minibitsGet(TEST_MINT)).body.mint
    expectMinibitsShape(m)
    expect(m.isTest).toBe(true)
  })

  it.each([
    ['the stored URL', MINIBITS],
    ['a trailing slash', `${MINIBITS}/`],
    ['an upper-case host', 'https://MINT.minibits.cash/Bitcoin'],
    ['http:// instead of https://', 'http://mint.minibits.cash/Bitcoin'],
    ['a different path case', 'https://mint.minibits.cash/bitcoin'],
  ])('finds the mint for %s and answers with the stored URL', async (_label, asked) => {
    const res = await minibitsGet(asked)
    expect(res.status).toBe(200)
    expectMinibitsShape(res.body.mint)
    // The card builds its mintradar.org/mint/... link from this, so it must be the stored URL.
    expect(res.body.mint.url).toBe(MINIBITS)
  })

  it('a bare-host mint is found with and without the trailing slash', async () => {
    for (const asked of [OFFLINE, `${OFFLINE}/`]) {
      const res = await minibitsGet(asked)
      expect(res.status, asked).toBe(200)
      expect(res.body.mint.url).toBe(OFFLINE)
    }
  })

  it('the percent-encoded path is what Minibits sends: https%3A%2F%2F…', async () => {
    const res = await request(app).get('/api/v1/wallets/mints/https%3A%2F%2Fmint.minibits.cash%2FBitcoin').set('Accept', 'application/json')
    expect(res.status).toBe(200)
    expect(res.body.mint.url).toBe(MINIBITS)
  })

  it('an unknown mint is a clean JSON 404 without a mint (the card hides)', async () => {
    const res = await minibitsGet('https://unknown.example.com')
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.body).toEqual({ error: { code: 'mint_not_found', message: expect.any(String) } })
    expect(res.body).not.toHaveProperty('mint')
  })

  it.each([
    ['React Native on Android (okhttp)', 'okhttp/4.9.2'],
    ['React Native on iOS', 'Minibits/1 CFNetwork/1498.700.2 Darwin/23.6.0'],
    ['an empty user agent', ''],
  ])('needs no special user agent: %s', async (_label, ua) => {
    const res = await minibitsGet(MINIBITS, ua)
    expect(res.status).toBe(200)
    expect(res.body.mint.url).toBe(MINIBITS)
  })

  it('needs no Origin, no auth and no query string, and is not behind the internal CORS gate', async () => {
    const res = await request(app).get(`/api/v1/wallets/mints/${encodeURIComponent(MINIBITS)}`)
    expect(res.status).toBe(200)
    expect(res.body.mint.url).toBe(MINIBITS)
    const cross = await minibitsGet(MINIBITS).set('Origin', 'https://some-wallet.example')
    expect(cross.status).toBe(200)
    expect(cross.headers['access-control-allow-origin']).toBe('*')
  })
})
