import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('../db.js', () => ({
  pool: { query: queryMock },
  initDb: vi.fn(),
}))

import { refreshReliabilityMoversRollup, isReliabilityMoversRollupRunning } from '../reliabilityMoversRollup.js'

beforeEach(() => {
  queryMock.mockReset()
  queryMock.mockResolvedValue({ rowCount: 3 })
})

describe('refreshReliabilityMoversRollup', () => {
  it('issues a single UPDATE against mints that writes both snapshot columns', async () => {
    await refreshReliabilityMoversRollup()
    expect(queryMock).toHaveBeenCalledTimes(1)
    const sql = queryMock.mock.calls[0][0] as string
    expect(sql).toMatch(/UPDATE mints/i)
    expect(sql).toMatch(/reliability_score_7d_ago\s*=/)
    expect(sql).toMatch(/reliability_score_30d_ago\s*=/)
    expect(sql).toMatch(/reliability_movers_checked_at\s*=\s*NOW\(\)/i)
    // Only mint_history is read, no dependence on mints.last_reliability_score here.
    expect(sql).toMatch(/INTERVAL '7 days'/)
    expect(sql).toMatch(/INTERVAL '30 days'/)
  })

  it('never throws when the query fails — leaves previous snapshots in place', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection refused'))
    await expect(refreshReliabilityMoversRollup()).resolves.toBeUndefined()
  })

  it('is single-flight: an overlapping call while one is in progress is a no-op', async () => {
    let release!: () => void
    queryMock.mockImplementationOnce(
      () => new Promise(resolve => { release = () => resolve({ rowCount: 1 }) }),
    )
    const first = refreshReliabilityMoversRollup()
    expect(isReliabilityMoversRollupRunning()).toBe(true)
    const second = refreshReliabilityMoversRollup() // should return immediately, no query
    await second
    expect(queryMock).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(isReliabilityMoversRollupRunning()).toBe(false)
  })
})
