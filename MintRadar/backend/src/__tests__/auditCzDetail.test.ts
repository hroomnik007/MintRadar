import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const { db, queryMock, fetchMock, readMock, targets } = vi.hoisted(() => {
  const db = { details: new Map<string, { detail: unknown; fetched_at: Date }>() }
  const targets: { rows: Array<{ url: string; page: string | null }> } = { rows: [] }
  const queryMock = vi.fn(async (sql: string, p?: unknown[]) => {
    if (sql.includes('FROM audit_cz_mints m')) return { rows: targets.rows }
    if (sql.includes('INSERT INTO audit_cz_detail')) {
      db.details.set(p?.[0] as string, { detail: JSON.parse(p?.[1] as string), fetched_at: new Date() })
      return { rows: [] }
    }
    return { rows: [] }
  })
  return { db, queryMock, fetchMock: vi.fn(), readMock: vi.fn(), targets }
})

vi.mock('../db.js', () => ({ pool: { query: queryMock } }))
vi.mock('../prober.js', () => ({ probeMintToDb: vi.fn(), isValidCashuMint: vi.fn() }))
vi.mock('../ssrf.js', () => ({
  safeFetch: fetchMock,
  readJsonLimited: readMock,
  RESPONSE_CAPS: { auditCzMints: 1048576, auditCzSwaps: 1048576, auditCzMintDetail: 65536 },
}))

import { parseAuditCzDetailFull, syncAuditCzDetails } from '../auditCzDetail.js'

const ID = 'cmmx4oml50000a5l3z6b7qr83'

// Same shape as the real GET /api/v1/mints/{id} of mint.lnpay.cz (daily shortened).
const real = () => ({
  id: ID, url: 'https://mint.lnpay.cz', name: 'LNpay Mint', state: 'ok', reasons: [], score: 100,
  scoreParts: [{ key: 'uptime', label: 'Availability, 30 days', weight: 40, score: 100, detail: 'IGNORE ME <script>' }],
  uptime: { '24h': 100, '7d': 100, '30d': 100, '90d': 100 }, uptimeFrankfurt7d: 100,
  daily: [{ day: '2026-07-10', uptime: null, checks: 0 }],
  latency7d: { prague: { p50: 41, p95: 53, max: 314, samples: 2009 }, timings: { prague: { dns: 1, connect: 9, tls: 14, ttfb: 16, samples: 2009 }, frankfurt: { dns: 3, connect: 3, tls: 68, ttfb: 8, samples: 856 } } },
  incidents7d: [],
  swaps7d: {
    all: { total: 126, success: 107, failed: 19, successRate: 84.9, amount: 16052, fees: 302, avgMs: 8289 },
    asSource: { total: 64, success: 51, failed: 13, successRate: 79.7, amount: 12642, fees: 156, avgMs: 11719 },
    asDest: { total: 62, success: 56, failed: 6, successRate: 90.3, amount: 3410, fees: 146, avgMs: 5166 },
    errorsBlamed: 0, melts: 50, quoteMs: 306, meltMs: 1342, mintMs: 166, dleq: { valid: 56, invalid: 0, missing: 0 },
  },
  spec: { version: 'Nutshell/0.21.0', pubkey: '025a3b7f', nuts: ['4'], methods: [], inputFeePpk: 100, websockets: true, onionUrl: null, tosUrl: null },
  network: { ipv4: true, ipv6: true, asn: 14061, asName: 'DIGITALOCEAN-ASN - DigitalOcean, LLC, US', country: 'US', tlsIssuer: "Let's Encrypt", tlsExpiresAt: '2026-12-27T08:59:17.000Z' },
  integrity: {
    swap_test: { ok: true, ms: 139, timestamp: 1791337568797, detail: { inputs: 1, outputs: 1, amount: 2, fee: 1, dleq: 'valid' }, recentOk: 7, recentFail: 0 },
    proof_state: { ok: true, ms: 99, timestamp: 1791337568658, detail: { checked: 9, spent: 0, spentSat: 0, pending: 0 }, recentOk: 7, recentFail: 0 },
  },
  changes: [], reviews: { count: 0, rated: 0, average: null }, page: `https://cashu.info/mint/${ID}`,
})

const EXPECTED = {
  swaps7d: {
    all: { total: 126, success: 107, failed: 19, avgMs: 8289 },
    asSource: { total: 64, success: 51, failed: 13, avgMs: 11719 },
    asDest: { total: 62, success: 56, failed: 6, avgMs: 5166 },
    errorsBlamed: 0, dleq: { valid: 56, invalid: 0, missing: 0 },
  },
  integrity: {
    proof_state: { checked: 9, spent: 0, pending: 0 },
  },
}

