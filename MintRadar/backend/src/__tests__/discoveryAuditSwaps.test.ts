import { describe, it, expect, vi, beforeEach } from 'vitest'

const { connectMock, clientQueryMock, clientReleaseMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
}))

vi.mock('../db.js', () => ({
  pool: { connect: connectMock, query: vi.fn() },
}))
vi.mock('../prober.js', () => ({ probeMintToDb: vi.fn(), isValidCashuMint: vi.fn() }))
vi.mock('../ssrf.js', () => ({ safeFetch: vi.fn() }))

import {
  parseAuditSwapItem,
  computeSwapStats,
  persistMintAuditSwaps,
  type ParsedAuditSwap,
} from '../discovery.js'

beforeEach(() => {
  connectMock.mockReset()
  clientQueryMock.mockReset()
  clientReleaseMock.mockReset()
  clientQueryMock.mockResolvedValue({ rows: [] })
  connectMock.mockResolvedValue({ query: clientQueryMock, release: clientReleaseMock })
})

// The two real, anonymization-safe sample payloads captured from a live
// diagnostic GET https://api.audit.8333.space/swaps/mint/2?limit=5 (Minibits,
// 2026-09-12) — see the confirmed shape: id, from_id, to_id, from_url, to_url,
// amount, fee, created_at, time_taken (ms), state, error.
const SAMPLE_SWAP_1 = {
  id: 65989,
  from_id: 2,
  to_id: 49,
  from_url: 'https://mint.minibits.cash/Bitcoin',
  to_url: 'https://mint.chorus.community',
  amount: 56,
  fee: 2,
  created_at: '2026-09-11T21:36:24',
  time_taken: 2574.3284225463867,
  state: 'OK',
  error: null,
}

const SAMPLE_SWAP_2 = {
  id: 65961,
  from_id: 2,
  to_id: 72,
  from_url: 'https://mint.minibits.cash/Bitcoin',
  to_url: 'https://mint.hanbitkorea.org',
  amount: 78,
  fee: 2,
  created_at: '2026-09-11T11:01:54',
  time_taken: 3595.5216884613037,
  state: 'OK',
  error: null,
}

describe('parseAuditSwapItem', () => {
  it('parses the real Minibits sample payload shape', () => {
    const parsed = parseAuditSwapItem(SAMPLE_SWAP_1)
    expect(parsed).toEqual({
      swapId: 65989,
      toUrl: 'https://mint.chorus.community',
      amount: 56,
      fee: 2,
      createdAt: '2026-09-11T21:36:24',
      timeTakenMs: 2574.3284225463867,
      state: 'OK',
      error: null,
    })
  })

  it('parses a second real sample independently', () => {
    const parsed = parseAuditSwapItem(SAMPLE_SWAP_2)
    expect(parsed).toEqual({
      swapId: 65961,
      toUrl: 'https://mint.hanbitkorea.org',
      amount: 78,
      fee: 2,
      createdAt: '2026-09-11T11:01:54',
      timeTakenMs: 3595.5216884613037,
      state: 'OK',
      error: null,
    })
  })

  it('parses a failed swap, keeping the error string', () => {
    const parsed = parseAuditSwapItem({ ...SAMPLE_SWAP_1, id: 1, state: 'FAILED', error: 'timeout' })
    expect(parsed?.state).toBe('FAILED')
    expect(parsed?.error).toBe('timeout')
  })

  it('returns null for a non-object item', () => {
    expect(parseAuditSwapItem(null)).toBeNull()
    expect(parseAuditSwapItem('nope')).toBeNull()
    expect(parseAuditSwapItem(42)).toBeNull()
  })

  it('returns null when the required id field is missing or the wrong type', () => {
    expect(parseAuditSwapItem({ state: 'OK' })).toBeNull()
    expect(parseAuditSwapItem({ id: '65989', state: 'OK' })).toBeNull()
  })

  it('returns null when the required state field is missing or the wrong type', () => {
    expect(parseAuditSwapItem({ id: 1 })).toBeNull()
    expect(parseAuditSwapItem({ id: 1, state: 7 })).toBeNull()
  })

  it('degrades missing/wrong-typed optional fields to null instead of failing', () => {
    const parsed = parseAuditSwapItem({ id: 1, state: 'OK' })
    expect(parsed).toEqual({
      swapId: 1,
      toUrl: null,
      amount: null,
      fee: null,
      createdAt: null,
      timeTakenMs: null,
      state: 'OK',
      error: null,
    })
  })

  it('degrades a wrong-typed time_taken/to_url without rejecting the whole item', () => {
    const parsed = parseAuditSwapItem({ id: 1, state: 'OK', time_taken: 'slow', to_url: 123 })
    expect(parsed?.timeTakenMs).toBeNull()
    expect(parsed?.toUrl).toBeNull()
    expect(parsed?.swapId).toBe(1)
  })
})

