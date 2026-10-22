// The tooltip texts state facts the code computes. Every number in a text built here must equal the constant or
// function it comes from (and, for the facts only the backend defines, the backend's own constant), and every
// tooltip text obeys the style rules: at most 220 characters, no ALL CAPS words, none of the verdict words.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import * as T from '@/utils/tooltipTexts'
import { AUDIT_MAX_AGE_HOURS, AUDIT_MIN_SAMPLES, AUDIT_NEUTRAL, AUDIT_TAB_MIN_SAMPLES } from '@/utils/auditScore'
import { NEW_MINT_MAX_DAYS, NEW_MINT_RELIABILITY_CAP, TRACKED_NUT_COUNT, computeReliabilityScore, contactComponent } from '@/utils/reliabilityScore'
import { UNKNOWN_SOFTWARE_POINTS, classifyMintVersion, pointsForMinorsBehind } from '@/utils/versionRule'
import { NHI_WEIGHTS, DEGRADED_AFTER_HOURS, nhiOnlineSetText, nhiOnlineRowText, nhiReliabilityRowText, nhiAdvancedRowText, avgUptimeCaption } from '@/utils/networkHealthIndex'
import { TRACKED_NUTS } from '@/constants/nuts'
import * as nhi from '@/utils/networkHealthIndex'
import * as probeLocation from '@/constants/probeLocation'
import { mintAgeBadge } from '@/utils/mintFormatting'
import { SURGE_ABSOLUTE_GAIN as beGain, SURGE_RATIO as beRatio, SURGE_RATIO_MIN_BASELINE as beBase } from '../../backend/src/reviewSurge'
import { MINT_MELT_BLAMED_RATIO as beBlamed, MINT_MELT_MIN_SWAPS as beMinSwaps } from '../../backend/src/alertTriggers'
import { ALERT_COOLDOWN_HOURS } from '../../backend/src/notificationLimits'

const backend = (rel: string) => readFileSync(resolve(__dirname, '../../backend/src', rel), 'utf8')
// the host name audit.8333.space is a name, not a number
const numbers = (text: string) => (text.replace(/audit\.8333\.space/g, 'the auditor').match(/\d+(?:\.\d+)?/g) ?? []).map(Number)

describe('facts the frontend repeats from the backend', () => {
  it('review surge rule', () => {
    expect([T.SURGE_ABSOLUTE_GAIN, T.SURGE_RATIO, T.SURGE_RATIO_MIN_BASELINE]).toEqual([beGain, beRatio, beBase])
  })
  it('"More alerts" thresholds and cooldowns', () => {
    expect(T.MINT_MELT_BLAMED_RATIO).toBe(beBlamed)
    expect(T.MINT_MELT_MIN_SWAPS).toBe(beMinSwaps)
    expect(T.MINT_MELT_COOLDOWN_HOURS).toBe(ALERT_COOLDOWN_HOURS.mint_melt)
    expect(T.OTHER_ALERT_COOLDOWN_HOURS).toBe(ALERT_COOLDOWN_HOURS.version_outdated)
    expect(T.OTHER_ALERT_COOLDOWN_HOURS).toBe(ALERT_COOLDOWN_HOURS.nut_loss)
  })
  it('audit.8333.space window of the recent figures', () => {
    expect(backend('discovery.ts')).toMatch(new RegExp(`const AUDIT_SWAPS_WINDOW = ${T.AUDIT_SWAPS_WINDOW}\\b`))
  })
  it('uptime window is the last 24 hours of probes', () => {
    expect(backend('prober.ts')).toContain(`INTERVAL '${T.UPTIME_WINDOW_HOURS} hours'`)
  })
  it('"Outdated" starts at OUTDATED_AFTER_MINORS minor versions behind', () => {
    const latest = { nutshell: { major: 0, minor: 20 } }
    const label = (minor: number) => classifyMintVersion(`Nutshell/0.${minor}.0`, latest).label
    expect(label(20 - (T.OUTDATED_AFTER_MINORS - 1))).not.toBe('outdated')
    expect(label(20 - T.OUTDATED_AFTER_MINORS)).toBe('outdated')
  })
  it('the Tracking history row counts a mint as "tracked for a month" once it is no longer Fresh', () => {
    const days = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
    expect(mintAgeBadge(days(29))?.label).toBe('Fresh')
    expect(mintAgeBadge(days(31))?.label).not.toBe('Fresh')
  })
})