describe('parseAuditCzDetailFull', () => {
  it('keeps exactly the stored subset of a real-shaped response', () => {
    expect(parseAuditCzDetailFull(real(), ID)).toEqual(EXPECTED)
  })

  const refPath = '/home/citizenseven/Claude/refs/cashu-info-detail-lnpay.json'
  it.skipIf(!existsSync(refPath))('also holds for the reference file (read in place, never copied into the repo)', () => {
    expect(parseAuditCzDetailFull(JSON.parse(readFileSync(refPath, 'utf8')), ID)).toEqual(EXPECTED)
  })

  it('never stores score, scoreParts, reviews, daily, changes, incidents, Frankfurt, spec details or an IP', () => {
    const json = JSON.stringify(parseAuditCzDetailFull(real(), ID))
    for (const k of ['scoreParts', 'score', 'reviews', 'daily', 'changes', 'incidents', 'frankfurt', 'uptime', 'pubkey', 'nuts', 'version', 'IGNORE ME', 'samples', 'max']) {
      expect(json).not.toContain(k)
    }
  })

  it('never keeps the onion address, network facts or the spec (the Network card is measured by us)', () => {
    const r = real(); r.spec.onionUrl = 'http://abcdefghijklmnop.onion' as never
    const out = parseAuditCzDetailFull(r, ID)
    expect(out).not.toHaveProperty('onion')
    expect(out).not.toHaveProperty('network')
    expect(JSON.stringify(out)).not.toContain('.onion')
  })

  it('drops only the malformed fields', () => {
    type Counts = { total: unknown; success: unknown; avgMs: unknown }
    const r = real() as unknown as {
      swaps7d: { all: Counts; asSource: Counts; asDest: Counts; errorsBlamed: unknown }
      integrity: { proof_state: { detail: { checked: unknown } } }
    }
    r['swaps7d'].all.total = -1
    r['swaps7d'].asSource.success = 1e9
    r['swaps7d'].asDest.avgMs = 600_000
    r['swaps7d'].errorsBlamed = '0'
    r['integrity'].proof_state.detail.checked = 1.5
    const out = parseAuditCzDetailFull(r, ID)!
    expect(out.swaps7d?.all).toEqual({ success: 107, failed: 19, avgMs: 8289 })
    expect(out.swaps7d?.asSource).toEqual({ total: 64, failed: 13, avgMs: 11719 })
    expect(out.swaps7d?.asDest).toEqual({ total: 62, success: 56, failed: 6 })
    expect(out.swaps7d).not.toHaveProperty('errorsBlamed')
    expect(out.integrity?.proof_state).not.toHaveProperty('checked')
  })

  it('wrong types and missing blocks: only the usable blocks remain', () => {
    expect(parseAuditCzDetailFull({ swaps7d: 'x', integrity: [] }, ID)).toBeNull()
    expect(parseAuditCzDetailFull({ network: { asn: 14061 } }, ID)).toBeNull() // network facts are not stored any more
    const r = real() as Record<string, unknown>; delete r['integrity']
    const out = parseAuditCzDetailFull(r, ID)!
    expect(Object.keys(out)).toEqual(['swaps7d'])
  })

  it('every optional field missing: a bare object is skipped, not stored empty', () => {
    expect(parseAuditCzDetailFull({}, ID)).toBeNull()
    expect(parseAuditCzDetailFull({ swaps7d: {}, integrity: {} }, ID)).toBeNull()
  })

  it('a malformed top level skips the mint', () => {
    for (const bad of [null, undefined, 'x', 5, [], [real()]]) expect(parseAuditCzDetailFull(bad, ID)).toBeNull()
    expect(parseAuditCzDetailFull({ ...real(), id: 'someoneelse01' }, ID)).toBeNull() // body of another mint
  })
})

