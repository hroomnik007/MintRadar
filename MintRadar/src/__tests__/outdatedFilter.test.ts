import { describe, it, expect } from 'vitest'
import {
  HIDE_OUTDATED_HINT, buildOutdatedParam, hasUnknownVersion, isOutdatedMint, mintMatchesOutdated, parseOutdatedParam,
  unknownKeptNote,
} from '@/utils/outdatedFilter'
import { mintMatchesSoftware } from '@/utils/softwareFilter'
import { classifyMintVersion, latestMapFor } from '@/utils/versionRule'

const NUTSHELL_LATEST = { major: 0, minor: 21 }
const CDK_LATEST = { major: 0, minor: 18 }
const mint = (version: string | null, softwareLatest: { major: number; minor: number } | null) => ({ version, softwareLatest })

const latest = mint('Nutshell/0.21.0', NUTSHELL_LATEST)
const oneBehind = mint('Nutshell/0.20.3', NUTSHELL_LATEST)
const twoBehind = mint('Nutshell/0.19.2', NUTSHELL_LATEST)
const cdkOld = mint('cdk-mintd/0.13.0', CDK_LATEST)
const cdkLatest = mint('cdk-mintd/0.18.1', CDK_LATEST)
const nutshellCf = mint('Nutshell-CF/0.16.0', null)
const lekmint = mint('LekMint/1.0.0', null)
const noLatest = mint('Nutshell/0.15.0', null)
const unreadable = mint('Nutshell/beta', NUTSHELL_LATEST)
const noVersion = mint(null, null)

describe('outdated filter: the shared version rule decides', () => {
  it('hides exactly the mints classifyMintVersion() labels "outdated"', () => {
    for (const m of [latest, oneBehind, twoBehind, cdkOld, cdkLatest, nutshellCf, lekmint, noLatest, unreadable, noVersion]) {
      const label = classifyMintVersion(m.version, latestMapFor(m.version, m.softwareLatest)).label
      expect(isOutdatedMint(m)).toBe(label === 'outdated')
      expect(mintMatchesOutdated(m, true)).toBe(label !== 'outdated')
    }
  })
  it('2 or more minors behind is hidden, 0 or 1 behind stays', () => {
    expect(mintMatchesOutdated(twoBehind, true)).toBe(false)
    expect(mintMatchesOutdated(cdkOld, true)).toBe(false)
    expect(mintMatchesOutdated(oneBehind, true)).toBe(true)
    expect(mintMatchesOutdated(latest, true)).toBe(true)
    expect(mintMatchesOutdated(cdkLatest, true)).toBe(true)
  })
  it('off: every mint passes', () => {
    expect(mintMatchesOutdated(twoBehind, false)).toBe(true)
    expect(mintMatchesOutdated(cdkOld, false)).toBe(true)
  })
  it('the hint states the rule with the shared threshold', () => {
    expect(HIDE_OUTDATED_HINT).toBe('2 or more minor versions behind the newest stable release of the same software.')
  })
})

describe('unknown versions are kept', () => {
  it('unknown software, no latest, unreadable or missing version: never hidden, counted as unknown', () => {
    for (const m of [nutshellCf, lekmint, noLatest, unreadable, noVersion]) {
      expect(hasUnknownVersion(m)).toBe(true)
      expect(mintMatchesOutdated(m, true)).toBe(true)
    }
  })
  it('comparable versions are not unknown', () => {
    for (const m of [latest, oneBehind, twoBehind, cdkOld, cdkLatest]) expect(hasUnknownVersion(m)).toBe(false)
  })
  it('the note uses the real count', () => {
    const all = [latest, twoBehind, nutshellCf, lekmint, noVersion]
    const shown = all.filter(m => mintMatchesOutdated(m, true))
    expect(unknownKeptNote(shown.filter(hasUnknownVersion).length)).toBe('3 mints with unknown software are kept.')
    expect(unknownKeptNote(1)).toBe('1 mint with unknown software is kept.')
    expect(unknownKeptNote(0)).toBe('0 mints with unknown software are kept.')
  })
})

describe('?outdated=hide round trip', () => {
  it('only "hide" turns it on; the param is written only when on', () => {
    expect(parseOutdatedParam('hide')).toBe(true)
    expect(parseOutdatedParam(null)).toBe(false)
    expect(parseOutdatedParam('')).toBe(false)
    expect(parseOutdatedParam('HIDE')).toBe(false)
    expect(parseOutdatedParam('show')).toBe(false)
    expect(buildOutdatedParam(true)).toBe('hide')
    expect(buildOutdatedParam(false)).toBeNull()
  })
  it('parse(build(x)) === x through a URLSearchParams', () => {
    for (const on of [true, false]) {
      const params = new URLSearchParams()
      const v = buildOutdatedParam(on)
      if (v) params.set('outdated', v)
      expect(params.toString()).toBe(on ? 'outdated=hide' : '')
      expect(parseOutdatedParam(new URLSearchParams(params.toString()).get('outdated'))).toBe(on)
    }
  })
})

describe('combination with another filter (logical AND)', () => {
  it('Software = Nutshell AND hide outdated', () => {
    const families = new Set(['nutshell', 'cdk', 'nutshell-cf', 'lekmint'])
    const all = [latest, oneBehind, twoBehind, cdkOld, cdkLatest, nutshellCf, lekmint]
    const shown = all.filter(m => mintMatchesSoftware(m, ['nutshell'], families) && mintMatchesOutdated(m, true))
    expect(shown).toEqual([latest, oneBehind])
    // Each filter alone keeps more: the AND is the intersection.
    expect(all.filter(m => mintMatchesSoftware(m, ['nutshell'], families))).toEqual([latest, oneBehind, twoBehind])
    expect(all.filter(m => mintMatchesOutdated(m, true))).toEqual([latest, oneBehind, cdkLatest, nutshellCf, lekmint])
  })
})
