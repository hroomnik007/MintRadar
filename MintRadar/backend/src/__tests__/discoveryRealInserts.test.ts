import { describe, it, expect, vi, beforeEach } from 'vitest'

// The kind:38172 upsert (INSERT ... ON CONFLICT DO UPDATE) reports rowCount 1 for an UPDATE as well, so the
// "added N new" log claimed every re-announced mint as new. It now counts only really inserted rows
// (RETURNING (xmax = 0) AS inserted).

const { queryMock, events } = vi.hoisted(() => ({ queryMock: vi.fn(), events: [] as unknown[] }))

vi.mock('../db.js', () => ({ pool: { query: queryMock } }))
vi.mock('../prober.js', () => ({ probeMintToDb: vi.fn(), isValidCashuMint: vi.fn().mockResolvedValue(true) }))
vi.mock('../ssrf.js', () => ({ safeFetch: vi.fn(), readJsonLimited: vi.fn(), RESPONSE_CAPS: {} }))
vi.mock('nostr-tools', () => ({
  verifyEvent: () => true,
  SimplePool: class {
    trackRelays = false
    onRelayConnectionFailure: unknown = null
    seenOn = new Map()
    querySync = vi.fn(async (_relays: string[], filter: { kinds: number[] }) => (filter.kinds[0] === 38172 ? events : []))
    destroy() {}
  },
}))

import { discoverMintsFromNostr } from '../discovery.js'

const ev = (id: string, url: string) => ({ id, pubkey: 'pk', created_at: 1_700_000_000, kind: 38172, tags: [['u', url], ['d', id]] })

beforeEach(() => {
  queryMock.mockReset()
  events.length = 0
})

describe('discovery log: added N new counts real inserts only', () => {
  it('2 announced mints, 1 already tracked (DO UPDATE) and 1 new: "added 1 new"', async () => {
    events.push(ev('a', 'https://old.example'), ev('b', 'https://new.example'))
    queryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (/INSERT INTO mints \(url, is_known, nostr_announced_at/.test(sql)) {
        expect(sql).toMatch(/RETURNING \(xmax = 0\) AS inserted/)
        const isNew = params[0] === 'https://new.example'
        return { rowCount: 1, rows: [{ inserted: isNew }] } // rowCount is 1 either way
      }
      return { rowCount: 0, rows: [] }
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const added = await discoverMintsFromNostr()
    expect(added).toBe(1)
    expect(log.mock.calls.map(c => String(c[0]))).toContain('[discovery] kind:38172 found 2 mints, added 1 new')
  })

  it('all already tracked: "added 0 new"', async () => {
    events.push(ev('a', 'https://old.example'), ev('b', 'https://older.example'))
    queryMock.mockImplementation(async () => ({ rowCount: 1, rows: [{ inserted: false }] }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await discoverMintsFromNostr()).toBe(0)
    expect(log.mock.calls.map(c => String(c[0]))).toContain('[discovery] kind:38172 found 2 mints, added 0 new')
  })
})