describe('numbers in the built texts equal their sources', () => {
  it('score components add up to 100 and the formula states each', () => {
    expect(T.UPTIME_POINTS + T.NUT_POINTS + T.VERSION_POINTS + T.CONTACT_POINTS + T.AUDIT_POINTS).toBe(100)
    // the maxima really are what computeReliabilityScore can award
    const best = computeReliabilityScore(100, TRACKED_NUT_COUNT, 'Nutshell/0.20.0', 3, { blamed: 0, total: AUDIT_MIN_SAMPLES, fetchedAt: new Date().toISOString() }, { nutshell: { major: 0, minor: 20 } }, '2000-01-01T00:00:00Z')
    expect(best).toBe(100)
    expect(numbers(T.scoreFormulaText())).toEqual([T.UPTIME_POINTS, T.NUT_POINTS, T.VERSION_POINTS, T.CONTACT_POINTS, T.AUDIT_POINTS, NEW_MINT_MAX_DAYS, NEW_MINT_RELIABILITY_CAP])
  })
  it('uptime row', () => expect(numbers(T.uptimeRowText())).toEqual([T.UPTIME_WINDOW_HOURS, 100]))
  it('audit row: 7 days, 10 swaps, neutral 12.5 of 25', () => {
    expect(T.AUDIT_WINDOW_DAYS).toBe(AUDIT_MAX_AGE_HOURS / 24)
    expect(numbers(T.auditRowText())).toEqual([T.AUDIT_WINDOW_DAYS, AUDIT_MIN_SAMPLES, AUDIT_NEUTRAL, T.AUDIT_POINTS])
    expect(T.AUDIT_POINTS).toBe(25)
  })
  it('NUT row names no number, and the app tracks TRACKED_NUT_COUNT NUTs', () => {
    expect(numbers(T.NUT_ROW_TEXT)).toEqual([])
    expect(TRACKED_NUTS.length).toBe(TRACKED_NUT_COUNT)
  })
  it('version row: points per minors behind, unknown software', () => {
    const p = pointsForMinorsBehind
    expect(p(0)).toBe(p(1)) // "0-1 minor versions behind" share one value
    expect(p(4)).toBeGreaterThan(0)
    expect(p(5)).toBe(0) // "5 or more"
    expect(numbers(T.versionRowText())).toEqual([0, 1, p(0), 2, p(2), 3, p(3), 4, p(4), 5, p(5), UNKNOWN_SOFTWARE_POINTS])
    expect(T.versionRowText()).toContain('2 = ' + p(2) + ' (Outdated)')
  })
  it('contact row: the full points are reached at CONTACT_FULL_AT contacts, not before', () => {
    expect(contactComponent(T.CONTACT_FULL_AT)).toBe(T.CONTACT_POINTS)
    expect(contactComponent(T.CONTACT_FULL_AT - 1)).toBeLessThan(T.CONTACT_POINTS)
    expect(T.contactRowText()).toBe(`Email, Twitter and Nostr contacts the mint lists. Three or more give the full ${T.CONTACT_POINTS} points.`)
    expect(T.CONTACT_FULL_AT).toBe(3)
  })
  it('review surge text', () => {
    expect(numbers(T.reviewSurgeText())).toEqual([beGain, beBase])
    expect(T.reviewSurgeText()).toContain('at least double')
    expect(beRatio).toBe(2)
  })
  it('operator-excluded note counts the reviews and says where they still are', () => {
    expect(T.operatorExcludedText(1)).toBe("Excludes 1 review from a key that is both listed as the mint's Nostr contact and the author of its NIP-87 announcement. The Reviews tab still lists it, marked Operator.")
    expect(T.operatorExcludedText(3)).toBe("Excludes 3 reviews from a key that is both listed as the mint's Nostr contact and the author of its NIP-87 announcement. The Reviews tab still lists them, marked Operator.")
  })
  it('new-mint cap texts carry the cap and the days', () => {
    expect(numbers(T.newMintBadgeText())).toEqual([NEW_MINT_RELIABILITY_CAP, NEW_MINT_MAX_DAYS])
    expect(numbers(T.newMintCapNote())).toEqual([NEW_MINT_RELIABILITY_CAP, NEW_MINT_MAX_DAYS])
  })
  it('outdated-software text', () => expect(T.outdatedSoftwareText()).toContain('two or more minor versions'))
  it('audit tab text: ~100 swaps window, "too few" below 3', () => {
    expect(numbers(T.auditSuccessRateText())).toEqual([T.AUDIT_SWAPS_WINDOW, AUDIT_TAB_MIN_SAMPLES])
  })
  it('Compare audit success text: 7 days, 10 swaps', () => {
    expect(numbers(T.compareAuditSuccessText())).toEqual([T.AUDIT_WINDOW_DAYS, AUDIT_MIN_SAMPLES])
  })
  it('cashu.info tiles: 7 days', () => {
    expect(numbers(T.depositsTileText())).toEqual([T.AUDIT_WINDOW_DAYS])
    expect(numbers(T.withdrawalsTileText())).toEqual([T.AUDIT_WINDOW_DAYS])
    const f = (n: number) => String(n)
    expect(T.cleanTileText(107, 126, 0, 19, f)).toBe('107 of 126 swaps in the last 7 days, 19 failed for other reasons')
    expect(T.cleanTileText(120, 126, 4, 2, f)).toBe('120 of 126 swaps in the last 7 days, 4 attributed to this mint, 2 other failures')
    expect(T.cleanTileText(126, 126, 0, 0, f)).toBe('126 of 126 swaps in the last 7 days')
  })
  it('cashu.info view text: the score uses the combined number, the tiles are the same data split by direction', () => {
    expect(T.cashuInfoViewText({ fallbackFrom8333: false })).toBe('The Reliability Score uses the combined cashu.info number for the last 7 days. Deposits and withdrawals are the same data split by direction.')
    expect(T.cashuInfoViewText({ fallbackFrom8333: true })).toBe('audit.8333.space has no recent data for this mint. The Reliability Score uses the combined cashu.info number for the last 7 days. Deposits and withdrawals are the same data split by direction.')
    expect(numbers(T.cashuInfoViewText({ fallbackFrom8333: false }))).toEqual([T.AUDIT_WINDOW_DAYS])
  })
  it('More alerts note: ratio, window, minors, cooldowns', () => {
    expect(numbers(T.moreAlertsNote())).toEqual([T.AUDIT_WINDOW_DAYS, T.OUTDATED_AFTER_MINORS, 4, 5, T.MINT_MELT_COOLDOWN_HOURS, T.OTHER_ALERT_COOLDOWN_HOURS])
    expect(T.moreAlertsNote()).toContain('half or more')
    expect(beBlamed).toBe(0.5)
  })
  it('Network Health Index texts carry the weights and the degraded hours', () => {
    expect(Object.keys(NHI_WEIGHTS)).toHaveLength(5)
    expect(numbers(nhiOnlineSetText())).toEqual([DEGRADED_AFTER_HOURS])
    expect(numbers(avgUptimeCaption())).toEqual([DEGRADED_AFTER_HOURS])
  })
})

