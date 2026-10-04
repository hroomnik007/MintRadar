import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory stand-in for the audit_cz_* tables. It recognises only the statements
// auditCz.ts issues (by SQL text), so the tests exercise the real sync/read code
// with the HTTP boundary (safeFetch/readJsonLimited) and the pool mocked.
const { db, fetchMock, readMock, poolMock } = vi.hoisted(() => {
  const db = {
    mints: new Map<string, Record<string, unknown>>(),
    aliases: new Map<string, string>(),
    swaps: new Map<string, Record<string, unknown>>(),
  }
  const exec = (sql: string, p: unknown[] = []) => {
    if (sql.includes('INSERT INTO audit_cz_mints')) {
      db.mints.set(p[0] as string, { url: p[0], state: p[1], uptime24h: p[2], uptime7d: p[3], uptime30d: p[4], attributed_failures: p[5], last_check: p[6], page: p[7], fetched_at: new Date('2026-10-04T10:00:00Z') })
    } else if (sql.includes('INSERT INTO audit_cz_aliases')) {
      db.aliases.set(p[0] as string, p[1] as string)
    } else if (sql.includes('INSERT INTO audit_cz_swaps')) {
      db.swaps.set(p[0] as string, { id: p[0], at: new Date(p[1] as string), status: p[2], stage: p[3], error: p[4], amount: p[5], fee: p[6], duration_ms: p[7], from_url: p[8], to_url: p[9], from_name: p[10], to_name: p[11] })
    } else if (sql.includes('FROM audit_cz_mints') && sql.includes('WHERE url = $1')) {
      const k = p[0] as string
      const hit = db.mints.get(k) ?? db.mints.get(db.aliases.get(k) ?? '')
      return { rows: hit ? [hit] : [] }
    } else if (sql.includes('MAX(fetched_at)')) {
      return { rows: [{ fetched_at: null }] }
    } else if (sql.includes('SELECT alias_url')) {
      return { rows: [...db.aliases].filter(([, m]) => m === p[0]).map(([a]) => ({ alias_url: a })) }
    } else if (sql.includes('FROM audit_cz_swaps') && sql.includes('ANY($1)')) {
      const urls = p[0] as string[]
      const rows = [...db.swaps.values()]
        .filter(s => urls.includes(s['from_url'] as string) || urls.includes(s['to_url'] as string))
        .sort((a, b) => (b['at'] as Date).getTime() - (a['at'] as Date).getTime())
        .slice(0, 20)
      return { rows }
    }
    return { rows: [] } // BEGIN/COMMIT/DELETE prune
  }
  const poolMock = {
    query: vi.fn(async (sql: string, p?: unknown[]) => exec(sql, p)),
    connect: vi.fn(async () => {
      // transaction: stage writes, apply on COMMIT, drop on ROLLBACK
      let staged: Array<[string, unknown[] | undefined]> = []
      return {
        query: async (sql: string, p?: unknown[]) => {
          if (sql === 'BEGIN') { staged = []; return { rows: [] } }
          if (sql === 'COMMIT') { for (const [s, a] of staged) exec(s, a); return { rows: [] } }
          if (sql === 'ROLLBACK') { staged = []; return { rows: [] } }
          staged.push([sql, p])
          return { rows: [] }
        },
        release: vi.fn(),
      }
    }),
  }
  return { db, fetchMock: vi.fn(), readMock: vi.fn(), poolMock }
})

vi.mock('../db.js', () => ({ pool: poolMock }))
vi.mock('../prober.js', () => ({ probeMintToDb: vi.fn(), isValidCashuMint: vi.fn() }))
vi.mock('../ssrf.js', () => ({
  safeFetch: fetchMock,
  readJsonLimited: readMock,
  RESPONSE_CAPS: { auditCzMints: 1048576, auditCzSwaps: 1048576 },
}))

import { auditCzKey, parseAuditCzMintsResponse, parseAuditCzSwapsResponse, syncAuditCz, getAuditCzForMint, getAuditCzSyncStatus } from '../auditCz.js'

const mint = (o: Record<string, unknown> = {}) => ({
  id: 'm1', url: 'https://mint.minibits.cash/Bitcoin', isTest: false, aliases: [], name: 'Minibits', state: 'ok',
  reasons: [], score: 90, uptime24h: 99.5, uptime7d: 98, uptime30d: 97, latencyMs24h: 120, version: 'x',
  swaps: { minted: 3, melted: 2, attributedFailures: 1 }, lastCheck: '2026-10-04T09:58:00Z', page: 'https://audit.cashu.cz/mint/m1', ...o,
})
const swap = (o: Record<string, unknown> = {}) => ({
  id: 's1', at: '2026-10-04T09:00:00Z', kind: 'x', status: 'success', stage: null, error: null, amount: 10, fee: 1, durationMs: 900,
  from: { id: 'm1', url: 'https://mint.minibits.cash/Bitcoin', name: 'Minibits' },
  to: { id: 'm2', url: 'https://other.example', name: 'Other' }, ...o,
})

const feed = (mints: unknown[], swaps: unknown[]) => {
  fetchMock.mockImplementation(async (url: string) => ({ ok: true, status: 200, url }))
  readMock.mockImplementation(async (res: { url: string }) => (res.url.includes('/mints') ? { generatedAt: 'x', mints } : { swaps }))
}

