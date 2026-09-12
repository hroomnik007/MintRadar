import { describe, it, expect } from 'vitest'
import {
  computeTrustScore, versionFreshnessScore, TRACKED_NUT_COUNT,
  uptimeComponent, nutComponent, versionComponent, contactComponent,
} from '../utils/trustScore'

// Frontend half of the shared Trust Score contract.
// Weights: uptime 40 | NUT 15 | version 15 | contact 5 | audit 25
// Missing audit samples → 12.5
describe('computeTrustScore — parity with the backend source of truth', () => {
  it('returns 100 for a perfect mint', () => {
    expect(computeTrustScore(100, 25, 'Nutshell/0.20', 3, 100, 0)).toBe(100)
  })

  it('caps the total at 100', () => {
    expect(computeTrustScore(100, 28, 'Nutshell/0.20', 6, 100, 0)).toBe(100)
  })

  it('returns 13 for a mint with no data at all', () => {
    expect(computeTrustScore(0, null, null, 0, null, null)).toBe(13)
  })

  it('returns 88 when only audit data is missing', () => {
    expect(computeTrustScore(100, 25, 'Nutshell/0.20', 3, null, null)).toBe(88)
  })

  it('rounds the total exactly once, after summing the components', () => {
    // 40 + 15 + 15 + 5 + 12.5 = 87.5 → 88
    expect(computeTrustScore(100, 25, 'Nutshell/0.20', 3, null, null)).toBe(88)
    // 0 + 0 + 0 + 0 + 12.5 = 12.5 → 13
    expect(computeTrustScore(0, 0, null, 0, null, null)).toBe(13)
  })

  it('never returns NaN for negative or null inputs', () => {
    for (const score of [
      computeTrustScore(-50, null, null, 0, null, null),
      computeTrustScore(0, -5, null, 0, null, null),
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
    expect(versionComponent('Nutshell/0.20')).toBe(15)
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
    const sum = uptimeComponent(uptime) + nutComponent(nuts) + versionComponent(version)
      + contactComponent(contacts) + 12.5 /* audit: no data */
    expect(computeTrustScore(uptime, nuts, version, contacts, null, null))
      .toBe(Math.min(100, Math.round(sum)))
  })
})

describe('versionFreshnessScore', () => {
  it('returns 0 for missing versions', () => {
    expect(versionFreshnessScore(null)).toBe(0)
    expect(versionFreshnessScore('')).toBe(0)
  })

  it('returns 2.5 for a string with no recognizable software name (no "/", same neutral default as Unknown audit reliability)', () => {
    expect(versionFreshnessScore('garbage')).toBe(2.5)
    expect(versionFreshnessScore('0.20')).toBe(2.5)
  })

  it('returns 3 for a recognized software with an unparseable version number', () => {
    expect(versionFreshnessScore('Nutshell/garbage')).toBe(3)
  })

  it('decreases by 2 per version step below the freshest, floored at 0 five steps back', () => {
    expect(versionFreshnessScore('Nutshell/0.20')).toBe(10)
    expect(versionFreshnessScore('Nutshell/0.19')).toBe(8)
    expect(versionFreshnessScore('Nutshell/0.16')).toBe(2)
    expect(versionFreshnessScore('Nutshell/0.15')).toBe(0)
    expect(versionFreshnessScore('Nutshell/0.11')).toBe(0)
    expect(versionFreshnessScore('Nutshell/0.10')).toBe(0)
  })

  it('treats a newer-than-known Nutshell version as freshest', () => {
    expect(versionFreshnessScore('Nutshell/1.0')).toBe(10)
    expect(versionFreshnessScore('Nutshell/0.21')).toBe(10)
  })

  it('matches the first major.minor inside a longer version string', () => {
    expect(versionFreshnessScore('Nutshell/0.19.1')).toBe(8)
  })

  it('recognizes cdk-mintd against its own leaderboard instead of Nutshell\'s', () => {
    expect(versionFreshnessScore('cdk-mintd/0.17.5')).toBe(10)
    expect(versionFreshnessScore('cdk-mintd/0.16.0')).toBe(8)
  })

  it('strips a leading "v" and a "-rc.N" prerelease suffix before comparing', () => {
    expect(versionFreshnessScore('cdk-mintd/v0.17.5')).toBe(10)
    expect(versionFreshnessScore('cdk-mintd/0.17.0-rc.3')).toBe(10)
  })

  it('scores unrecognized software neutrally instead of 0 or an automatic 10 (the bug this fixes)', () => {
    expect(versionFreshnessScore('LekMint/1.1.1')).toBe(2.5)
    expect(versionFreshnessScore('Nutshell-CF/1.0.0')).toBe(2.5)
  })
})
