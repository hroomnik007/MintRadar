import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory stand-in for the statements auditCzNetwork.ts issues. HTTP (safeFetch / readJsonLimited) is mocked.
const { db, fetchMock, readMock, poolMock, connectMock } = vi.hoisted(() => {
  const db = { mints: new Map<string, Record<string, unknown>>(), writes: [] as unknown[][] }
  const poolMock = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT url, page FROM audit_cz_mints')) {
        return { rows: [...db.mints.values()].map(r => ({ url: r['url'], page: r['page'] })) }
      }
      return { rows: [] }
    }),
    connect: vi.fn(),
  }
  const connectMock = {
    query: vi.fn(async (sql: string, p?: unknown[]) => {
      if (sql.startsWith('UPDATE audit_cz_mints')) {
        const url = p![0] as string
        const row = db.mints.get(url)
        if (row) {
          row['network30_paid'] = p![1]
          row['network30_failed'] = p![2]
          row['network30_amount'] = p![3]
          row['network30_avg_ms'] = p![4]
          row['network30_dest_paid'] = p![5]
          row['network30_dest_failed'] = p![6]
          row['network30_dest_amount'] = p![7]
          row['network30_source_paid'] = p![8]
          row['network30_source_failed'] = p![9]
          row['network30_source_amount'] = p![10]
          row['network30_fetched_at'] = new Date('2026-11-21T10:00:00Z')
        }
        db.writes.push(p as unknown[])
      }
      return { rows: [] }
    }),
    release: vi.fn(),
  }
  poolMock.connect.mockImplementation(async () => connectMock)
  return { db, fetchMock: vi.fn(), readMock: vi.fn(), poolMock, connectMock }
})

vi.mock('../db.js', () => ({ pool: poolMock }))
vi.mock('../ssrf.js', () => ({
  safeFetch: fetchMock,
  readJsonLimited: readMock,
  RESPONSE_CAPS: { auditCzNetwork: 1024 * 1024 },
}))

import {
  parseAuditCzNetworkEdge, parseAuditCzNetwork, sumNetworkEdgesForMint, sumNetwork30dByMint,
  syncAuditCzNetwork, AUDIT_CZ_NETWORK_URL,
} from '../auditCzNetwork.js'

const ID_A = 'mintaaaa01'
const ID_B = 'mintbbbb02'
const ID_C = 'mintcccc03'
const URL_A = 'https://a.example/Bitcoin'
const URL_B = 'https://b.example'
const URL_C = 'https://c.example'
const PAGE = (id: string) => `https://cashu.info/mint/${id}`

const edge = (o: Record<string, unknown>) => ({
  source: ID_A, dest: ID_B, paid: 0, failed: 0, pending: 0, amount: 0, avgMs: null, ...o,
})