describe('computeSwapStats', () => {
  const swap = (o: Partial<ParsedAuditSwap>): ParsedAuditSwap => ({
    swapId: 1,
    toUrl: null,
    amount: null,
    fee: null,
    createdAt: null,
    timeTakenMs: null,
    state: 'OK',
    error: null,
    ...o,
  })

  it('counts total and non-OK errors', () => {
    const stats = computeSwapStats([
      swap({ state: 'OK' }),
      swap({ state: 'OK' }),
      swap({ state: 'FAILED' }),
    ])
    expect(stats.total).toBe(3)
    expect(stats.errors).toBe(1)
  })

  it('averages time_taken over OK swaps only, ignoring failed ones', () => {
    const stats = computeSwapStats([
      swap({ state: 'OK', timeTakenMs: 100 }),
      swap({ state: 'OK', timeTakenMs: 300 }),
      swap({ state: 'FAILED', timeTakenMs: 9999 }),
    ])
    expect(stats.avgTimeMs).toBe(200)
  })

  it('ignores OK swaps with a null time_taken when averaging', () => {
    const stats = computeSwapStats([
      swap({ state: 'OK', timeTakenMs: 100 }),
      swap({ state: 'OK', timeTakenMs: null }),
    ])
    expect(stats.avgTimeMs).toBe(100)
  })

  it('returns avgTimeMs null when there are zero OK swaps with a known time', () => {
    expect(computeSwapStats([swap({ state: 'FAILED', timeTakenMs: 50 })]).avgTimeMs).toBeNull()
    expect(computeSwapStats([]).avgTimeMs).toBeNull()
  })
})

describe('persistMintAuditSwaps', () => {
  it('replaces the swap window and updates the summary columns inside one transaction', async () => {
    const swaps: ParsedAuditSwap[] = [
      {
        swapId: 65989,
        toUrl: 'https://mint.chorus.community',
        amount: 56,
        fee: 2,
        createdAt: '2026-09-11T21:36:24',
        timeTakenMs: 2574.3,
        state: 'OK',
        error: null,
      },
      {
        swapId: 65961,
        toUrl: 'https://mint.hanbitkorea.org',
        amount: 78,
        fee: 2,
        createdAt: '2026-09-11T11:01:54',
        timeTakenMs: null,
        state: 'FAILED',
        error: 'timeout',
      },
    ]
    const stats = computeSwapStats(swaps)

    await persistMintAuditSwaps('https://mint.minibits.cash/Bitcoin', swaps, stats)

    const sqls = clientQueryMock.mock.calls.map(c => String(c[0]).trim().split(/\s+/).slice(0, 2).join(' '))
    expect(sqls[0]).toBe('BEGIN')
    expect(sqls[1]).toBe('DELETE FROM')
    expect(sqls.filter(s => s === 'INSERT INTO')).toHaveLength(1)
    expect(sqls.at(-2)).toBe('UPDATE mints')
    expect(sqls.at(-1)).toBe('COMMIT')

    const insertCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO mint_audit_swaps'))!
    expect(insertCall[1]).toHaveLength(18) // 2 rows * 9 cols
    expect(String(insertCall[0])).toMatch(/\$10/) // second row's params present → really batched

    const updateCall = clientQueryMock.mock.calls.find(c => String(c[0]).includes('UPDATE mints'))!
    expect(updateCall[1]).toEqual([2, 1, 2574.3, 'https://mint.minibits.cash/Bitcoin']) // total=2, errors=1, avg over the one OK swap
    expect(clientReleaseMock).toHaveBeenCalledOnce()
  })

  it('rolls back and releases the client when the insert fails', async () => {
    clientQueryMock.mockImplementation((sql: string) => {
      if (String(sql).startsWith('INSERT INTO')) return Promise.reject(new Error('boom'))
      return Promise.resolve({ rows: [] })
    })

    await expect(
      persistMintAuditSwaps('https://m.example', [
        { swapId: 1, toUrl: null, amount: null, fee: null, createdAt: null, timeTakenMs: null, state: 'OK', error: null },
      ], { total: 1, errors: 0, avgTimeMs: null }),
    ).rejects.toThrow('boom')

    const sqls = clientQueryMock.mock.calls.map(c => String(c[0]).trim().split(/\s+/)[0])
    expect(sqls).toContain('ROLLBACK')
    expect(clientReleaseMock).toHaveBeenCalledOnce()
  })

  it('writes an empty window (zero rows) without an INSERT call', async () => {
    await persistMintAuditSwaps('https://m.example', [], { total: 0, errors: 0, avgTimeMs: null })

    const sqls = clientQueryMock.mock.calls.map(c => String(c[0]).trim().split(/\s+/).slice(0, 2).join(' '))
    expect(sqls).not.toContain('INSERT INTO')
    expect(sqls).toContain('UPDATE mints')
  })
})