beforeEach(() => {
  db.mints.clear(); db.aliases.clear(); db.swaps.clear()
  fetchMock.mockReset(); readMock.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('URL mapping', () => {
  it('normalises case and trailing slash but keeps the path', () => {
    expect(auditCzKey('https://Mint.Minibits.cash/')).toBe('https://mint.minibits.cash')
    expect(auditCzKey('https://mint.minibits.cash/Bitcoin/')).toBe('https://mint.minibits.cash/Bitcoin')
    expect(auditCzKey('https://mint.minibits.cash/Bitcoin')).not.toBe(auditCzKey('https://mint.minibits.cash'))
  })

  it('matches by url, case-insensitive host, and not on a different path or host', async () => {
    feed([mint()], [])
    await syncAuditCz()
    expect((await getAuditCzForMint('https://MINT.minibits.cash/Bitcoin/')).covered).toBe(true)
    expect((await getAuditCzForMint('https://mint.minibits.cash')).covered).toBe(false)
    expect((await getAuditCzForMint('https://mint.minibits.cash/Other')).covered).toBe(false)
    expect((await getAuditCzForMint('https://elsewhere.example/Bitcoin')).covered).toBe(false)
  })

  it('matches a tracked mint stored under an alias URL, including its swaps', async () => {
    feed(
      [mint({ id: 'sat', url: 'https://mint.satscribe.me', aliases: ['https://satscribe.me/cashu'], page: 'https://audit.cashu.cz/mint/sat' })],
      [swap({ id: 'a', from: { id: 'sat', url: 'https://mint.satscribe.me', name: 'Sat' } })],
    )
    await syncAuditCz()
    const r = await getAuditCzForMint('https://satscribe.me/cashu')
    expect(r.covered).toBe(true)
    expect(r.sourceUrl).toBe('https://audit.cashu.cz/mint/sat')
    expect(r.swaps).toHaveLength(1)
    expect(r.swaps[0]).toMatchObject({ direction: 'from', otherMintUrl: 'https://other.example' })
  })

  it('stores audit mints we do not track but never touches any other table', async () => {
    feed([mint({ url: 'https://untracked.example' })], [])
    await syncAuditCz()
    expect(db.mints.has('https://untracked.example')).toBe(true)
    expect(poolMock.query.mock.calls.every(c => !String(c[0]).includes('INTO mints'))).toBe(true)
    expect((await getAuditCzForMint('https://tracked.example')).covered).toBe(false)
  })
})

describe('failed fetches leave stored rows untouched', () => {
  const seed = async () => {
    feed([mint()], [swap({ id: 's1' }), swap({ id: 's2' })])
    await syncAuditCz()
  }
  const snapshot = () => JSON.stringify([[...db.mints], [...db.aliases], [...db.swaps]])

  const failures: Array<[string, () => void]> = [
    ['timeout / no response', () => { fetchMock.mockResolvedValue(null) }],
    ['HTTP 500', () => { fetchMock.mockResolvedValue({ ok: false, status: 500 }) }],
    ['oversize', () => { fetchMock.mockResolvedValue({ ok: true }); readMock.mockRejectedValue(new Error('too large')) }],
    ['invalid JSON', () => { fetchMock.mockResolvedValue({ ok: true }); readMock.mockRejectedValue(new SyntaxError('bad')) }],
    ['invalid shape', () => { fetchMock.mockResolvedValue({ ok: true }); readMock.mockResolvedValue({ mints: 'nope', swaps: {} }) }],
  ]
  for (const [name, arrange] of failures) {
    it(name, async () => {
      await seed()
      const before = snapshot()
      fetchMock.mockReset(); readMock.mockReset()
      arrange()
      await syncAuditCz()
      expect(snapshot()).toBe(before)
    })
  }

  it('a later success adds only new swaps by id', async () => {
    await seed()
    fetchMock.mockReset(); readMock.mockReset()
    fetchMock.mockResolvedValue(null)
    await syncAuditCz()
    feed([mint()], [swap({ id: 's2' }), swap({ id: 's3', at: '2026-10-04T10:00:00Z' })])
    await syncAuditCz()
    expect([...db.swaps.keys()].sort()).toEqual(['s1', 's2', 's3'])
  })
})

describe('malformed items', () => {
  it('rejects a response with an invalid top-level shape', () => {
    expect(parseAuditCzMintsResponse(null)).toBeNull()
    expect(parseAuditCzMintsResponse({ mints: {} })).toBeNull()
    expect(parseAuditCzSwapsResponse([])).toBeNull()
    expect(parseAuditCzSwapsResponse({ swaps: 'x' })).toBeNull()
  })

  it('skips bad items and keeps the rest', async () => {
    feed(
      [mint(), mint({ id: 'b', url: 'http://plain.example' }), mint({ id: 'c', url: 'https://c.example', state: 'weird' }),
        mint({ id: 'd', url: 'https://d.example', uptime7d: 'high' }), 'junk', mint({ id: 'e', url: 'https://e.example', page: 'https://evil.example/x' })],
      [swap({ id: 'ok' }), swap({ id: 'bad1', status: 'Maybe!' }), swap({ id: 'odd', status: 'cancelled' }), swap({ id: 'bad2', stage: '<b>x</b>' }), swap({ id: 'limits', stage: 'limits' }), swap({ id: 'bad3', amount: Infinity }),
        swap({ id: 'bad4', at: 'not a date' }), null, swap({ id: 'long', error: 'x'.repeat(1000) })],
    )
    const r = await syncAuditCz()
    expect(r).toEqual({ mints: 2, swaps: 4 })
    expect(getAuditCzSyncStatus()).toMatchObject({ mintsStored: 2, swapsStored: 4, skipped: { mints: 4, swaps: 5 } })
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/mints 6 fetched, 2 stored, 4 skipped; swaps 9 fetched, 4 stored, 5 skipped$/))
    expect(db.swaps.get('limits')?.['stage']).toBe('limits')
    expect(db.swaps.get('odd')?.['status']).toBe('cancelled')
    expect(db.mints.get('https://e.example')?.['page']).toBeNull()
    expect((db.swaps.get('long')?.['error'] as string).length).toBe(300)
  })
})
