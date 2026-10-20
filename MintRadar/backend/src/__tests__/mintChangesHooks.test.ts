import { describe, it, expect, vi, beforeEach } from 'vitest'

// Where the change log is fed from (no extra request to a mint): the successful /v1/info of the probe and the complete,
// stored /v1/keysets answer of the hourly job. A failed fetch, a non-2xx, an invalid body, a failed store and an empty list
// never reach it (so nothing is compared and the stored baseline cannot be overwritten).

vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('../ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssrf.js')>()
  return { ...actual, safeFetch: vi.fn(), readJsonLimited: (res: { json: () => Promise<unknown> }) => res.json() }
})
vi.mock('../nostrService.js', () => ({
  notifySubscribers: vi.fn().mockResolvedValue(undefined),
  notifyAlert: vi.fn().mockResolvedValue(undefined),
  notifyMintChanges: vi.fn().mockResolvedValue(undefined),
  recordAlertClear: vi.fn().mockResolvedValue(undefined),
  isNotificationServiceEnabled: vi.fn().mockReturnValue(false),
}))
vi.mock('../versionCatalog.js', () => ({ getLatestVersionsMap: vi.fn().mockResolvedValue({}) }))
vi.mock('../mintChanges.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mintChanges.js')>()
  return { ...actual, recordInfoObservation: vi.fn().mockResolvedValue(undefined), recordKeysetsObservation: vi.fn().mockResolvedValue(undefined) }
})

const MINT = 'https://mint.example.com'
const GOOD = { name: 'Test Mint', version: 'Nutshell/0.17.0', pubkey: '02' + 'ab'.repeat(32), nuts: { '4': {}, '5': {} } }

let safeFetch: ReturnType<typeof vi.fn>
let record: ReturnType<typeof vi.fn>
let probeMintToDb: typeof import('../prober.js')['probeMintToDb']

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../db.js')
  const query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  query.mockImplementation(async (sql: string) => {
    if (/SELECT server_location/.test(sql)) return { rows: [{ server_location: 'Somewhere' }] }
    return { rows: [], rowCount: 0 }
  })
  const lookup = (await import('dns/promises')).lookup as unknown as ReturnType<typeof vi.fn>
  lookup.mockReset().mockResolvedValue([{ address: '1.2.3.4', family: 4 }])
  safeFetch = (await import('../ssrf.js')).safeFetch as unknown as ReturnType<typeof vi.fn>
  safeFetch.mockReset()
  record = (await import('../mintChanges.js')).recordInfoObservation as unknown as ReturnType<typeof vi.fn>
  record.mockReset().mockResolvedValue(undefined)
  ;({ probeMintToDb } = await import('../prober.js'))
})

async function probe(): Promise<void> {
  vi.useFakeTimers()
  try {
    let done = false
    const p = probeMintToDb(MINT).finally(() => { done = true })
    while (!done) await vi.advanceTimersByTimeAsync(1000)
    await p
  } finally {
    vi.useRealTimers()
  }
}

describe('probe -> change log', () => {
  it('a successful /v1/info hands the body it already fetched to the change log, once', async () => {
    safeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => GOOD })
    await probe()
    expect(record).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledWith(MINT, GOOD)
    expect(safeFetch).toHaveBeenCalledTimes(1) // no extra request
  })

  it.each([
    ['a network failure', () => safeFetch.mockResolvedValue(null)],
    ['a non-2xx answer', () => safeFetch.mockResolvedValue({ ok: false, status: 404 })],
    ['a 429', () => safeFetch.mockResolvedValue({ ok: false, status: 429 })],
    ['a 503 that stays a 503', () => safeFetch.mockResolvedValue({ ok: false, status: 503 })],
    ['a 200 that is not a mint (no nuts object)', () => safeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ name: 'x' }) })],
    ['a 200 with a body that is not JSON', () => safeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })],
  ])('%s never reaches the change log', async (_n, arrange) => {
    arrange()
    await probe()
    expect(record).not.toHaveBeenCalled()
  })
})

describe('keysets job -> change log', () => {
  const LIST = { keysets: [{ id: '00aaaaaaaaaaaaaa', unit: 'sat', active: false, input_fee_ppk: 100 }] }

  it('a complete, stored answer is handed over; a failed fetch, a failed store and an empty or malformed list are not', async () => {
    const { collectMintKeysets } = await import('../keysetsSync.js')
    const onObserved = vi.fn().mockResolvedValue(undefined)
    const mk = (fetchJson: (u: string) => Promise<unknown>, store: () => Promise<void> = async () => undefined) =>
      ({ fetchJson, store, pendingMismatch: new Set<string>(), onObserved })

    expect((await collectMintKeysets(MINT, mk(async () => LIST))).ok).toBe(true)
    expect(onObserved).toHaveBeenCalledTimes(1)
    expect(onObserved.mock.calls[0]![0]).toBe(MINT)
    expect(onObserved.mock.calls[0]![1].keysets).toHaveLength(1)

    onObserved.mockClear()
    await collectMintKeysets(MINT, mk(async () => null)) // failed fetch / non-2xx / bad JSON
    await collectMintKeysets(MINT, mk(async () => ({ keysets: [] }))) // empty answer
    await collectMintKeysets(MINT, mk(async () => ({ nope: true }))) // schema surprise
    await collectMintKeysets(MINT, mk(async () => LIST, async () => { throw new Error('db down') })) // store failed
    expect(onObserved).not.toHaveBeenCalled()
  })

  it('the default tick wires the change log in', async () => {
    const { runKeysetsTick } = await import('../keysetsSync.js')
    const { recordKeysetsObservation } = await import('../mintChanges.js')
    const spy = recordKeysetsObservation as unknown as ReturnType<typeof vi.fn>
    spy.mockClear()
    safeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => LIST })
    const slot = (await import('../keysetsSync.js')).keysetsSlotOf(MINT)
    await runKeysetsTick({
      now: () => new Date(2026, 9, 20, 12, slot * 5, 0), random: () => 0, sleep: async () => undefined,
      listOnlineUrls: async () => [MINT], lastVantageOutageAt: () => null, log: () => undefined,
    })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toBe(MINT)
  })
})