// ── Style ───────────────────────────────────────────────────────────────────────────────────────────────────
const ALL_CAPS_OK = new Set(['DLEQ', 'JSON', 'HTTP', 'HTTPS', 'BOLT']) // technical names
const VERDICT = /\b(safe|safely|secure|securely|trusted|guaranteed?|recommended?)\b/i

export function styleProblems(text: string): string[] {
  const out: string[] = []
  if (text.length > 220) out.push(`${text.length} characters`)
  for (const w of text.match(/\b[A-Z]{4,}\b/g) ?? []) if (!ALL_CAPS_OK.has(w)) out.push(`ALL CAPS word ${w}`)
  for (const v of text.matchAll(new RegExp(VERDICT.source, 'gi'))) out.push(`verdict word "${v[0]}"`)
  if (/\bminter\b/i.test(text)) out.push('"minter"')
  return out
}

const BUILT: Record<string, string> = {
  scoreFormulaText: T.scoreFormulaText(), uptimeRowText: T.uptimeRowText(), auditRowText: T.auditRowText(), NUT_ROW_TEXT: T.NUT_ROW_TEXT,
  versionRowText: T.versionRowText(), contactRowText: T.contactRowText(), reviewSurgeText: T.reviewSurgeText(),
  UNIT_FILTER_TEXT: T.UNIT_FILTER_TEXT, HIDE_TEST_MINTS_TEXT: T.HIDE_TEST_MINTS_TEXT, outdatedSoftwareText: T.outdatedSoftwareText(),
  TRACKING_HISTORY_TEXT: T.TRACKING_HISTORY_TEXT, BACKUP_SUPPORTED_TEXT: T.BACKUP_SUPPORTED_TEXT, NO_BACKUP_TEXT: T.NO_BACKUP_TEXT,
  AUDIT_MINTS_TEXT: T.AUDIT_MINTS_TEXT, AUDIT_MELTS_TEXT: T.AUDIT_MELTS_TEXT, auditSuccessRateText: T.auditSuccessRateText(),
  REVIEWS_NIP87_TEXT: T.REVIEWS_NIP87_TEXT, SIGNATURE_CHECK_TEXT: T.SIGNATURE_CHECK_TEXT, INPUT_FEE_TEXT: T.INPUT_FEE_TEXT, FEE_PER_COIN_TEXT: T.FEE_PER_COIN_TEXT,
  compareAuditSuccessText: T.compareAuditSuccessText(), sameOperatorText: T.sameOperatorText(['alpha.mint.example', 'twin.mint.example']),
  depositsTileText: T.depositsTileText(), withdrawalsTileText: T.withdrawalsTileText(),
  cleanTileText: T.cleanTileText(120, 126, 4, 2, n => n.toLocaleString('en-US')),
  cashuInfoViewText: T.cashuInfoViewText({ fallbackFrom8333: true }),
  moreAlertsNote: T.moreAlertsNote(), KEYSETS_HINT: T.KEYSETS_HINT, newMintBadgeText: T.newMintBadgeText(), newMintCapNote: T.newMintCapNote(), OPERATOR_REVIEW_NOTE: T.OPERATOR_REVIEW_NOTE, operatorExcludedText: T.operatorExcludedText(2),
  nhiOnlineSetText: nhiOnlineSetText(), nhiOnlineRowText: nhiOnlineRowText(26), nhiReliabilityRowText: nhiReliabilityRowText(),
  nhiAdvancedRowText: nhiAdvancedRowText(),
  ...Object.fromEntries(Object.entries(T.HTTP_ERROR_EXPLANATIONS).map(([k, v]) => [`HTTP ${k}`, v])),
  ...Object.fromEntries(Object.entries(T.NON_HTTP_ERROR_EXPLANATIONS).map(([k, v]) => [k, v])),
}

