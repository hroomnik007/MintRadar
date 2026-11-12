import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// CONTRACT: wallet integrations rely on this; do not break.
//
// Wallets build a mint availability view from ONE call to GET /api/v1/wallets/mints/{encodeURIComponent(mintUrl)}
// (no query string, Accept: application/json, a stock mobile HTTP client user agent). A typical client reads the
// `{ mint }` envelope and drops the WHOLE answer when `mint.url` is not a string; any field below that disappears or
// changes type silently breaks (part of) that view in every such wallet. A 404 is how a wallet learns that a mint is
// not tracked, so an unknown mint must stay a clean JSON 404. Wallets link to
// https://mintradar.org/mint/{encodeURIComponent(mint.url)}, so `mint.url` must be the stored URL the SPA route knows
// (e2e/wallet-mint-link.spec.ts covers the page). Changing anything pinned here breaks integrations (docs/API.md,
// "Used by wallet integrations").
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

const MINT = 'https://mint.example.com/Bitcoin'
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
  row(MINT, { name: 'Example mint' }),
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

/** What a mobile wallet sends: the v1 path, the encoded URL, no query, Accept JSON, a React Native user agent. */
const walletGet = (mintUrl: string, userAgent = 'okhttp/4.9.2') =>
  request(app)
    .get(`/api/v1/wallets/mints/${encodeURIComponent(mintUrl)}`)
    .set('Accept', 'application/json')
    .set('User-Agent', userAgent)

const STATUSES = ['online', 'offline', 'degraded', 'archived']
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const isInt = (v: unknown) => Number.isInteger(v)
const nullOr = (v: unknown, check: (x: unknown) => boolean) => v === null || check(v)
const isIso = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v

/** Every field a wallet availability view reads, with the type a strict client parser accepts. */
function expectWalletShape(m: Record<string, unknown>): void {
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

describe('Wallet integration contract: GET /api/v1/wallets/mints/{url}', () => {
  it('answers JSON with the { mint } envelope and every field a wallet availability view reads', async () => {
    const res = await walletGet(MINT)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.body).toHaveProperty('mint')
    const m = res.body.mint
    expectWalletShape(m)
    // The values of a healthy mint, as a wallet renders them.
    expect(m).toMatchObject({
      url: MINT, status: 'online', score: 98, scoreStale: false,
      uptime24hPct: 100, uptime7dPct: 100, uptime30dPct: 100,
      downSince: null, mintDisabled: false, meltDisabled: false, software: 'cdk-mintd/0.18.3', outdated: false, isTest: false,
      audit: { swaps7d: 12, attributedFailures: 0 },
    })
    expect(m.latency24h.p50Ms).toBe(230)
    expect(isIso(m.lastCheckedAt)).toBe(true)
  })

  it('an offline, disabled, outdated mint keeps the same types and fills downSince', async () => {
    const m = (await walletGet(OFFLINE)).body.mint
    expectWalletShape(m)
    expect(m).toMatchObject({ url: OFFLINE, status: 'offline', scoreStale: true, mintDisabled: true, meltDisabled: true, outdated: true, software: 'Nutshell/0.15.0' })
    expect(isIso(m.downSince)).toBe(true)
    expect(m.audit).toMatchObject({ swaps7d: 20, attributedFailures: 4 })
    expect(m.uptime30dPct).toBe(93) // 8000 / 8640, rounded: below the 95 % recommendation line
    expect(m.latency24h).toBeNull()
  })

  it('a test mint is returned when asked for by URL, flagged with isTest', async () => {
    const m = (await walletGet(TEST_MINT)).body.mint
    expectWalletShape(m)
    expect(m.isTest).toBe(true)
  })

  it.each([
    ['the stored URL', MINT],
    ['a trailing slash', `${MINT}/`],
    ['an upper-case host', 'https://MINT.example.com/Bitcoin'],
    ['http:// instead of https://', 'http://mint.example.com/Bitcoin'],
    ['a different path case', 'https://mint.example.com/bitcoin'],
  ])('finds the mint for %s and answers with the stored URL', async (_label, asked) => {
    const res = await walletGet(asked)
    expect(res.status).toBe(200)
    expectWalletShape(res.body.mint)
    // Wallets build their mintradar.org/mint/... link from this, so it must be the stored URL.
    expect(res.body.mint.url).toBe(MINT)
  })

  it('a bare-host mint is found with and without the trailing slash', async () => {
    for (const asked of [OFFLINE, `${OFFLINE}/`]) {
      const res = await walletGet(asked)
      expect(res.status, asked).toBe(200)
      expect(res.body.mint.url).toBe(OFFLINE)
    }
  })

  it('the percent-encoded path as wallets send it: https%3A%2F%2F…', async () => {
    const res = await request(app).get('/api/v1/wallets/mints/https%3A%2F%2Fmint.example.com%2FBitcoin').set('Accept', 'application/json')
    expect(res.status).toBe(200)
    expect(res.body.mint.url).toBe(MINT)
  })

  it('an unknown mint is a clean JSON 404 without a mint (the wallet hides its view)', async () => {
    const res = await walletGet('https://unknown.example.com')
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.body).toEqual({ error: { code: 'mint_not_found', message: expect.any(String) } })
    expect(res.body).not.toHaveProperty('mint')
  })

  it.each([
    ['React Native on Android (okhttp)', 'okhttp/4.9.2'],
    ['React Native on iOS', 'Wallet/1 CFNetwork/1498.700.2 Darwin/23.6.0'],
    ['an empty user agent', ''],
  ])('needs no special user agent: %s', async (_label, ua) => {
    const res = await walletGet(MINT, ua)
    expect(res.status).toBe(200)
    expect(res.body.mint.url).toBe(MINT)
  })

  it('needs no Origin, no auth and no query string, and is not behind the internal CORS gate', async () => {
    const res = await request(app).get(`/api/v1/wallets/mints/${encodeURIComponent(MINT)}`)
    expect(res.status).toBe(200)
    expect(res.body.mint.url).toBe(MINT)
    const cross = await walletGet(MINT).set('Origin', 'https://some-wallet.example')
    expect(cross.status).toBe(200)
    expect(cross.headers['access-control-allow-origin']).toBe('*')
  })
})
