import { describe, it, expect } from 'vitest'
import { computeReliabilityScore } from '../shared/reliabilityScore.js'
import { computeScoreBreakdown, readStoredBreakdown, BREAKDOWN_MAX } from '../scoreBreakdown.js'

// The breakdown stored beside the score (mints.score_breakdown) must never disagree with it: for any input the
// parts add up (rounded once, plus the new-mint cap correction) to the very number computeReliabilityScore returns.

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0)
const LATEST = { nutshell: { major: 0, minor: 21 }, cdk: { major: 0, minor: 18 } }
const fresh = new Date(NOW - 3_600_000)
const AUDITS = [
  { blamed: null, total: null, fetchedAt: null }, // no_data -> 12.5
  { blamed: 0, total: 9, fetchedAt: fresh }, // low sample -> 12.5
  { blamed: 0, total: 100, fetchedAt: new Date(NOW - 200 * 3_600_000) }, // stale -> 12.5
  { blamed: 0, total: 100, fetchedAt: fresh },
  { blamed: 3, total: 100, fetchedAt: fresh },
  { blamed: 10, total: 100, fetchedAt: fresh },
  { blamed: 40, total: 100, fetchedAt: fresh },
]
const VERSIONS = [null, 'Nutshell/0.21.0', 'Nutshell/0.19.0', 'cdk/0.14.0', 'Unknown/1.0.0']
const DISCOVERED = [null, new Date(NOW - 5 * 86_400_000).toISOString(), new Date(NOW - 29.9 * 86_400_000).toISOString(), new Date(NOW - 400 * 86_400_000).toISOString()]

describe('computeScoreBreakdown', () => {
  it('sum equals computeReliabilityScore, and the parts add up to it, for a grid of inputs', () => {
    let checked = 0
    for (const uptime of [0, 1, 37, 50, 99, 100])
      for (const nutCount of [null, 0, 7, 14, 30])
        for (const version of VERSIONS)
          for (const contacts of [0, 1, 2, 3, 60])
            for (const audit of AUDITS)
              for (const discovered of DISCOVERED) {
                const score = computeReliabilityScore(uptime, nutCount, version, contacts, audit, LATEST, discovered, NOW)
                const b = computeScoreBreakdown(uptime, nutCount, version, contacts, audit, LATEST, discovered, NOW)
                expect(b.sum).toBe(score)
                const parts = b.uptime.points + b.audit.points + b.nuts.points + b.version.points + b.contact.points
                expect(Math.min(100, Math.round(parts)) + b.newMintCap.points).toBe(score)
                expect(b.newMintCap.points).toBeLessThanOrEqual(0)
                checked++
              }
    expect(checked).toBeGreaterThan(10_000)
  })

  it('maxima are 40, 25, 15, 15 and 5 (100 together) and every part stays within its maximum', () => {
    expect(Object.values(BREAKDOWN_MAX).reduce((a, b) => a + b, 0)).toBe(100)
    const b = computeScoreBreakdown(100, 14, 'Nutshell/0.21.0', 3, { blamed: 0, total: 100, fetchedAt: fresh }, LATEST, null, NOW)
    expect(b).toEqual({
      uptime: { points: 40, max: 40 }, audit: { points: 25, max: 25 }, nuts: { points: 15, max: 15 },
      version: { points: 15, max: 15 }, contact: { points: 5, max: 5 }, newMintCap: { points: 0, cap: 75 }, sum: 100,
    })
  })

  it('a mint younger than 30 days: the cap correction is the difference to the uncapped score', () => {
    const b = computeScoreBreakdown(100, 14, 'Nutshell/0.21.0', 3, { blamed: 0, total: 100, fetchedAt: fresh }, LATEST, DISCOVERED[1], NOW)
    expect(b.sum).toBe(75)
    expect(b.newMintCap).toEqual({ points: -25, cap: 75 })
  })

  it('neutral audit data counts 12.5 points, so the parts can end in .5', () => {
    const b = computeScoreBreakdown(50, 1, '1.0.0', 0, AUDITS[0]!, LATEST, null, NOW)
    expect(b.audit.points).toBe(12.5)
    expect(b.sum).toBe(38) // 37.5 rounded once, as the stored score
  })
})

