import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  NHI_WEIGHTS, ADVANCED_NUTS, ADVANCED_NUT_KEYS, DEGRADED_AFTER_HOURS, advancedAdoptionPercent,
  nhiSummaryText, nhiOnlineSetText, nhiFormulaText, nhiOnlineRowText, nhiReliabilityRowText,
  nhiAdvancedRowText, avgUptimeText,
} from '@/utils/networkHealthIndex'
import { PROBE_LOCATION, CLIENT_LATENCY_BUTTON_LABEL, latencyTooltipText } from '@/constants/probeLocation'

const src = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')
const adoption = (pairs: Record<string, number>) => Object.entries(pairs).map(([k, percent]) => ({ nut: `NUT-${k.padStart(2, '0')}`, count: 0, percent }))

describe('Network Health Index constants', () => {
  it('weights add up to 100 points', () => {
    expect(Object.values(NHI_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('the advanced NUT keys are the ones the index averages', () => {
    expect(ADVANCED_NUT_KEYS).toEqual(['11', '12', '14', '17', '21', '22', '25', '27', '28', '30'])
    expect(ADVANCED_NUT_KEYS).toEqual(ADVANCED_NUTS.map(n => n.key))
    expect(new Set(ADVANCED_NUTS.map(n => n.label)).size).toBe(ADVANCED_NUTS.length)
  })

  it('DEGRADED_AFTER_HOURS equals the backend rule that sets `degraded`', () => {
    const m = /const STALE_OFFLINE_MS = (\d+) \* (\d+) \* (\d+) \* (\d+)/.exec(src('../../backend/src/degraded.ts'))
    expect(m).not.toBeNull()
    expect(m!.slice(1).map(Number).reduce((a, b) => a * b, 1) / 3_600_000).toBe(DEGRADED_AFTER_HOURS)
  })
})

describe('advancedAdoptionPercent', () => {
  it('averages the listed NUTs and counts a NUT missing from the stats as 0%', () => {
    // 11/12/14/17 at 100/100/98/94, the rest absent or 0: (100+100+98+94)/10
    const a = adoption({ '11': 100, '12': 100, '14': 98, '17': 94, '21': 0, '22': 0, '25': 0, '30': 0 })
    expect(advancedAdoptionPercent(a)).toBeCloseTo(39.2, 5)
  })

  it('is non-zero for a NUT-27/28 that the stats do report, 0 for a missing one', () => {
    const only = ADVANCED_NUTS.filter(n => n.key === '27' || n.key === '28')
    expect(advancedAdoptionPercent(adoption({ '27': 50, '28': 30 }), only)).toBe(40)
    expect(advancedAdoptionPercent(adoption({}), only)).toBe(0)
  })

  it('ignores NUTs that are not in the list and handles an empty list', () => {
    expect(advancedAdoptionPercent(adoption({ '4': 100, '5': 100 }))).toBe(0)
    expect(advancedAdoptionPercent(adoption({ '11': 100 }), [])).toBe(0)
  })
})

describe('Network Health Index texts come from the constants', () => {
  it('the summary names every component with its weight', () => {
    const t = nhiSummaryText()
    for (const [k, w] of Object.entries(NHI_WEIGHTS)) expect(t, k).toContain(String(w))
    expect(t).toContain(`online mints ${NHI_WEIGHTS.online}`)
    expect(t).toContain(`network stability ${NHI_WEIGHTS.stability}`)
  })

  it('changing a weight changes the summary, the formula and the row text', () => {
    const w = { online: 40, reliability: 20, diversity: 15, advanced: 15, stability: 10 }
    expect(nhiSummaryText(w)).toContain('online mints 40')
    expect(nhiSummaryText(w)).toContain('network stability 10')
    expect(nhiSummaryText(w)).not.toBe(nhiSummaryText())
    expect(nhiFormulaText(w)).toContain('Online%×40')
    expect(nhiFormulaText(w)).toContain('Stability×10')
    expect(nhiOnlineRowText(36, w)).toBe(nhiOnlineRowText(36, w, DEGRADED_AFTER_HOURS))
    expect(nhiOnlineRowText(36, w)).toContain('36 of 40 points')
  })

  it('the formula and the online-set sentence use the degraded window', () => {
    expect(nhiFormulaText()).toContain(`Online%×${NHI_WEIGHTS.online}`)
    expect(nhiFormulaText()).toContain(nhiOnlineSetText())
    expect(nhiOnlineSetText(48)).toContain('48h')
    expect(nhiOnlineRowText(10, NHI_WEIGHTS, 48)).toContain('48h')
    expect(avgUptimeText(48)).toContain('48h')
    expect(avgUptimeText()).toContain(`${DEGRADED_AFTER_HOURS}h`)
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
    const all = [nhiSummaryText(), nhiOnlineSetText(), nhiFormulaText(), nhiOnlineRowText(27), nhiReliabilityRowText(), nhiAdvancedRowText(), avgUptimeText()]
    for (const t of all) {
      expect(t).not.toMatch(/dashboard/i)
      expect(t).not.toMatch(/\b(safe|secure|trusted|guaranteed|recommended)\b/i)
    }
    expect(nhiSummaryText()).not.toMatch(/uptime/i)
    expect(nhiAdvancedRowText()).toContain('A feature no mint offers counts as 0%')
    expect(nhiReliabilityRowText()).toContain('without a score counts as 0')
    expect(nhiReliabilityRowText()).toContain('Test mints are included')
    expect(avgUptimeText()).toContain('not counted as 0%')
  })

  it('every tooltip stays within 220 characters (the desktop header one is summary + online set)', () => {
    expect(`${nhiSummaryText()} ${nhiOnlineSetText()}`.length).toBeLessThanOrEqual(220)
    expect(`${nhiSummaryText()} Tap the gauge for the full breakdown.`.length).toBeLessThanOrEqual(220)
    for (const t of [nhiOnlineRowText(27), nhiReliabilityRowText(), nhiAdvancedRowText(), avgUptimeText(), latencyTooltipText()]) {
      expect(t.length).toBeLessThanOrEqual(220)
    }
  })
})

describe('Stats.tsx wires the generated texts', () => {
  const stats = src('../pages/Stats.tsx')
  it('uses the constants and no second copy of the numbers or the old claims', () => {
    expect(stats).not.toMatch(/same set as the Dashboard default grid/)
    expect(stats).not.toMatch(/ADVANCED_NUT_KEYS\s*=/)
    expect(stats).not.toMatch(/\* 0\.(30|25|15)\b/)
    expect(stats).toContain('advancedAdoptionPercent(data.nutAdoption)')
    expect(stats).toContain('weight: NHI_WEIGHTS.advanced')
    expect(stats).toContain('{avgUptimeText()}')
    expect(stats).toContain('nhiSummaryText()')
  })
})

describe('Latency tooltip (Mint Detail)', () => {
  it('names the real button label and the probe location from their constants', () => {
    expect(CLIENT_LATENCY_BUTTON_LABEL).toBe('Show my latency')
    expect(latencyTooltipText()).toBe(`Measured from our server in ${PROBE_LOCATION} at the last probe. "${CLIENT_LATENCY_BUTTON_LABEL}" measures from your device.`)
    expect(latencyTooltipText('Helsinki', 'Test')).toBe('Measured from our server in Helsinki at the last probe. "Test" measures from your device.')
    expect(latencyTooltipText()).not.toMatch(/, DE|Click/)
  })

  it('MintDetail renders the button label and the tooltip from the same constants', () => {
    const md = src('../pages/MintDetail.tsx')
    expect(md).toContain('{CLIENT_LATENCY_BUTTON_LABEL}')
    expect(md).toContain('{latencyTooltipText()}')
    expect(md).not.toMatch(/Click &quot;Test&quot;/)
  })
})
