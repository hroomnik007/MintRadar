import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// Methodology 4 (2026-10-21): a NUT entry with `supported: false` in /v1/info is NOT a supported NUT in every place the
// backend decides "NUT supported" from the nuts object (shared/nutSupport.ts): the wallet API `nuts` field and `nuts=`
// filter, `authRequired`, the deprecated /recommend route, /api/stats and the probe preview. The score and
// the change log are covered in prober-nut-support.test.ts and mintChanges.test.ts.

vi.mock('../../db.js', () => ({ pool: { query: vi.fn() }, initDb: vi.fn() }))
vi.mock('../../versionCatalog.js', () => ({
  getLatestVersionsMap: vi.fn().mockResolvedValue({ nutshell: { major: 0, minor: 21 }, cdk: { major: 0, minor: 18 } }),
}))
vi.mock('../../ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ssrf.js')>()
  return { ...actual, safeFetch: vi.fn(), readJsonLimited: (res: { json: () => Promise<unknown> }) => res.json() }
})

let app: Express
let query: ReturnType<typeof vi.fn>
let safeFetch: ReturnType<typeof vi.fn>

const DAY = 86_400_000
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString()

function row(url: string, nuts: Record<string, unknown> | null) {
  return {
    url, name: 'Mint', icon_url: null, version: 'Nutshell/0.21.0', nut_count: 3, tos_url: null, description_long: null,
    nuts_limits: nuts, units: ['sat'], mint_methods: null, melt_methods: null, pubkey: null,
    audit_cz_total: 104, audit_cz_blamed: 2, audit_cz_fetched_at: new Date(ago(0.1)), discovered_at: ago(200),
    last_reliability_score: 90, last_error: null, server_location: null, ip_address: null, net_asn: null, net_org: null,
    net_country: null, has_onion: false, review_count: 0, review_avg_rating: null, review_rated_count: 0,
    review_operator_count: 0, nostr_announce_pubkey: null, total: 288, online_count: 288, total_7d: 2016, online_count_7d: 2016,
    latest_online: true, latest_latency_ms: 120, latest_checked_at: ago(0.001), last_online_at: ago(0.001),
  }
}

const ROWS = [
  row('https://yes.example.com', { '4': {}, '5': {}, '11': { supported: true }, '12': {}, '21': {}, '22': { methods: [] } }),
  row('https://no.example.com', { '4': {}, '5': {}, '11': { supported: false }, '12': { supported: false }, '21': { supported: false }, '22': { supported: false }, '7': null }),
]

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../../db.js')
  const ssrf = await import('../../ssrf.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  safeFetch = ssrf.safeFetch as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  safeFetch.mockReset()
  query.mockResolvedValue({ rows: ROWS })
  ;({ app } = await import('../../index.js'))
})

const urls = (body: { mints: Array<{ url: string }> }) => body.mints.map(m => m.url)
const list = (qs = '') => request(app).get('/api/wallets/mints' + qs)
const mintOf = (body: { mints: Array<{ url: string }> }, url: string) => body.mints.find(m => m.url === url) as Record<string, unknown>

describe('wallet API', () => {
  it('nuts=11 does not return a mint with "11": {"supported": false}', async () => {
    expect(urls((await list('?nuts=11')).body)).toEqual(['https://yes.example.com'])
    expect(urls((await list('?nuts=11,12')).body)).toEqual(['https://yes.example.com'])
    expect(urls((await list('?nuts=4,5')).body).sort()).toEqual(['https://no.example.com', 'https://yes.example.com'])
  })

  it('the nuts field lists only NUTs that are declared and not supported:false (null is not declared)', async () => {
    const body = (await list('')).body
    expect(mintOf(body, 'https://yes.example.com')['nuts']).toEqual(['11', '12', '21', '22', '4', '5'].sort((a, b) => Number(a) - Number(b)))
    expect(mintOf(body, 'https://no.example.com')['nuts']).toEqual(['4', '5'])
  })

  it('authRequired.clear / blind are false for NUT-21 / NUT-22 with supported:false', async () => {
    const body = (await list('')).body
    expect(mintOf(body, 'https://yes.example.com')['authRequired']).toEqual({ clear: true, blind: true })
    expect(mintOf(body, 'https://no.example.com')['authRequired']).toEqual({ clear: false, blind: false })
  })

  it('the deprecated /recommend route applies the same nuts rule', async () => {
    const r = await request(app).get('/api/mints/recommend?minScore=0&nuts=11')
    expect(r.body.recommended.map((m: { url: string }) => m.url)).toEqual(['https://yes.example.com'])
  })
})

describe('/api/stats NUT coverage', () => {
  it('/api/stats nutAdoption: count and percent skip supported:false', async () => {
    const rows = ROWS.map(r => ({ url: r.url, name: r.name, last_reliability_score: 80, nuts_limits: r.nuts_limits, discovered_at: ago(365), online: true, latency_ms: 100 }))
    query.mockReset()
    query.mockResolvedValueOnce({ rows }).mockResolvedValueOnce({ rows: [{ avg_latency: 100 }] })
    const r = await request(app).get('/api/stats')
    expect(r.status).toBe(200)
    const find = (n: string) => r.body.nutAdoption.find((x: { nut: string }) => x.nut === n)
    expect(find('NUT-11')).toMatchObject({ count: 1, percent: 50 })
    expect(find('NUT-04')).toMatchObject({ count: 2, percent: 100 })
  })
})

describe('probe preview of an unknown mint', () => {
  it('lists only declared, not supported:false NUT keys', async () => {
    query.mockResolvedValue({ rowCount: 0, rows: [] })
    safeFetch.mockImplementation(async (u: string) => u.endsWith('/v1/info')
      ? { ok: true, status: 200, json: async () => ({ name: 'X', version: 'Nutshell/0.16.0', nuts: { '4': {}, '7': { supported: false }, '11': { supported: true } } }) }
      : null)
    const r = await request(app).get('/api/mint/probe?url=https://unknown-host.example').expect(200)
    expect(Object.keys(r.body.info.nuts).sort()).toEqual(['11', '4'])
  })
})
