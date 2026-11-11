import { describe, it, expect, vi, beforeEach } from 'vitest'

// Invariant: every recorded probe outcome, including a network failure such as a DNS error, updates the
// stored Reliability Score and runs the transition logic. The database is a small stateful stub so a
// second failed probe sees the row the first one wrote.

vi.mock('../db.js', () => ({
  pool: { query: vi.fn() },
}))
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('../ssrf.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ssrf.js')>()
  return { ...actual, safeFetch: vi.fn(), readJsonLimited: (res: { json: () => Promise<unknown> }) => res.json() }
})
vi.mock('../nostrService.js', () => ({
  notifySubscribers: vi.fn().mockResolvedValue(undefined),
  notifyAlert: vi.fn().mockResolvedValue(undefined),
  recordAlertClear: vi.fn().mockResolvedValue(undefined),
  isNotificationServiceEnabled: vi.fn(),
}))
vi.mock('../versionCatalog.js', () => ({ getLatestVersionsMap: vi.fn().mockResolvedValue({}) }))

const MINT = 'https://mint.example.com'
const STORED_SCORE = 87
const NUT_COUNT = 14
const CONTACTS = 3
/** Highest score the existing formula gives at uptime 0 (0 + 15 NUT + 15 version + 5 contact + 25 audit). */
const MAX_AT_UPTIME_0 = 60

let query: ReturnType<typeof vi.fn>
let storedBreakdown: Record<string, unknown> | null = null
let lookup: ReturnType<typeof vi.fn>
let safeFetch: ReturnType<typeof vi.fn>
let notifySubscribers: ReturnType<typeof vi.fn>
let probeMintToDb: typeof import('../prober.js')['probeMintToDb']
let computeReliabilityScore: typeof import('../shared/reliabilityScore.js')['computeReliabilityScore']

/** What the stub database holds for MINT. */
let history: Array<{ id: number; online: boolean; reliability_score: number | null }>
let storedScore: number | null
let lastError: string | null

function dnsError(): Error {
  return Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })
}

beforeEach(async () => {
  vi.resetModules()
  const db = await import('../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  lookup = (await import('dns/promises')).lookup as unknown as ReturnType<typeof vi.fn>
  lookup.mockReset()
  safeFetch = (await import('../ssrf.js')).safeFetch as unknown as ReturnType<typeof vi.fn>
  safeFetch.mockReset()
  const notify = await import('../nostrService.js')
  notifySubscribers = notify.notifySubscribers as unknown as ReturnType<typeof vi.fn>
  notifySubscribers.mockReset().mockResolvedValue(undefined)
  ;(notify.isNotificationServiceEnabled as unknown as ReturnType<typeof vi.fn>).mockReset().mockReturnValue(true)
  ;({ probeMintToDb } = await import('../prober.js'))
  ;({ computeReliabilityScore } = await import('../shared/reliabilityScore.js'))

  // An online mint with a high stored score and ten successful probes in the last 24 h.
  history = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, online: true, reliability_score: STORED_SCORE }))
  storedScore = STORED_SCORE
  lastError = null

  query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/SELECT online FROM mint_history WHERE url = \$1/.test(sql)) {
      const last = history[history.length - 1]
      return { rows: last ? [{ online: last.online }] : [] }
    }
    if (/INSERT INTO mint_history \(url, online, latency_ms, checked_at\)/.test(sql)) {
      const id = history.length + 1
      history.push({ id, online: params !== undefined && params.length > 1 ? (params[1] as boolean) : !/VALUES \(\$1, false/.test(sql), reliability_score: null })
      return { rows: [{ id }] }
    }
    // The 30-day rows of the uptime inputs (uptimeInputFor): the stored probes one day apart, the newest one now,
    // so two failed probes in a row are an outage of 24 hours.
    if (/SELECT online, checked_at FROM mint_history/.test(sql)) {
      const now = Date.now()
      return { rows: history.map((h, i) => ({ online: h.online, checked_at: new Date(now - (history.length - 1 - i) * 86_400_000) })) }
    }
    if (/FROM mints m\s*\n\s*LEFT JOIN mint_history h/.test(sql)) {
      const online = history.filter(h => h.online).length
      return { rows: [{
        nut_count: NUT_COUNT, version: null, contact_count: CONTACTS,
        audit_cz_total: null, audit_cz_blamed: null, audit_cz_fetched_at: null, discovered_at: null,
        total: String(history.length), online_count: String(online),
      }] }
    }
    if (/UPDATE mints SET last_reliability_score/.test(sql)) {
      storedScore = params?.[0] as number
      lastError = params?.[1] as string | null
      storedBreakdown = JSON.parse(params?.[3] as string) as Record<string, unknown>
      return { rowCount: 1 }
    }
    if (/UPDATE mint_history SET reliability_score/.test(sql)) {
      const row = history.find(h => h.id === params?.[1])
      if (row) row.reliability_score = params?.[0] as number
      return { rowCount: 1 }
    }
    if (/UPDATE mints SET last_error = \$1/.test(sql)) {
      lastError = params?.[0] as string | null
      return { rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  })
})

// Offline for the whole stored history: no successful probe in 24 hours or 30 days, one ongoing outage of 24 hours.
const expectedAtUptime0 = () =>
  computeReliabilityScore(
    { pct24h: 0, pct30d: 0, outageCount30d: 1, longestOutageMs30d: 86_400_000, ongoingOutage: true },
    NUT_COUNT, null, CONTACTS, { blamed: null, total: null, fetchedAt: null }, {}, null,
  )

// Several of the failures below are retried inside the prober (1 s, 2 s): fake timers keep the suite fast.
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

