import { describe, it, expect } from 'vitest'
import type { KnownMint } from '@/hooks/useKnownMints'
import type { WizardCheck } from '@/utils/wizardScoring'
import {
  softwareChoices, matchesPreferredSoftware, rankWizardRecs, wizardReasonText, latencyLimitNote, latencyLimitEmptyText,
  cleanSoftwareName, LATENCY_LIMITS,
} from '@/utils/wizardPick'
import { REVIEWS_WEIGHT, SOFTWARE_PREFERENCE_BONUS, softwarePreferenceCredit, weightsFor } from '@/utils/wizardScoring'
import { softwareFamily } from '@/utils/softwareFilter'

const LN = [{ method: 'bolt11', unit: 'sat' }]
const NUTS_ALL = { '9': {}, '11': { supported: true }, '17': { supported: [{ method: 'bolt11' }] } }
const mint = (over: Partial<KnownMint> = {}): KnownMint => ({
  url: 'https://a.mint.example', name: 'A', iconUrl: null, degraded: false, online: true, latencyMs: 1, version: 'Nutshell/0.16.0',
  nutCount: 5, tosUrl: null, descriptionLong: null, nutsLimits: NUTS_ALL, mintMethods: LN, meltMethods: LN, reliabilityScore: 88, ...over,
})
const sel = (...c: WizardCheck[]) => new Set<WizardCheck>(c)
const reason = (checks: Set<WizardCheck>, m: KnownMint = mint(), o: { latencyMs?: number | null; latencyLimit?: number | null; preferred?: string | null } = {}) =>
  wizardReasonText({ checks, mint: m, latencyMs: o.latencyMs ?? null, latencyLimit: o.latencyLimit ?? null, preferred: o.preferred ?? null })

describe('wizardReasonText', () => {
  it('lists each fact the mint meets, in the fixed order, joined with " · "', () => {
    expect(reason(sel('fast', 'reliable', 'ln', 'seed', 'p2pk', 'ws'), mint(), { latencyMs: 142, preferred: 'nutshell' }))
      .toBe('Lightning in and out · Restore (NUT-09) · Locked payments (NUT-11) · Live updates (NUT-17) · Reliability 88 · 142 ms from your browser · Nutshell')
  })

  it('each fact alone', () => {
    expect(reason(sel('ln'))).toBe('Lightning in and out')
    expect(reason(sel('seed'))).toBe('Restore (NUT-09)')
    expect(reason(sel('p2pk'))).toBe('Locked payments (NUT-11)')
    expect(reason(sel('ws'))).toBe('Live updates (NUT-17)')
    expect(reason(sel('reliable'))).toBe('Reliability 88')
    expect(reason(sel('fast'), mint(), { latencyMs: 90 })).toBe('90 ms from your browser')
  })

  it('Lightning uses the cardLightningLabel rule: in only, out only', () => {
    expect(reason(sel('ln'), mint({ meltMethods: [] }))).toBe('Lightning in')
    expect(reason(sel('ln'), mint({ mintMethods: [] }))).toBe('Lightning out')
    expect(reason(sel('ln'), mint({ mintMethods: [], meltMethods: [] }))).toBeNull()
  })

  it('a selected priority the mint does not meet is left out, with no negative words', () => {
    const t = reason(sel('seed', 'p2pk', 'ws'), mint({ nutsLimits: { '9': {} } }))
    expect(t).toBe('Restore (NUT-09)')
    expect(reason(sel('seed'), mint({ nutsLimits: { '9': { supported: false } } }))).toBeNull()
    expect(reason(sel('reliable'), mint({ reliabilityScore: null }))).toBeNull()
    expect(t).not.toMatch(/\b(no|not|without|lacks?|missing)\b/i)
  })

  it('nothing selected gives no line', () => {
    expect(reason(sel(), mint(), { latencyMs: 10 })).toBeNull()
  })

  it('latency: with the fast priority or a max latency, only when a measurement exists', () => {
    expect(reason(sel('fast'), mint(), { latencyMs: null })).toBeNull()
    expect(reason(sel('reliable'), mint(), { latencyMs: 80 })).toBe('Reliability 88') // neither fast nor a limit: not mentioned
    expect(reason(sel('reliable'), mint(), { latencyMs: 80, latencyLimit: 300 })).toBe('Reliability 88 · 80 ms from your browser')
  })

  it('the software name only when a preference is selected and the mint matches it', () => {
    expect(reason(sel('reliable'), mint(), { preferred: 'cdk' })).toBe('Reliability 88')
    expect(reason(sel('reliable'), mint({ version: 'cdk-mintd/0.9.1' }), { preferred: 'cdk' })).toBe('Reliability 88 · CDK-Mintd')
    expect(reason(sel(), mint(), { preferred: 'nutshell' })).toBe('Nutshell')
  })

  it('hostile software text stays short plain text', () => {
    const v = '<img src=x onerror=alert(1)>‮/1.0'
    const key = softwareFamily(v)!.key
    const t = reason(sel(), mint({ version: v }), { preferred: key })
    expect(t).toBe('<img src=x onerror=alert(1)>')
    expect(cleanSoftwareName('a\u0000b\nc')).toBe('a b c')
    expect(cleanSoftwareName('x'.repeat(200)).length).toBe(32)
  })
})

