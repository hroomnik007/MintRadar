import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The one-time location catch-up (backfillServerLocations, 30 s after boot) resolves every mint host and sends the
// address to ipinfo.io. In allowlist mode (MINT_ALLOWLIST) that must not happen: the real prober function runs here,
// with only the network (undici, DNS) and the database stubbed, so a request to ipinfo.io would be seen.

const { fetchMock, queryMock, lookupMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  queryMock: vi.fn(),
  lookupMock: vi.fn(),
}))

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }))
vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici')
  return { ...actual, fetch: fetchMock }
})
vi.mock('dns', async () => {
  const actual = await vi.importActual<typeof import('dns')>('dns')
  const promises = { ...actual.promises, lookup: lookupMock }
  return { ...actual, default: { ...actual, promises }, promises }
})
vi.mock('../db.js', async () => {
  const actual = await vi.importActual<typeof import('../db.js')>('../db.js')
  return { ...actual, pool: { query: queryMock }, pruneOldNotificationSubscriptions: vi.fn() }
})
vi.mock('../probeCycle.js', () => ({ runProbeCycle: vi.fn(), getLastVantageOutageAt: vi.fn() }))
vi.mock('../keysetsSync.js', () => ({ runKeysetsTick: vi.fn() }))
vi.mock('../discovery.js', async () => {
  const actual = await vi.importActual<typeof import('../discovery.js')>('../discovery.js')
  return { ...actual, discoverMintsFromNostr: vi.fn(), discoverMintsFromApi: vi.fn() }
})
vi.mock('../auditCz.js', () => ({ syncAuditCz: vi.fn() }))
vi.mock('../auditCzDetail.js', () => ({ syncAuditCzDetails: vi.fn() }))
vi.mock('../mintAddress.js', () => ({ refreshMintAddresses: vi.fn() }))
vi.mock('../reviewsSync.js', () => ({ refreshAllMintReviews: vi.fn(), recomputeReviewCountRollups: vi.fn(), isReviewSyncRunning: vi.fn() }))
vi.mock('../reviewsSchedule.js', () => ({ startReviewsSyncTimer: vi.fn() }))
vi.mock('../reliabilityMoversRollup.js', () => ({ refreshReliabilityMoversRollup: vi.fn() }))
vi.mock('../reviewSurgeRollup.js', () => ({ refreshReviewSurgeBaseline: vi.fn() }))
vi.mock('../nostrService.js', () => ({
  publishServiceProfile: vi.fn(), notifySubscribers: vi.fn(), notifyAlert: vi.fn(), recordAlertClear: vi.fn(),
  isNotificationServiceEnabled: vi.fn(() => false),
}))
vi.mock('../versionCatalog.js', () => ({ fetchLatestUpstreamVersions: vi.fn(), getLatestVersionsMap: vi.fn() }))

import { startCron } from '../cron.js'

const MINT = 'https://private-mint.example'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock.mockReset()
  queryMock.mockReset()
  lookupMock.mockReset()
  queryMock.mockResolvedValue({ rows: [{ url: MINT }] })
  lookupMock.mockResolvedValue({ address: '203.0.113.7', family: 4 })
  fetchMock.mockResolvedValue({ ok: false, status: 500 })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete process.env['MINT_ALLOWLIST']
})

// 30 s backfill timer + its 150 ms pause per mint; stops short of the 45 s / 120 s timers.
async function bootAndWait(): Promise<void> {
  startCron()
  await vi.advanceTimersByTimeAsync(31_000)
}

const ipinfoCalls = () => fetchMock.mock.calls.filter(c => String(c[0]).includes('ipinfo.io'))

describe('backfillServerLocations at boot', () => {
  it('allowlist mode: no query for mints without a location, no DNS lookup, no request to ipinfo.io', async () => {
    process.env['MINT_ALLOWLIST'] = MINT
    await bootAndWait()
    expect(queryMock).not.toHaveBeenCalledWith(expect.stringContaining('server_location IS NULL'))
    expect(lookupMock).not.toHaveBeenCalled()
    expect(ipinfoCalls()).toHaveLength(0)
  })

  it('normal mode: the backfill still runs and asks ipinfo.io for the mint address', async () => {
    await bootAndWait()
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('server_location IS NULL'))
    expect(ipinfoCalls()).toHaveLength(1)
    expect(String(ipinfoCalls()[0]![0])).toBe('https://ipinfo.io/203.0.113.7/json')
  })
})