describe('tooltip style rules', () => {
  for (const [name, text] of Object.entries(BUILT)) {
    it(`${name}: at most 220 characters, no ALL CAPS, no verdict word`, () => {
      expect(styleProblems(text), text).toEqual([])
    })
  }

  // Everything the browser showed in the extraction fixture (e2e/fixtures/tooltip-texts.json), whichever file it comes from.
  it('every text in the e2e extraction fixture obeys the rules', () => {
    const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../e2e/fixtures/tooltip-texts.json'), 'utf8')) as Record<string, { texts: string[] }>
    const bad: string[] = []
    const seen = new Set<string>()
    for (const v of Object.values(fixture)) for (const t of v.texts) {
      if (seen.has(t)) continue
      seen.add(t)
      const p = styleProblems(t.replace(/<[A-Z]+>/g, 'x')) // <ISO> / <DATE> are the fixture's placeholders for a clock-dependent date
      if (p.length) bad.push(`${p.join(', ')}: ${t.slice(0, 80)}`)
    }
    expect(seen.size).toBeGreaterThan(40)
    expect(bad).toEqual([])
  })

  // The four explanations removed 2026-10-14 (Latency tile, Network health index header, average uptime tile, Reliability
  // Score card header) are gone from the extraction, and the builders that produced them are gone from the code.
  it('the removed tooltips are neither in the e2e extraction fixture nor exported any more', () => {
    const fixture = readFileSync(resolve(__dirname, '../../e2e/fixtures/tooltip-texts.json'), 'utf8')
    for (const gone of ['Measured from our server in', 'Five parts, in points', 'Average 24-hour uptime of all mints', 'Score = Uptime×']) {
      expect(fixture, gone).not.toContain(gone)
    }
    expect(nhi).not.toHaveProperty('nhiSummaryText')
    expect(nhi).not.toHaveProperty('avgUptimeText')
    expect(probeLocation).not.toHaveProperty('latencyTooltipText')
  })

  it('the checker itself catches what it should', () => {
    expect(styleProblems('x'.repeat(221))).toHaveLength(1)
    expect(styleProblems('This is SHOUTING')).toEqual(['ALL CAPS word SHOUTING'])
    expect(styleProblems('A DLEQ proof is fine')).toEqual([])
    expect(styleProblems('A secure, trusted mint')).toHaveLength(2)
    expect(styleProblems('Recommended by guaranteed minter')).toHaveLength(3)
  })
})
