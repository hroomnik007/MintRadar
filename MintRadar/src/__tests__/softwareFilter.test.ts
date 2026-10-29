import { describe, it, expect } from 'vitest'
import { softwareFamily, softwareGroups, mintMatchesSoftware, parseSoftwareParam, buildSoftwareParam, SOFTWARE_OTHER, SOFTWARE_UNKNOWN } from '@/utils/softwareFilter'

const v = (version: string | null) => ({ version })

describe('softwareFamily', () => {
  it('names the known prefixes cleanly and maps cdk-mintd onto cdk', () => {
    expect(softwareFamily('Nutshell/0.16.3')).toEqual({ key: 'nutshell', name: 'Nutshell' })
    expect(softwareFamily('cdk-mintd/0.9.1')).toEqual({ key: 'cdk', name: 'CDK-Mintd' })
    expect(softwareFamily('cdk/0.9.1')).toEqual({ key: 'cdk', name: 'CDK-Mintd' })
  })
  it('is case-insensitive for known families', () => {
    expect(softwareFamily('NUTSHELL/0.16.3')).toEqual({ key: 'nutshell', name: 'Nutshell' })
    expect(softwareFamily('CDK-Mintd/0.9.1')?.key).toBe('cdk')
  })
  it('keeps an unknown prefix as reported, with a lowercase key; a look-alike is not a prefix match', () => {
    expect(softwareFamily('LekMint/1.0')).toEqual({ key: 'lekmint', name: 'LekMint' })
    expect(softwareFamily('Nutshell-CF/0.16.3')).toEqual({ key: 'nutshell-cf', name: 'Nutshell-CF' })
  })
  it('a string without "/" is a family on its own; no version string is no family', () => {
    expect(softwareFamily('Nutshell')?.key).toBe('nutshell')
    expect(softwareFamily(null)).toBeNull()
    expect(softwareFamily(undefined)).toBeNull()
    expect(softwareFamily('')).toBeNull()
    expect(softwareFamily('   ')).toBeNull()
    expect(softwareFamily('/0.1')).toBeNull()
  })
})

describe('softwareGroups', () => {
  const mints = [
    v('Nutshell/0.16.3'), v('nutshell/0.17.0'), v('Nutshell/0.16.3'),
    v('cdk-mintd/0.9.1'), v('cdk-mintd/0.9.2'),
    v('Nutshell-CF/0.1'), v('Nutshell-CF/0.2'),
    v('LekMint/1.0'), v('Solo/2'),
    v(null),
  ]
  it('lists every family by count (then name), then Unknown; Other stays out while no family is below the threshold', () => {
    expect(softwareGroups(mints).options).toEqual([
      { key: 'nutshell', name: 'Nutshell' }, { key: 'cdk', name: 'CDK-Mintd' }, { key: 'nutshell-cf', name: 'Nutshell-CF' },
      { key: 'lekmint', name: 'LekMint' }, { key: 'solo', name: 'Solo' }, { key: SOFTWARE_UNKNOWN, name: 'Unknown' },
    ])
    expect([...softwareGroups(mints).families].sort()).toEqual(['cdk', 'lekmint', 'nutshell', 'nutshell-cf', 'solo'])
  })
  it('leaves out Other / Unknown when no mint falls in them, and uses the most reported spelling', () => {
    const g = softwareGroups([v('Foo/1'), v('FOO/2'), v('FOO/3')])
    expect(g.options).toEqual([{ key: 'foo', name: 'FOO' }])
  })
  it('keeps a selected Other listed so it can be cleared', () => {
    expect(softwareGroups([v('Foo/1')], [SOFTWARE_OTHER]).options.map(o => o.key)).toEqual(['foo', SOFTWARE_OTHER])
  })
  it('keeps a selected key nobody has, so it can be cleared', () => {
    expect(softwareGroups([v('Foo/1'), v('Foo/2')], ['bar']).options.map(o => o.key)).toEqual(['foo', 'bar'])
  })
})

describe('mintMatchesSoftware', () => {
  const families = new Set(['nutshell', 'cdk'])
  it('no selection = no filtering (even for a mint without a version)', () => {
    expect(mintMatchesSoftware(v(null), [], families)).toBe(true)
  })
  it('matches the mint\'s own family, case-insensitively, and ORs several selections', () => {
    expect(mintMatchesSoftware(v('NUTSHELL/0.1'), ['nutshell'], families)).toBe(true)
    expect(mintMatchesSoftware(v('cdk-mintd/0.9'), ['nutshell'], families)).toBe(false)
    expect(mintMatchesSoftware(v('cdk-mintd/0.9'), ['nutshell', 'cdk'], families)).toBe(true)
  })
  it('Other = a family without its own option; Unknown = no version string', () => {
    expect(mintMatchesSoftware(v('LekMint/1'), [SOFTWARE_OTHER], families)).toBe(true)
    expect(mintMatchesSoftware(v('Nutshell/1'), [SOFTWARE_OTHER], families)).toBe(false)
    expect(mintMatchesSoftware(v(null), [SOFTWARE_OTHER], families)).toBe(false)
    expect(mintMatchesSoftware(v(null), [SOFTWARE_UNKNOWN], families)).toBe(true)
    expect(mintMatchesSoftware(v('LekMint/1'), [SOFTWARE_UNKNOWN], families)).toBe(false)
  })
})

describe('software URL param', () => {
  it('parses lowercase, drops malformed entries and duplicates', () => {
    expect(parseSoftwareParam('Nutshell,cdk,nutshell,bad name,')).toEqual(['nutshell', 'cdk'])
    expect(parseSoftwareParam(null)).toEqual([])
    expect(parseSoftwareParam('')).toEqual([])
  })
  it('builds null for an empty selection', () => {
    expect(buildSoftwareParam([])).toBeNull()
    expect(buildSoftwareParam(['cdk', 'other'])).toBe('cdk,other')
  })
})
