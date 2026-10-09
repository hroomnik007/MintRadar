import { describe, it, expect } from 'vitest'
import {
  classifyVersion, classifyMintVersion, compareMintVersionNumbers, newestStableByFamily, latestMapFor,
  parseVersion, MAX_VERSION_LENGTH,
} from '../shared/versionRule.js'
import { versionComponent } from '../shared/reliabilityScore.js'
import { VERSION_CASES, ORDER_CASES } from './versionCases.js'

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

describe('newestStableByFamily (the fallback "latest": at least two DISTINCT mints report the exact version)', () => {
  const two = (v: string) => [v, v]
  it('takes the highest stable version per family that two mints report; pre-releases and unknown software never count', () => {
    expect(newestStableByFamily([
      ...two('Nutshell/0.20.3'), ...two('Nutshell/0.21.0'), ...two('Nutshell/0.22.0-rc.1'), ...two('cdk-mintd/0.18.1'),
      ...two('cdk-mintd/0.19.0-rc.0'), ...two('LekMint/9.9.9'), null, undefined, 'garbage', 'garbage',
    ])).toEqual({ nutshell: { major: 0, minor: 21 }, cdk: { major: 0, minor: 18 } })
  })

  it('one hostile mint reporting 0.99.0 changes nothing', () => {
    const honest = [...two('Nutshell/0.21.0'), 'Nutshell/0.20.3', 'Nutshell/0.20.3']
    expect(newestStableByFamily(honest)).toEqual({ nutshell: { major: 0, minor: 21 } })
    expect(newestStableByFamily([...honest, 'Nutshell/0.99.0'])).toEqual({ nutshell: { major: 0, minor: 21 } })
  })

  it('two mints reporting 0.99.0 do move it', () => {
    expect(newestStableByFamily(['Nutshell/0.21.0', 'Nutshell/0.21.0', 'Nutshell/0.99.0', 'Nutshell/0.99.0']))
      .toEqual({ nutshell: { major: 0, minor: 99 } })
  })

  it('mints that only differ by prefix count as the same version', () => {
    expect(newestStableByFamily(['cdk/0.18.1', 'cdk-mintd/0.18.1'])).toEqual({ cdk: { major: 0, minor: 18 } })
    expect(newestStableByFamily(['Nutshell/v0.99.0', 'nutshell/0.99.0'])).toEqual({ nutshell: { major: 0, minor: 99 } })
    expect(newestStableByFamily(['CDK-MINTD/0.18.1', 'cdk/v0.18.1'])).toEqual({ cdk: { major: 0, minor: 18 } })
  })

  it('different exact versions do not add up (0.99.0 and 0.99.1 are two different versions)', () => {
    expect(newestStableByFamily(['Nutshell/0.99.0', 'Nutshell/0.99.1'])).toEqual({})
    expect(newestStableByFamily(['Nutshell/0.20.3', 'Nutshell/0.20.3.1'])).toEqual({})
  })

  it('a family where no version qualifies gets no latest at all', () => {
    expect(newestStableByFamily(['Nutshell/0.21.0', 'cdk-mintd/0.18.1'])).toEqual({})
    expect(newestStableByFamily([])).toEqual({})
  })

  it('a pre-release reported by two mints still never counts', () => {
    expect(newestStableByFamily(['cdk-mintd/0.19.0-rc.1', 'cdk-mintd/0.19.0-rc.1'])).toEqual({})
  })

  it('the minimum can be lowered explicitly (the old "newest seen" behaviour)', () => {
    expect(newestStableByFamily(['Nutshell/0.99.0'], 1)).toEqual({ nutshell: { major: 0, minor: 99 } })
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