describe('syncAuditCzDetails', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://m${i}.example`, page: `https://cashu.info/mint/mintid${String(i).padStart(4, '0')}` }))
  beforeEach(() => {
    db.details.clear(); queryMock.mockClear(); fetchMock.mockReset(); readMock.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    readMock.mockImplementation(async () => ({ ...real(), id: undefined }))
  })

  it('fetches sequentially with a pause between requests (not before the first, not after the last)', async () => {
    targets.rows = mk(3)
    const events: string[] = []
    fetchMock.mockImplementation(async (u: string) => { events.push(`fetch ${u.split('/').pop()}`); return { ok: true, status: 200 } })
    readMock.mockImplementation(async () => ({ ...real(), id: undefined }))
    const sleep = vi.fn(async (ms: number) => { events.push(`sleep ${ms}`) })
    const stats = await syncAuditCzDetails({ sleep })
    expect(events).toEqual(['fetch mintid0000', 'sleep 2000', 'fetch mintid0001', 'sleep 2000', 'fetch mintid0002'])
    expect(stats).toMatchObject({ fetched: 3, stored: 3, skipped: 0, failed: 0, deferred: 0 })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cashu.info/api/v1/mints/mintid0000')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ timeoutMs: 15000 })
  })

  it('stops at the budget and defers the rest to the next run', async () => {
    targets.rows = mk(5)
    let t = 0
    const stats = await syncAuditCzDetails({ budgetMs: 25 * 60_000, now: () => t, sleep: async ms => { t += ms + 13 * 60_000 } })
    expect(stats.fetched).toBe(3)
    expect(stats.deferred).toBe(2)
    expect(stats.fetched + stats.deferred).toBe(5)
  })

  it('selects oldest fetched_at first and only covered tracked mints', async () => {
    targets.rows = []
    await syncAuditCzDetails({ sleep: async () => {} })
    const sql = String(queryMock.mock.calls[0]?.[0])
    expect(sql).toContain('ORDER BY d.fetched_at ASC NULLS FIRST')
    expect(sql).toContain('FROM mints')
    expect(sql).toContain('m.page IS NOT NULL')
  })

  it('takes the id only from a valid stored page URL; anything else is skipped without a request', async () => {
    targets.rows = [
      { url: 'https://a.example', page: null },
      { url: 'https://b.example', page: 'https://evil.example/mint/mintid0001' },
      { url: 'https://c.example', page: 'https://cashu.info/mint/x' },
      { url: 'https://d.example', page: 'https://cashu.info/mint/../../etc' },
      { url: 'https://e.example', page: 'https://audit.cashu.cz/mint/mintid0005' },
    ]
    const stats = await syncAuditCzDetails({ sleep: async () => {} })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cashu.info/api/v1/mints/mintid0005')
    expect(stats.skipped).toBe(4)
  })

  it('a failed or oversized fetch keeps the stored row and deletes nothing', async () => {
    targets.rows = mk(3)
    db.details.set('https://m0.example', { detail: { network: { asn: 1 } }, fetched_at: new Date('2026-10-01') })
    db.details.set('https://m1.example', { detail: { network: { asn: 2 } }, fetched_at: new Date('2026-10-01') })
    fetchMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValueOnce({ ok: true, status: 200 })
    readMock.mockRejectedValueOnce(new Error('too big'))
    const stats = await syncAuditCzDetails({ sleep: async () => {} })
    expect(stats).toMatchObject({ failed: 3, stored: 0 })
    expect(db.details.get('https://m0.example')?.detail).toEqual({ network: { asn: 1 } })
    expect(db.details.get('https://m1.example')?.detail).toEqual({ network: { asn: 2 } })
    expect(queryMock.mock.calls.some(c => /DELETE/i.test(String(c[0])))).toBe(false)
  })

  it('a malformed body is skipped and an existing row survives', async () => {
    targets.rows = mk(1)
    db.details.set('https://m0.example', { detail: { network: { asn: 7 } }, fetched_at: new Date('2026-10-01') })
    readMock.mockResolvedValue('<html>')
    const stats = await syncAuditCzDetails({ sleep: async () => {} })
    expect(stats).toMatchObject({ fetched: 1, stored: 0, skipped: 1 })
    expect(db.details.get('https://m0.example')?.detail).toEqual({ network: { asn: 7 } })
  })

  it('logs one line with counts only', async () => {
    targets.rows = mk(2)
    await syncAuditCzDetails({ sleep: async () => {} })
    const calls = [...(console.log as ReturnType<typeof vi.fn>).mock.calls, ...(console.warn as ReturnType<typeof vi.fn>).mock.calls]
    expect(calls).toHaveLength(1)
    expect(String(calls[0]?.[0])).toMatch(/^\[audit-cz\] cashu\.info detail run: 2 fetched, 2 stored, 0 skipped, 0 failed, \d+ s$/)
  })

  it('stores the validated subset as JSON keyed by the audit mint URL', async () => {
    targets.rows = mk(1)
    await syncAuditCzDetails({ sleep: async () => {} })
    expect(db.details.get('https://m0.example')?.detail).toEqual(EXPECTED)
  })
})
