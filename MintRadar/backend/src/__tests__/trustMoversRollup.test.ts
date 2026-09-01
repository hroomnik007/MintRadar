import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('../db.js', () => ({
  pool: { query: queryMock },
  initDb: vi.fn(),
}))

import { refreshTrustMoversRollup, isTrustMoversRollupRunning } from '../trustMoversRollup.js'

beforeEach(() => {
  queryMock.mockReset()
  queryMock.mockResolvedValue({ rowCount: 3 })
})

describe('refreshTrustMoversRollup', () => {
  it('issues a single UPDATE against mints that writes both snapshot columns', async () => {
    await refreshTrustMoversRollup()
    expect(queryMock).toHaveBeenCalledTimes(1)
    const sql = queryMock.mock.calls[0][0] as string
    expect(sql).toMatch(/UPDATE mints/i)
    expect(sql).toMatch(/trust_score_7d_ago\s*=/)
    expect(sql).toMatch(/trust_score_30d_ago\s*=/)
    expect(sql).toMatch(/trust_movers_checked_at\s*=\s*NOW\(\)/i)
    // Only mint_history is read, no dependence on mints.last_trust_score here.
    expect(sql).toMatch(/INTERVAL '7 days'/)
    expect(sql).toMatch(/INTERVAL '30 days'/)
  })

  it('never throws when the query fails — leaves previous snapshots in place', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection refused'))
    await expect(refreshTrustMoversRollup()).resolves.toBeUndefined()
  })

  it('is single-flight: an overlapping call while one is in progress is a no-op', async () => {
    let release!: () => void
    queryMock.mockImplementationOnce(
      () => new Promise(resolve => { release = () => resolve({ rowCount: 1 }) }),
    )
    const first = refreshTrustMoversRollup()
    expect(isTrustMoversRollupRunning()).toBe(true)
    const second = refreshTrustMoversRollup() // should return immediately, no query
    await second
    expect(queryMock).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(isTrustMoversRollupRunning()).toBe(false)
  })
})
