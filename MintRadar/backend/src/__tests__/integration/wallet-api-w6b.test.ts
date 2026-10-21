import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// W6b: feeExamples, limits and auditByDirection of the wallet API. All three are facts: only with include=facts on the
// list (the default list does not change), always on the single-mint endpoint. The pool is mocked at the db.js
// boundary like wallet-api-w2b.test.ts; the real handlers run.

vi.mock('../../db.js', () => ({ pool: { query: vi.fn() }, initDb: vi.fn() }))
vi.mock('../../versionCatalog.js', () => ({
  getLatestVersionsMap: vi.fn().mockResolvedValue({ nutshell: { major: 0, minor: 21 }, cdk: { major: 0, minor: 18 } }),
}))

let app: Express
let query: ReturnType<typeof vi.fn>

const DAY = 86_400_000
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString()
const SYNCED = '2026-10-21T04:00:00.000Z'

const KEYSETS = [
  { id: '00aaaaaaaaaaaaaa', unit: 'sat', active: true, fee: 100, expiry: null, version: 'v1', valid: true },
  { id: '00bbbbbbbbbbbbbb', unit: 'sat', active: false, fee: 5000, expiry: null, version: 'v1', valid: null },
  { id: '01cccccccccccccc', unit: 'usd', active: true, fee: 0, expiry: null, version: 'v2', valid: true },
]
const DIRECTIONS = { asSource: { total: 64, failed: 13 }, asDest: { total: 62, failed: 6 }, fetchedAt: SYNCED }

function row(url: string, o: Record<string, unknown> = {}) {
  return {
    url, name: 'Mint', icon_url: null, version: 'Nutshell/0.21.0', nut_count: 12,
    nuts_limits: { '4': {}, '5': {} }, units: ['sat'],
    mint_methods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 1000000 }],
    melt_methods: [{ method: 'bolt11', unit: 'sat', min_amount: 5 }],
    pubkey: null, audit_cz_total: 126, audit_cz_blamed: 2, audit_cz_fetched_at: new Date(ago(0.1)),
    discovered_at: ago(200), last_reliability_score: 90, last_error: null,
    review_count: 0, review_avg_rating: null, review_rated_count: 0, review_operator_count: 0,
    total: 288, online_count: 288, total_7d: 2016, online_count_7d: 2016,
    latest_online: true, latest_latency_ms: 120, latest_checked_at: ago(0.001), last_online_at: ago(0.001),
    score_breakdown: null, keysets_checked_at: ago(0.01), keysets_json: KEYSETS, down_since: null, contact_checks: null,
    audit_directions_json: DIRECTIONS,
    ...o,
  }
}

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  query.mockResolvedValue({ rows: [row('https://a.example.com')] })
  ;({ app } = await import('../../index.js'))
})

const list = (qs = '') => request(app).get('/api/wallets/mints' + qs)
const one = (url: string) => request(app).get('/api/wallets/mints/' + encodeURIComponent(url))
const withRows = (rows: unknown[]) => query.mockResolvedValue({ rows })
const KEYS = ['feeExamples', 'limits', 'auditByDirection']

describe('where the W6b facts appear', () => {
  it('the default list has none of them, whatever is stored', async () => {
    for (const qs of ['', '?minScore=0', '?include=keysets,methods,breakdown,changes']) {
      for (const m of (await list(qs)).body.mints) for (const k of KEYS) expect(m, `${qs} ${k}`).not.toHaveProperty(k)
    }
  })

  it('include=facts brings all three; the single-mint endpoint always has them', async () => {
    const m = (await list('?include=facts')).body.mints[0]
    for (const k of KEYS) expect(m, k).toHaveProperty(k)
    const s = (await one('https://a.example.com')).body.mint
    for (const k of KEYS) expect(s, k).toHaveProperty(k)
  })

  it('/api/mints/known does not carry them', async () => {
    const res = await request(app).get('/api/mints/known')
    const ks = Object.keys(res.body[0])
    for (const k of [...KEYS, 'audit_directions_json', 'auditDirections']) expect(ks).not.toContain(k)
  })
})

describe('feeExamples', () => {
  it('per unit with an active keyset: the effective fee and the fee for 1, 16 and 100 proofs (NUT-02, rounded up)', async () => {
    const m = (await one('https://a.example.com')).body.mint
    expect(m.feeExamples).toEqual([
      { unit: 'sat', inputFeePpk: 100, examples: [{ proofs: 1, fee: 1 }, { proofs: 16, fee: 2 }, { proofs: 100, fee: 10 }] },
      { unit: 'usd', inputFeePpk: 0, examples: [{ proofs: 1, fee: 0 }, { proofs: 16, fee: 0 }, { proofs: 100, fee: 0 }] },
    ])
  })

  it('never checked, or a malformed column: an empty array', async () => {
    withRows([row('https://a.example.com', { keysets_json: null, keysets_checked_at: null }), row('https://b.example.com', { keysets_json: { x: 1 } })])
    const body = (await list('?include=facts')).body
    for (const m of body.mints) expect(m.feeExamples).toEqual([])
  })
})

