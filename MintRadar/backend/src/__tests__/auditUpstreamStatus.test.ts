import { describe, it, expect, vi, beforeEach } from 'vitest'

const { safeFetchMock, queryMock } = vi.hoisted(() => ({
  safeFetchMock: vi.fn(),
  queryMock: vi.fn(),
}))

vi.mock('../db.js', () => ({ pool: { connect: vi.fn(), query: queryMock } }))
vi.mock('../prober.js', () => ({ probeMintToDb: vi.fn(), isValidCashuMint: vi.fn() }))
vi.mock('../ssrf.js', () => ({ safeFetch: safeFetchMock }))

// Fresh module per test = fresh in-memory state, like a process restart.
let mod: typeof import('../discovery.js')

beforeEach(async () => {
  vi.resetModules()
  safeFetchMock.mockReset()
  queryMock.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mod = await import('../discovery.js')
})

const okEmpty = () => ({ ok: true, status: 200, json: async () => [] })

describe('audit upstream status (in-memory, set by discoverMintsFromApi)', () => {
  it('is unknown with no check time before any sync has run', () => {
    expect(mod.getAuditUpstreamStatus()).toEqual({ auditUpstream: 'unknown', auditUpstreamCheckedAt: null })
  })

  it('is ok after a successful fetch', async () => {
    safeFetchMock.mockResolvedValue(okEmpty())
    await mod.discoverMintsFromApi()
    const s = mod.getAuditUpstreamStatus()
    expect(s.auditUpstream).toBe('ok')
    expect(typeof s.auditUpstreamCheckedAt).toBe('string')
  })

  it('is down after a 502', async () => {
    safeFetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) })
    await mod.discoverMintsFromApi()
    expect(mod.getAuditUpstreamStatus().auditUpstream).toBe('down')
    expect(mod.getAuditUpstreamStatus().auditUpstreamCheckedAt).not.toBeNull()
  })

  it('is down after a timeout / network error (safeFetch returns null)', async () => {
    safeFetchMock.mockResolvedValue(null)
    await mod.discoverMintsFromApi()
    expect(mod.getAuditUpstreamStatus().auditUpstream).toBe('down')
  })

  it('is down when the fetch or body parsing throws', async () => {
    safeFetchMock.mockRejectedValue(new Error('boom'))
    await mod.discoverMintsFromApi()
    expect(mod.getAuditUpstreamStatus().auditUpstream).toBe('down')
  })

  it('recovers to ok after a later successful sync', async () => {
    safeFetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
    await mod.discoverMintsFromApi()
    expect(mod.getAuditUpstreamStatus().auditUpstream).toBe('down')
    safeFetchMock.mockResolvedValue(okEmpty())
    await mod.discoverMintsFromApi()
    expect(mod.getAuditUpstreamStatus().auditUpstream).toBe('ok')
  })
})

describe('getSyncTimesFromDb', () => {
  it('returns null for both when there are no rows, with one query per cache window', async () => {
    queryMock.mockResolvedValue({ rows: [{ last_sync: null, last_reviews_sync: null }] })
    const [a, b] = await Promise.all([mod.getSyncTimesFromDb(), mod.getSyncTimesFromDb()])
    expect(a).toEqual({ lastAuditSyncAt: null, lastReviewsSyncAt: null })
    expect(b).toEqual(a)
    await mod.getSyncTimesFromDb()
    expect(queryMock).toHaveBeenCalledTimes(1)
  })
})