describe('softwareChoices', () => {
  const m = (version: string | null, online = true) => ({ online, version })
  it('one option per family of the online mints, the Dashboard names, the most used first', () => {
    expect(softwareChoices([m('Nutshell/0.16.0'), m('Nutshell/0.15.0'), m('cdk-mintd/0.9.1'), m('Nutshell/0.20.0')]))
      .toEqual([{ key: 'nutshell', name: 'Nutshell' }, { key: 'cdk', name: 'CDK-Mintd' }])
  })
  it('only online mints count, and Unknown is never offered', () => {
    expect(softwareChoices([m('Nutshell/0.16.0'), m('cdk-mintd/0.9.1', false), m(null), m('')])).toEqual([{ key: 'nutshell', name: 'Nutshell' }])
    expect(softwareChoices([m(null)])).toEqual([])
  })
  it('a family the Dashboard does not know keeps the spelling mints report', () => {
    expect(softwareChoices([m('Fedimint/1.0')])).toEqual([{ key: 'fedimint', name: 'Fedimint' }])
  })
})

describe('rankWizardRecs', () => {
  const rec = (name: string, score: number, latencyMs: number | null, version = 'Nutshell/0.16.0') => ({ name, mint: { version }, score, latencyMs })
  const BONUS = 0.02
  const rank = (recs: ReturnType<typeof rec>[], preferred: string | null) => rankWizardRecs(recs, { preferred, latencyLimit: null, bonus: BONUS })
  it('the software preference is a credit, not a filter: a matching mint wins an exact tie and nobody disappears', () => {
    const recs = [rec('a', 0.7, 100), rec('b', 0.7, 100, 'cdk-mintd/0.9.1')]
    expect(rank(recs, null).top.map(r => r.name)).toEqual(['a', 'b'])
    const withPref = rank(recs, 'cdk')
    expect(withPref.top.map(r => r.name)).toEqual(['b', 'a'])
    expect(withPref.top).toHaveLength(2)
  })
  it('a preference that matches nobody changes nothing ("Any" is null)', () => {
    const recs = [rec('a', 0.9, 1), rec('b', 0.5, 1), rec('c', 0.4, 1)]
    expect(rank(recs, 'nope').top.map(r => r.name)).toEqual(['a', 'b', 'c'])
    expect(rank(recs, null).top.map(r => r.name)).toEqual(['a', 'b', 'c'])
  })
  it('keeps the best three by default', () => {
    const recs = [rec('a', 0.1, 1), rec('b', 0.4, 1), rec('c', 0.3, 1), rec('d', 0.2, 1)]
    expect(rank(recs, null).top.map(r => r.name)).toEqual(['b', 'c', 'd'])
  })
  it('a bonus of zero changes nothing', () => {
    const recs = [rec('a', 0.7, 1), rec('b', 0.69, 1, 'cdk-mintd/0.9.1')]
    expect(rankWizardRecs(recs, { preferred: 'cdk', latencyLimit: null, bonus: 0 }).top.map(r => r.name)).toEqual(['a', 'b'])
  })
})

