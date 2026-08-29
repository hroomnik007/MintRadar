import { describe, it, expect } from 'vitest'
import { computeTrustMovers, TRUST_MOVER_THRESHOLD, type MintScoreSnapshot } from '../trustMovers.js'

function snap(url: string, latestScore: number, oldScore: number, name: string | null = null): MintScoreSnapshot {
  return { url, name, latestScore, oldScore }
}

describe('computeTrustMovers', () => {
  it('exports the documented +/-3 threshold', () => {
    expect(TRUST_MOVER_THRESHOLD).toBe(3)
  })

  describe('threshold boundary (edge cases from the spec)', () => {
    it('excludes a mint with exactly a 2.9-point rise (below threshold)', () => {
      const { risers } = computeTrustMovers([snap('a', 82.9, 80)])
      expect(risers).toHaveLength(0)
    })

    it('includes a mint with exactly a 3.0-point rise (at threshold, inclusive)', () => {
      const { risers } = computeTrustMovers([snap('a', 83, 80)])
      expect(risers).toHaveLength(1)
      expect(risers[0].delta).toBe(3)
    })

    it('includes a mint with a 3.1-point rise (above threshold)', () => {
      const { risers } = computeTrustMovers([snap('a', 83.1, 80)])
      expect(risers).toHaveLength(1)
    })

    it('excludes a mint with exactly a 2.9-point fall (below threshold)', () => {
      const { fallers } = computeTrustMovers([snap('a', 77.1, 80)])
      expect(fallers).toHaveLength(0)
    })

    it('includes a mint with exactly a 3.0-point fall (at threshold, inclusive)', () => {
      const { fallers } = computeTrustMovers([snap('a', 77, 80)])
      expect(fallers).toHaveLength(1)
      expect(fallers[0].delta).toBe(-3)
    })

    it('includes a mint with a 3.1-point fall (above threshold)', () => {
      const { fallers } = computeTrustMovers([snap('a', 76.9, 80)])
      expect(fallers).toHaveLength(1)
    })
  })

  describe('no qualifying mints', () => {
    it('returns empty risers and fallers when every delta is within +/-3', () => {
      const result = computeTrustMovers([snap('a', 81, 80), snap('b', 79, 80), snap('c', 80, 80)])
      expect(result).toEqual({ risers: [], fallers: [] })
    })

    it('returns empty arrays for an empty snapshot list', () => {
      expect(computeTrustMovers([])).toEqual({ risers: [], fallers: [] })
    })
  })

  describe('ranking and top-3 cap', () => {
    it('sorts risers by delta descending and caps at 3', () => {
      const { risers } = computeTrustMovers([
        snap('small', 84, 80),   // +4
        snap('biggest', 95, 80), // +15
        snap('mid', 90, 80),     // +10
        snap('smallest-qualifying', 83, 80), // +3
        snap('fifth', 88, 80),   // +8 — should be dropped, only top 3 kept
      ])
      expect(risers.map(r => r.url)).toEqual(['biggest', 'mid', 'fifth'])
      expect(risers).toHaveLength(3)
    })

    it('sorts fallers by delta ascending (most negative first) and caps at 3', () => {
      const { fallers } = computeTrustMovers([
        snap('small', 76, 80),        // -4
        snap('biggest-drop', 60, 80), // -20
        snap('mid-drop', 70, 80),     // -10
        snap('smallest-qualifying', 77, 80), // -3
        snap('fifth-drop', 72, 80),   // -8 — should be dropped, only top 3 kept
      ])
      expect(fallers.map(f => f.url)).toEqual(['biggest-drop', 'mid-drop', 'fifth-drop'])
      expect(fallers).toHaveLength(3)
    })
  })

  it('a mint excluded for insufficient history simply never appears in the input snapshots (SQL INNER JOIN concern, not this function)', () => {
    // fetchOgMintData-style SQL exclusion happens before this function ever runs —
    // computeTrustMovers only ever sees mints that already have both snapshots.
    const result = computeTrustMovers([snap('has-both-snapshots', 90, 80)])
    expect(result.risers).toHaveLength(1)
  })

  it('preserves mint name and url in the output', () => {
    const { risers } = computeTrustMovers([snap('https://mint.example.com', 90, 80, 'Example Mint')])
    expect(risers[0]).toEqual({ url: 'https://mint.example.com', name: 'Example Mint', delta: 10 })
  })

  it('handles a null mint name without crashing', () => {
    const { risers } = computeTrustMovers([snap('https://mint.example.com', 90, 80, null)])
    expect(risers[0].name).toBeNull()
  })
})
