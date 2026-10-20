import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  NHI_WEIGHTS, ADVANCED_NUTS, ADVANCED_NUT_KEYS, DEGRADED_AFTER_HOURS, advancedAdoptionPercent,
  nhiSubtitle, NHI_SUBTITLE, nhiOnlineSetText, nhiFormulaText, nhiOnlineRowText, nhiReliabilityRowText,
  nhiAdvancedRowText, avgUptimeCaption, nhiScore, methodAdoptionPercent,
} from '@/utils/networkHealthIndex'
import { PROBE_LOCATION, CLIENT_LATENCY_BUTTON_LABEL, latencyCaption } from '@/constants/probeLocation'

const src = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')
const adoption = (pairs: Record<string, number>) => Object.entries(pairs).map(([k, percent]) => ({ nut: `NUT-${k.padStart(2, '0')}`, count: 0, percent }))

describe('Network Health Index constants', () => {
  it('weights add up to 100 points', () => {
    expect(Object.values(NHI_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('the advanced NUT keys are the ones the index averages', () => {
    expect(ADVANCED_NUT_KEYS).toEqual(['11', '12', '14', '17', '21', '22', '25', '30'])
    expect(ADVANCED_NUT_KEYS).toEqual(ADVANCED_NUTS.map(n => n.key))
    expect(new Set(ADVANCED_NUTS.map(n => n.label)).size).toBe(ADVANCED_NUTS.length)
  })

  it('leaves out the wallet-side NUT-27 and NUT-28 (a mint never advertises them) and keeps the mint-side rest', () => {
    expect(ADVANCED_NUT_KEYS).not.toContain('27')
    expect(ADVANCED_NUT_KEYS).not.toContain('28')
    for (const k of ['11', '12', '14', '17', '21', '22', '25', '30']) expect(ADVANCED_NUT_KEYS, k).toContain(k)
    expect(ADVANCED_NUTS.map(n => n.label)).not.toContain('Nostr backup')
    expect(ADVANCED_NUTS.map(n => n.label)).not.toContain('pay-to-blinded-key')
  })

  it('DEGRADED_AFTER_HOURS equals the backend rule that sets `degraded`', () => {
    const m = /const STALE_OFFLINE_MS = (\d+) \* (\d+) \* (\d+) \* (\d+)/.exec(src('../../backend/src/degraded.ts'))
    expect(m).not.toBeNull()
    expect(m!.slice(1).map(Number).reduce((a, b) => a * b, 1) / 3_600_000).toBe(DEGRADED_AFTER_HOURS)
  })
})

describe('advancedAdoptionPercent', () => {
  it('averages the listed NUTs and counts a NUT missing from the stats as 0%', () => {
    // 11/12/14/17 at 100/100/98/94, the other four absent or 0: (100+100+98+94)/8
    const a = adoption({ '11': 100, '12': 100, '14': 98, '17': 94, '21': 0, '22': 0, '25': 0, '30': 0 })
    expect(advancedAdoptionPercent(a)).toBeCloseTo(49, 5)
  })

  it('is 100 when every remaining feature is offered by every mint (it was capped below 100 with 27/28 listed)', () => {
    const all = adoption(Object.fromEntries(ADVANCED_NUT_KEYS.map(k => [k, 100])))
    const offering = [{ online: true, nutsLimits: {}, mintMethods: [{ method: 'bolt12' }], meltMethods: [{ method: 'onchain' }] }]
    expect(advancedAdoptionPercent(all, ADVANCED_NUTS, offering)).toBe(100)
  })

  it('is 0 when no mint offers any of them, or the stats list none', () => {
    expect(advancedAdoptionPercent(adoption(Object.fromEntries(ADVANCED_NUT_KEYS.map(k => [k, 0]))))).toBe(0)
    expect(advancedAdoptionPercent(adoption({}))).toBe(0)
  })

  it('ignores NUT-27 and NUT-28 even when the stats report them', () => {
    expect(advancedAdoptionPercent(adoption({ '27': 100, '28': 100 }))).toBe(0)
    const all = adoption(Object.fromEntries(ADVANCED_NUT_KEYS.map(k => [k, 100])))
    const offering = [{ online: true, nutsLimits: {}, mintMethods: [{ method: 'bolt12' }], meltMethods: [{ method: 'onchain' }] }]
    expect(advancedAdoptionPercent([...all, ...adoption({ '27': 0, '28': 0 })], ADVANCED_NUTS, offering)).toBe(100)
  })

  it('ignores NUTs that are not in the list and handles an empty list', () => {
    expect(advancedAdoptionPercent(adoption({ '4': 100, '5': 100 }))).toBe(0)
    expect(advancedAdoptionPercent(adoption({ '11': 100 }), [])).toBe(0)
  })
})

describe('BOLT12 and on-chain adoption (payment methods in NUT-04/05, not nuts keys 25/30)', () => {
  const nuts = { '4': {}, '5': {} }
  const mint = (o: Record<string, unknown>) => ({ online: true, nutsLimits: nuts, mintMethods: null, meltMethods: null, ...o })
  const mints = [
    mint({ mintMethods: [{ method: 'bolt11', unit: 'sat' }, { method: 'bolt12', unit: 'sat' }] }),
    mint({ meltMethods: [{ method: 'onchain', unit: 'sat' }, { method: 'BOLT12', unit: 'sat' }] }),
    mint({ mintMethods: [{ method: 'bolt11', unit: 'sat' }] }),
    mint({ online: false, mintMethods: [{ method: 'bolt12', unit: 'sat' }] }),
    mint({ nutsLimits: null, mintMethods: [{ method: 'bolt12', unit: 'sat' }] }),
  ]

  it('counts a mint that lists the method as mint OR melt method, over online mints with a stored nuts object', () => {
    // population = 3 online mints with nuts; bolt12 on 2 of them, onchain on 1
    expect(methodAdoptionPercent(mints, 'bolt12')).toBe(67)
    expect(methodAdoptionPercent(mints, 'onchain')).toBe(33)
    expect(methodAdoptionPercent([], 'bolt12')).toBe(0)
  })

  it('the index takes BOLT12/on-chain from the methods and ignores nuts keys 25 and 30', () => {
    const a = adoption({ '11': 100, '12': 100, '14': 100, '17': 100, '21': 0, '22': 0, '25': 100, '30': 100 })
    // keys 25/30 at 100% in nutAdoption no longer count: (100*4 + 0 + 0 + 67 + 33) / 8
    expect(advancedAdoptionPercent(a, ADVANCED_NUTS, mints)).toBeCloseTo((400 + 67 + 33) / 8, 5)
    // without any mints the two method features are 0, whatever nutAdoption says
    expect(advancedAdoptionPercent(a)).toBeCloseTo(400 / 8, 5)
  })

  it('the two features carry their method and the row text says how they count', () => {
    expect(ADVANCED_NUTS.filter(n => n.method).map(n => [n.key, n.method])).toEqual([['25', 'bolt12'], ['30', 'onchain']])
    expect(nhiAdvancedRowText()).toContain('BOLT12 and on-chain are read from mint and melt methods')
  })

  it('the wrong "no online mint reports 21, 22, 25 or 30" comment is gone', () => {
    expect(src('../utils/networkHealthIndex.ts')).not.toMatch(/no online mint reports 21, 22, 25 or 30/)
  })
})

describe('Network Health Index texts come from the constants', () => {
  it('the formula names every component with its weight', () => {
    const t = nhiFormulaText()
    for (const [k, w] of Object.entries(NHI_WEIGHTS)) expect(t, k).toContain(String(w))
    expect(t).toContain(`Online%×${NHI_WEIGHTS.online}`)
    expect(t).toContain(`Tracking history×${NHI_WEIGHTS.stability}`)
  })

  it('changing a weight changes the formula and the row text', () => {
    const w = { online: 40, reliability: 20, diversity: 15, advanced: 15, stability: 10 }
    expect(nhiFormulaText(w)).toContain('Online%×40')
    expect(nhiFormulaText(w)).toContain('Tracking history×10')
    expect(nhiOnlineRowText(36, w)).toBe(nhiOnlineRowText(36, w, DEGRADED_AFTER_HOURS))
    expect(nhiOnlineRowText(36, w)).toContain('36 of 40 points')
  })

  it('the formula and the online-set sentence use the degraded window', () => {
    expect(nhiFormulaText()).toContain(`Online%×${NHI_WEIGHTS.online}`)
    expect(nhiFormulaText()).toContain(nhiOnlineSetText())
    expect(nhiOnlineSetText(48)).toContain('48h')
    expect(nhiOnlineRowText(10, NHI_WEIGHTS, 48)).toContain('48h')
    expect(avgUptimeCaption(48)).toBe('of mints not offline for 48h+')
    expect(avgUptimeCaption()).toBe(`of mints not offline for ${DEGRADED_AFTER_HOURS}h+`)
  })

  it('the advanced row lists exactly the computed features, in order', () => {
    const t = nhiAdvancedRowText()
    let last = -1
    for (const f of ADVANCED_NUTS) {
      const at = t.indexOf(f.label)
      expect(at, f.label).toBeGreaterThan(last)
      last = at
    }
  })

  it('a feature that is not computed is never mentioned', () => {
    const t = nhiAdvancedRowText(ADVANCED_NUTS.filter(n => n.key === '11' || n.key === '12'))
    expect(t).toContain('P2PK')
    expect(t).toContain('DLEQ')
    for (const f of ADVANCED_NUTS.filter(n => n.key !== '11' && n.key !== '12')) expect(t, f.label).not.toContain(f.label)
  })

  it('says what is counted: online mints, 0% for a feature nobody offers, no "uptime", no Dashboard grid', () => {
    const all = [nhiOnlineSetText(), nhiFormulaText(), nhiOnlineRowText(27), nhiReliabilityRowText(), nhiAdvancedRowText(), avgUptimeCaption()]
    for (const t of all) {
      expect(t).not.toMatch(/dashboard/i)
      expect(t).not.toMatch(/\b(safe|secure|trusted|guaranteed|recommended)\b/i)
    }
    expect(nhiAdvancedRowText()).toContain('A feature no mint offers counts as 0%')
    expect(nhiReliabilityRowText()).toContain('without a score counts as 0')
    expect(nhiReliabilityRowText()).toContain('Test mints are included')
  })

  it('every remaining NHI tooltip stays within 220 characters', () => {
    for (const t of [nhiOnlineRowText(27), nhiReliabilityRowText(), nhiAdvancedRowText()]) {
      expect(t.length).toBeLessThanOrEqual(220)
    }
  })
})

describe('nhiScore', () => {
  it('equals the value computed by hand from the weights', () => {
    // 80*0.30 + 60*0.25 + 40*0.15 + 100*0.15 + 40*0.15 = 24 + 15 + 6 + 15 + 6
    expect(nhiScore({ online: 80, reliability: 60, diversity: 40, advanced: 100, stability: 40 })).toBe(66)
    // 100*0.30 + 86*0.25 + 51*0.15 + 49*0.15 + 82*0.15 = 30 + 21.5 + 7.65 + 7.35 + 12.3 = 78.8
    expect(nhiScore({ online: 100, reliability: 86, diversity: 51, advanced: 49, stability: 82 })).toBe(79)
    expect(nhiScore({ online: 0, reliability: 0, diversity: 0, advanced: 0, stability: 0 })).toBe(0)
    expect(nhiScore({ online: 100, reliability: 100, diversity: 100, advanced: 100, stability: 100 })).toBe(100)
  })

  it('moves by the advanced weight x the change of that part (49 -> 100 is +7.65 points at weight 15)', () => {
    const base = { online: 100, reliability: 86, diversity: 51, stability: 82 }
    expect(nhiScore({ ...base, advanced: 100 }) - nhiScore({ ...base, advanced: 49 })).toBe(7) // 86.45 -> 86 minus 78.8 -> 79
    expect(nhiScore({ ...base, advanced: 100 }, { online: 30, reliability: 25, diversity: 15, advanced: 0, stability: 30 })).toBe(
      nhiScore({ ...base, advanced: 0 }, { online: 30, reliability: 25, diversity: 15, advanced: 0, stability: 30 }),
    )
  })

  it('follows the weights it is given', () => {
    const p = { online: 100, reliability: 0, diversity: 0, advanced: 0, stability: 0 }
    expect(nhiScore(p, { online: 40, reliability: 20, diversity: 15, advanced: 15, stability: 10 })).toBe(40)
  })
})

describe('advanced row text names exactly the computed features', () => {
  it('lists the labels of ADVANCED_NUTS and nothing else', () => {
    const t = nhiAdvancedRowText()
    const list = /each of: (.*?)\. (?:BOLT12 and on-chain are read from mint and melt methods\. )?A feature/.exec(t)![1]!
    expect(list.split(', ')).toEqual(ADVANCED_NUTS.map(n => n.label))
  })

  it('never names the removed wallet-side features, in any NHI text', () => {
    const all = [nhiOnlineSetText(), nhiFormulaText(), nhiOnlineRowText(27), nhiReliabilityRowText(), nhiAdvancedRowText(), avgUptimeCaption()]
    for (const t of all) {
      expect(t).not.toMatch(/Nostr backup|blinded-key|pay-to-blinded|NUT-27|NUT-28/i)
    }
  })
})

describe('Stats.tsx wires the generated texts', () => {
  const stats = src('../pages/Stats.tsx')
  it('uses the constants and no second copy of the numbers or the old claims', () => {
    expect(stats).not.toMatch(/same set as the Dashboard default grid/)
    expect(stats).not.toMatch(/ADVANCED_NUT_KEYS\s*=/)
    expect(stats).not.toMatch(/\* 0\.(30|25|15)\b/)
    expect(stats).toContain('advancedAdoptionPercent(data.nutAdoption, undefined, knownMintsData)')
    expect(stats).toContain('nhiScore({')
    expect(stats).toContain('weight: NHI_WEIGHTS.advanced')
    expect(stats).toContain('{avgUptimeCaption()}')
    expect(stats).toContain('{nhiSubtitle()}')
  })
})

describe('NHI subtitle and the average-uptime caption (they replaced two tooltips)', () => {
  it('the subtitle is one short sentence (the "Show details" link says how to open the breakdown)', () => {
    expect(NHI_SUBTITLE).toBe('Weighted from five factors.')
    expect(nhiSubtitle()).toBe('Weighted from five factors.')
  })

  it('the caption is built from DEGRADED_AFTER_HOURS, stays within 32 characters and follows the constant', () => {
    expect(avgUptimeCaption()).toBe(`of mints not offline for ${DEGRADED_AFTER_HOURS}h+`)
    expect(avgUptimeCaption().length).toBeLessThanOrEqual(32)
    expect(avgUptimeCaption(72)).not.toBe(avgUptimeCaption())
    expect(avgUptimeCaption(72)).toContain('72h')
  })
})

describe('Latency caption (Mint Detail)', () => {
  it('says where the number was measured, from PROBE_LOCATION, and the button keeps its label', () => {
    expect(CLIENT_LATENCY_BUTTON_LABEL).toBe('Show my latency')
    expect(latencyCaption()).toBe(`server · ${PROBE_LOCATION}`)
    expect(latencyCaption('Helsinki')).toBe('server · Helsinki')
  })

  it('MintDetail renders the caption and the button label from the constants, and has no Latency tooltip', () => {
    const md = src('../pages/MintDetail.tsx')
    expect(md).toContain('{CLIENT_LATENCY_BUTTON_LABEL}')
    expect(md).toContain('{latencyCaption()}')
    expect(md).not.toContain('latencyTooltipText')
    expect(md).not.toContain('latency-info')
  })
})