describe('software preference weight (about 3 Reliability points)', () => {
  it('has its own constant, independent of the reviews weight', () => {
    expect(SOFTWARE_PREFERENCE_BONUS).toBe(3)
    expect(SOFTWARE_PREFERENCE_BONUS / 100).not.toBe(REVIEWS_WEIGHT)
  })
  it('the credit is 3 / 100 of the reliability weight of the search', () => {
    const w = weightsFor(sel('reliable'), 'small')
    expect(softwarePreferenceCredit(w)).toBeCloseTo(0.03 * w.reliability, 12)
    expect(softwarePreferenceCredit({ reliability: 0.63 })).toBeCloseTo(0.0189, 10)
  })
  // Scores as the wizard computes them: only the reliability part differs between the mints (latency, NUTs, reviews equal).
  const scenarios: [string, Set<WizardCheck>, 'small' | 'large'][] = [
    ['Reliable', sel('reliable'), 'small'], ['Fast', sel('fast'), 'small'], ['Fast + Reliable', sel('fast', 'reliable'), 'small'], ['Reliable, large', sel('reliable'), 'large'],
  ]
  for (const [name, checks, size] of scenarios) {
    it(`${name}: preferred wins against an equal mint and one 2 points better, loses against one 10 points better; nobody removed`, () => {
      const w = weightsFor(checks, size)
      const credit = softwarePreferenceCredit(w)
      const score = (reliability: number) => w.reliability * (reliability / 100) + 0.3
      const rec = (n: string, reliability: number, version: string) => ({ n, mint: { version }, score: score(reliability), latencyMs: 100 })
      const rank = (other: number) => rankWizardRecs([rec('other', other, 'Nutshell/1'), rec('pref', 80, 'cdk-mintd/1')], { preferred: 'cdk', latencyLimit: null, bonus: credit })
      expect(rank(80).top.map(r => r.n)).toEqual(['pref', 'other'])
      expect(rank(82).top.map(r => r.n)).toEqual(['pref', 'other'])
      expect(rank(90).top.map(r => r.n)).toEqual(['other', 'pref'])
      for (const o of [80, 82, 90]) expect(rank(o).top).toHaveLength(2)
    })
  }
})

describe('latency limit', () => {
  const rec = (name: string, latencyMs: number | null, score = 0.5) => ({ name, mint: { version: null }, score, latencyMs })
  const recs = [rec('fast', 120, 0.4), rec('edge', 300, 0.9), rec('slow', 450, 0.8), rec('failed', null, 1), rec('mid', 299, 0.6)]
  const names = (limit: number | null) => rankWizardRecs(recs, { preferred: null, latencyLimit: limit, bonus: 0 }).top.map(r => r.name)
  it('shows measured mints under the limit (strictly), hides slower, unmeasured and failed ones', () => {
    expect(names(300)).toEqual(['mid', 'fast'])
    expect(names(600)).toEqual(['edge', 'slow', 'mid'].slice(0, 3))
    expect(names(300)).not.toContain('edge')
    expect(names(300)).not.toContain('failed')
  })
  it('"Any" changes nothing: the unmeasured one stays', () => {
    expect(names(null)).toEqual(['failed', 'edge', 'slow'])
  })
  it('counts: N measured of M tried, whatever the limit', () => {
    for (const limit of [null, 300, 600]) {
      const r = rankWizardRecs(recs, { preferred: null, latencyLimit: limit, bonus: 0 })
      expect(r.measured).toBe(4)
      expect(r.total).toBe(5)
    }
    expect(latencyLimitNote(4, 5)).toBe('The latency limit applies to the 4 of 5 mints measured from your browser.')
    expect(latencyLimitNote(1, 1)).toBe('The latency limit applies to the 1 of 1 mint measured from your browser.')
  })
  it('the limit changes no score and the empty text names the limit', () => {
    expect(rankWizardRecs([rec('x', 900)], { preferred: null, latencyLimit: 300, bonus: 0 }).top).toEqual([])
    expect(latencyLimitEmptyText(300)).toBe('No measured mint is under 300 ms. Try a higher limit.')
    expect([...LATENCY_LIMITS]).toEqual([300, 600])
  })
  it('the limit and the preference work together: the preference ranks only the mints that passed', () => {
    const r = [{ name: 'a', mint: { version: 'Nutshell/1' }, score: 0.5, latencyMs: 100 }, { name: 'b', mint: { version: 'cdk-mintd/1' }, score: 0.5, latencyMs: 900 }]
    expect(rankWizardRecs(r, { preferred: 'cdk', latencyLimit: 300, bonus: 0.02 }).top.map(x => x.name)).toEqual(['a'])
    expect(matchesPreferredSoftware({ version: 'cdk-mintd/1' }, 'cdk')).toBe(true)
    expect(matchesPreferredSoftware({ version: 'cdk-mintd/1' }, null)).toBe(false)
  })
})