describe('feeExamples: a keyset without a stated fee uses the NUT-02 default 0', () => {
  it('fee null counts as 0, a stated fee of another unit is unchanged, and the keysets field still shows null', async () => {
    withRows([row('https://a.example.com', { keysets_json: [
      { id: '00aaaaaaaaaaaaaa', unit: 'sat', active: true, fee: null, expiry: null, version: 'v1', valid: true },
      { id: '01bbbbbbbbbbbbbb', unit: 'usd', active: true, fee: 100, expiry: null, version: 'v2', valid: true },
    ] })])
    const m = (await one('https://a.example.com')).body.mint
    expect(m.feeExamples).toEqual([
      { unit: 'sat', inputFeePpk: 0, examples: [{ proofs: 1, fee: 0 }, { proofs: 16, fee: 0 }, { proofs: 100, fee: 0 }] },
      { unit: 'usd', inputFeePpk: 100, examples: [{ proofs: 1, fee: 1 }, { proofs: 16, fee: 2 }, { proofs: 100, fee: 10 }] },
    ])
    expect(m.keysets[0].inputFeePpk).toBeNull()
  })
})

describe('limits', () => {
  it('per method and unit, null for a limit the mint does not declare', async () => {
    const m = (await one('https://a.example.com')).body.mint
    expect(m.limits).toEqual({
      mint: [{ method: 'bolt11', unit: 'sat', min: 1, max: 1000000 }],
      melt: [{ method: 'bolt11', unit: 'sat', min: 5, max: null }],
    })
  })

  it('a value that is not a non-negative integer is "not declared" (null), never a number', async () => {
    withRows([row('https://a.example.com', { mint_methods: [{ method: 'bolt11', unit: 'sat', min_amount: '10', max_amount: -1 }, { method: 'bolt12', unit: 'sat', min_amount: 1.5, max_amount: null }] })])
    const m = (await one('https://a.example.com')).body.mint
    expect(m.limits.mint).toEqual([{ method: 'bolt11', unit: 'sat', min: null, max: null }, { method: 'bolt12', unit: 'sat', min: null, max: null }])
  })

  it('null when neither direction is stored', async () => {
    withRows([row('https://a.example.com', { mint_methods: null, melt_methods: null })])
    expect((await one('https://a.example.com')).body.mint.limits).toBeNull()
  })
})

describe('auditByDirection', () => {
  it('mint = swaps as destination, melt = swaps as source, with window, source and the store time', async () => {
    const m = (await one('https://a.example.com')).body.mint
    expect(m.auditByDirection).toEqual({
      mint: { attempts: 62, failures: 6, windowDays: 7, source: 'cashu.info', syncedAt: SYNCED },
      melt: { attempts: 64, failures: 13, windowDays: 7, source: 'cashu.info', syncedAt: SYNCED },
    })
  })

  it('a direction without numbers is null; nothing stored gives two nulls', async () => {
    withRows([
      row('https://a.example.com', { audit_directions_json: { asSource: { total: 4, failed: 0 }, asDest: null, fetchedAt: SYNCED } }),
      row('https://b.example.com', { audit_directions_json: null }),
      row('https://c.example.com', { audit_directions_json: { asSource: { total: 'x', failed: 1 }, asDest: { total: 3 }, fetchedAt: SYNCED } }),
      row('https://d.example.com', { audit_directions_json: { asSource: { total: 4, failed: 1 }, asDest: { total: 3, failed: 0 }, fetchedAt: 'not a time' } }),
    ])
    const by = Object.fromEntries((await list('?include=facts')).body.mints.map((m: { url: string }) => [m.url, m]))
    expect(by['https://a.example.com'].auditByDirection).toEqual({ mint: null, melt: { attempts: 4, failures: 0, windowDays: 7, source: 'cashu.info', syncedAt: SYNCED } })
    expect(by['https://b.example.com'].auditByDirection).toEqual({ mint: null, melt: null })
    expect(by['https://c.example.com'].auditByDirection).toEqual({ mint: null, melt: null })
    expect(by['https://d.example.com'].auditByDirection).toEqual({ mint: null, melt: null })
  })

  it('the score does not use the split: the audit part and the sample are the combined numbers', async () => {
    const m = (await one('https://a.example.com')).body.mint
    expect(m.audit).toMatchObject({ swaps7d: 126, attributedFailures: 2 })
    expect(m.sample.swaps7d).toBe(126)
  })
})
