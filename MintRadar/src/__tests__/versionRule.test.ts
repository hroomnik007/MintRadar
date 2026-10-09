import { describe, it, expect } from 'vitest'
import {
  classifyVersion, classifyMintVersion, compareMintVersionNumbers, newestStableByFamily, latestMapFor,
  parseVersion, MAX_VERSION_LENGTH,
} from '@/utils/versionRule'
import { versionComponent } from '@/utils/reliabilityScore'
import { VERSION_CASES, ORDER_CASES } from './versionCases'

describe('classifyVersion (the one version rule)', () => {
  it.each(VERSION_CASES.map(c => [c.name, c] as const))('%s', (_n, c) => {
    const r = classifyVersion(c.software, c.version, c.latest)
    expect(r.label).toBe(c.label)
    expect(r.points).toBe(c.points)
    if (c.behind !== undefined) expect(r.minorsBehind).toBe(c.behind)
  })

  it('reports the family and the parsed parts (a fourth segment and a pre-release are kept apart)', () => {
    const r = classifyVersion('cdk-mintd', '0.18.0-rc.1', { major: 0, minor: 18 })
    expect(r.family).toBe('cdk')
    expect(r.parsed).toEqual({ major: 0, minor: 18, patch: 0, segment4: null, prerelease: 'rc.1' })
    expect(classifyVersion('Nutshell', '0.20.3.1', null).parsed).toMatchObject({ patch: 3, segment4: 1, prerelease: null })
  })

  it('a pre-release is never "latest" and never outdated against its own minor line', () => {
    const l = { major: 0, minor: 18 }
    expect(classifyVersion('cdk', '0.18.0-rc.1', l).label).toBeNull()
    expect(classifyVersion('cdk', '0.19.0-rc.1', l).label).toBeNull() // ahead of the latest line
    expect(classifyVersion('cdk', '0.16.0-rc.1', l).label).toBe('outdated') // its base is two behind
  })

  it('classifyMintVersion splits "Software/version" and picks the family latest', () => {
    const L = { nutshell: { major: 0, minor: 21 }, cdk: { major: 0, minor: 18 } }
    expect(classifyMintVersion('Nutshell/0.19.2', L).label).toBe('outdated')
    expect(classifyMintVersion('cdk-mintd/0.19.2', L).label).toBe('latest')
    expect(classifyMintVersion('', L).points).toBe(0)
    expect(classifyMintVersion('garbage', L).points).toBe(4)
    expect(classifyMintVersion('Nutshell/', L).points).toBe(5)
    expect(versionComponent('Nutshell/0.19.2', L)).toBe(9)
  })

  it('latestMapFor keys the one latest value by the mint\'s family', () => {
    expect(latestMapFor('cdk-mintd/0.18.1', { major: 0, minor: 18 })).toEqual({ cdk: { major: 0, minor: 18 } })
    expect(latestMapFor('LekMint/1.0.0', { major: 0, minor: 18 })).toBeUndefined()
    expect(latestMapFor('Nutshell/0.21.0', null)).toBeUndefined()
    expect(latestMapFor(null, { major: 0, minor: 21 })).toBeUndefined()
  })
})

describe('compareMintVersionNumbers (ordering)', () => {
  it.each(ORDER_CASES)('%s sorts above %s', (newer, older) => {
    expect(compareMintVersionNumbers(newer, older)).toBeGreaterThan(0)
    expect(compareMintVersionNumbers(older, newer)).toBeLessThan(0)
  })
  it('equal versions compare equal and a missing fourth segment equals 0', () => {
    expect(compareMintVersionNumbers('0.20.3', '0.20.3')).toBe(0)
    expect(compareMintVersionNumbers('0.20.3.0', '0.20.3')).toBe(0)
  })
})

describe('newestStableByFamily (the fallback "latest")', () => {
  it('takes the newest stable version per family and ignores pre-releases and unknown software', () => {
    expect(newestStableByFamily([
      'Nutshell/0.20.3', 'Nutshell/0.21.0', 'Nutshell/0.22.0-rc.1', 'cdk-mintd/0.18.1', 'cdk-mintd/0.19.0-rc.0',
      'LekMint/9.9.9', null, undefined, 'garbage',
    ])).toEqual({ nutshell: { major: 0, minor: 21 }, cdk: { major: 0, minor: 18 } })
  })
})

describe('untrusted version strings', () => {
  it('only ever looks at the first MAX_VERSION_LENGTH characters', () => {
    const long = '0.20.3-' + 'a'.repeat(5000)
    expect(parseVersion(long)?.prerelease?.length).toBeLessThanOrEqual(64)
    expect(classifyVersion('Nutshell', long + '-x'.repeat(5000), { major: 0, minor: 21 }).points).toBe(15)
    expect(MAX_VERSION_LENGTH).toBe(100)
  })
  it('does not backtrack catastrophically on hostile input', () => {
    const t = Date.now()
    parseVersion('1.'.repeat(50_000) + 'x')
    parseVersion('-'.repeat(100_000))
    expect(Date.now() - t).toBeLessThan(200)
  })
})
