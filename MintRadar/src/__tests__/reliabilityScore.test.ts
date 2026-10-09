import { describe, it, expect } from 'vitest'
import {
  computeReliabilityScore, TRACKED_NUT_COUNT,
  uptimeComponent, nutComponent, versionComponent, contactComponent,
  isEligibleForRecommendation, MIN_RECOMMENDATION_AGE_DAYS, type AuditInput,
} from '../utils/reliabilityScore'

const NO_AUDIT: AuditInput = { blamed: null, total: null, fetchedAt: null }
const CLEAN: AuditInput = { blamed: 0, total: 100, fetchedAt: new Date().toISOString() }
// The one "latest" per family the API sends with a mint (`softwareLatest`); there is no static fallback list.
const LATEST_NUTSHELL = { nutshell: { major: 0, minor: 20 } }

// Frontend half of the shared Reliability Score contract.
// Weights: uptime 40 | NUT 15 | version 15 | contact 5 | audit 25
// Missing / too few (<10 swaps in 7 days) / older than 168 h cashu.info audit data → 12.5
describe('computeReliabilityScore — parity with the backend source of truth', () => {
  it('returns 100 for a perfect mint', () => {
    expect(computeReliabilityScore(100, 14, 'Nutshell/0.20', 3, CLEAN, LATEST_NUTSHELL)).toBe(100)
  })

  it('caps the total at 100', () => {
    expect(computeReliabilityScore(100, 28, 'Nutshell/0.20', 6, CLEAN, LATEST_NUTSHELL)).toBe(100)
  })

  it('returns 13 for a mint with no data at all', () => {
    expect(computeReliabilityScore(0, null, null, 0, NO_AUDIT)).toBe(13)
  })

  it('returns 88 when only audit data is missing', () => {
    expect(computeReliabilityScore(100, 14, 'Nutshell/0.20', 3, NO_AUDIT, LATEST_NUTSHELL)).toBe(88)
  })

  it('rounds the total exactly once, after summing the components', () => {
    // 40 + 15 + 15 + 5 + 12.5 = 87.5 → 88
    expect(computeReliabilityScore(100, 14, 'Nutshell/0.20', 3, NO_AUDIT, LATEST_NUTSHELL)).toBe(88)
    // 0 + 0 + 0 + 0 + 12.5 = 12.5 → 13
    expect(computeReliabilityScore(0, 0, null, 0, NO_AUDIT)).toBe(13)
  })

  it('never returns NaN for negative or null inputs', () => {
    for (const score of [
      computeReliabilityScore(-50, null, null, 0, NO_AUDIT),
      computeReliabilityScore(0, -5, null, 0, NO_AUDIT),
    ]) {
      expect(Number.isFinite(score)).toBe(true)
      expect(Number.isNaN(score)).toBe(false)
    }
  })
})

describe('components', () => {
  it('uptime is worth 40 points at 100%', () => {
    expect(uptimeComponent(0)).toBe(0)
    expect(uptimeComponent(100)).toBe(40)
  })

  it('NUT support is worth 15 points and caps at TRACKED_NUT_COUNT', () => {
    expect(nutComponent(0)).toBe(0)
    expect(nutComponent(null)).toBe(0)
    expect(nutComponent(TRACKED_NUT_COUNT)).toBe(15)
    expect(nutComponent(TRACKED_NUT_COUNT * 2)).toBe(15)
  })

  it('version is worth 15 points at the freshest known release', () => {
    expect(versionComponent(null)).toBe(0)
    expect(versionComponent('Nutshell/0.20', { nutshell: { major: 0, minor: 20 } })).toBe(15)
  })

  it('contact is worth 5 points at 3 methods and is clamped there (audit finding H1)', () => {
    expect(contactComponent(0)).toBe(0)
    expect(contactComponent(1)).toBe(2)
    expect(contactComponent(3)).toBe(5)
    expect(contactComponent(6)).toBe(5)
    expect(contactComponent(60)).toBe(5)
  })

  it('breakdown components sum to the same total the score reports', () => {
    const [uptime, nuts, version, contacts] = [97, 20, 'Nutshell/0.15', 1] as const
    const LATEST = { nutshell: { major: 0, minor: 20 } }
    const sum = uptimeComponent(uptime) + nutComponent(nuts) + versionComponent(version, LATEST)
      + contactComponent(contacts) + 12.5 /* audit: no data */
    expect(computeReliabilityScore(uptime, nuts, version, contacts, NO_AUDIT, LATEST))
      .toBe(Math.min(100, Math.round(sum)))
  })
})