type Failure = { name: string; arrange: () => void; error: string }
const failures: Failure[] = [
  {
    name: 'dns-error (the guard cannot resolve the host)',
    arrange: () => { lookup.mockRejectedValue(dnsError()) },
    error: 'DNS resolution failed',
  },
  {
    name: 'network failure at fetch time (timeout / unreachable)',
    arrange: () => {
      lookup.mockResolvedValue([{ address: '1.2.3.4', family: 4 }])
      safeFetch.mockImplementation(async (_u: string, opts?: { onError?: (e: unknown) => void }) => {
        opts?.onError?.(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }))
        return null
      })
    },
    error: '',
  },
  {
    name: 'HTTP error',
    arrange: () => {
      lookup.mockResolvedValue([{ address: '1.2.3.4', family: 4 }])
      safeFetch.mockResolvedValue({ ok: false, status: 404 })
    },
    error: 'HTTP 404',
  },
  {
    name: 'invalid JSON',
    arrange: () => {
      lookup.mockResolvedValue([{ address: '1.2.3.4', family: 4 }])
      safeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })
    },
    error: 'Invalid JSON response',
  },
  {
    name: 'not a Cashu mint (no nuts object)',
    arrange: () => {
      lookup.mockResolvedValue([{ address: '1.2.3.4', family: 4 }])
      safeFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ name: 'x' }) })
    },
    error: 'Invalid Cashu response',
  },
]

describe('probeMintToDb — a failed probe updates the stored score and runs the transition logic', () => {
  for (const f of failures) {
    describe(f.name, () => {
      it('reaches uptime 0 and the stored score is the formula result, at most the maximum for uptime 0', async () => {
        f.arrange()
        history = [{ id: 1, online: false, reliability_score: STORED_SCORE }]
        storedScore = STORED_SCORE

        await probe()

        expect(storedScore).toBe(expectedAtUptime0())
        expect(storedScore as number).toBeLessThanOrEqual(MAX_AT_UPTIME_0)
        expect(history[history.length - 1]!.reliability_score).toBe(expectedAtUptime0())
        if (f.error) expect(lastError).toBe(f.error)
      })

      it('notifies "down" exactly once for online → offline, and not again on the next failed probe', async () => {
        f.arrange()

        await probe()
        expect(notifySubscribers).toHaveBeenCalledTimes(1)
        expect(notifySubscribers).toHaveBeenCalledWith(MINT, 'down', expect.any(Date))

        await probe()
        expect(notifySubscribers).toHaveBeenCalledTimes(1)
      })
    })
  }
})

describe('probeMintToDb — the 30-day uptime inputs are stored with the score (methodology 7)', () => {
  it('two failed probes after ten successful ones: one ongoing outage, counted from the stored rows', async () => {
    lookup.mockResolvedValue([{ address: '1.2.3.4', family: 4 }])
    safeFetch.mockResolvedValue({ ok: false, status: 503 })

    await probe()
    await probe()

    // 12 stored probes one day apart (the mock), 10 of them successful; the outage runs from the first failed probe to now
    expect(storedBreakdown!['uptimeInputs']).toEqual({ uptime24hPct: 83, uptime30dPct: 83, uptime30dExactPct: 83.33, outageCount30d: 1, longestOutage30dMs: expect.any(Number), ongoingOutage: true })
    const longest = (storedBreakdown!['uptimeInputs'] as { longestOutage30dMs: number }).longestOutage30dMs
    expect(Math.round(longest / 3_600_000)).toBe(24)
    // 24 h: round(83 * 0.2) = 17; 30 days: 83 % is under the 90 % floor = 0; longest outage a day or more = 0; ongoing = 0
    expect(storedBreakdown!['uptimeParts']).toEqual({
      last24h: { points: 17, max: 20 }, last30d: { points: 0, max: 10 }, longestOutage: { points: 0, max: 6 }, outageCount: { points: 0, max: 4 },
    })
    expect(storedBreakdown!['uptime']).toEqual({ points: 17, max: 40 })
    expect(storedBreakdown!['sum']).toBe(storedScore)
  })
})

describe('probeMintToDb — failures held back as a suspected vantage outage', () => {
  const writes = () => query.mock.calls.filter(c => /^\s*(INSERT|UPDATE)/.test(c[0] as string))

  for (const [name, arrange] of [
    ['dns-error', () => { lookup.mockRejectedValue(dnsError()) }],
    ['network failure at fetch time', () => {
      lookup.mockResolvedValue([{ address: '1.2.3.4', family: 4 }])
      safeFetch.mockImplementation(async (_u: string, opts?: { onError?: (e: unknown) => void }) => {
        opts?.onError?.(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }))
        return null
      })
    }],
  ] as Array<[string, () => void]>) {
    it(`${name}: nothing is recorded, recomputed or notified until commit() runs`, async () => {
      arrange()
      const held: Array<{ commit: () => Promise<void> }> = []
      vi.useFakeTimers()
      try {
        let done = false
        const p = probeMintToDb(MINT, f => { held.push(f) }).finally(() => { done = true })
        while (!done) await vi.advanceTimersByTimeAsync(1000)
        await p
      } finally {
        vi.useRealTimers()
      }

      expect(held).toHaveLength(1)
      expect(writes()).toHaveLength(0)
      expect(storedScore).toBe(STORED_SCORE)
      expect(notifySubscribers).not.toHaveBeenCalled()

      await held[0]!.commit()
      expect(storedScore).not.toBe(STORED_SCORE)
      expect(notifySubscribers).toHaveBeenCalledTimes(1)
      expect(history[history.length - 1]!.online).toBe(false)
    })
  }
})
