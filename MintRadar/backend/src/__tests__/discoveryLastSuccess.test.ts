import { describe, it, expect, vi, beforeEach } from 'vitest'

// app_state discovery_last_success_at: written only by a discovery run in which a relay completed the kind:38172 query;
// a run in which every relay failed (or the query timed out) leaves the earlier value alone.

const h = vi.hoisted(() => ({ queryMock: vi.fn(), mode: { value: 'ok' as 'ok' | 'allFailed' | 'rejects' }, store: new Map<string, string>() }))

vi.mock('../db.js', () => ({ pool: { query: h.queryMock } }))
vi.mock('../prober.js', () => ({ probeMintToDb: vi.fn(), isValidCashuMint: vi.fn().mockResolvedValue(true) }))
vi.mock('../ssrf.js', () => ({ safeFetch: vi.fn(), readJsonLimited: vi.fn(), RESPONSE_CAPS: {} }))
vi.mock('nostr-tools', () => ({
  verifyEvent: () => true,
  SimplePool: class {
    trackRelays = false
    onRelayConnectionFailure: ((url: string) => void) | null = null
    seenOn = new Map()
    querySync = vi.fn(async (relays: string[], filter: { kinds: number[] }) => {
      if (h.mode.value === 'rejects') throw new Error('boom')
      if (h.mode.value === 'allFailed') for (const r of relays) this.onRelayConnectionFailure?.(r)
      return filter.kinds[0] === 38172 ? [] : []
    })
    destroy() {}
  },
}))

import { discoverMintsFromNostr } from '../discovery.js'
import { DISCOVERY_LAST_SUCCESS_KEY } from '../appState.js'

const EARLIER = '2026-10-01T00:00:00.000Z'

beforeEach(() => {
  h.queryMock.mockReset()
  h.store.clear()
  h.mode.value = 'ok'
  h.queryMock.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/INSERT INTO app_state/.test(sql)) { h.store.set(params[0] as string, params[1] as string); return { rowCount: 1, rows: [] } }
    return { rowCount: 0, rows: [] }
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('discovery_last_success_at', () => {
  it('a run that reached the relays writes the key (ISO 8601 UTC, the time of the run)', async () => {
    const before = Date.now()
    await discoverMintsFromNostr()
    const v = h.store.get(DISCOVERY_LAST_SUCCESS_KEY)
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(new Date(v!).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('every relay failed: the key is not written and an earlier value is preserved', async () => {
    h.store.set(DISCOVERY_LAST_SUCCESS_KEY, EARLIER)
    h.mode.value = 'allFailed'
    await discoverMintsFromNostr()
    expect(h.store.get(DISCOVERY_LAST_SUCCESS_KEY)).toBe(EARLIER)
    expect(h.queryMock.mock.calls.some(c => /app_state/.test(String(c[0])))).toBe(false)
  })

  it('every relay failed and no earlier value: still no key', async () => {
    h.mode.value = 'allFailed'
    await discoverMintsFromNostr()
    expect(h.store.has(DISCOVERY_LAST_SUCCESS_KEY)).toBe(false)
  })

  it('the query rejected (timeout): not written, earlier value preserved', async () => {
    h.store.set(DISCOVERY_LAST_SUCCESS_KEY, EARLIER)
    h.mode.value = 'rejects'
    await discoverMintsFromNostr()
    expect(h.store.get(DISCOVERY_LAST_SUCCESS_KEY)).toBe(EARLIER)
  })

  it('a failing write does not fail the run', async () => {
    h.queryMock.mockImplementation(async (sql: string) => {
      if (/INSERT INTO app_state/.test(sql)) throw new Error('db down')
      return { rowCount: 0, rows: [] }
    })
    await expect(discoverMintsFromNostr()).resolves.toBeTypeOf('number')
  })
})
