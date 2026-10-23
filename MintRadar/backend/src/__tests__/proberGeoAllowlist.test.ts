import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The geolocation step of a successful probe resolves the mint host and sends the address to ipinfo.io when the mint has no
// stored location. In allowlist mode (MINT_ALLOWLIST) that must not happen. The real probeMintToDb runs here; only the
// network (undici, DNS, the mint's own /v1/info) and the database are stubbed, so a request to ipinfo.io would be seen.

const { fetchMock, queryMock, geoLookupMock, safeFetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  queryMock: vi.fn(),
  geoLookupMock: vi.fn(),
  safeFetchMock: vi.fn(),
}))

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici')
  return { ...actual, fetch: fetchMock }
})
vi.mock('dns', async () => {
  const actual = await vi.importActual<typeof import('dns')>('dns')
  const promises = { ...actual.promises, lookup: geoLookupMock }
  return { ...actual, default: { ...actual, promises }, promises }
})
vi.mock('dns/promises', () => ({ lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) }))
vi.mock('../db.js', () => ({ pool: { query: queryMock } }))
vi.mock('../ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssrf.js')>()
  return { ...actual, safeFetch: safeFetchMock, readJsonLimited: (res: { json: () => Promise<unknown> }) => res.json() }
})
vi.mock('../nostrService.js', () => ({
  notifySubscribers: vi.fn().mockResolvedValue(undefined),
  notifyAlert: vi.fn().mockResolvedValue(undefined),
  recordAlertClear: vi.fn().mockResolvedValue(undefined),
  isNotificationServiceEnabled: vi.fn(() => false),
}))
vi.mock('../versionCatalog.js', () => ({ getLatestVersionsMap: vi.fn().mockResolvedValue({}) }))
vi.mock('../contactChecks.js', () => ({ queueContactChecks: vi.fn() }))
vi.mock('../mintChanges.js', () => ({ recordInfoObservation: vi.fn().mockResolvedValue(undefined) }))

import { probeMintToDb } from '../prober.js'

const MINT = 'https://private-mint.example'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  fetchMock.mockReset()
  queryMock.mockReset()
  geoLookupMock.mockReset()
  safeFetchMock.mockReset()
  // An online mint without a stored location; every other query answers with no rows.
  queryMock.mockImplementation(async (sql: string) => {
    if (/SELECT server_location FROM mints/.test(sql)) return { rows: [{ server_location: null }] }
    return { rows: [], rowCount: 0 }
  })
  geoLookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 })
  fetchMock.mockResolvedValue({ ok: false, status: 500 })
  safeFetchMock.mockResolvedValue({
    ok: true, status: 200, headers: new Headers(),
    json: async () => ({ name: 'Private', version: 'Nutshell/0.16.0', nuts: { '4': { methods: [], disabled: false } } }),
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.env['MINT_ALLOWLIST']
})

// The steps after the geo step need a full database; whatever they throw is not what is tested here.
async function probe(): Promise<void> {
  await probeMintToDb(MINT).catch(() => {})
}

const ipinfoCalls = () => fetchMock.mock.calls.filter(c => String(c[0]).includes('ipinfo.io'))

describe('probe geolocation step', () => {
  it('allowlist mode: no stored-location query, no DNS lookup, no request to ipinfo.io', async () => {
    process.env['MINT_ALLOWLIST'] = MINT
    await probe()
    expect(safeFetchMock).toHaveBeenCalled()
    expect(queryMock).not.toHaveBeenCalledWith(expect.stringContaining('SELECT server_location'), expect.anything())
    expect(geoLookupMock).not.toHaveBeenCalled()
    expect(ipinfoCalls()).toHaveLength(0)
  })

  it('normal mode: a mint without a stored location is looked up at ipinfo.io', async () => {
    await probe()
    expect(ipinfoCalls()).toHaveLength(1)
    expect(String(ipinfoCalls()[0]![0])).toBe('https://ipinfo.io/93.184.216.34/json')
  })
})