describe('version component (one rule: versionRule.ts)', () => {
  const L = { nutshell: { major: 0, minor: 21 }, cdk: { major: 0, minor: 18 } }

  it('is 0 for a missing version', () => {
    expect(versionComponent(null)).toBe(0)
    expect(versionComponent('')).toBe(0)
  })

  it('keeps 4 points for a string with no recognizable software name and for unrecognized software', () => {
    expect(versionComponent('garbage', L)).toBe(4)
    expect(versionComponent('0.20', L)).toBe(4)
    expect(versionComponent('LekMint/1.1.1', L)).toBe(4)
    expect(versionComponent('Nutshell-CF/1.0.0', L)).toBe(4)
  })

  it('keeps 5 points for a recognized software with an unparseable version number', () => {
    expect(versionComponent('Nutshell/garbage', L)).toBe(5)
  })

  it('0 or 1 minor versions behind the latest = 15, then 9 / 6 / 3 / 0', () => {
    expect(versionComponent('Nutshell/0.21.0', L)).toBe(15)
    expect(versionComponent('Nutshell/0.20.3', L)).toBe(15)
    expect(versionComponent('Nutshell/0.19.2', L)).toBe(9)
    expect(versionComponent('Nutshell/0.18.2', L)).toBe(6)
    expect(versionComponent('Nutshell/0.17.0', L)).toBe(3)
    expect(versionComponent('Nutshell/0.16.0', L)).toBe(0)
  })

  it('treats a newer-than-latest version as current', () => {
    expect(versionComponent('Nutshell/1.0', L)).toBe(15)
    expect(versionComponent('Nutshell/0.22.0', L)).toBe(15)
  })

  it('recognizes cdk-mintd against its own latest instead of Nutshell\'s', () => {
    expect(versionComponent('cdk-mintd/0.17.5', L)).toBe(15)
    expect(versionComponent('cdk-mintd/0.16.0', L)).toBe(9)
  })

  it('strips a leading "v" and counts a pre-release as its base version', () => {
    expect(versionComponent('cdk-mintd/v0.17.5', L)).toBe(15)
    expect(versionComponent('cdk-mintd/0.18.0-rc.1', L)).toBe(15)
  })

  it('has no static fallback: without a latest a recognized family scores neutrally', () => {
    expect(versionComponent('Nutshell/0.21.0')).toBe(4)
  })

  it('INVARIANT: the version points the breakdown shows are the points inside the final score', () => {
    // Mint Detail's breakdown row = versionComponent(version, latest); the score = computeReliabilityScore(..., latest).
    const audit = { blamed: 0, total: 100, fetchedAt: new Date().toISOString() }
    for (const v of ['Nutshell/0.21.0', 'Nutshell/0.20.3', 'Nutshell/0.19.2', 'Nutshell/0.18.2', 'Nutshell/0.17.0', 'cdk-mintd/0.18.0-rc.1', 'cdk-mintd/0.13.4']) {
      const shown = uptimeComponent(90) + nutComponent(10) + versionComponent(v, L) + contactComponent(2) + 25
      expect(computeReliabilityScore(90, 10, v, 2, audit, L), v).toBe(Math.min(100, Math.round(shown)))
    }
  })
})

describe('isEligibleForRecommendation', () => {
  const NOW = new Date('2026-09-19T00:00:00Z').getTime()
  const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

  it('rejects a mint discovered 5 days ago', () => {
    expect(isEligibleForRecommendation(daysAgo(5), NOW)).toBe(false)
  })

  it('accepts a mint discovered exactly MIN_RECOMMENDATION_AGE_DAYS ago', () => {
    expect(isEligibleForRecommendation(daysAgo(MIN_RECOMMENDATION_AGE_DAYS), NOW)).toBe(true)
  })

  it('accepts a mint discovered 20 days ago', () => {
    expect(isEligibleForRecommendation(daysAgo(20), NOW)).toBe(true)
  })

  it('rejects null/undefined discoveredAt (unknown age is never eligible)', () => {
    expect(isEligibleForRecommendation(null, NOW)).toBe(false)
    expect(isEligibleForRecommendation(undefined, NOW)).toBe(false)
  })
})