beforeEach(() => {
  db.mints.clear()
  db.writes.length = 0
  fetchMock.mockReset()
  readMock.mockReset()
  connectMock.query.mockClear()
  connectMock.release.mockClear()
  poolMock.connect.mockClear()
  poolMock.query.mockClear()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('parseAuditCzNetwork', () => {
  it('accepts a valid 30d graph and skips a bad edge', () => {
    const edges = parseAuditCzNetwork({
      range: '30d',
      edges: [edge({ paid: 4, failed: 1, amount: 40, avgMs: 120 }), { source: 'nope', dest: ID_B, paid: 1 }, null],
    })
    expect(edges).toHaveLength(1)
    expect(edges![0]).toEqual({ source: ID_A, dest: ID_B, paid: 4, failed: 1, pending: 0, amount: 40, avgMs: 120 })
  })

  it('rejects a bad wrapper, a non-array edges, or a range other than 30d', () => {
    expect(parseAuditCzNetwork(null)).toBeNull()
    expect(parseAuditCzNetwork({ edges: {} })).toBeNull()
    expect(parseAuditCzNetwork({ range: '7d', edges: [] })).toBeNull()
    expect(parseAuditCzNetworkEdge({ source: ID_A, dest: 'x', paid: 1 })).toBeNull()
    expect(parseAuditCzNetworkEdge({ source: ID_A, dest: ID_B, paid: -1, failed: 0, amount: 0, avgMs: 10 })).toEqual({
      source: ID_A, dest: ID_B, paid: 0, failed: 0, pending: 0, amount: 0, avgMs: 10,
    })
  })
})

describe('direction mapping (dest = deposits, source = withdrawals)', () => {
  // Recorded-shape fixture: the same 7-day sums cashu.info reports on swaps7d.asDest / asSource
  // for two mints, expressed as network edges. dest paid/failed/amount matches asDest; source matches asSource.
  // Live cashu.info 7d network vs /mints/{id} was checked the same way for several covered mints.
  const edges = [
    edge({ source: ID_A, dest: ID_B, paid: 10, failed: 1, amount: 100, avgMs: 200 }), // A withdrawals, B deposits
    edge({ source: ID_C, dest: ID_A, paid: 5, failed: 2, amount: 50, avgMs: 100 }),  // A deposits, C withdrawals
    edge({ source: ID_C, dest: ID_B, paid: 3, failed: 0, amount: 30, avgMs: 50 }),   // unrelated to the A-vs-detail check
  ]

  it('sums dest as deposits (asDest) and source as withdrawals (asSource), with a paid-weighted avgMs', () => {
    const a = sumNetworkEdgesForMint(edges, ID_A)
    expect(a).toEqual({
      paid: 15, failed: 3, amount: 150, avgMs: Math.round((200 * 10 + 100 * 5) / 15),
      destPaid: 5, destFailed: 2, destAmount: 50,
      sourcePaid: 10, sourceFailed: 1, sourceAmount: 100,
    })
    // Official-style 7d detail for mint A would be: asDest { success: 5, failed: 2, total: 7, amount: 50 }
    // and asSource { success: 10, failed: 1, total: 11, amount: 100 }.
    expect(a.destPaid).toBe(5)
    expect(a.sourcePaid).toBe(10)

    const b = sumNetworkEdgesForMint(edges, ID_B)
    expect(b.destPaid).toBe(13)
    expect(b.sourcePaid).toBe(0)
    expect(b.paid).toBe(13)
    expect(b.avgMs).toBe(Math.round((200 * 10 + 50 * 3) / 13))
  })

  it('returns zeros for a mint that is not on any edge', () => {
    const z = sumNetworkEdgesForMint(edges, 'mintzzzz99')
    expect(z).toEqual({
      paid: 0, failed: 0, amount: 0, avgMs: null,
      destPaid: 0, destFailed: 0, destAmount: 0,
      sourcePaid: 0, sourceFailed: 0, sourceAmount: 0,
    })
  })

  it('indexes every mint that appears on an edge', () => {
    const by = sumNetwork30dByMint(edges)
    expect([...by.keys()].sort()).toEqual([ID_A, ID_B, ID_C].sort())
    expect(by.get(ID_C)?.sourcePaid).toBe(8)
    expect(by.get(ID_C)?.destPaid).toBe(0)
  })
})

describe('syncAuditCzNetwork', () => {
  const seed = () => {
    db.mints.set(URL_A, { url: URL_A, page: PAGE(ID_A), attributed_failures: 2 })
    db.mints.set(URL_B, { url: URL_B, page: PAGE(ID_B), attributed_failures: 0 })
    db.mints.set(URL_C, { url: URL_C, page: 'https://evil.example/mint/' + ID_C, attributed_failures: 0 }) // bad page, skipped
    db.mints.set('https://quiet.example', { url: 'https://quiet.example', page: PAGE('mintquiet1'), attributed_failures: 0 })
  }

  const feed = (body: unknown) => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, url: AUDIT_CZ_NETWORK_URL })
    readMock.mockResolvedValue(body)
  }

  it('stores dest/source totals and writes zeros for a covered mint with no edges', async () => {
    seed()
    feed({
      range: '30d',
      edges: [
        edge({ source: ID_A, dest: ID_B, paid: 10, failed: 1, amount: 100, avgMs: 200 }),
        edge({ source: ID_C, dest: ID_A, paid: 5, failed: 2, amount: 50, avgMs: 100 }),
      ],
    })
    const r = await syncAuditCzNetwork()
    expect(r).toMatchObject({ fetched: true, stored: 3, skipped: 1, failed: false })
    expect(fetchMock).toHaveBeenCalledWith(AUDIT_CZ_NETWORK_URL, expect.objectContaining({ headers: { Accept: 'application/json' } }))
    const a = db.mints.get(URL_A)!
    expect(a['network30_paid']).toBe(15)
    expect(a['network30_failed']).toBe(3)
    expect(a['network30_dest_paid']).toBe(5)
    expect(a['network30_source_paid']).toBe(10)
    expect(a['network30_avg_ms']).toBe(Math.round((200 * 10 + 100 * 5) / 15))
    const quiet = db.mints.get('https://quiet.example')!
    expect(quiet['network30_paid']).toBe(0)
    expect(quiet['network30_failed']).toBe(0)
    expect(quiet['network30_avg_ms']).toBeNull()
    expect(quiet['network30_fetched_at']).toBeInstanceOf(Date)
    expect(db.mints.get(URL_C)!['network30_paid']).toBeUndefined()
  })

  it('a failed fetch, oversize body, or unusable graph writes nothing', async () => {
    seed()
    const before = JSON.stringify([...db.mints])
    fetchMock.mockResolvedValue(null)
    expect((await syncAuditCzNetwork()).failed).toBe(true)
    expect(poolMock.connect).not.toHaveBeenCalled()
    expect(JSON.stringify([...db.mints])).toBe(before)

    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    expect((await syncAuditCzNetwork()).failed).toBe(true)

    fetchMock.mockResolvedValue({ ok: true })
    readMock.mockRejectedValue(new Error('too large'))
    expect((await syncAuditCzNetwork()).failed).toBe(true)
    expect(JSON.stringify([...db.mints])).toBe(before)

    readMock.mockResolvedValue({ range: '7d', edges: [] })
    const skip = await syncAuditCzNetwork()
    expect(skip).toMatchObject({ fetched: true, stored: 0, skipped: 1, failed: false })
    expect(poolMock.connect).not.toHaveBeenCalled()
    expect(JSON.stringify([...db.mints])).toBe(before)
  })
})