describe('readStoredBreakdown', () => {
  const good = computeScoreBreakdown(80, 10, 'Nutshell/0.21.0', 2, AUDITS[3]!, LATEST, null, NOW)
  it('round-trips a stored value through JSON', () => {
    expect(readStoredBreakdown(JSON.parse(JSON.stringify(good)))).toEqual(good)
  })
  it('null for anything that is not a breakdown', () => {
    for (const bad of [null, undefined, 'x', 5, [], {}, { ...good, sum: 'a' }, { ...good, sum: 100.5 }, { ...good, uptime: { points: 41, max: 40 } },
      { ...good, nuts: { points: -1, max: 15 } }, { ...good, newMintCap: { points: 1, cap: 75 } }, { ...good, contact: null }]) {
      expect(readStoredBreakdown(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})

// Methodology 7: with the 30-day inputs the breakdown also stores the four uptime parts and the figures they used.
describe('uptime parts in the breakdown', () => {
  const H = 3_600_000
  const INPUTS = [
    { pct24h: 100, pct30d: 100, outageCount30d: 0, longestOutageMs30d: 0, ongoingOutage: false },
    { pct24h: 100, pct30d: 77, outageCount30d: 8, longestOutageMs30d: 162 * H, ongoingOutage: false },
    { pct24h: 97, pct30d: 97, outageCount30d: 35, longestOutageMs30d: 2 * H, ongoingOutage: false },
    { pct24h: 0, pct30d: 93, outageCount30d: 1, longestOutageMs30d: 30 * H, ongoingOutage: true },
    { pct24h: 50, pct30d: 91, outageCount30d: 4, longestOutageMs30d: 5 * H, ongoingOutage: true },
  ]

  it('sum equals computeReliabilityScore and the four parts add up to the uptime points', () => {
    for (const u of INPUTS) {
      for (const audit of AUDITS) {
        for (const discovered of DISCOVERED) {
          const score = computeReliabilityScore(u, 12, 'Nutshell/0.21.0', 2, audit, LATEST, discovered, NOW)
          const b = computeScoreBreakdown(u, 12, 'Nutshell/0.21.0', 2, audit, LATEST, discovered, NOW)
          expect(b.sum).toBe(score)
          const p = b.uptimeParts!
          expect(p.last24h.points + p.last30d.points + p.longestOutage.points + p.outageCount.points).toBe(b.uptime.points)
          expect([p.last24h.max, p.last30d.max, p.longestOutage.max, p.outageCount.max]).toEqual([20, 10, 6, 4])
          expect(b.uptimeInputs).toEqual({ uptime24hPct: u.pct24h, uptime30dPct: u.pct30d, outageCount30d: u.outageCount30d, longestOutage30dMs: u.longestOutageMs30d, ongoingOutage: u.ongoingOutage })
        }
      }
    }
  })

  it('a plain percentage stores no parts (nothing to show them from)', () => {
    const b = computeScoreBreakdown(80, 10, 'Nutshell/0.21.0', 2, AUDITS[3]!, LATEST, null, NOW)
    expect(b.uptimeParts).toBeUndefined()
    expect(b.uptimeInputs).toBeUndefined()
  })

  it('round-trips through JSON; parts that do not add up or have no inputs are dropped, the rest stays readable', () => {
    const good = computeScoreBreakdown(INPUTS[1]!, 10, 'Nutshell/0.21.0', 2, AUDITS[3]!, LATEST, null, NOW)
    expect(readStoredBreakdown(JSON.parse(JSON.stringify(good)))).toEqual(good)
    const plain = { uptime: good.uptime, audit: good.audit, nuts: good.nuts, version: good.version, contact: good.contact, newMintCap: good.newMintCap, sum: good.sum }
    const wrongSum = { ...good, uptimeParts: { ...good.uptimeParts!, last24h: { points: 1, max: 20 } } }
    const noInputs = { ...good, uptimeInputs: undefined }
    const badInputs = { ...good, uptimeInputs: { ...good.uptimeInputs!, uptime30dPct: 140 } }
    for (const partial of [wrongSum, noInputs, badInputs]) {
      expect(readStoredBreakdown(JSON.parse(JSON.stringify(partial)))).toEqual(plain)
    }
  })
})
