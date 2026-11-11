import { describe, it, expect, vi, beforeEach } from 'vitest'

// NIP-87 discovery is untrusted input: a discovered URL needs the 'nostr' daily budget (separate from the budget of
// mints people add by hand) and the stronger /v1/info + /v1/keys probe before it is inserted, and the row records
// added_via = 'nostr' so the budget can count it.

const { queryMock, events, functioning } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  events: [] as unknown[],
  functioning: vi.fn(),
}))

vi.mock('../db.js', () => ({ pool: { query: queryMock } }))
vi.mock('../prober.js', () => ({ probeMintToDb: vi.fn(), isValidCashuMint: vi.fn().mockResolvedValue(true), isFunctioningCashuMint: functioning }))
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
import { NEW_NOSTR_MINTS_PER_DAY, NEW_MANUAL_MINTS_PER_DAY } from '../mintAdmission.js'

const ev = (id: string, url: string) => ({ id, pubkey: 'pk', created_at: 1_700_000_000, kind: 38172, tags: [['u', url], ['d', id]] })

/** The mints table the admission query sees, then an insert answer for any INSERT. */
function withMints(rows: { url: string; added_via: string | null; recent: boolean }[]) {
  queryMock.mockImplementation(async (sql: string) => {
    if (/FROM mints$/.test(sql.trim()) && /added_via/.test(sql)) return { rowCount: rows.length, rows }
    if (/INSERT INTO mints/.test(sql)) return { rowCount: 1, rows: [{ inserted: true }] }
    return { rowCount: 0, rows: [] }
  })
}
const inserts = () => queryMock.mock.calls.filter(c => /INSERT INTO mints/.test(String(c[0])))

beforeEach(() => {
  queryMock.mockReset()
  functioning.mockReset().mockResolvedValue(true)
  events.length = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('NIP-87 discovery admission', () => {
  it('inserts a working new mint with added_via = nostr', async () => {
    events.push(ev('a', 'https://mint.new.example'))
    withMints([])
    expect(await discoverMintsFromNostr()).toBe(1)
    expect(functioning).toHaveBeenCalledWith('https://mint.new.example')
    expect(inserts()).toHaveLength(1)
    expect(String(inserts()[0]![0])).toMatch(/added_via\)\s+VALUES \(\$1, true, to_timestamp\(\$2\), \$3, \$4, \$5, 'nostr'\)/)
  })

  it('does not insert a URL that fails the /v1/info + /v1/keys probe', async () => {
    events.push(ev('a', 'https://fake.example'))
    withMints([])
    functioning.mockResolvedValue(false)
    expect(await discoverMintsFromNostr()).toBe(0)
    expect(inserts()).toHaveLength(0)
  })

  it('stops at the nostr budget without probing, whatever the manual count', async () => {
    events.push(ev('a', 'https://mint.one-more.example'))
    withMints(Array.from({ length: NEW_NOSTR_MINTS_PER_DAY }, (_, i) => ({ url: `https://mint.n${i}.example`, added_via: 'nostr', recent: true })))
    expect(await discoverMintsFromNostr()).toBe(0)
    expect(functioning).not.toHaveBeenCalled()
    expect(inserts()).toHaveLength(0)
  })

  it('a full manual budget does not stop discovery', async () => {
    events.push(ev('a', 'https://mint.discovered.example'))
    withMints(Array.from({ length: NEW_MANUAL_MINTS_PER_DAY }, (_, i) => ({ url: `https://mint.m${i}.example`, added_via: 'manual', recent: true })))
    expect(await discoverMintsFromNostr()).toBe(1)
  })
})
